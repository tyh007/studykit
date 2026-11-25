/**
 * StudyKit v0.4 — Domain barrel.
 *
 * Re-exports every contract defined under `domain/`. Other layers
 * (application, repositories, features, app) import from here, not
 * from the individual files, so we can reorganise the domain folder
 * without touching call sites.
 *
 * `study` and `research` both export `nowIso`. We re-export
 * from `study` so the name is the same across the barrel;
 * callers that need the research-specific helpers import
 * directly from `./research`.
 */

export * from './workspace';
export * from './surface-status';
export * from './draft';
export * from './repository';
export * from './study';
export {
  type Claim,
  type ClaimEvidenceLink,
  type ClaimEvidenceRelation,
  CLAIM_EVIDENCE_RELATIONS,
  isClaim,
  isClaimEvidenceLink,
  isClaimEvidenceRelation,
  isClaimStatus,
  CLAIM_STATUSES,
  type ClaimStatus,
  type ResearchProject,
  type ResearchProjectKind,
  RESEARCH_PROJECT_KINDS,
  isResearchProject,
  isResearchProjectKind,
  type LivingBrief,
  type CreateResearchProjectInput,
  type QuerySpec,
  type QueryConcept,
  type QueryStrategy,
  QUERY_STRATEGIES,
  isQueryConcept,
  isQuerySpec,
  isQueryStrategy,
  type SearchRun,
  type SearchRunStatus,
  SEARCH_RUN_STATUSES,
  isSearchRun,
  isSearchRunStatus,
  type ProviderError,
  isProviderError,
  type SearchCandidate,
  type SearchCandidateVerdict,
  SEARCH_CANDIDATE_VERDICTS,
  isSearchCandidate,
  isSearchCandidateVerdict,
  type ReasonChip,
  REASON_CHIPS,
  isReasonChip,
  type Work,
  type WorkIdentifiers,
  type WorkMetadataProvenance,
  type MetadataSource,
  type WorkAsset,
  type WorkAssetKind,
  type WorkIntegrity,
  WORK_INTEGRITY_VALUES,
  type WorkConflict,
  isWork,
  isWorkAsset,
  isWorkAssetKind,
  isWorkIdentifiers,
  isWorkMetadataProvenance,
  isWorkIntegrity,
  isMetadataSource,
  isWorkConflict,
  type ResearchSourceLocator,
  type ResearchSourceKind,
  RESEARCH_SOURCE_KINDS,
  isResearchSourceKind,
  isResearchSourceLocator,
  isCompleteResearchLocator,
  type Evidence,
  type EvidenceType,
  type EvidenceStatus,
  EVIDENCE_TYPES,
  EVIDENCE_STATUSES,
  isEvidence,
  isEvidenceType,
  isEvidenceStatus,
  isEvidenceReadyForVerification,
  canonicaliseDoi,
  canonicaliseArxiv,
  canonicalisePmid,
  canonicaliseOpenAlex,
  canonicaliseSemanticScholar,
  canonicaliseOpenAlexWork,
  makeWorkIdFromIdentifiers,
  compareWorkMetadata,
  hashQuote,
  reconstructAbstractFromInverted,
  type OpenAlexWorkShape,
  type CanonicaliseOpenAlexInput,
} from './research';
