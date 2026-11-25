/**
 * StudyKit v0.4 — `domain/research`
 *
 * Canonical domain contracts for the **Research Evidence Slice**
 * (WP-05). Everything in this file is pure types + type guards
 * + tiny helpers. The file deliberately mirrors the shape of
 * `domain/study.ts` so the two slices feel like siblings:
 *
 *   - SourceLocator     — extended with a `workLocator` so a
 *                         passage can point back to a paper as
 *                         well as a lecture.
 *   - ResearchProject   — owns a Living Brief. Freeform goal
 *                         OR a Research Question; the user is
 *                         never forced into a template.
 *   - LivingBrief       — single free-text field (the
 *                         "working goal"). No ResearchQuestion
 *                         required.
 *   - QuerySpec         — the structured search query the user
 *                         can edit. Always a draft of a
 *                         `SearchRun`.
 *   - SearchRun         — an executed search against one
 *                         provider. Carries the *resolved* query
 *                         snapshot, provider id, status, and
 *                         candidate Work ids. Re-running creates
 *                         a new Run; the lineage stays.
 *   - SearchCandidate   — a Work the provider returned, with
 *                         the *why this paper* chips, the
 *                         provider's original rank, the user's
 *                         verdict (Save / Maybe / Exclude /
 *                         pending) and the inclusion reason.
 *   - Work              — the canonical academic Work. One
 *                         Work, one identity, many identifiers
 *                         and many assets. Metadata carries
 *                         field-level provenance so a mismatch
 *                         between providers is visible.
 *   - Evidence          — a passage with locator + quote +
 *                         interpretation. `candidate | verified
 *                         | rejected`. No verified without
 *                         locator; no verified without user
 *                         interpretation.
 *   - Claim             — the user's claim, optionally tied to
 *                         supporting / contradicting /
 *                         qualifying Evidence. Drafts are
 *                         distinct from canonical claims so
 *                         AI suggestions never silently become
 *                         canonical.
 *   - ClaimEvidenceLink — typed, directional relation between
 *                         Claim and Evidence.
 *
 * Design rules (enforced by type guards):
 *
 *   1. **One concept, one truth.** A `Work` is the only
 *      object that knows about identifiers; `SearchCandidate`
 *      references it, never duplicates it. `Evidence` always
 *      points at a `Work` + locator; an Evidence can never
 *      be `verified` without a complete locator.
 *   2. **Author / AI distinction is explicit.** Every object
 *      has `authorType: 'user' | 'ai' | 'imported'`. AI
 *      suggestions live in `*Draft` shapes (or
 *      `Evidence.status === 'candidate'` for AI-extracted
 *      evidence) until the user Accepts.
 *   3. **No fake locators.** `isCompleteResearchLocator`
 *      returns `false` on partial data; the UI shows
 *      "Source: not available" instead of inventing one.
 *   4. **Field-level provenance is mandatory on `Work`.**
 *      Every metadata field that the resolver wrote carries
 *      the provider + timestamp + revision it came from.
 *      A conflict is visible: `provenance.doi` may not
 *      match the user's entered DOI.
 *   5. **Candidate / verified / rejected.** An Evidence
 *      always has a status. `verified` requires a complete
 *      locator, a non-empty quoteHash OR excerpt, and a
 *      non-empty user interpretation.
 *   6. **ClaimEvidenceLink is a real relation.** It carries
 *      `relation: 'supports' | 'contradicts' | 'qualifies'`
 *      and `authorType`. UI never silently writes it.
 *   7. **Drafts are explicit.** A Claim Draft carries
 *      `status: 'draft' | 'accepted' | 'rejected'` so the
 *      user can see what's still pending.
 *   8. **Timestamps are mandatory.** Every persisted
 *      Research object has `createdAt` and `updatedAt`.
 */

import type { ContainerRef } from './workspace';

// ---------------------------------------------------------------------------
// SourceLocator (research-flavoured extension of `domain/study`).
// ---------------------------------------------------------------------------

/**
 * The kind of research locator. The study locator already
 * supports `pdf-page`, `text-range`, `media-time`,
 * `image-region`, and `web-snapshot`. For Research we add
 * `paper-work` and `paper-page` so a passage can point at
 * a *canonical* Work id (independent of which PDF the
 * user has on disk) AND a specific page within a local PDF
 * asset.
 */
export type ResearchSourceKind =
  | 'paper-work'
  | 'paper-page'
  | 'pdf-page'
  | 'text-range'
  | 'web-snapshot';

export const RESEARCH_SOURCE_KINDS: readonly ResearchSourceKind[] = [
  'paper-work',
  'paper-page',
  'pdf-page',
  'text-range',
  'web-snapshot',
] as const;

export function isResearchSourceKind(value: unknown): value is ResearchSourceKind {
  return (
    value === 'paper-work' ||
    value === 'paper-page' ||
    value === 'pdf-page' ||
    value === 'text-range' ||
    value === 'web-snapshot'
  );
}

