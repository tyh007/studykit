import {
  canonicaliseDoi,
  canonicaliseOpenAlex,
  canonicaliseOpenAlexWork,
  type OpenAlexWorkShape,
  type Work,
  type WorkIntegrity,
} from '../../domain/research';
import type { ResearchRepository } from '../research/researchRepository';

export type VerifiableWorkField = 'title' | 'authors' | 'year' | 'venue' | 'doi';

export interface VerifiedWorkMetadata {
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly year?: number;
  readonly venue?: string;
  readonly doi?: string;
}

export interface CitationVerificationSource {
  readonly providerId: 'crossref' | 'openalex';
  readonly registryId: string;
  readonly metadata: VerifiedWorkMetadata;
  readonly integrity: WorkIntegrity;
  readonly checkedAt: string;
}

export interface CitationMetadataDifference {
  readonly field: VerifiableWorkField;
  readonly current: string | number | readonly string[] | undefined;
  readonly proposed: string | number | readonly string[];
  readonly providerId: CitationVerificationSource['providerId'];
}

export interface CitationVerificationResult {
  readonly workId: string;
  readonly baseUpdatedAt: string;
  readonly checkedAt: string;
  readonly sources: readonly CitationVerificationSource[];
  readonly differences: readonly CitationMetadataDifference[];
  readonly integrity: WorkIntegrity;
  readonly errors: readonly string[];
}

export interface CitationMetadataVerifier {
  verify(work: Work, options?: { readonly signal?: AbortSignal }): Promise<CitationVerificationResult>;
}

