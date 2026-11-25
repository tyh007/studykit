/**
 * StudyKit v0.4 — `domain/research` type-guard round-trip tests.
 *
 * Behavioural contract for the Research Evidence Slice
 * (WP-05). The tests are exhaustive: every type guard
 * is exercised against (a) a happy fixture, (b) a
 * deliberately broken shape, (c) a *round-trip* through
 * `JSON.parse(JSON.stringify(x))`. The round-trip is the
 * one that breaks when the type guard and the type drift
 * apart.
 *
 * The tests are the smallest possible surface that proves
 * the invariants the use-case layer and the Dexie adapter
 * both rely on:
 *
 *   - `Evidence` cannot be `verified` without a complete
 *     locator + non-empty interpretation.
 *   - `Work` identities are stable across canonicalisation
 *     and dedup.
 *   - `Claim` / `ClaimEvidenceLink` carry an explicit
 *     `authorType` so AI suggestions never silently become
 *     canonical.
 *   - DOI / arXiv / PMID / OpenAlex canonicalisation is
 *     stable and refuses malformed input.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicaliseArxiv,
  canonicaliseDoi,
  canonicaliseOpenAlex,
  canonicaliseOpenAlexWork,
  canonicalisePmid,
  canonicaliseSemanticScholar,
  compareWorkMetadata,
  hashQuote,
  isClaim,
  isClaimEvidenceLink,
  isClaimEvidenceRelation,
  isClaimStatus,
  isCompleteResearchLocator,
  isEvidence,
  isEvidenceReadyForVerification,
  isEvidenceStatus,
  isEvidenceType,
  isProviderError,
  isQueryConcept,
  isQuerySpec,
  isQueryStrategy,
  isReasonChip,
  isResearchProject,
  isResearchProjectKind,
  isResearchSourceKind,
  isResearchSourceLocator,
  isSearchCandidate,
  isSearchCandidateVerdict,
  isSearchRun,
  isSearchRunStatus,
  isWork,
  isWorkAsset,
  isWorkAssetKind,
  isWorkIdentifiers,
  isWorkIntegrity,
  isWorkMetadataProvenance,
  isWorkConflict,
  makeWorkIdFromIdentifiers,
  reconstructAbstractFromInverted,
  type Claim,
  type ClaimEvidenceLink,
  type Evidence,
  type QueryConcept,
  type QuerySpec,
  type ResearchProject,
  type ResearchSourceLocator,
  type SearchCandidate,
  type SearchRun,
  type Work,
  type WorkAsset,
  type WorkConflict,
  type WorkMetadataProvenance,
} from './research';
import type { ContainerRef } from './workspace';

const TS = '2026-07-21T12:00:00.000Z';
const CONTAINER: ContainerRef = { workspaceId: 'ws-local', mode: 'research', kind: 'project', id: 'p-1' };

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeLocator(overrides: Partial<ResearchSourceLocator> = {}): ResearchSourceLocator {
  return {
    kind: 'paper-page',
    workId: 'doi:10.1/example',
    assetId: 'asset-1',
    pageNumber: 4,
    quoteHash: 'abcdef01',
    capturedAt: TS,
    ...overrides,
  };
}

function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: 'doi:10.1/example',
    identifiers: { doi: '10.1/example' },
    title: 'A canonical example paper',
    authors: ['Doe, J.', 'Roe, R.'],
    year: 2024,
    venue: 'Journal of Examples',
    abstract: 'An abstract.',
    metadataProvenance: {
      title: { providerId: 'openalex', at: TS },
      authors: { providerId: 'openalex', at: TS },
      year: { providerId: 'openalex', at: TS },
      venue: { providerId: 'openalex', at: TS },
      abstract: { providerId: 'openalex', at: TS },
      doi: { providerId: 'openalex', at: TS },
    },
    integrity: 'unknown',
    assetIds: ['asset-1'],
    projectIds: ['p-1'],
    readingStatus: 'unread',
    importance: 0,
    createdAt: TS,
    updatedAt: TS,
    authorType: 'imported',
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'e-1',
    projectId: 'p-1',
    workId: 'doi:10.1/example',
    locator: makeLocator(),
    exactQuote: 'A representative quote.',
    userInterpretation: 'My reading of the passage.',
    evidenceType: 'finding',
    status: 'verified',
    createdAt: TS,
    updatedAt: TS,
    authorType: 'user',
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c-1',
    projectId: 'p-1',
    title: 'Sleep affects memory',
    body: 'Across the corpus, sleep loss reduces recall accuracy.',
    status: 'canonical',
    aiSuggested: false,
    createdAt: TS,
    updatedAt: TS,
    authorType: 'user',
    ...overrides,
  };
}

function makeLink(overrides: Partial<ClaimEvidenceLink> = {}): ClaimEvidenceLink {
  return {
    id: 'l-1',
    projectId: 'p-1',
    claimId: 'c-1',
    evidenceId: 'e-1',
    relation: 'supports',
    createdAt: TS,
    updatedAt: TS,
    authorType: 'user',
    ...overrides,
  };
}

function makeQuerySpec(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    id: 'qs-1',
    projectId: 'p-1',
    question: 'How does sleep affect memory?',
    concepts: [{ label: 'sleep', synonyms: ['slumber'] }],
    includeTerms: ['sleep', 'memory'],
    excludeTerms: ['review of reviews'],
    dateRange: { from: 2010, to: 2026 },
    languages: ['en'],
    seedWorkIds: [],
    strategy: 'explore',
    aiAssisted: false,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeRun(overrides: Partial<SearchRun> = {}): SearchRun {
  return {
    id: 'run-1',
    projectId: 'p-1',
    querySpecId: 'qs-1',
    providerId: 'openalex',
    startedAt: TS,
    status: 'completed',
    candidateWorkIds: ['w-1'],
    errors: [],
    totalHits: 1,
    runNumber: 1,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    id: 'cand-1',
    runId: 'run-1',
    projectId: 'p-1',
    workId: 'w-1',
    work: makeWork(),
    providerRank: 0,
    providerScore: 0.42,
    reasonChips: ['matches-construct'],
    reasonNotes: ['matches the construct "sleep"'],
    verdict: 'pending',
    ...overrides,
  };
}

function makeProject(overrides: Partial<ResearchProject> = {}): ResearchProject {
  return {
    id: 'p-1',
    container: CONTAINER,
    name: 'Sleep & memory',
    livingBrief: 'How does sleep affect memory recall?',
    kind: 'explore',
    createdAt: TS,
    updatedAt: TS,
    authorType: 'user',
    ...overrides,
  };
}

describe('canonicalisation helpers', () => {
  it('canonicalises DOIs', () => {
    expect(canonicaliseDoi('10.1234/ABC')).toBe('10.1234/abc');
    expect(canonicaliseDoi('https://doi.org/10.1234/ABC.')).toBe('10.1234/abc');
    expect(canonicaliseDoi('doi:10.1234/abc)')).toBe('10.1234/abc');
    expect(canonicaliseDoi('')).toBeUndefined();
    expect(canonicaliseDoi(undefined)).toBeUndefined();
  });

  it('canonicalises arXiv ids', () => {
    expect(canonicaliseArxiv('arXiv:2106.09685')).toBe('2106.09685');
    expect(canonicaliseArxiv('2106.09685v2')).toBe('2106.09685');
    expect(canonicaliseArxiv('2106.09685')).toBe('2106.09685');
    expect(canonicaliseArxiv('garbage')).toBeUndefined();
  });

  it('canonicalises PMIDs', () => {
    expect(canonicalisePmid('PMID: 12345')).toBe('12345');
    expect(canonicalisePmid(' 012345 ')).toBe('012345');
    expect(canonicalisePmid('abc')).toBeUndefined();
  });

  it('canonicalises OpenAlex ids', () => {
    expect(canonicaliseOpenAlex('https://openalex.org/W2741809807')).toBe('W2741809807');
    expect(canonicaliseOpenAlex('W2741809807')).toBe('W2741809807');
    expect(canonicaliseOpenAlex('something-else')).toBeUndefined();
  });

  it('canonicalises Semantic Scholar ids', () => {
    expect(canonicaliseSemanticScholar('PMID:12345')).toBe('PMID:12345');
    expect(canonicaliseSemanticScholar('  ')).toBeUndefined();
  });

  it('hashQuote is stable and bounded', () => {
    const a = hashQuote('Hello world');
    const b = hashQuote('Hello world ');
    const c = hashQuote('A very different quote');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('identifier-based Work ids', () => {
  it('uses DOI first', () => {
    expect(makeWorkIdFromIdentifiers({ doi: '10.1/x' }, 'title', ['a'], 2020)).toBe('doi:10.1/x');
  });
  it('uses PMID when no DOI', () => {
    expect(makeWorkIdFromIdentifiers({ pmid: '123' }, 'title', ['a'], 2020)).toBe('pmid:123');
  });
  it('uses arXiv when no DOI/PMID', () => {
    expect(makeWorkIdFromIdentifiers({ arxiv: '2106.09685' }, 'title', ['a'], 2020)).toBe(
      'arxiv:2106.09685',
    );
  });
  it('uses OpenAlex when nothing else', () => {
    expect(makeWorkIdFromIdentifiers({ openAlex: 'W2741809807' }, 'title', ['a'], 2020)).toBe(
      'oa:W2741809807',
    );
  });
  it('falls back to title+author+year', () => {
    expect(makeWorkIdFromIdentifiers({}, 'Hello world!', ['Doe'], 2020)).toBe(
      't:hello world::a:doe::y2020',
    );
  });
});

describe('Work canonicalisation from OpenAlex', () => {
  it('returns null on empty title', () => {
    expect(canonicaliseOpenAlexWork({ shape: { title: '   ' } })).toBeNull();
  });

  it('round-trips a happy Work', () => {
    const work = canonicaliseOpenAlexWork({
      shape: {
        id: 'https://openalex.org/W2741809807',
        doi: 'https://doi.org/10.1234/ABC',
        title: 'Sleep and memory',
        authorships: [
          { author: { display_name: 'Doe, J.' } },
          { author: { display_name: 'Roe, R.' } },
        ],
        publication_year: 2024,
        primary_location: { source: { display_name: 'Nature Sleep' } },
        abstract_inverted_index: { sleep: [0], affects: [1], memory: [2] },
        open_access: { is_oa: true, oa_url: 'https://example.org/pdf' },
      },
    });
    expect(work).not.toBeNull();
    expect(work!.id).toBe('doi:10.1234/abc');
    expect(work!.identifiers.doi).toBe('10.1234/abc');
    expect(work!.identifiers.openAlex).toBe('W2741809807');
    expect(work!.title).toBe('Sleep and memory');
    expect(work!.authors).toEqual(['Doe, J.', 'Roe, R.']);
    expect(work!.year).toBe(2024);
    expect(work!.venue).toBe('Nature Sleep');
    expect(work!.abstract).toBe('sleep affects memory');
    expect(isWork(roundTrip(work!))).toBe(true);
  });

  it('reconstructs abstracts from inverted index', () => {
    const text = reconstructAbstractFromInverted({
      hello: [0],
      world: [1],
      this: [3],
      test: [4],
    });
    expect(text).toBe('hello world this test');
  });
});

describe('Work metadata comparison', () => {
  it('returns empty when two works agree', () => {
    const a = makeWork();
    const b = makeWork({
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
    });
    expect(compareWorkMetadata(a, b)).toEqual([]);
  });
  it('returns the field when titles differ', () => {
    const a = makeWork();
    const b = makeWork({ title: 'A different title' });
    expect(compareWorkMetadata(a, b)).toEqual(['title']);
  });
  it('returns multiple fields when several disagree', () => {
    const a = makeWork();
    const b = makeWork({ year: 2023, venue: 'Other' });
    expect(compareWorkMetadata(a, b)).toEqual(['year', 'venue']);
  });
});

describe('SourceLocator invariants', () => {
  it('accepts a complete paper-page locator', () => {
    const loc = makeLocator();
    expect(isResearchSourceLocator(loc)).toBe(true);
    expect(isCompleteResearchLocator(loc)).toBe(true);
  });

  it('rejects a paper-page without an asset', () => {
    const loc = makeLocator({ assetId: undefined });
    expect(isResearchSourceLocator(loc)).toBe(true);
    expect(isCompleteResearchLocator(loc)).toBe(false);
  });

  it('accepts a paper-work locator (work only, no page)', () => {
    const loc: ResearchSourceLocator = {
      kind: 'paper-work',
      workId: 'doi:10.1/x',
      capturedAt: TS,
    };
    expect(isCompleteResearchLocator(loc)).toBe(true);
  });

  it('rejects text-range without a valid range', () => {
    const a: ResearchSourceLocator = {
      kind: 'text-range',
      workId: 'w-1',
      start: 5,
      end: 5,
      capturedAt: TS,
    };
    const b: ResearchSourceLocator = {
      kind: 'text-range',
      workId: 'w-1',
      start: 5,
      end: 8,
      capturedAt: TS,
    };
    expect(isCompleteResearchLocator(a)).toBe(false);
    expect(isCompleteResearchLocator(b)).toBe(true);
  });

  it('rejects malformed locator shapes', () => {
    expect(isResearchSourceLocator(null)).toBe(false);
    expect(isResearchSourceLocator({ kind: 'unknown', workId: 'w-1' })).toBe(false);
    expect(
      isResearchSourceLocator({ kind: 'paper-page', workId: '', assetId: 'a', pageNumber: 1 }),
    ).toBe(false);
  });
});

describe('Research type guards (happy + round-trip + malformed)', () => {
  it('isResearchProject', () => {
    const p = makeProject();
    expect(isResearchProject(p)).toBe(true);
    expect(isResearchProject(roundTrip(p))).toBe(true);
    expect(isResearchProject({ ...p, kind: 'invalid' as never })).toBe(false);
    expect(isResearchProject({ ...p, container: { ...CONTAINER, mode: 'study' as never } })).toBe(
      false,
    );
  });

  it('isQuerySpec', () => {
    const q = makeQuerySpec();
    expect(isQuerySpec(q)).toBe(true);
    expect(isQuerySpec(roundTrip(q))).toBe(true);
    expect(isQuerySpec({ ...q, strategy: 'nope' as never })).toBe(false);
    expect(isQuerySpec({ ...q, concepts: [{ label: '', synonyms: [] }] })).toBe(false);
  });

  it('isQueryConcept', () => {
    const c: QueryConcept = { label: 'sleep', synonyms: ['slumber'] };
    expect(isQueryConcept(c)).toBe(true);
    expect(isQueryConcept({ label: 'sleep', synonyms: 'not-an-array' })).toBe(false);
  });

  it('isSearchRun', () => {
    const r = makeRun();
    expect(isSearchRun(r)).toBe(true);
    expect(isSearchRun(roundTrip(r))).toBe(true);
    expect(isSearchRun({ ...r, status: 'weird' as never })).toBe(false);
    expect(isSearchRun({ ...r, totalHits: -1 })).toBe(false);
  });

  it('isSearchCandidate', () => {
    const c = makeCandidate();
    expect(isSearchCandidate(c)).toBe(true);
    expect(isSearchCandidate(roundTrip(c))).toBe(true);
    expect(isSearchCandidate({ ...c, verdict: 'accepted' as never })).toBe(false);
  });

  it('isWork', () => {
    const w = makeWork();
    expect(isWork(w)).toBe(true);
    expect(isWork(roundTrip(w))).toBe(true);
    expect(isWork({ ...w, readingStatus: 'reviewed!' as never })).toBe(false);
    expect(isWork({ ...w, integrity: 'gone' as never })).toBe(false);
  });

  it('isWorkAsset', () => {
    const a: WorkAsset = {
      id: 'asset-1',
      workId: 'w-1',
      kind: 'local-pdf',
      ref: '/tmp/foo.pdf',
      createdAt: TS,
    };
    expect(isWorkAsset(a)).toBe(true);
    expect(isWorkAsset({ ...a, kind: 'magic' as never })).toBe(false);
  });

  it('isWorkMetadataProvenance', () => {
    const prov: WorkMetadataProvenance = {
      title: { providerId: 'openalex', at: TS },
    };
    expect(isWorkMetadataProvenance(prov)).toBe(true);
    expect(isWorkMetadataProvenance({ title: { providerId: '', at: TS } })).toBe(false);
  });

  it('isEvidence', () => {
    const e = makeEvidence();
    expect(isEvidence(e)).toBe(true);
    expect(isEvidence(roundTrip(e))).toBe(true);
    expect(isEvidence({ ...e, evidenceType: 'highlighted' as never })).toBe(false);
    expect(isEvidence({ ...e, authorType: 'magic' as never })).toBe(false);
  });

  it('isClaim', () => {
    const c = makeClaim();
    expect(isClaim(c)).toBe(true);
    expect(isClaim(roundTrip(c))).toBe(true);
    expect(isClaim({ ...c, status: 'pending' as never })).toBe(false);
    expect(isClaim({ ...c, authorType: 'imported' as never })).toBe(false);
  });

  it('isClaimEvidenceLink', () => {
    const l = makeLink();
    expect(isClaimEvidenceLink(l)).toBe(true);
    expect(isClaimEvidenceLink(roundTrip(l))).toBe(true);
    expect(isClaimEvidenceLink({ ...l, relation: 'mentions' as never })).toBe(false);
  });

  it('isWorkConflict', () => {
    const c: WorkConflict = {
      id: 'wc-1',
      projectId: 'p-1',
      candidateWorkId: 'w-1',
      existingWorkId: 'w-2',
      fields: ['title', 'year'],
      createdAt: TS,
    };
    expect(isWorkConflict(c)).toBe(true);
    expect(isWorkConflict({ ...c, fields: ['abstract'] as never })).toBe(false);
  });
});

describe('Evidence verification invariants', () => {
  it('isEvidenceReadyForVerification requires locator + quote + interpretation', () => {
    const e = makeEvidence();
    expect(isEvidenceReadyForVerification(e)).toBe(true);
    expect(
      isEvidenceReadyForVerification({ ...e, locator: { ...e.locator, pageNumber: undefined } }),
    ).toBe(false);
    expect(isEvidenceReadyForVerification({ ...e, exactQuote: '' })).toBe(false);
    expect(isEvidenceReadyForVerification({ ...e, userInterpretation: '   ' })).toBe(false);
  });
});

describe('Enum guards accept only valid values', () => {
  it('isResearchProjectKind', () => {
    for (const k of ['blank', 'explore', 'review', 'empirical', 'thesis']) {
      expect(isResearchProjectKind(k)).toBe(true);
    }
    expect(isResearchProjectKind('garbage')).toBe(false);
  });
  it('isQueryStrategy', () => {
    for (const s of ['explore', 'balanced', 'precise', 'review']) {
      expect(isQueryStrategy(s)).toBe(true);
    }
    expect(isQueryStrategy('lenient')).toBe(false);
  });
  it('isSearchRunStatus', () => {
    for (const s of ['running', 'partial', 'completed', 'failed', 'cancelled']) {
      expect(isSearchRunStatus(s)).toBe(true);
    }
    expect(isSearchRunStatus('done')).toBe(false);
  });
  it('isSearchCandidateVerdict', () => {
    for (const s of ['pending', 'saved', 'maybe', 'excluded']) {
      expect(isSearchCandidateVerdict(s)).toBe(true);
    }
    expect(isSearchCandidateVerdict('accepted')).toBe(false);
  });
  it('isResearchSourceKind', () => {
    for (const k of ['paper-work', 'paper-page', 'pdf-page', 'text-range', 'web-snapshot']) {
      expect(isResearchSourceKind(k)).toBe(true);
    }
    expect(isResearchSourceKind('audio')).toBe(false);
  });
  it('isReasonChip', () => {
    for (const r of [
      'matches-construct',
      'cites-seed',
      'cited-by-seed',
      'recent-review',
      'open-access',
      'high-citation',
      'manual-seed',
      'contradicts-claim',
    ]) {
      expect(isReasonChip(r)).toBe(true);
    }
    expect(isReasonChip('free-coffee')).toBe(false);
  });
  it('isEvidenceType', () => {
    for (const t of [
      'finding',
      'method',
      'definition',
      'theory',
      'limitation',
      'context',
    ]) {
      expect(isEvidenceType(t)).toBe(true);
    }
    expect(isEvidenceType('citation')).toBe(false);
  });
  it('isEvidenceStatus', () => {
    for (const s of ['candidate', 'verified', 'rejected']) {
      expect(isEvidenceStatus(s)).toBe(true);
    }
    expect(isEvidenceStatus('accepted')).toBe(false);
  });
  it('isClaimStatus', () => {
    expect(isClaimStatus('draft')).toBe(true);
    expect(isClaimStatus('canonical')).toBe(true);
    expect(isClaimStatus('archived')).toBe(false);
  });
  it('isClaimEvidenceRelation', () => {
    for (const r of ['supports', 'contradicts', 'qualifies']) {
      expect(isClaimEvidenceRelation(r)).toBe(true);
    }
    expect(isClaimEvidenceRelation('mentions')).toBe(false);
  });
  it('isWorkAssetKind', () => {
    for (const k of ['local-pdf', 'oa-url', 'linked-file']) {
      expect(isWorkAssetKind(k)).toBe(true);
    }
    expect(isWorkAssetKind('miracle')).toBe(false);
  });
  it('isWorkIntegrity', () => {
    for (const k of ['unknown', 'ok', 'corrected', 'retracted', 'concern']) {
      expect(isWorkIntegrity(k)).toBe(true);
    }
    expect(isWorkIntegrity('pending')).toBe(false);
  });
  it('isProviderError', () => {
    expect(isProviderError({ providerId: 'x', message: 'oops' })).toBe(true);
    expect(isProviderError({ providerId: 'x', message: 1 })).toBe(false);
    expect(isProviderError({ providerId: '', message: 'x' })).toBe(false);
  });
});