export interface ResearchSourceLocator {
  readonly kind: ResearchSourceKind;
  /** Canonical Work id the locator points at. */
  readonly workId: string;
  /**
   * Optional local asset id (e.g. the `sourceDocumentId` of
   * a PDF on disk). Required for `paper-page` (no
   * `paper-page` survives a missing asset — the UI shows
   * a broken source link).
   */
  readonly assetId?: string;
  /** 1-based page number for page-shaped locators. */
  readonly pageNumber?: number;
  /** 0-based text range for `text-range`. */
  readonly start?: number;
  readonly end?: number;
  /** SHA-1 of the trimmed quote (≤ 240 chars). Locator
   *  round-trip uses this to recover after PDF re-import. */
  readonly quoteHash?: string;
  /** URL for `web-snapshot`. */
  readonly url?: string;
  /** When the locator was first captured. */
  readonly capturedAt: string;
  /** Optional rect anchors for a future PDF re-import. */
  readonly rects?: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
}

export function isResearchSourceLocator(value: unknown): value is ResearchSourceLocator {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isResearchSourceKind(v.kind)) return false;
  if (typeof v.workId !== 'string' || v.workId.length === 0) return false;
  if (v.assetId !== undefined && typeof v.assetId !== 'string') return false;
  if (v.pageNumber !== undefined && (typeof v.pageNumber !== 'number' || v.pageNumber < 1)) {
    return false;
  }
  if (v.start !== undefined && (typeof v.start !== 'number' || v.start < 0)) return false;
  if (v.end !== undefined && (typeof v.end !== 'number' || v.end < 0)) return false;
  if (v.quoteHash !== undefined && typeof v.quoteHash !== 'string') return false;
  if (v.url !== undefined && typeof v.url !== 'string') return false;
  if (typeof v.capturedAt !== 'string' || v.capturedAt.length === 0) return false;
  if (v.rects !== undefined) {
    if (!Array.isArray(v.rects)) return false;
    for (const r of v.rects) {
      if (typeof r !== 'object' || r === null) return false;
      const rr = r as Record<string, unknown>;
      if (typeof rr.x !== 'number' || typeof rr.y !== 'number') return false;
      if (typeof rr.width !== 'number' || typeof rr.height !== 'number') return false;
    }
  }
  return true;
}

/**
 * True when the locator carries enough information to
 * round-trip back to the source. A `paper-work` is always
 * complete (a stable Work id is enough). A `paper-page`
 * needs the asset id (so we can re-open the PDF) and a
 * page number. A `pdf-page` needs an asset id too. A
 * `text-range` needs a non-zero range. A `web-snapshot`
 * needs a URL.
 */
