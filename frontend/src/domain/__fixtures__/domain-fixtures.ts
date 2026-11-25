/**
 * Deterministic fixtures for the v0.4 domain contracts.
 *
 * The whole point of WP-00 is to nail down types, not data. These
 * fixtures are intentionally minimal but stable: any change here is a
 * breaking change for the contract tests in the same packet.
 */

import type { AIDraft, DraftProvenance } from '../draft';
import type { AppLocation, ContainerRef } from '../workspace';
import type { ExportArtifact, KnowledgeObject, ExportOptions } from '../repository';
import type {
  SourceLocator,
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
} from '../study';
import type {
  Claim,
  ClaimEvidenceLink,
  Evidence,
  QuerySpec,
  ResearchProject,
  ResearchSourceLocator,
  SearchCandidate,
  SearchRun,
  Work,
  WorkAsset,
  WorkConflict,
  WorkMetadataProvenance,
} from '../research';

export const FIXED_TS = '2026-07-20T04:00:00.000Z';

export function makeContainerRef(overrides: Partial<ContainerRef> = {}): ContainerRef {
  return {
    workspaceId: 'ws-local',
    mode: 'study',
    kind: 'course',
    id: 'course-001',
    ...overrides,
  };
}

export function makeProjectContainer(overrides: Partial<ContainerRef> = {}): ContainerRef {
  return makeContainerRef({ mode: 'research', kind: 'project', id: 'project-001', ...overrides });
}

export function makeLocation(overrides: Partial<AppLocation> = {}): AppLocation {
  return {
    mode: 'study',
    surface: 'home',
    ...overrides,
  };
}

export function makeKnowledgeObject(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  return {
    id: 'obj-001',
    kind: 'note',
    body: 'A canonical note body.',
    state: 'active',
    authorType: 'user',
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    ...overrides,
  };
}

export function makeProvenance(overrides: Partial<DraftProvenance> = {}): DraftProvenance {
  return {
    provider: 'ollama',
    model: 'llama3.1:8b',
    generatedAt: FIXED_TS,
    sourceScope: ['source:abc#page=3', 'object:note-1'],
    origin: { kind: 'selection', objectId: 'note-1' },
    ...overrides,
  };
}

export function makeAIDraft(overrides: Partial<AIDraft> = {}): AIDraft {
  return {
    id: 'draft-001',
    status: 'pending',
    title: 'Proposed explanation',
    body: 'AI-generated explanation body.',
    target: { targetObjectId: 'note-1', targetKind: 'note' },
    provenance: makeProvenance(),
    ...overrides,
  };
}

export const SAMPLE_EXPORT_OPTIONS: ExportOptions = {
  scope: 'workspace',
  format: 'json',
};

