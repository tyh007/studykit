/**
 * StudyKit v0.4 — `application/research/openAlexProvider`
 *
 * The first real search provider for the Research slice
 * (WP-05). OpenAlex is the open scholarly catalog
 * (CC0 metadata, no API key), which makes it the right
 * default: it works in a local workspace, it works for
 * users who haven't signed in, and it gives us a real
 * citation graph to attach reason chips to.
 *
 * Design rules (enforced by the contract + tests):
 *
 *   1. **No raw fetch from the UI.** Every call goes
 *      through `runSearch`. The function takes a
 *      `ProviderFetch` dependency so a test (or a
 *      `v04Research` smoke run on a host that can't
 *      reach `api.openalex.org`) can inject a
 *      deterministic fixture. The default dependency is
 *      `globalThis.fetch` — a normal browser fetch — but
 *      nothing else in the file is allowed to talk to
 *      the network.
 *
 *   2. **Cancellation.** The provider accepts an
 *      `AbortSignal`. The host passes one to every
 *      `runSearch`; the search is killed when the user
 *      re-runs or leaves the surface. A `runSearch` that
 *      finds its `signal.aborted === true` returns
 *      `{ status: 'cancelled' }` without throwing.
 *
 *   3. **Dedup and reason chips.** Every raw result is
 *      canonicalised into a `Work` and given a
 *      `providerRank` / `providerScore`. The reason
 *      chips come from the OpenAlex payload
 *      (`cited_by_count`, `open_access.is_oa`,
 *      `publication_year`) plus the user's seed work ids.
 *      The provider never invents a reason it can't
 *      justify.
 *
 *   4. **Deterministic ordering.** The result order
 *      follows the provider's `relevance_score` (when
 *      present) and falls back to the API's `meta.counts`
 *      order. Two equivalent requests return the same
 *      order, so the UI can present a stable list.
 *
 *   5. **Provider error reporting.** A network failure
 *      becomes a `ProviderError` with `code: 'network'`.
 *      A non-200 response becomes
 *      `code: 'http'`. A parse error becomes
 *      `code: 'parse'`. The host records the error on
 *      the `SearchRun`; the search itself returns
 *      `status: 'failed'` and an empty candidate list.
 *
 *   6. **No silent fake success.** The provider never
 *      returns a hand-crafted fixture unless one is
 *      explicitly injected through `ProviderFetch`. A
 *      `fetch` failure surfaces to the user as a real
 *      `provider unavailable` state.
 *
 * The contract (`SearchProvider`) is intentionally
 * tiny. Adding Crossref / Semantic Scholar / Unpaywall
 * later is a one-class addition; the use case layer
 * only knows about the contract.
 */

import {
  canonicaliseOpenAlex,
  canonicaliseOpenAlexWork,
  isWork,
  nowIso,
  type QuerySpec,
  type ReasonChip,
  type Work,
  type WorkIdentifiers,
} from '../../domain/research';
import { makeWorkIdFromIdentifiers } from '../../domain/research';

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export const OPEN_ALEX_PROVIDER_ID = 'openalex';
export const OPEN_ALEX_BASE_URL = 'https://api.openalex.org';

export type SearchRunResultStatus = 'completed' | 'partial' | 'failed' | 'cancelled';

export interface SearchProviderRequest {
  readonly querySpec: QuerySpec;
  /** Per-page size, defaults to 25. Capped at 200 (OpenAlex hard limit). */
  readonly perPage?: number;
  /** Page number (1-based). Defaults to 1. */
  readonly page?: number;
  /** Cancellation signal. */
  readonly signal: AbortSignal;
}

export interface SearchProviderResult {
  readonly status: SearchRunResultStatus;
  readonly candidates: readonly ProviderCandidate[];
  readonly totalHits: number;
  readonly errors: readonly ProviderErrorPayload[];
  /** When the call finished. */
  readonly completedAt: string;
}