export function isCompleteResearchLocator(loc: ResearchSourceLocator | null | undefined): boolean {
  if (!loc) return false;
  switch (loc.kind) {
    case 'paper-work':
      return loc.workId.length > 0;
    case 'paper-page':
      return loc.workId.length > 0 && loc.assetId !== undefined && loc.pageNumber !== undefined;
    case 'pdf-page':
      return loc.assetId !== undefined && loc.pageNumber !== undefined;
    case 'text-range':
      return (
        loc.start !== undefined &&
        loc.end !== undefined &&
        loc.end > (loc.start as number)
      );
    case 'web-snapshot':
      return typeof loc.url === 'string' && loc.url.length > 0;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// ResearchProject
// ---------------------------------------------------------------------------

/**
 * The user picks a `kind` only as a soft default. They are
 * never locked in; a "blank" project can stay blank.
 */
export type ResearchProjectKind = 'blank' | 'explore' | 'review' | 'empirical' | 'thesis';

export const RESEARCH_PROJECT_KINDS: readonly ResearchProjectKind[] = [
  'blank',
  'explore',
  'review',
  'empirical',
  'thesis',
] as const;

export function isResearchProjectKind(value: unknown): value is ResearchProjectKind {
  return (
    value === 'blank' ||
    value === 'explore' ||
    value === 'review' ||
    value === 'empirical' ||
    value === 'thesis'
  );
}

export interface ResearchProject {
  readonly id: string;
  /** Container ref (always project / research). */
  readonly container: ContainerRef;
  /** User-facing name. Freeform. */
  readonly name: string;
  /**
   * The user's freeform goal. May be empty; the UI never
   * demands a Research Question or any other template
   * field. The system *suggests* structured questions in
   * a later packet — the user is not forced to accept.
   */
  readonly livingBrief: string;
  /** Soft default. The user is never locked in. */
  readonly kind: ResearchProjectKind;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isResearchProject(value: unknown): value is ResearchProject {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.container !== 'object' || v.container === null) return false;
  if (v.container && (v.container as { mode?: unknown }).mode !== 'research') return false;
  if (v.container && (v.container as { kind?: unknown }).kind !== 'project') return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.livingBrief !== 'string') return false;
  if (!isResearchProjectKind(v.kind)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

/** A small input the UI uses to create a project. */
export interface CreateResearchProjectInput {
  readonly name: string;
  readonly livingBrief?: string;
  readonly kind?: ResearchProjectKind;
}

/**
 * Alias for the `livingBrief` field on a ResearchProject,
 * so the Project Home can import the type directly.
 * The brief is intentionally a free-text string.
 */
export type LivingBrief = string;

// ---------------------------------------------------------------------------
// QuerySpec
// ---------------------------------------------------------------------------

/**
 * The structured search query. The natural-language question
 * is preserved alongside the structured terms. The user can
 * edit either side; the AI may fill the structured side and
 * the user keeps the last word.
 */
export type QueryStrategy = 'explore' | 'balanced' | 'precise' | 'review';

export const QUERY_STRATEGIES: readonly QueryStrategy[] = [
  'explore',
  'balanced',
  'precise',
  'review',
] as const;

export function isQueryStrategy(value: unknown): value is QueryStrategy {
  return (
    value === 'explore' ||
    value === 'balanced' ||
    value === 'precise' ||
    value === 'review'
  );
}

export interface QueryConcept {
  readonly label: string;
  /** Optional synonyms / alternate spellings the provider
   *  should also match. */
  readonly synonyms: readonly string[];
}

export function isQueryConcept(value: unknown): value is QueryConcept {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.label !== 'string' || v.label.length === 0) return false;
  if (!Array.isArray(v.synonyms)) return false;
  for (const s of v.synonyms) {
    if (typeof s !== 'string') return false;
  }
  return true;
}

export interface QuerySpec {
  readonly id: string;
  readonly projectId: string;
  /** Original natural-language question. */
  readonly question: string;
  /** Concepts the search should focus on. */
  readonly concepts: readonly QueryConcept[];
  /** Terms that must appear (AND). */
  readonly includeTerms: readonly string[];
  /** Terms that must NOT appear (NOT). */
  readonly excludeTerms: readonly string[];
  /** Year range; inclusive. */
  readonly dateRange?: { readonly from?: number; readonly to?: number };
  /** Languages (ISO 639-1 codes, lowercase). */
  readonly languages: readonly string[];
  /** Seed paper ids the user picked. */
  readonly seedWorkIds: readonly string[];
  /** Strategy. */
  readonly strategy: QueryStrategy;
  /** `true` when an AI filled the structured side; the
   *  user can still edit. */
  readonly aiAssisted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isQuerySpec(value: unknown): value is QuerySpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.question !== 'string') return false;
  if (!Array.isArray(v.concepts)) return false;
  for (const c of v.concepts) if (!isQueryConcept(c)) return false;
  if (!Array.isArray(v.includeTerms)) return false;
  for (const t of v.includeTerms) if (typeof t !== 'string') return false;
  if (!Array.isArray(v.excludeTerms)) return false;
  for (const t of v.excludeTerms) if (typeof t !== 'string') return false;
  if (v.dateRange !== undefined) {
    if (typeof v.dateRange !== 'object' || v.dateRange === null) return false;
    const dr = v.dateRange as Record<string, unknown>;
    if (dr.from !== undefined && typeof dr.from !== 'number') return false;
    if (dr.to !== undefined && typeof dr.to !== 'number') return false;
  }
  if (!Array.isArray(v.languages)) return false;
  for (const l of v.languages) if (typeof l !== 'string') return false;
  if (!Array.isArray(v.seedWorkIds)) return false;
  for (const s of v.seedWorkIds) if (typeof s !== 'string') return false;
  if (!isQueryStrategy(v.strategy)) return false;
  if (typeof v.aiAssisted !== 'boolean') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// SearchRun
// ---------------------------------------------------------------------------

export type SearchRunStatus = 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';

export const SEARCH_RUN_STATUSES: readonly SearchRunStatus[] = [
  'running',
  'partial',
  'completed',
  'failed',
  'cancelled',
] as const;

export function isSearchRunStatus(value: unknown): value is SearchRunStatus {
  return (
    value === 'running' ||
    value === 'partial' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

export interface ProviderError {
  readonly providerId: string;
  readonly message: string;
  readonly code?: string;
  /** Optional HTTP status when the provider returned a
   *  non-2xx response. */
  readonly status?: number;
}

export function isProviderError(value: unknown): value is ProviderError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.providerId !== 'string' || v.providerId.length === 0) return false;
  if (typeof v.message !== 'string') return false;
  if (v.code !== undefined && typeof v.code !== 'string') return false;
  if (v.status !== undefined && (typeof v.status !== 'number' || v.status < 0)) return false;
  return true;
}

export interface SearchRun {
  readonly id: string;
  readonly projectId: string;
  /** The QuerySpec snapshot the run executed. */
  readonly querySpecId: string;
  /** Provider that ran the search. */
  readonly providerId: string;
  /** Optional human label (e.g. "OpenAlex — sleep & memory"). */
  readonly label?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: SearchRunStatus;
  /** Candidate Work ids in provider order. */
  readonly candidateWorkIds: readonly string[];
  readonly errors: readonly ProviderError[];
  /** The total number of *raw* hits the provider returned
   *  (before dedup). 0 if unknown. */
  readonly totalHits: number;
  /** Run number, monotonically increasing per project. */
  readonly runNumber: number;
}

export function isSearchRun(value: unknown): value is SearchRun {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.querySpecId !== 'string' || v.querySpecId.length === 0) return false;
  if (typeof v.providerId !== 'string' || v.providerId.length === 0) return false;
  if (v.label !== undefined && typeof v.label !== 'string') return false;
  if (typeof v.startedAt !== 'string' || v.startedAt.length === 0) return false;
  if (v.completedAt !== undefined && typeof v.completedAt !== 'string') return false;
  if (!isSearchRunStatus(v.status)) return false;
  if (!Array.isArray(v.candidateWorkIds)) return false;
  for (const c of v.candidateWorkIds) if (typeof c !== 'string') return false;
  if (!Array.isArray(v.errors)) return false;
  for (const e of v.errors) if (!isProviderError(e)) return false;
  if (typeof v.totalHits !== 'number' || v.totalHits < 0) return false;
  if (typeof v.runNumber !== 'number' || v.runNumber < 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// SearchCandidate
// ---------------------------------------------------------------------------

export type SearchCandidateVerdict = 'pending' | 'saved' | 'maybe' | 'excluded';

export const SEARCH_CANDIDATE_VERDICTS: readonly SearchCandidateVerdict[] = [
  'pending',
  'saved',
  'maybe',
  'excluded',
] as const;

export function isSearchCandidateVerdict(value: unknown): value is SearchCandidateVerdict {
  return (
    value === 'pending' ||
    value === 'saved' ||
    value === 'maybe' ||
    value === 'excluded'
  );
}

export type ReasonChip =
  | 'matches-construct'
  | 'cites-seed'
  | 'cited-by-seed'
  | 'recent-review'
  | 'open-access'
  | 'high-citation'
  | 'manual-seed'
  | 'contradicts-claim';

export const REASON_CHIPS: readonly ReasonChip[] = [
  'matches-construct',
  'cites-seed',
  'cited-by-seed',
  'recent-review',
  'open-access',
  'high-citation',
  'manual-seed',
  'contradicts-claim',
] as const;

export function isReasonChip(value: unknown): value is ReasonChip {
  return (
    value === 'matches-construct' ||
    value === 'cites-seed' ||
    value === 'cited-by-seed' ||
    value === 'recent-review' ||
    value === 'open-access' ||
    value === 'high-citation' ||
    value === 'manual-seed' ||
    value === 'contradicts-claim'
  );
}

export interface SearchCandidate {
  readonly id: string;
  readonly runId: string;
  readonly projectId: string;
  readonly workId: string;
  /**
   * The canonical Work the candidate points at. The
   * repository persists the Work separately; the
   * candidate carries a denormalised copy so the UI
   * can render the result list without a join.
   */
  readonly work: Work;
  /** Provider's 0-based rank within the run. */
  readonly providerRank: number;
  /** Provider's normalised score, 0..1. Optional. */
  readonly providerScore?: number;
  /** Why this paper appeared. The user can read these. */
  readonly reasonChips: readonly ReasonChip[];
  /** A short, human-readable explanation of each chip. */
  readonly reasonNotes: readonly string[];
  /** Verdict the user (or the AI suggestion) assigned. */
  readonly verdict: SearchCandidateVerdict;
  /** User-supplied reason for Exclude (required for review). */
  readonly excludeReason?: string;
  /** When the verdict was last set. */
  readonly verdictAt?: string;
}

export function isSearchCandidate(value: unknown): value is SearchCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.runId !== 'string' || v.runId.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.workId !== 'string' || v.workId.length === 0) return false;
  if (!isWork(v.work)) return false;
  if (typeof v.providerRank !== 'number' || v.providerRank < 0) return false;
  if (v.providerScore !== undefined && typeof v.providerScore !== 'number') return false;
  if (!Array.isArray(v.reasonChips)) return false;
  for (const c of v.reasonChips) if (!isReasonChip(c)) return false;
  if (!Array.isArray(v.reasonNotes)) return false;
  for (const n of v.reasonNotes) if (typeof n !== 'string') return false;
  if (!isSearchCandidateVerdict(v.verdict)) return false;
  if (v.excludeReason !== undefined && typeof v.excludeReason !== 'string') return false;
  if (v.verdictAt !== undefined && typeof v.verdictAt !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Work — canonical academic Work identity
// ---------------------------------------------------------------------------

/**
 * The set of external ids a Work may carry. `doi` is
 * normalised to lowercase without the `https://doi.org/`
 * prefix. `pmid` is a PubMed id (digits only). `arxiv` is
 * the bare arXiv id (no version suffix). `openAlex`,
 * `semanticScholar`, `zotero` carry the raw provider id.
 */
export interface WorkIdentifiers {
  readonly doi?: string;
  readonly pmid?: string;
  readonly arxiv?: string;
  readonly openAlex?: string;
  readonly semanticScholar?: string;
  readonly zotero?: string;
}

export function isWorkIdentifiers(value: unknown): value is WorkIdentifiers {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const k of ['doi', 'pmid', 'arxiv', 'openAlex', 'semanticScholar', 'zotero'] as const) {
    if (v[k] !== undefined && typeof v[k] !== 'string') return false;
  }
  return true;
}

/**
 * Field-level provenance. A work's title may have been
 * merged from OpenAlex + a Zotero import; the two records
 * are kept on the Work so a future conflict is visible.
 */
export interface MetadataSource {
  readonly providerId: string;
  readonly at: string;
  /** Optional field-level revision (e.g. a CSL `version`). */
  readonly revision?: string;
}

export function isMetadataSource(value: unknown): value is MetadataSource {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.providerId !== 'string' || v.providerId.length === 0) return false;
  if (typeof v.at !== 'string' || v.at.length === 0) return false;
  if (v.revision !== undefined && typeof v.revision !== 'string') return false;
  return true;
}

export interface WorkMetadataProvenance {
  readonly title?: MetadataSource;
  readonly authors?: MetadataSource;
  readonly year?: MetadataSource;
  readonly venue?: MetadataSource;
  readonly abstract?: MetadataSource;
  readonly doi?: MetadataSource;
  readonly openAccess?: MetadataSource;
}

export function isWorkMetadataProvenance(value: unknown): value is WorkMetadataProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const k of [
    'title',
    'authors',
    'year',
    'venue',
    'abstract',
    'doi',
    'openAccess',
  ] as const) {
    if (v[k] !== undefined && !isMetadataSource(v[k])) return false;
  }
  return true;
}