export function makeExportArtifact(overrides: Partial<ExportArtifact> = {}): ExportArtifact {
  return {
    schemaVersion: 1,
    producedAt: FIXED_TS,
    format: 'json',
    payload: JSON.stringify({ objects: [makeKnowledgeObject()] }),
    objectIds: ['obj-001'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WP-04 Study fixtures
// ---------------------------------------------------------------------------

export function makeLocator(overrides: Partial<SourceLocator> = {}): SourceLocator {
  return {
    kind: 'page',
    lectureId: 'lec-1',
    sourceDocumentId: 'doc-1',
    pageNumber: 3,
    capturedAt: FIXED_TS,
    ...overrides,
  };
}

export function makeQuestion(overrides: Partial<StudyQuestion> = {}): StudyQuestion {
  return {
    id: 'q-1',
    body: 'What does the theorem state?',
    locator: makeLocator(),
    status: 'open',
    review: 'unreviewed',
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'user',
    ...overrides,
  };
}

export function makeAttempt(overrides: Partial<StudyAttempt> = {}): StudyAttempt {
  return {
    id: 'a-1',
    questionId: 'q-1',
    body: 'My own explanation.',
    locator: makeLocator(),
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'user',
    ...overrides,
  };
}

export function makeFeedback(overrides: Partial<StudyFeedback> = {}): StudyFeedback {
  return {
    id: 'f-1',
    questionId: 'q-1',
    attemptId: 'a-1',
    body: 'AI feedback body.',
    locator: makeLocator(),
    authorType: 'ai',
    provenance: {
      provider: 'ollama',
      model: 'llama3.1:8b',
      generatedAt: FIXED_TS,
    },
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WP-05 Research fixtures
// ---------------------------------------------------------------------------

export function makeResearchProject(
  overrides: Partial<ResearchProject> = {},
): ResearchProject {
  return {
    id: 'p-001',
    container: makeProjectContainer(),
    name: 'Sleep & memory',
    livingBrief: 'How does sleep affect memory recall?',
    kind: 'explore',
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'user',
    ...overrides,
  };
}

export function makeResearchLocator(
  overrides: Partial<ResearchSourceLocator> = {},
): ResearchSourceLocator {
  return {
    kind: 'paper-page',
    workId: 'doi:10.1/example',
    assetId: 'asset-1',
    pageNumber: 4,
    quoteHash: 'abcdef01',
    capturedAt: FIXED_TS,
    ...overrides,
  };
}

export function makeQuerySpec(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    id: 'qs-001',
    projectId: 'p-001',
    question: 'How does sleep affect memory recall?',
    concepts: [
      { label: 'sleep', synonyms: ['slumber'] },
      { label: 'memory', synonyms: ['recall'] },
    ],
    includeTerms: ['sleep', 'memory'],
    excludeTerms: ['review of reviews'],
    dateRange: { from: 2010, to: 2026 },
    languages: ['en'],
    seedWorkIds: [],
    strategy: 'explore',
    aiAssisted: false,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    ...overrides,
  };
}

export function makeSearchRun(overrides: Partial<SearchRun> = {}): SearchRun {
  return {
    id: 'run-001',
    projectId: 'p-001',
    querySpecId: 'qs-001',
    providerId: 'openalex',
    startedAt: FIXED_TS,
    completedAt: FIXED_TS,
    status: 'completed',
    candidateWorkIds: ['doi:10.1/example', 'doi:10.1/other'],
    errors: [],
    totalHits: 2,
    runNumber: 1,
    ...overrides,
  };
}

export function makeSearchCandidate(
  overrides: Partial<SearchCandidate> = {},
): SearchCandidate {
  return {
    id: 'cand-001',
    runId: 'run-001',
    projectId: 'p-001',
    workId: 'doi:10.1/example',
    work: makeWork(),
    providerRank: 0,
    providerScore: 0.9,
    reasonChips: ['matches-construct', 'open-access'],
    reasonNotes: ['matches the construct "sleep"', 'open access PDF available'],
    verdict: 'pending',
    ...overrides,
  };
}

export function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: 'doi:10.1/example',
    identifiers: { doi: '10.1/example' },
    title: 'Sleep, memory, and consolidation',
    authors: ['Doe, J.', 'Roe, R.'],
    year: 2024,
    venue: 'Nature Sleep',
    abstract: 'A study of sleep and memory.',
    metadataProvenance: makeWorkMetadataProvenance(),
    integrity: 'unknown',
    assetIds: ['asset-1'],
    projectIds: ['p-001'],
    readingStatus: 'unread',
    importance: 0,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'imported',
    ...overrides,
  };
}

export function makeWorkMetadataProvenance(
  overrides: Partial<WorkMetadataProvenance> = {},
): WorkMetadataProvenance {
  return {
    title: { providerId: 'openalex', at: FIXED_TS },
    authors: { providerId: 'openalex', at: FIXED_TS },
    year: { providerId: 'openalex', at: FIXED_TS },
    venue: { providerId: 'openalex', at: FIXED_TS },
    abstract: { providerId: 'openalex', at: FIXED_TS },
    doi: { providerId: 'openalex', at: FIXED_TS },
    ...overrides,
  };
}

export function makeWorkAsset(overrides: Partial<WorkAsset> = {}): WorkAsset {
  return {
    id: 'asset-1',
    workId: 'doi:10.1/example',
    kind: 'local-pdf',
    ref: '/tmp/sleep-memory.pdf',
    pageCount: 18,
    createdAt: FIXED_TS,
    ...overrides,
  };
}

export function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'e-001',
    projectId: 'p-001',
    workId: 'doi:10.1/example',
    locator: makeResearchLocator(),
    exactQuote: 'Sleep deprivation reduced recall accuracy by 24%.',
    userInterpretation:
      'A measurable effect of one-night sleep loss on declarative recall.',
    evidenceType: 'finding',
    status: 'verified',
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'user',
    ...overrides,
  };
}

export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c-001',
    projectId: 'p-001',
    title: 'Sleep loss reduces recall accuracy',
    body: 'Across studies, one night of sleep loss reduces recall accuracy by 15–25%.',
    status: 'canonical',
    aiSuggested: false,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'user',
    ...overrides,
  };
}

export function makeClaimEvidenceLink(
  overrides: Partial<ClaimEvidenceLink> = {},
): ClaimEvidenceLink {
  return {
    id: 'l-001',
    projectId: 'p-001',
    claimId: 'c-001',
    evidenceId: 'e-001',
    relation: 'supports',
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    authorType: 'user',
    ...overrides,
  };
}

export function makeWorkConflict(overrides: Partial<WorkConflict> = {}): WorkConflict {
  return {
    id: 'wc-001',
    projectId: 'p-001',
    candidateWorkId: 'w-candidate',
    existingWorkId: 'w-existing',
    fields: ['year'],
    createdAt: FIXED_TS,
    ...overrides,
  };
}