type VerificationFetch = (
  input: string,
  init?: { readonly method?: string; readonly signal?: AbortSignal; readonly headers?: Record<string, string> },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

interface CrossrefMessage {
  readonly DOI?: string;
  readonly title?: readonly string[];
  readonly author?: ReadonlyArray<{ readonly family?: string; readonly given?: string }>;
  readonly issued?: { readonly 'date-parts'?: readonly (readonly number[])[] };
  readonly published?: { readonly 'date-parts'?: readonly (readonly number[])[] };
  readonly 'container-title'?: readonly string[];
  readonly 'update-to'?: ReadonlyArray<{ readonly type?: string }>;
  readonly 'updated-by'?: ReadonlyArray<{ readonly type?: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function crossrefIntegrity(message: CrossrefMessage): WorkIntegrity {
  const updates = [...(message['update-to'] ?? []), ...(message['updated-by'] ?? [])]
    .map((update) => update.type?.toLowerCase() ?? '');
  if (updates.some((type) => type.includes('retract'))) return 'retracted';
  if (updates.some((type) => type.includes('concern'))) return 'concern';
  if (updates.some((type) => type.includes('correct'))) return 'corrected';
  return 'ok';
}

export function parseCrossrefVerification(
  value: unknown,
  expectedDoi: string,
  checkedAt: string,
): CitationVerificationSource {
  const root = asRecord(value);
  const message = asRecord(root?.message) as CrossrefMessage | null;
  if (!message) throw new Error('Crossref returned an invalid response.');
  const doi = canonicaliseDoi(message.DOI);
  if (!doi || doi !== expectedDoi) throw new Error('Crossref DOI did not match the canonical Work.');
  const title = message.title?.[0]?.trim();
  const authors = (message.author ?? []).map((author) =>
    [author.family?.trim(), author.given?.trim()].filter(Boolean).join(', '),
  ).filter(Boolean);
  const year = message.issued?.['date-parts']?.[0]?.[0] ?? message.published?.['date-parts']?.[0]?.[0];
  const venue = message['container-title']?.[0]?.trim();
  return {
    providerId: 'crossref',
    registryId: doi,
    metadata: {
      ...(title ? { title } : {}),
      ...(authors.length > 0 ? { authors } : {}),
      ...(typeof year === 'number' ? { year } : {}),
      ...(venue ? { venue } : {}),
      doi,
    },
    integrity: crossrefIntegrity(message),
    checkedAt,
  };
}

export function parseOpenAlexVerification(
  value: unknown,
  expectedOpenAlex: string,
  checkedAt: string,
): CitationVerificationSource {
  const shape = asRecord(value) as OpenAlexWorkShape | null;
  if (!shape || canonicaliseOpenAlex(shape.id) !== expectedOpenAlex) {
    throw new Error('OpenAlex id did not match the canonical Work.');
  }
  const work = canonicaliseOpenAlexWork({ shape, providerId: 'openalex', at: checkedAt });
  if (!work) throw new Error('OpenAlex returned incomplete metadata.');
  return {
    providerId: 'openalex',
    registryId: expectedOpenAlex,
    metadata: {
      title: work.title,
      ...(work.authors.length > 0 ? { authors: work.authors } : {}),
      ...(work.year ? { year: work.year } : {}),
      ...(work.venue ? { venue: work.venue } : {}),
      ...(work.identifiers.doi ? { doi: work.identifiers.doi } : {}),
    },
    integrity: 'unknown',
    checkedAt,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, index) => value === b[index])
    : a === b;
}

function currentField(work: Work, field: VerifiableWorkField): string | number | readonly string[] | undefined {
  return field === 'doi' ? work.identifiers.doi : work[field];
}

function resultFromSources(
  work: Work,
  sources: readonly CitationVerificationSource[],
  errors: readonly string[],
  checkedAt: string,
): CitationVerificationResult {
  const differences: CitationMetadataDifference[] = [];
  for (const field of ['title', 'authors', 'year', 'venue', 'doi'] as const) {
    const source = sources.find((candidate) => candidate.metadata[field] !== undefined);
    const proposed = source?.metadata[field];
    if (source && proposed !== undefined && !sameValue(currentField(work, field), proposed)) {
      differences.push({ field, current: currentField(work, field), proposed, providerId: source.providerId });
    }
  }
  const crossref = sources.find((source) => source.providerId === 'crossref');
  return {
    workId: work.id,
    baseUpdatedAt: work.updatedAt,
    checkedAt,
    sources,
    differences,
    integrity: crossref?.integrity ?? 'unknown',
    errors,
  };
}

export class CrossrefOpenAlexCitationVerifier implements CitationMetadataVerifier {
  private readonly fetchImpl: VerificationFetch;
  private readonly timeoutMs: number;

  constructor(options: { readonly fetchImpl?: VerificationFetch; readonly timeoutMs?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async verify(work: Work, options: { readonly signal?: AbortSignal } = {}): Promise<CitationVerificationResult> {
    const doi = canonicaliseDoi(work.identifiers.doi);
    const openAlex = canonicaliseOpenAlex(work.identifiers.openAlex);
    const checkedAt = new Date().toISOString();
    if (!doi && !openAlex) return resultFromSources(work, [], ['Work has no Crossref DOI or OpenAlex id.'], checkedAt);
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const jobs: Array<Promise<CitationVerificationSource>> = [];
    if (doi) {
      jobs.push(this.fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Crossref returned HTTP ${response.status}.`);
        return parseCrossrefVerification(await response.json(), doi, checkedAt);
      }));
    }
    if (openAlex) {
      jobs.push(this.fetchImpl(`https://api.openalex.org/works/${encodeURIComponent(openAlex)}`, {
        method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`OpenAlex returned HTTP ${response.status}.`);
        return parseOpenAlexVerification(await response.json(), openAlex, checkedAt);
      }));
    }
    try {
      const settled = await Promise.allSettled(jobs);
      const sources = settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []);
      const errors = settled.flatMap((item) => item.status === 'rejected'
        ? [item.reason instanceof Error ? item.reason.message : String(item.reason)]
        : []);
      return resultFromSources(work, sources, errors, checkedAt);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}

export async function applyCitationVerification(
  repository: ResearchRepository,
  input: {
    readonly result: CitationVerificationResult;
    readonly acceptedFields: readonly VerifiableWorkField[];
    readonly acceptIntegrity: boolean;
  },
): Promise<Work> {
  if (input.result.sources.length === 0) throw new Error('No registry result is available to apply.');
  const work = await repository.getWork(input.result.workId);
  if (!work) throw new Error(`Work ${input.result.workId} no longer exists.`);
  if (work.updatedAt !== input.result.baseUpdatedAt) {
    throw new Error('Work changed after verification; verify again before applying metadata.');
  }
  const accepted = new Set(input.acceptedFields);
  const nextFields: Partial<Pick<Work, 'title' | 'authors' | 'year' | 'venue'>> = {};
  let identifiers = work.identifiers;
  let provenance = work.metadataProvenance;
  for (const difference of input.result.differences) {
    if (!accepted.has(difference.field)) continue;
    const source = input.result.sources.find((candidate) => candidate.providerId === difference.providerId)!;
    const metadataSource = { providerId: source.providerId, at: input.result.checkedAt, revision: source.registryId };
    if (difference.field === 'doi') {
      identifiers = { ...identifiers, doi: String(difference.proposed) };
      provenance = { ...provenance, doi: metadataSource };
    } else {
      Object.assign(nextFields, { [difference.field]: difference.proposed });
      provenance = { ...provenance, [difference.field]: metadataSource };
    }
  }
  const next: Work = {
    ...work,
    ...nextFields,
    identifiers,
    metadataProvenance: provenance,
    ...(input.acceptIntegrity ? { integrity: input.result.integrity, integrityCheckedAt: input.result.checkedAt } : {}),
    updatedAt: input.result.checkedAt,
  };
  await repository.transact((tx) => tx.putWork(next));
  return next;
}