export type WorkIntegrity = 'unknown' | 'ok' | 'corrected' | 'retracted' | 'concern';

export const WORK_INTEGRITY_VALUES: readonly WorkIntegrity[] = [
  'unknown',
  'ok',
  'corrected',
  'retracted',
  'concern',
] as const;

export function isWorkIntegrity(value: unknown): value is WorkIntegrity {
  return (
    value === 'unknown' ||
    value === 'ok' ||
    value === 'corrected' ||
    value === 'retracted' ||
    value === 'concern'
  );
}

export type WorkAssetKind = 'local-pdf' | 'oa-url' | 'linked-file';

export const WORK_ASSET_KINDS: readonly WorkAssetKind[] = [
  'local-pdf',
  'oa-url',
  'linked-file',
] as const;

export function isWorkAssetKind(value: unknown): value is WorkAssetKind {
  return (
    value === 'local-pdf' || value === 'oa-url' || value === 'linked-file'
  );
}

/**
 * An asset that lets the user read the Work. Local PDFs
 * are first-class. `oa-url` is an Open Access URL. A
 * `linked-file` is a reference to a file the user did
 * NOT copy into the workspace — the UI shows a "link
 * broken" notice when the file is missing.
 */
export interface WorkAsset {
  readonly id: string;
  readonly workId: string;
  readonly kind: WorkAssetKind;
  /** File path / DOI URL / library id depending on kind. */
  readonly ref: string;
  /** Optional checksum for `local-pdf`. */
  readonly checksum?: string;
  /** Optional content hash, for locator round-trip. */
  readonly contentHash?: string;
  /** Optional page count. */
  readonly pageCount?: number;
  readonly createdAt: string;
}