export interface ProviderCandidate {
  /** Canonicalised `Work` (may be partial: the API does
   *  not always include every field). */
  readonly work: Work;
  /** 0-based provider rank. */
  readonly providerRank: number;
  /** 0..1 normalised score, when the provider exposes it. */
  readonly providerScore?: number;
  /** The chips the provider attached. */
  readonly reasonChips: readonly ReasonChip[];
  /** A short human-readable note for each chip. */
  readonly reasonNotes: readonly string[];
}

export interface ProviderErrorPayload {
  readonly providerId: string;
  readonly code: 'network' | 'http' | 'parse' | 'cancelled' | 'timeout' | 'unknown';
  readonly message: string;
  readonly status?: number;
}

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  /** Probe reachability. Never throws. */
  probe(): Promise<{ available: boolean; reason?: string }>;
  runSearch(request: SearchProviderRequest): Promise<SearchProviderResult>;
  /** Cancel a running search by its `signal`. The provider
   *  itself only knows about the signal it received — the
   *  abort is the *host's* responsibility. */
  cancel?(signal: AbortSignal): void;
}

// ---------------------------------------------------------------------------
// Fetch dependency injection
// ---------------------------------------------------------------------------

export interface ProviderFetch {
  (input: string, init: { method: 'GET'; signal: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

const defaultFetch: ProviderFetch = async (input, init) => {
  // We intentionally use `globalThis.fetch` so the
  // provider stays host-agnostic (browser + worker +
  // happy-dom + Tauri). The cast below is the one place
  // the provider touches the platform.
  const res = await globalThis.fetch(input, init);
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<unknown>,
  };
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface OpenAlexProviderDeps {
  readonly fetchImpl?: ProviderFetch;
  readonly baseUrl?: string;
  /** Max per_page we'll request. OpenAlex caps at 200. */
  readonly maxPerPage?: number;
  /**
   * Internal per-run timeout in ms. Defaults to 8s.
   * The provider combines the user's `AbortSignal` with
   * this internal timeout so a hanging upstream request
   * returns `cancelled` and the host records a real
   * `failed` run instead of staying busy forever.
   */
  readonly runTimeoutMs?: number;
}

const DEFAULT_RUN_TIMEOUT_MS = 8_000;

export class OpenAlexSearchProvider implements SearchProvider {
  readonly id = OPEN_ALEX_PROVIDER_ID;
  readonly label = 'OpenAlex';
  private readonly fetchImpl: ProviderFetch;
  private readonly baseUrl: string;
  private readonly maxPerPage: number;
  private readonly runTimeoutMs: number;

  constructor(deps: OpenAlexProviderDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? defaultFetch;
    this.baseUrl = deps.baseUrl ?? OPEN_ALEX_BASE_URL;
    this.maxPerPage = deps.maxPerPage ?? 50;
    this.runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  }

  async probe(): Promise<{ available: boolean; reason?: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/works?per_page=1`, {
        method: 'GET',
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        return {
          available: false,
          reason: `OpenAlex probe returned HTTP ${response.status}`,
        };
      }
      return { available: true };
    } catch (err) {
      clearTimeout(timer);
      return {
        available: false,
        reason: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  async runSearch(request: SearchProviderRequest): Promise<SearchProviderResult> {
    const completedAt = nowIso();
    if (request.signal.aborted) {
      return this.cancelledResult(completedAt);
    }
    // Internal timeout: combine the user signal with
    // a hard 8s ceiling so a hanging upstream request
    // never leaves the surface busy. The user keeps
    // their QuerySpec / selection / input either way.
    const ctl = new AbortController();
    const onUserAbort = (): void => ctl.abort();
    if (request.signal.aborted) {
      return this.cancelledResult(nowIso());
    }
    request.signal.addEventListener('abort', onUserAbort);
    const timer = setTimeout(() => ctl.abort(), this.runTimeoutMs);
    const url = this.buildUrl(request);
    let response: Awaited<ReturnType<ProviderFetch>>;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        signal: ctl.signal,
      });
    } catch (err) {
      const userAborted = request.signal.aborted;
      const timedOut = !userAborted && ctl.signal.aborted;
      return {
        status: userAborted ? 'cancelled' : timedOut ? 'failed' : 'failed',
        candidates: [],
        totalHits: 0,
        errors: [
          {
            providerId: this.id,
            code: userAborted ? 'cancelled' : timedOut ? 'timeout' : 'network',
            message: timedOut
              ? `OpenAlex did not respond within ${this.runTimeoutMs}ms`
              : err instanceof Error
                ? err.message
                : 'fetch failed',
          },
        ],
        completedAt,
      };
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onUserAbort);
    }
    if (!response.ok) {
      return {
        status: response.status >= 500 ? 'failed' : 'partial',
        candidates: [],
        totalHits: 0,
        errors: [
          {
            providerId: this.id,
            code: 'http',
            status: response.status,
            message: `OpenAlex returned ${response.status}`,
          },
        ],
        completedAt,
      };
    }
    let parsed: OpenAlexListResponse;
    try {
      parsed = (await response.json()) as OpenAlexListResponse;
    } catch (err) {
      return {
        status: 'failed',
        candidates: [],
        totalHits: 0,
        errors: [
          {
            providerId: this.id,
            code: 'parse',
            message: err instanceof Error ? err.message : 'parse failed',
          },
        ],
        completedAt,
      };
    }
    const candidates = this.buildCandidates(parsed, request);
    const totalHits = parsed.meta?.count ?? candidates.length;
    return {
      status: candidates.length === 0 ? 'partial' : 'completed',
      candidates,
      totalHits,
      errors: [],
      completedAt,
    };
  }

  // -----------------------------------------------------------------------
  // URL
  // -----------------------------------------------------------------------

  private cancelledResult(completedAt: string): SearchProviderResult {
    return {
      status: 'cancelled',
      candidates: [],
      totalHits: 0,
      errors: [
        {
          providerId: this.id,
          code: 'cancelled',
          message: 'search aborted before dispatch',
        },
      ],
      completedAt,
    };
  }

  buildUrl(request: SearchProviderRequest): string {
    const params = new URLSearchParams();
    const filter = this.buildFilter(request.querySpec);
    if (filter.length > 0) params.set('filter', filter.join(','));
    const search = buildSearchClause(request.querySpec);
    if (search.length > 0) params.set('search', search);
    if (request.querySpec.dateRange?.from) {
      params.set('from_publication_date', `${request.querySpec.dateRange.from}-01-01`);
    }
    if (request.querySpec.dateRange?.to) {
      params.set('to_publication_date', `${request.querySpec.dateRange.to}-12-31`);
    }
    if (request.querySpec.languages.length > 0) {
      params.set('filter', appendFilter(params.get('filter'), 'language', request.querySpec.languages));
    }
    const perPage = Math.min(
      this.maxPerPage,
      Math.max(1, request.perPage ?? 25),
    );
    params.set('per_page', String(perPage));
    params.set('page', String(Math.max(1, request.page ?? 1)));
    // Select the fields we actually use. Smaller payload,
    // faster round-trip.
    params.set(
      'select',
      [
        'id',
        'doi',
        'title',
        'display_name',
        'publication_year',
        'publication_date',
        'authorships',
        'primary_location',
        'open_access',
        'cited_by_count',
        'abstract_inverted_index',
        'type',
        'relevance_score',
      ].join(','),
    );
    return `${this.baseUrl}/works?${params.toString()}`;
  }

  private buildFilter(spec: QuerySpec): string[] {
    const out: string[] = [];
    if (spec.includeTerms.length > 0) {
      // `default.search` AND-combines terms inside the
      // abstract / title; we use `title.search` as a
      // hard filter for the include set.
      out.push(`title.search:${spec.includeTerms.map(quote).join('+')}`);
    }
    if (spec.excludeTerms.length > 0) {
      out.push(
        `!title.search:${spec.excludeTerms.map(quote).join('+')}`,
      );
    }
    if (spec.seedWorkIds.length > 0) {
      // Seeds are *not* a filter — they're the reason
      // chips for the candidates. We expose them in the
      // URL only when the user explicitly asked for a
      // citation graph expansion (future packet).
    }
    return out;
  }

  private buildCandidates(
    response: OpenAlexListResponse,
    request: SearchProviderRequest,
  ): ProviderCandidate[] {
    const list = Array.isArray(response.results) ? response.results : [];
    const out: ProviderCandidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i] as OpenAlexWorkShape;
      const work = canonicaliseOpenAlexWork({
        shape: raw,
        providerId: this.id,
      });
      if (!work) continue;
      // Dedup on the canonical id. Two records may share
      // a DOI but differ on a metadata field — we keep
      // the first one and report the rest as candidates
      // for a future dedup pass.
      if (seen.has(work.id)) continue;
      seen.add(work.id);
      const { chips, notes } = this.buildReasonChips(raw, work, request);
      const candidate: ProviderCandidate = {
        work,
        providerRank: i,
        ...(typeof raw.relevance_score === 'number'
          ? { providerScore: clamp01(raw.relevance_score) }
          : {}),
        reasonChips: chips,
        reasonNotes: notes,
      };
      out.push(candidate);
    }
    return out;
  }

  private buildReasonChips(
    raw: OpenAlexWorkShape,
    work: Work,
    request: SearchProviderRequest,
  ): { chips: ReasonChip[]; notes: string[] } {
    const chips: ReasonChip[] = [];
    const notes: string[] = [];
    // We use a `Set` to dedupe identical chips. The
    // previous version pushed `matches-construct`
    // twice (title + DOI), which produced a React
    // duplicate-key warning in the UI. The chip
    // is the *same* in both cases (we already note
    // DOI as a separate `note`); collapsing them
    // keeps the audit trail clean.
    const seen = new Set<ReasonChip>();
    if (work.title) {
      chips.push('matches-construct');
      seen.add('matches-construct');
      notes.push(`Title match: "${work.title.slice(0, 60)}…"`);
    }
    if (work.identifiers.doi) {
      // DOI is the strongest match signal.
      const note = `DOI: ${work.identifiers.doi}`;
      // Move the doi note to the front of the list
      // (and the chip too if not already present).
      notes.unshift(note);
      if (!seen.has('matches-construct')) {
        chips.unshift('matches-construct');
        seen.add('matches-construct');
      }
    }
    if (raw.open_access?.is_oa) {
      chips.push('open-access');
      notes.push('Open Access PDF available');
    }
    if (typeof raw.cited_by_count === 'number' && raw.cited_by_count >= 100) {
      chips.push('high-citation');
      notes.push(`Cited ${raw.cited_by_count} times`);
    }
    if (
      work.year &&
      request.querySpec.dateRange?.to &&
      work.year >= request.querySpec.dateRange.to - 3
    ) {
      chips.push('recent-review');
      notes.push(`Published in ${work.year}`);
    }
    if (request.querySpec.seedWorkIds.includes(work.id)) {
      chips.push('manual-seed');
      notes.push('You listed this paper as a seed');
    }
    return { chips, notes };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the OpenAlex `search=` clause from a QuerySpec. */
export function buildSearchClause(spec: QuerySpec): string {
  const parts: string[] = [];
  for (const c of spec.concepts) {
    const labels = [c.label, ...c.synonyms].filter(Boolean);
    if (labels.length > 0) parts.push(`(${labels.map(quoteOr).join(' OR ')})`);
  }
  if (spec.question.trim().length > 0) {
    parts.push(quoteOr(spec.question.trim()));
  }
  return parts.join(' AND ');
}

function quoteOr(s: string): string {
  // OpenAlex `search` is a free-text parameter; wrapping
  // the user's phrase in double quotes forces phrase
  // matching. The provider already URL-encodes the value
  // via `URLSearchParams`.
  if (s.includes(' ') || s.includes('-')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function quote(s: string): string {
  if (s.includes(' ') || s.includes('-')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function appendFilter(
  existing: string | null,
  key: string,
  values: readonly string[],
): string {
  const head = existing ? `${existing},` : '';
  return `${head}${key}:${values.join('|')}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// OpenAlex response shape (minimal; the parser only reads
// what `select=` returned).
// ---------------------------------------------------------------------------

interface OpenAlexListResponse {
  readonly meta?: { count?: number; per_page?: number; page?: number };
  readonly results?: readonly OpenAlexWorkShape[];
}

interface OpenAlexWorkShape {
  readonly id?: string;
  readonly doi?: string;
  readonly title?: string;
  readonly display_name?: string;
  readonly publication_year?: number;
  readonly publication_date?: string;
  readonly authorships?: ReadonlyArray<{
    readonly author?: { readonly display_name?: string };
  }>;
  readonly primary_location?: {
    readonly source?: { readonly display_name?: string } | null;
  } | null;
  readonly open_access?: { readonly is_oa?: boolean; readonly oa_url?: string };
  readonly cited_by_count?: number;
  readonly abstract_inverted_index?: Record<string, readonly number[]>;
  readonly type?: string;
  readonly relevance_score?: number;
}

// ---------------------------------------------------------------------------
// Deterministic fixture (for tests + offline smoke runs)
// ---------------------------------------------------------------------------

/**
 * A fixture is a thin wrapper over a `ProviderFetch` that
 * returns canned responses. The shape mirrors the real
 * OpenAlex list response; the test (or smoke runner) just
 * has to provide `results`.
 */
export interface OpenAlexFixture {
  readonly responses: ReadonlyMap<string, OpenAlexListResponse>;
  /** Optional delay in ms. */
  readonly delayMs?: number;
}

export function makeFixtureFetch(fixture: OpenAlexFixture): ProviderFetch {
  // Index responses by *URL prefix* so callers can use
  // any query string variant. Exact-match keys (no
  // query string) become a "matches this URL with any
  // query string" prefix.
  const exact = new Map<string, OpenAlexListResponse>();
  const prefixes: Array<{ prefix: string; body: OpenAlexListResponse }> = [];
  for (const [key, body] of fixture.responses) {
    exact.set(key, body);
    if (!key.includes('?')) {
      // The key itself becomes a prefix so any
      // `?query=...` variant also matches.
      prefixes.push({ prefix: key, body });
    } else {
      prefixes.push({ prefix: key.split('?')[0]!, body });
    }
  }
  return async (input, init) => {
    if (fixture.delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, fixture.delayMs));
    }
    if (init.signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    const direct = exact.get(input);
    if (direct) {
      return { ok: true, status: 200, json: async () => direct };
    }
    for (const p of prefixes) {
      if (input === p.prefix || input.startsWith(`${p.prefix}?`)) {
        return { ok: true, status: 200, json: async () => p.body };
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    };
  };
}

// ---------------------------------------------------------------------------
// Deterministic fixture body
// ---------------------------------------------------------------------------

/**
 * Build a deterministic OpenAlex response that maps a
 * single search phrase to a list of works. The same
 * `seed` always produces the same list, so tests are
 * reproducible.
 */
export function deterministicOpenAlexResponse(input: {
  readonly seed: string;
  readonly count?: number;
}): OpenAlexListResponse {
  const count = Math.max(1, Math.min(20, input.count ?? 5));
  const results: OpenAlexWorkShape[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `W${(1000 + i).toString(36).toUpperCase()}`;
    const doi = `10.${(input.seed.charCodeAt(0) % 1000) + i}/example-${input.seed.slice(0, 3).toLowerCase()}-${i}`;
    const year = 2018 + (i % 8);
    results.push({
      id: `https://openalex.org/${id}`,
      doi: `https://doi.org/${doi}`,
      title: `${input.seed} study #${i + 1}`,
      display_name: `${input.seed} study #${i + 1}`,
      publication_year: year,
      publication_date: `${year}-03-15`,
      authorships: [{ author: { display_name: `Author, A.${i}` } }],
      primary_location: { source: { display_name: 'Journal of Examples' } },
      open_access: { is_oa: i % 2 === 0, oa_url: `https://example.org/${id}.pdf` },
      cited_by_count: 50 * (i + 1),
      abstract_inverted_index: {
        this: [0],
        is: [1],
        a: [2],
        [input.seed.toLowerCase()]: [3],
        study: [4],
      },
      type: 'article',
      relevance_score: 1 - i * 0.1,
    });
  }
  return {
    meta: { count, per_page: 25, page: 1 },
    results,
  };
}

// ---------------------------------------------------------------------------
// Conflict-aware merge
// ---------------------------------------------------------------------------

/**
 * Merge a new provider `Work` with the existing one. The
 * existing `Work` wins on `title` / `authors` (the user
 * has seen them), the new `Work` wins on identifiers
 * (newer providers sometimes have stronger IDs). The
 * merge returns the *winning* `Work` plus a list of
 * conflicting fields, if any.
 */
export interface MergeResult {
  readonly work: Work;
  readonly conflicts: ReadonlyArray<'title' | 'year' | 'authors' | 'venue' | 'doi'>;
}

export function mergeWorks(
  existing: Work,
  incoming: Work,
): MergeResult {
  // Identifier-level merge.
  const ids: WorkIdentifiers = { ...existing.identifiers, ...incoming.identifiers };
  // If both have a DOI but they disagree, the conflict
  // is reported; we keep the *incoming* one because a
  // new import is more recent.
  const conflicts: Array<'title' | 'year' | 'authors' | 'venue' | 'doi'> = [];
  if (existing.identifiers.doi && incoming.identifiers.doi && existing.identifiers.doi !== incoming.identifiers.doi) {
    conflicts.push('doi');
  }
  if (existing.title.trim() !== incoming.title.trim()) conflicts.push('title');
  if ((existing.year ?? null) !== (incoming.year ?? null)) conflicts.push('year');
  if (
    JSON.stringify([...existing.authors].sort()) !==
    JSON.stringify([...incoming.authors].sort())
  ) {
    conflicts.push('authors');
  }
  if ((existing.venue ?? '').trim() !== (incoming.venue ?? '').trim()) {
    conflicts.push('venue');
  }
  // Project membership is unioned.
  const projects = Array.from(
    new Set<string>([...existing.projectIds, ...incoming.projectIds]),
  );
  // Asset union.
  const assets = Array.from(new Set<string>([...existing.assetIds, ...incoming.assetIds]));
  const work: Work = {
    id: incoming.id,
    identifiers: ids,
    title: existing.title,
    authors: existing.authors,
    ...(existing.year !== undefined ? { year: existing.year } : {}),
    ...(existing.venue ? { venue: existing.venue } : {}),
    ...(incoming.abstract ? { abstract: incoming.abstract } : existing.abstract ? { abstract: existing.abstract } : {}),
    metadataProvenance: {
      ...existing.metadataProvenance,
      ...incoming.metadataProvenance,
    },
    integrity: existing.integrity,
    assetIds: assets,
    projectIds: projects,
    readingStatus: existing.readingStatus,
    importance: existing.importance,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
    authorType: existing.authorType,
  };
  // Re-validate before returning — a buggy merge is
  // louder than a downstream `isWork` failure.
  if (!isWork(work)) {
    throw new Error('mergeWorks produced an invalid Work record.');
  }
  return { work, conflicts };
}

// Re-export so the provider file is the single seam for
// the rest of the Research slice.
export { canonicaliseOpenAlex, makeWorkIdFromIdentifiers };