export function isWorkAsset(value: unknown): value is WorkAsset {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.workId !== 'string' || v.workId.length === 0) return false;
  if (!isWorkAssetKind(v.kind)) return false;
  if (typeof v.ref !== 'string' || v.ref.length === 0) return false;
  if (v.checksum !== undefined && typeof v.checksum !== 'string') return false;
  if (v.contentHash !== undefined && typeof v.contentHash !== 'string') return false;
  if (v.pageCount !== undefined && typeof v.pageCount !== 'number') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  return true;
}

export interface Work {
  readonly id: string;
  /** Stable cross-provider identifiers. */
  readonly identifiers: WorkIdentifiers;
  /** Canonical title. Always user-readable English. */
  readonly title: string;
  /** Canonical authors, "Family, Given; Family, Given". */
  readonly authors: readonly string[];
  /** Year of publication. */
  readonly year?: number;
  /** Venue (journal, conference, repository). */
  readonly venue?: string;
  /** Abstract, trimmed. */
  readonly abstract?: string;
  /** Field-level provenance. Every present field is the
   *  *winning* one; older losers are not kept. A conflict
   *  (e.g. a later import disagrees) is exposed as a
   *  separate Work in the dedup report — the Work the
   *  user chose wins here. */
  readonly metadataProvenance: WorkMetadataProvenance;
  readonly integrity: WorkIntegrity;
  /** When integrity was last checked. */
  readonly integrityCheckedAt?: string;
  /** Assets the user can open. */
  readonly assetIds: readonly string[];
  /** Project ids that include this Work in their library. */
  readonly projectIds: readonly string[];
  /** Free-text reading status the user picked. */
  readonly readingStatus: 'unread' | 'reading' | 'read' | 'reviewed';
  /** Star count 0..5 (UI only). */
  readonly importance: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'ai' | 'imported';
}

export function isWork(value: unknown): value is Work {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (!isWorkIdentifiers(v.identifiers)) return false;
  if (typeof v.title !== 'string') return false;
  if (!Array.isArray(v.authors)) return false;
  for (const a of v.authors) if (typeof a !== 'string') return false;
  if (v.year !== undefined && typeof v.year !== 'number') return false;
  if (v.venue !== undefined && typeof v.venue !== 'string') return false;
  if (v.abstract !== undefined && typeof v.abstract !== 'string') return false;
  if (!isWorkMetadataProvenance(v.metadataProvenance)) return false;
  if (!isWorkIntegrity(v.integrity)) return false;
  if (v.integrityCheckedAt !== undefined && typeof v.integrityCheckedAt !== 'string') {
    return false;
  }
  if (!Array.isArray(v.assetIds)) return false;
  for (const a of v.assetIds) if (typeof a !== 'string') return false;
  if (!Array.isArray(v.projectIds)) return false;
  for (const p of v.projectIds) if (typeof p !== 'string') return false;
  if (
    v.readingStatus !== 'unread' &&
    v.readingStatus !== 'reading' &&
    v.readingStatus !== 'read' &&
    v.readingStatus !== 'reviewed'
  ) {
    return false;
  }
  if (typeof v.importance !== 'number') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'ai' && v.authorType !== 'imported') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceType =
  | 'finding'
  | 'method'
  | 'definition'
  | 'theory'
  | 'limitation'
  | 'context';

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  'finding',
  'method',
  'definition',
  'theory',
  'limitation',
  'context',
] as const;

export function isEvidenceType(value: unknown): value is EvidenceType {
  return (
    value === 'finding' ||
    value === 'method' ||
    value === 'definition' ||
    value === 'theory' ||
    value === 'limitation' ||
    value === 'context'
  );
}

/**
 * `candidate` is the default. AI-extracted evidence
 * arrives in `candidate` and only the user can move it
 * to `verified` (or `rejected`). The Repository refuses
 * to write `verified` without a complete locator + a
 * non-empty user interpretation.
 */
export type EvidenceStatus = 'candidate' | 'verified' | 'rejected';

export const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  'candidate',
  'verified',
  'rejected',
] as const;

export function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return (
    value === 'candidate' || value === 'verified' || value === 'rejected'
  );
}

export interface Evidence {
  readonly id: string;
  /** Project the evidence lives in. */
  readonly projectId: string;
  /** Work the evidence points at. */
  readonly workId: string;
  /** Stable locator. */
  readonly locator: ResearchSourceLocator;
  /**
   * The trimmed quote the user (or AI) selected. ≤ 240
   * chars. The actual quote may be longer; the user
   * excerpt is what shows in the Evidence table.
   */
  readonly exactQuote: string;
  /**
   * The user's own interpretation. The system MUST NOT
   * auto-fill this from AI. Empty interpretation is
   * allowed in `candidate`; required for `verified`.
   */
  readonly userInterpretation: string;
  /** Optional AI candidate interpretation (Draft Layer). */
  readonly aiCandidateInterpretation?: string;
  readonly evidenceType: EvidenceType;
  readonly status: EvidenceStatus;
  /** Free-form notes from the user. */
  readonly note?: string;
  /** The Draft Layer record the evidence came from, if any. */
  readonly draftId?: string;
  /** The run / import / search lineage that surfaced the
   *  work. Optional; absent for manually created evidence. */
  readonly lineageRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'ai' | 'imported';
}

export function isEvidence(value: unknown): value is Evidence {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.workId !== 'string' || v.workId.length === 0) return false;
  if (!isResearchSourceLocator(v.locator)) return false;
  if (typeof v.exactQuote !== 'string') return false;
  if (typeof v.userInterpretation !== 'string') return false;
  if (v.aiCandidateInterpretation !== undefined && typeof v.aiCandidateInterpretation !== 'string') {
    return false;
  }
  if (!isEvidenceType(v.evidenceType)) return false;
  if (!isEvidenceStatus(v.status)) return false;
  if (v.note !== undefined && typeof v.note !== 'string') return false;
  if (v.draftId !== undefined && typeof v.draftId !== 'string') return false;
  if (v.lineageRunId !== undefined && typeof v.lineageRunId !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'ai' && v.authorType !== 'imported') {
    return false;
  }
  return true;
}

/**
 * True when the evidence has everything the UI needs to
 * show "verified" — a complete locator, a non-empty
 * quote, and a non-empty user interpretation. The
 * `status` field is *not* checked here: the UI trusts
 * the user-set status, but the repository re-checks this
 * invariant on every write.
 */
export function isEvidenceReadyForVerification(e: Pick<Evidence, 'locator' | 'exactQuote' | 'userInterpretation'>): boolean {
  return (
    isCompleteResearchLocator(e.locator) &&
    e.exactQuote.trim().length > 0 &&
    e.userInterpretation.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export type ClaimStatus = 'draft' | 'canonical';

export const CLAIM_STATUSES: readonly ClaimStatus[] = ['draft', 'canonical'] as const;

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return value === 'draft' || value === 'canonical';
}

export interface Claim {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly body: string;
  readonly status: ClaimStatus;
  /** True when an AI suggested this claim; the user
   *  reviews it before it becomes `canonical`. */
  readonly aiSuggested: boolean;
  /** The draft record the claim came from, if AI. */
  readonly draftId?: string;
  /** The run that surfaced the supporting evidence, if any. */
  readonly lineageRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'ai';
}

export function isClaim(value: unknown): value is Claim {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.title !== 'string') return false;
  if (typeof v.body !== 'string') return false;
  if (!isClaimStatus(v.status)) return false;
  if (typeof v.aiSuggested !== 'boolean') return false;
  if (v.draftId !== undefined && typeof v.draftId !== 'string') return false;
  if (v.lineageRunId !== undefined && typeof v.lineageRunId !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'ai') return false;
  return true;
}

// ---------------------------------------------------------------------------
// ClaimEvidenceLink
// ---------------------------------------------------------------------------

export type ClaimEvidenceRelation = 'supports' | 'contradicts' | 'qualifies';

export const CLAIM_EVIDENCE_RELATIONS: readonly ClaimEvidenceRelation[] = [
  'supports',
  'contradicts',
  'qualifies',
] as const;

export function isClaimEvidenceRelation(value: unknown): value is ClaimEvidenceRelation {
  return (
    value === 'supports' || value === 'contradicts' || value === 'qualifies'
  );
}

export interface ClaimEvidenceLink {
  readonly id: string;
  readonly projectId: string;
  readonly claimId: string;
  readonly evidenceId: string;
  readonly relation: ClaimEvidenceRelation;
  /** Optional free-form explanation. */
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'ai';
}

export function isClaimEvidenceLink(value: unknown): value is ClaimEvidenceLink {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.claimId !== 'string' || v.claimId.length === 0) return false;
  if (typeof v.evidenceId !== 'string' || v.evidenceId.length === 0) return false;
  if (!isClaimEvidenceRelation(v.relation)) return false;
  if (v.note !== undefined && typeof v.note !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'ai') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Work conflict — surfaced to the user when dedup meets a disagreement
// ---------------------------------------------------------------------------

/**
 * A pair of Works that the dedup resolver thinks are the
 * same academic Work but disagree on at least one
 * metadata field. The user picks the winning Work (or
 * keeps both as separate identities).
 */
export interface WorkConflict {
  readonly id: string;
  readonly projectId: string;
  readonly candidateWorkId: string;
  readonly existingWorkId: string;
  readonly fields: readonly ('title' | 'year' | 'authors' | 'venue' | 'doi')[];
  readonly createdAt: string;
}

export function isWorkConflict(value: unknown): value is WorkConflict {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.candidateWorkId !== 'string') return false;
  if (typeof v.existingWorkId !== 'string') return false;
  if (!Array.isArray(v.fields)) return false;
  for (const f of v.fields) {
    if (
      f !== 'title' &&
      f !== 'year' &&
      f !== 'authors' &&
      f !== 'venue' &&
      f !== 'doi'
    ) {
      return false;
    }
  }
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO timestamp at call time. Pure helper; tests freeze `Date.now`. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Cheap, deterministic quote hash. SHA-1 is the
 * production target; the WP-05 implementation uses
 * FNV-1a 32-bit to avoid pulling `crypto.subtle` into
 * the domain layer (the Dexie adapter does the same).
 * The hash is stable for the same input, good enough
 * for round-trip after a PDF re-import.
 */
export function hashQuote(quote: string): string {
  const trimmed = quote.trim().slice(0, 240);
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i += 1) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned + hex.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canonicalise a DOI. Lowercase, strip URL prefix and
 * trailing whitespace / punctuation.
 */
export function canonicaliseDoi(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().toLowerCase();
  if (s.startsWith('https://doi.org/')) s = s.slice('https://doi.org/'.length);
  if (s.startsWith('http://doi.org/')) s = s.slice('http://doi.org/'.length);
  if (s.startsWith('doi:')) s = s.slice('doi:'.length);
  if (s.startsWith('doi.org/')) s = s.slice('doi.org/'.length);
  s = s.replace(/[)\].,;]+$/, '');
  return s.length === 0 ? undefined : s;
}

/**
 * Canonicalise an arXiv id. Accept "arXiv:2106.09685" or
 * "2106.09685" or "2106.09685v2". Always returns the bare
 * numeric id without the version suffix.
 */
export function canonicaliseArxiv(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().toLowerCase();
  if (s.startsWith('arxiv:')) s = s.slice('arxiv:'.length);
  s = s.replace(/v\d+$/, '');
  s = s.replace(/[)\].,;]+$/, '');
  if (!/^\d{4}\.\d{4,5}$/.test(s)) return undefined;
  return s;
}

/**
 * Canonicalise a PMID: digits only.
 */
export function canonicalisePmid(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/[^\d]/g, '');
  return s.length === 0 ? undefined : s;
}

/**
 * Canonicalise an OpenAlex id. The provider returns ids
 * like "https://openalex.org/W2741809807". We keep the
 * "W" form (the part after the last slash).
 */
export function canonicaliseOpenAlex(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const tail = s.split('/').filter(Boolean).pop();
  if (!tail) return undefined;
  if (!/^w\d+$/i.test(tail)) return undefined;
  return tail.toUpperCase();
}

/**
 * Canonicalise a Semantic Scholar paper id. The provider
 * returns ids like "PMID:27418098" or a 40-char hex hash.
 * Both are accepted; we store the raw value.
 */
export function canonicaliseSemanticScholar(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  return s.length === 0 ? undefined : s;
}

/**
 * Build a `Work` from the common OpenAlex shape. Kept
 * here (not in the provider) so other providers (future
 * Crossref / S2 / arXiv adapters) can share the same
 * canonicalisation.
 */
export interface OpenAlexWorkShape {
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
}

export interface CanonicaliseOpenAlexInput {
  readonly shape: OpenAlexWorkShape;
  readonly fallbackTitle?: string;
  readonly providerId?: string;
  readonly at?: string;
}

/**
 * Convert an OpenAlex `Work` shape into our canonical
 * `Work` record. Returns `null` when the shape is too
 * empty to be a real Work (no title).
 */
export function canonicaliseOpenAlexWork(input: CanonicaliseOpenAlexInput): Work | null {
  const { shape } = input;
  const title = (shape.title || shape.display_name || input.fallbackTitle || '').trim();
  if (title.length === 0) return null;
  const authors = (shape.authorships ?? [])
    .map((a) => (a.author?.display_name ?? '').trim())
    .filter((s) => s.length > 0);
  const year = typeof shape.publication_year === 'number' ? shape.publication_year : undefined;
  const venue = shape.primary_location?.source?.display_name?.trim();
  const abstract = reconstructAbstractFromInverted(shape.abstract_inverted_index);
  const doi = canonicaliseDoi(shape.doi);
  const openAlex = canonicaliseOpenAlex(shape.id);
  const at = input.at ?? nowIso();
  const providerId = input.providerId ?? 'openalex';
  const identifiers: WorkIdentifiers = {
    ...(doi ? { doi } : {}),
    ...(openAlex ? { openAlex } : {}),
  };
  const workId = makeWorkIdFromIdentifiers(identifiers, title, authors, year);
  return {
    id: workId,
    identifiers,
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(abstract ? { abstract } : {}),
    metadataProvenance: {
      title: { providerId, at },
      authors: { providerId, at },
      ...(year !== undefined ? { year: { providerId, at } } : {}),
      ...(venue ? { venue: { providerId, at } } : {}),
      ...(abstract ? { abstract: { providerId, at } } : {}),
      ...(doi ? { doi: { providerId, at } } : {}),
      ...(shape.open_access
        ? { openAccess: { providerId, at } }
        : {}),
    },
    integrity: 'unknown',
    assetIds: [],
    projectIds: [],
    readingStatus: 'unread',
    importance: 0,
    createdAt: at,
    updatedAt: at,
    authorType: 'imported',
  };
}

/**
 * Reconstruct an abstract from OpenAlex's
 * `abstract_inverted_index` shape (a word → positions
 * map). We rebuild the sentence and trim it to a
 * reasonable length.
 */
export function reconstructAbstractFromInverted(
  index: Record<string, readonly number[]> | undefined | null,
): string | undefined {
  if (!index) return undefined;
  const positions: Array<{ pos: number; word: string }> = [];
  for (const [word, idxs] of Object.entries(index)) {
    if (!Array.isArray(idxs)) continue;
    for (const p of idxs) {
      if (typeof p === 'number' && p >= 0) positions.push({ pos: p, word });
    }
  }
  if (positions.length === 0) return undefined;
  positions.sort((a, b) => a.pos - b.pos);
  const text = positions.map((p) => p.word).join(' ').trim();
  if (text.length === 0) return undefined;
  return text.length > 1500 ? `${text.slice(0, 1500).trim()}…` : text;
}

/**
 * Build a stable Work id from identifiers + a normalised
 * title fallback. Pure function. Identifiers (DOI, OpenAlex
 * id, etc.) are *stronger* signals than the title — when
 * any identifier is present the id is derived from it, so
 * the same paper always has the same Work id.
 */
export function makeWorkIdFromIdentifiers(
  ids: WorkIdentifiers,
  title: string,
  authors: readonly string[],
  year: number | undefined,
): string {
  if (ids.doi) return `doi:${ids.doi}`;
  if (ids.pmid) return `pmid:${ids.pmid}`;
  if (ids.arxiv) return `arxiv:${ids.arxiv}`;
  if (ids.openAlex) return `oa:${ids.openAlex}`;
  if (ids.semanticScholar) return `s2:${ids.semanticScholar}`;
  if (ids.zotero) return `zot:${ids.zotero}`;
  // Fallback: normalised title + first author + year. Not
  // bullet-proof across re-imports but stable for a single
  // session.
  const t = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .trim()
    .slice(0, 80);
  const a = (authors[0] ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').trim();
  const y = year ? `y${year}` : '';
  return `t:${t}::a:${a}::${y}`;
}

/**
 * Compare two Works for *possible* dedup. Returns the set
 * of fields that disagree. Empty array → no disagreement.
 */
export function compareWorkMetadata(a: Work, b: Work): ReadonlyArray<'title' | 'year' | 'authors' | 'venue' | 'doi'> {
  const out: Array<'title' | 'year' | 'authors' | 'venue' | 'doi'> = [];
  if (normaliseTitle(a.title) !== normaliseTitle(b.title)) out.push('title');
  if ((a.year ?? null) !== (b.year ?? null)) out.push('year');
  if (JSON.stringify(normaliseAuthors(a.authors)) !== JSON.stringify(normaliseAuthors(b.authors))) {
    out.push('authors');
  }
  if ((a.venue ?? '').trim() !== (b.venue ?? '').trim()) out.push('venue');
  if ((a.identifiers.doi ?? '') !== (b.identifiers.doi ?? '')) out.push('doi');
  return out;
}

function normaliseTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normaliseAuthors(authors: readonly string[]): readonly string[] {
  return authors.map((a) => a.toLowerCase().replace(/\s+/g, ' ').trim()).sort();
}
