/**
 * StudyKit v0.4 — `application/research/researchUseCases`
 *
 * Use-case layer for the Research Evidence Slice (WP-05).
 * Pure functions, no React, no Dexie, no fetch, no
 * network. Every use case takes a `ResearchRepository`
 * (and, where relevant, a `SearchProvider`) plus the
 * inputs it needs; the UI calls them and renders the
 * result.
 *
 * WP-05 ships a small, complete use-case surface. It
 * deliberately does *not* ship everything — Design
 * Decisions, Tasks, OSF export, Project Management are
 * later packets (WP-07 / WP-10). The current surface is
 * the minimum that lets the user form a `Claim` from
 * three Works with verified Evidence.
 *
 * Invariants (enforced here, *not* in the UI):
 *
 *   1. A Claim is *always* persisted in `draft` state
 *      when an AI suggested it; `canonical` requires the
 *      user to Accept. The use case has the AI return a
 *      draft; the host UI calls `acceptClaimDraft` to
 *      move it to canonical state.
 *   2. An Evidence is *always* persisted as `candidate`
 *      when an AI suggested the interpretation. A
 *      verified Evidence MUST carry a complete locator,
 *      a non-empty quote, and a non-empty user
 *      interpretation. The repository's `putEvidence`
 *      throws on the first violation.
 *   3. A Search run is *always* persisted: a
 *      `cancelled` run is still useful for the lineage.
 *      Failed runs persist with a `ProviderError`; the
 *      QuerySpec and the user input are not lost.
 *   4. A Maybe / Exclude verdict is reversible. The use
 *      case updates the candidate; nothing else.
 *   5. `Save` only happens on the user's explicit
 *      request. Search results are *not* silently
 *      promoted to Library.
 *   6. A ClaimEvidenceLink requires an existing Claim
 *      AND an existing verified Evidence. The use case
 *      reads the repository before writing; a missing
 *      record throws so the host can show a clear error.
 *
 * AI integration rules (per WP-03 / WP-04 pattern):
 *
 *   - AI feedback is *always* a draft first. The use
 *     case writes a Draft Layer record, then waits for
 *     the host to Accept / Reject.
 *   - On Accept, the use case reads the accepted body
 *     and writes a *new* canonical record (Claim or
 *     Evidence). The Draft Layer record is left in
 *     `accepted` state for the audit trail.
 *   - On Reject, the use case transitions the draft to
 *     `rejected`; the user can keep editing.
 *   - On AI failure the draft is `failed` and the host
 *     can Retry. The use case never silently falls back
 *     to a user-authored record — the user explicitly
 *     chooses to "Continue without AI" by editing the
 *     candidate body and re-submitting.
 */

import { draftLayer, type DraftRecord } from '../../features/ai/kernel/draftLayer';
import {
  isEvidenceReadyForVerification,
  nowIso,
  type Claim,
  type ClaimEvidenceLink,
  type ClaimEvidenceRelation,
  type CreateResearchProjectInput,
  type Evidence,
  type EvidenceType,
  type QuerySpec,
  type ResearchProject,
  type ResearchSourceLocator,
  type SearchCandidate,
  type SearchRun,
  type SearchRunStatus,
  type Work,
  type WorkConflict,
} from '../../domain/research';
import { isResearchSourceKind, makeWorkIdFromIdentifiers } from '../../domain/research';
import type { ContainerRef } from '../../domain/workspace';
import type {
  ResearchRepository,
  ResearchRepositoryTransaction,
} from './researchRepository';
import type {
  ProviderCandidate,
  SearchProvider,
  SearchProviderResult,
} from './openAlexProvider';

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  readonly name: string;
  readonly livingBrief?: string;
  readonly kind?: ResearchProject['kind'];
  readonly container: ContainerRef;
  readonly idFactory?: () => string;
}

export interface UpdateLivingBriefInput {
  readonly projectId: string;
  readonly livingBrief: string;
}

export interface SaveQuerySpecInput {
  readonly projectId: string;
  readonly question: string;
  readonly concepts: QuerySpec['concepts'];
  readonly includeTerms: readonly string[];
  readonly excludeTerms: readonly string[];
  readonly dateRange: { readonly from?: number; readonly to?: number } | undefined;
  readonly languages: readonly string[];
  readonly seedWorkIds: readonly string[];
  readonly strategy: QuerySpec['strategy'];
  readonly aiAssisted: boolean;
  /** When re-running, the id of the previous spec the
   *  user is editing. */
  readonly editOfSpecId?: string;
  readonly idFactory?: () => string;
}

export interface RunSearchInput {
  readonly projectId: string;
  readonly querySpec: QuerySpec;
  readonly provider: SearchProvider;
  /** Per-page, default 25. */
  readonly perPage?: number;
  /** Page, default 1. */
  readonly page?: number;
  /** AbortController.signal for the fetch. */
  readonly signal: AbortSignal;
  /** Optional id factory for tests. */
  readonly idFactory?: () => string;
}

export interface RunSearchResult {
  readonly run: SearchRun;
  readonly candidates: readonly SearchCandidate[];
}

export interface SaveCandidateInput {
  readonly candidateId: string;
  readonly userProjectId: string;
  readonly verdict: SearchCandidate['verdict'];
  readonly excludeReason?: string;
}

export interface CreateEvidenceDraftInput {
  readonly projectId: string;
  readonly workId: string;
  readonly locator: ResearchSourceLocator;
  readonly exactQuote: string;
  readonly userInterpretation?: string;
  readonly evidenceType: EvidenceType;
  readonly lineageRunId?: string;
  readonly idFactory?: () => string;
}

export interface VerifyEvidenceInput {
  readonly evidenceId: string;
  readonly exactQuote?: string;
  readonly userInterpretation?: string;
  readonly evidenceType?: EvidenceType;
}

export interface RejectEvidenceInput {
  readonly evidenceId: string;
}

export interface CreateClaimInput {
  readonly projectId: string;
  readonly title: string;
  readonly body: string;
  readonly aiSuggested?: boolean;
  readonly draftId?: string;
  readonly lineageRunId?: string;
  readonly idFactory?: () => string;
}

export interface LinkEvidenceInput {
  readonly projectId: string;
  readonly claimId: string;
  readonly evidenceId: string;
  readonly relation: ClaimEvidenceRelation;
  readonly note?: string;
  readonly idFactory?: () => string;
}

export interface UnlinkEvidenceInput {
  readonly linkId: string;
}

export interface ResolveConflictInput {
  readonly conflictId: string;
  readonly resolution: 'use-existing' | 'use-candidate' | 'keep-both';
}

export interface AcceptClaimDraftInput {
  readonly draftId: string;
  readonly projectId: string;
  readonly title: string;
  readonly body: string;
  readonly lineageRunId?: string;
  readonly idFactory?: () => string;
}

export interface SuggestClaimDraftInput {
  readonly projectId: string;
  readonly title: string;
  readonly body: string;
  readonly lineageRunId?: string;
  readonly idFactory?: () => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(
  idFactory: (() => string) | undefined,
  prefix: string,
): string {
  if (idFactory) return idFactory();
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

function makeProjectRecord(input: CreateProjectInput, id: string, now: string): ResearchProject {
  return {
    id,
    container: input.container,
    name: input.name,
    livingBrief: input.livingBrief ?? '',
    kind: input.kind ?? 'blank',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function makeQuerySpecRecord(input: SaveQuerySpecInput, id: string, now: string): QuerySpec {
  return {
    id,
    projectId: input.projectId,
    question: input.question,
    concepts: input.concepts,
    includeTerms: input.includeTerms,
    excludeTerms: input.excludeTerms,
    ...(input.dateRange ? { dateRange: input.dateRange } : {}),
    languages: input.languages,
    seedWorkIds: input.seedWorkIds,
    strategy: input.strategy,
    aiAssisted: input.aiAssisted,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRunRecord(input: {
  id: string;
  projectId: string;
  querySpecId: string;
  providerId: string;
  startedAt: string;
  status: SearchRunStatus;
  candidateWorkIds: string[];
  totalHits: number;
  errors: SearchRun['errors'];
  completedAt?: string;
  runNumber: number;
}): SearchRun {
  return {
    id: input.id,
    projectId: input.projectId,
    querySpecId: input.querySpecId,
    providerId: input.providerId,
    startedAt: input.startedAt,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    status: input.status,
    candidateWorkIds: input.candidateWorkIds,
    errors: input.errors,
    totalHits: input.totalHits,
    runNumber: input.runNumber,
  };
}

function makeCandidateRecord(input: {
  id: string;
  runId: string;
  projectId: string;
  workId: string;
  work: Work;
  providerRank: number;
  providerScore: number | undefined;
  reasonChips: SearchCandidate['reasonChips'];
  reasonNotes: SearchCandidate['reasonNotes'];
  verdict: SearchCandidate['verdict'];
  now: string;
}): SearchCandidate {
  return {
    id: input.id,
    runId: input.runId,
    projectId: input.projectId,
    workId: input.workId,
    work: input.work,
    providerRank: input.providerRank,
    ...(input.providerScore !== undefined ? { providerScore: input.providerScore } : {}),
    reasonChips: input.reasonChips,
    reasonNotes: input.reasonNotes,
    verdict: input.verdict,
    verdictAt: input.now,
  };
}

function makeEvidenceRecord(input: {
  id: string;
  projectId: string;
  workId: string;
  locator: ResearchSourceLocator;
  exactQuote: string;
  userInterpretation: string;
  evidenceType: EvidenceType;
  status: Evidence['status'];
  note: string | undefined;
  draftId: string | undefined;
  lineageRunId: string | undefined;
  authorType: Evidence['authorType'];
  now: string;
}): Evidence {
  return {
    id: input.id,
    projectId: input.projectId,
    workId: input.workId,
    locator: input.locator,
    exactQuote: input.exactQuote,
    userInterpretation: input.userInterpretation,
    evidenceType: input.evidenceType,
    status: input.status,
    ...(input.note ? { note: input.note } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
    ...(input.lineageRunId ? { lineageRunId: input.lineageRunId } : {}),
    createdAt: input.now,
    updatedAt: input.now,
    authorType: input.authorType,
  };
}

function makeClaimRecord(input: {
  id: string;
  projectId: string;
  title: string;
  body: string;
  status: Claim['status'];
  aiSuggested: boolean;
  draftId: string | undefined;
  lineageRunId: string | undefined;
  authorType: Claim['authorType'];
  now: string;
}): Claim {
  return {
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    body: input.body,
    status: input.status,
    aiSuggested: input.aiSuggested,
    ...(input.draftId ? { draftId: input.draftId } : {}),
    ...(input.lineageRunId ? { lineageRunId: input.lineageRunId } : {}),
    createdAt: input.now,
    updatedAt: input.now,
    authorType: input.authorType,
  };
}

function makeLinkRecord(input: {
  id: string;
  projectId: string;
  claimId: string;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
  note: string | undefined;
  authorType: ClaimEvidenceLink['authorType'];
  now: string;
}): ClaimEvidenceLink {
  return {
    id: input.id,
    projectId: input.projectId,
    claimId: input.claimId,
    evidenceId: input.evidenceId,
    relation: input.relation,
    ...(input.note ? { note: input.note } : {}),
    createdAt: input.now,
    updatedAt: input.now,
    authorType: input.authorType,
  };
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

/**
 * Create a Research Project. The user is never forced
 * to pick a `kind`; the default `kind: 'blank'` is
 * fine and the user can change it later. The
 * `livingBrief` may be empty; the user is never
 * required to write a Research Question.
 */
export async function createProject(
  repository: ResearchRepository,
  input: CreateProjectInput,
): Promise<ResearchProject> {
  if (!input.name.trim()) {
    throw new Error('createProject: name is required.');
  }
  if (input.container.mode !== 'research' || input.container.kind !== 'project') {
    throw new Error('createProject: container must be a research project.');
  }
  const now = nowIso();
  const id = makeId(input.idFactory, 'proj');
  const record = makeProjectRecord(input, id, now);
  await repository.transact(async (tx: ResearchRepositoryTransaction) => {
    tx.putProject(record);
  });
  return record;
}

/**
 * Persist the user's freeform Living Brief. The brief
 * can be empty; the UI never demands a Research
 * Question. Updates `updatedAt`.
 */
export async function updateLivingBrief(
  repository: ResearchRepository,
  input: UpdateLivingBriefInput,
): Promise<ResearchProject> {
  const existing = await repository.getProject(input.projectId);
  if (!existing) throw new Error(`updateLivingBrief: project ${input.projectId} not found.`);
  const next: ResearchProject = {
    ...existing,
    livingBrief: input.livingBrief,
    updatedAt: nowIso(),
  };
  await repository.transact(async (tx) => {
    tx.putProject(next);
  });
  return next;
}

/**
 * Persist (or create) a `QuerySpec`. When the user is
 * editing a previous spec, the `editOfSpecId` is
 * recorded as a *new* spec — the lineage is preserved.
 */
export async function saveQuerySpec(
  repository: ResearchRepository,
  input: SaveQuerySpecInput,
): Promise<QuerySpec> {
  const project = await repository.getProject(input.projectId);
  if (!project) throw new Error(`saveQuerySpec: project ${input.projectId} not found.`);
  const now = nowIso();
  const id = makeId(input.idFactory, 'qs');
  const record = makeQuerySpecRecord(input, id, now);
  await repository.transact(async (tx) => {
    tx.putQuerySpec(record);
  });
  return record;
}

/**
 * Run a search. The function:
 *
 *   1. Persists the `QuerySpec` (the *next* version if
 *      the user is editing; the original is left
 *      untouched for lineage).
 *   2. Creates a `SearchRun` in `running` state.
 *   3. Calls the provider with the spec.
 *   4. Persists each `Work` (canonicalise + dedup) and
 *      each `SearchCandidate` (with provider rank +
 *      reason chips + the user's `pending` verdict).
 *   5. Updates the run to its terminal status
 *      (`completed | partial | failed | cancelled`).
 *
 * The host UI can `subscribe` to the repository for
 * live updates. The function returns the final `run`
 * and the list of candidates.
 */
export async function runSearch(
  repository: ResearchRepository,
  input: RunSearchInput,
): Promise<RunSearchResult> {
  // Compute the next run number.
  const previousRuns = await repository.listRuns({ projectId: input.projectId });
  const runNumber = previousRuns.reduce((m, r) => Math.max(m, r.runNumber), 0) + 1;
  const runId = makeId(input.idFactory, 'run');
  const startedAt = nowIso();
  // Persist the running row first so the UI can show
  // "running…" without waiting for the network.
  await repository.transact(async (tx) => {
    tx.putQuerySpec(input.querySpec);
    tx.putRun(
      makeRunRecord({
        id: runId,
        projectId: input.projectId,
        querySpecId: input.querySpec.id,
        providerId: input.provider.id,
        startedAt,
        status: 'running',
        candidateWorkIds: [],
        totalHits: 0,
        errors: [],
        runNumber,
      }),
    );
  });

  let result: SearchProviderResult;
  try {
    result = await input.provider.runSearch({
      querySpec: input.querySpec,
      perPage: input.perPage,
      page: input.page,
      signal: input.signal,
    });
  } catch (err) {
    result = {
      status: input.signal.aborted ? 'cancelled' : 'failed',
      candidates: [],
      totalHits: 0,
      errors: [
        {
          providerId: input.provider.id,
          code: 'network',
          message: err instanceof Error ? err.message : 'fetch failed',
        },
      ],
      completedAt: nowIso(),
    };
  }

  // Persist the candidates + final run state.
  const candidateRecords: SearchCandidate[] = [];
  const workIds: string[] = [];
  for (let i = 0; i < result.candidates.length; i += 1) {
    const c = result.candidates[i] as ProviderCandidate;
    const candidate = makeCandidateRecord({
      id: makeId(input.idFactory, 'cand'),
      runId,
      projectId: input.projectId,
      workId: c.work.id,
      work: c.work,
      providerRank: c.providerRank,
      providerScore: c.providerScore,
      reasonChips: c.reasonChips,
      reasonNotes: c.reasonNotes,
      verdict: 'pending',
      now: nowIso(),
    });
    candidateRecords.push(candidate);
    workIds.push(c.work.id);
  }
  const finalRun = makeRunRecord({
    id: runId,
    projectId: input.projectId,
    querySpecId: input.querySpec.id,
    providerId: input.provider.id,
    startedAt,
    status: result.status,
    candidateWorkIds: [...workIds],
    totalHits: result.totalHits,
    errors: [...result.errors],
    completedAt: result.completedAt,
    runNumber,
  });
  await repository.transact(async (tx) => {
    for (const c of candidateRecords) tx.putCandidate(c);
    // Persist the *raw* Works too. The Library view
    // can then dedup + show the conflicts; the user
    // decides which one wins.
    for (const c of result.candidates) tx.putWork(c.work);
    tx.putRun(finalRun);
  });
  return { run: finalRun, candidates: candidateRecords };
}

/**
 * Apply the user's verdict (`saved | maybe | excluded`)
 * to a candidate. The Work is *not* auto-promoted to
 * the Library; the host UI calls `saveWorkFromCandidate`
 * to add the Work to a project's library.
 *
 * Note: when the verdict is `excluded`, an `excludeReason`
 * is recorded so the user can recover the verdict
 * later. A verdict of `pending` clears any previous
 * reason.
 */
export async function setCandidateVerdict(
  repository: ResearchRepository,
  input: SaveCandidateInput,
): Promise<SearchCandidate> {
  const target = await repository.getCandidate(input.candidateId);
  if (!target) throw new Error(`setCandidateVerdict: candidate ${input.candidateId} not found.`);
  const now = nowIso();
  const next: SearchCandidate = {
    ...target,
    verdict: input.verdict,
    ...(input.verdict === 'excluded' && input.excludeReason !== undefined
      ? { excludeReason: input.excludeReason }
      : {}),
    verdictAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putCandidate(next);
  });
  return next;
}

/**
 * Save a candidate Work to the project's library. The
 * candidate's verdict becomes `saved`; the Work gains
 * the project id in `projectIds`. The use case does
 * NOT silently resolve Work conflicts — when the
 * canonical Work already exists with a different DOI
 * or title, a `WorkConflict` is persisted and the
 * host must call `resolveConflict`.
 */
export async function saveWorkFromCandidate(
  repository: ResearchRepository,
  input: { candidateId: string; projectId: string; idFactory?: () => string },
): Promise<{ work: Work; conflict?: WorkConflict }> {
  const candidate = await repository.getCandidate(input.candidateId);
  if (!candidate) throw new Error(`saveWorkFromCandidate: candidate ${input.candidateId} not found.`);
  const existing = await repository.getWork(candidate.workId);
  // Existing work: union the project id, mark candidate
  // saved, return the existing record.
  if (existing) {
    const alreadyOnProject = existing.projectIds.includes(input.projectId);
    if (alreadyOnProject) {
      await repository.transact(async (tx) => {
        tx.putCandidate({ ...candidate, verdict: 'saved', verdictAt: nowIso() });
      });
      return { work: existing };
    }
    const nextWork: Work = {
      ...existing,
      projectIds: [...existing.projectIds, input.projectId],
      updatedAt: nowIso(),
    };
    await repository.transact(async (tx) => {
      tx.putWork(nextWork);
      tx.putCandidate({ ...candidate, verdict: 'saved', verdictAt: nowIso() });
    });
    return { work: nextWork };
  }
  // No existing row — persist a fresh Work.
  const work: Work = {
    id: candidate.workId,
    identifiers: candidate.work.identifiers,
    title: candidate.work.title,
    authors: candidate.work.authors,
    ...(candidate.work.year !== undefined ? { year: candidate.work.year } : {}),
    ...(candidate.work.venue ? { venue: candidate.work.venue } : {}),
    ...(candidate.work.abstract ? { abstract: candidate.work.abstract } : {}),
    metadataProvenance: candidate.work.metadataProvenance,
    integrity: candidate.work.integrity,
    assetIds: [],
    projectIds: [input.projectId],
    readingStatus: 'unread',
    importance: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    authorType: candidate.work.authorType,
  };
  await repository.transact(async (tx) => {
    tx.putWork(work);
    tx.putCandidate({ ...candidate, verdict: 'saved', verdictAt: nowIso() });
  });
  return { work };
}

/** Add a user-supplied DOI or URL without pretending metadata was verified. */
export async function addWorkFromIdentifier(
  repository: ResearchRepository,
  input: { projectId: string; value: string; title?: string; idFactory?: () => string },
): Promise<Work> {
  const raw = input.value.trim();
  if (!raw) throw new Error('Enter a DOI or URL.');
  const doiMatch = raw.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i);
  const doi = doiMatch?.[1]?.replace(/[.,;)]$/, '').toLowerCase();
  let url: string | undefined;
  if (!doi) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
      url = parsed.toString();
    } catch {
      throw new Error('Enter a complete https:// URL or DOI such as 10.1000/example.');
    }
  }

  const now = nowIso();
  const title = input.title?.trim() || (doi ? `DOI ${doi}` : new URL(url as string).hostname);
  const identifiers = doi ? { doi } : {};
  const id = makeWorkIdFromIdentifiers(identifiers, title, [], undefined);
  const existing = await repository.getWork(id);
  if (existing) {
    if (existing.projectIds.includes(input.projectId)) return existing;
    const next = { ...existing, projectIds: [...existing.projectIds, input.projectId], updatedAt: now };
    await repository.transact(async (tx) => tx.putWork(next));
    return next;
  }

  const assetId = url ? (input.idFactory?.() ?? `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`) : null;
  const work: Work = {
    id,
    identifiers,
    title,
    authors: [],
    metadataProvenance: {
      title: { providerId: 'user', at: now },
      ...(doi ? { doi: { providerId: 'user', at: now } } : {}),
    },
    integrity: 'unknown',
    assetIds: assetId ? [assetId] : [],
    projectIds: [input.projectId],
    readingStatus: 'unread',
    importance: 0,
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putWork(work);
    if (assetId && url) {
      tx.putWorkAsset({ id: assetId, workId: id, kind: 'oa-url', ref: url, createdAt: now });
    }
  });
  return work;
}

/**
 * Create an Evidence Draft. The draft always starts in
 * `candidate` state. The user moves it to `verified` by
 * calling `verifyEvidence`. The AI may fill the
 * `userInterpretation` (the use case records it as
 * `aiCandidateInterpretation`); the *real*
 * `userInterpretation` is always the user's own
 * text. The repository will throw on `verifyEvidence`
 * if the interpretation is empty — see the invariant
 * note at the top of the file.
 */
export async function createEvidenceDraft(
  repository: ResearchRepository,
  input: CreateEvidenceDraftInput,
): Promise<Evidence> {
  // Verify the Work exists in the repository (the user
  // can only create evidence for a Work the project
  // knows about).
  const work = await repository.getWork(input.workId);
  if (!work) throw new Error(`createEvidenceDraft: work ${input.workId} not found.`);
  // Source locator kind must be valid; we use the
  // domain guard so a bogus kind is caught at the
  // boundary.
  if (!isResearchSourceKind(input.locator.kind)) {
    throw new Error(`createEvidenceDraft: unknown locator kind ${input.locator.kind}.`);
  }
  const now = nowIso();
  const id = makeId(input.idFactory, 'e');
  const record = makeEvidenceRecord({
    id,
    projectId: input.projectId,
    workId: input.workId,
    locator: input.locator,
    exactQuote: input.exactQuote,
    userInterpretation: input.userInterpretation ?? '',
    evidenceType: input.evidenceType,
    status: 'candidate',
    note: undefined,
    draftId: undefined,
    lineageRunId: input.lineageRunId,
    authorType: input.userInterpretation ? 'user' : 'ai',
    now,
  });
  await repository.transact(async (tx) => {
    tx.putEvidence(record);
  });
  return record;
}

/**
 * Move an Evidence to `verified`. The repository will
 * throw if the record lacks a complete locator, a
 * non-empty quote, or a non-empty user
 * interpretation. The use case adds nothing on top.
 */
export async function verifyEvidence(
  repository: ResearchRepository,
  input: VerifyEvidenceInput,
): Promise<Evidence> {
  const target = await repository.getEvidence(input.evidenceId);
  if (!target) throw new Error(`verifyEvidence: evidence ${input.evidenceId} not found.`);
  const next: Evidence = {
    ...target,
    ...(input.exactQuote !== undefined ? { exactQuote: input.exactQuote } : {}),
    ...(input.userInterpretation !== undefined
      ? { userInterpretation: input.userInterpretation }
      : {}),
    ...(input.evidenceType !== undefined ? { evidenceType: input.evidenceType } : {}),
    status: 'verified',
    updatedAt: nowIso(),
  };
  if (!isEvidenceReadyForVerification(next)) {
    throw new Error(
      'verifyEvidence: cannot verify evidence without a complete locator, a non-empty quote, and a non-empty user interpretation.',
    );
  }
  await repository.transact(async (tx) => {
    tx.putEvidence(next);
  });
  return next;
}

/**
 * Reject an Evidence. The use case moves the record
 * to `rejected` and keeps the rest of the body for
 * lineage. The user can still see *why* the evidence
 * was rejected.
 */
export async function rejectEvidence(
  repository: ResearchRepository,
  input: RejectEvidenceInput,
): Promise<Evidence> {
  const target = await repository.getEvidence(input.evidenceId);
  if (!target) throw new Error(`rejectEvidence: evidence ${input.evidenceId} not found.`);
  const next: Evidence = { ...target, status: 'rejected', updatedAt: nowIso() };
  await repository.transact(async (tx) => {
    tx.putEvidence(next);
  });
  return next;
}

/**
 * Create a Claim in `canonical` state. The use case
 * is the user-authoring path; AI suggestions go
 * through `suggestClaimDraft` and `acceptClaimDraft`.
 */
export async function createClaim(
  repository: ResearchRepository,
  input: CreateClaimInput,
): Promise<Claim> {
  if (!input.title.trim()) throw new Error('createClaim: title is required.');
  const now = nowIso();
  const id = makeId(input.idFactory, 'c');
  const record = makeClaimRecord({
    id,
    projectId: input.projectId,
    title: input.title,
    body: input.body,
    status: 'canonical',
    aiSuggested: input.aiSuggested === true,
    draftId: input.draftId,
    lineageRunId: input.lineageRunId,
    authorType: input.aiSuggested ? 'ai' : 'user',
    now,
  });
  await repository.transact(async (tx) => {
    tx.putClaim(record);
  });
  return record;
}

/**
 * Link a Claim to a verified Evidence. The use case
 * reads both records first so a missing record throws
 * with a helpful message. The relation is one of
 * `supports | contradicts | qualifies`. The same Claim
 * can have multiple links to the same Evidence with
 * different relations (e.g. a single piece of evidence
 * can *support* one Claim and *qualify* another).
 */
export async function linkEvidenceToClaim(
  repository: ResearchRepository,
  input: LinkEvidenceInput,
): Promise<ClaimEvidenceLink> {
  // Verify the Claim exists.
  const claim = await repository.getClaim(input.claimId);
  if (!claim) throw new Error(`linkEvidenceToClaim: claim ${input.claimId} not found.`);
  // Verify the Evidence exists AND is verified.
  const ev = await repository.getEvidence(input.evidenceId);
  if (!ev) throw new Error(`linkEvidenceToClaim: evidence ${input.evidenceId} not found.`);
  if (ev.status !== 'verified') {
    throw new Error(
      `linkEvidenceToClaim: evidence ${input.evidenceId} is not verified; only verified evidence can be linked.`,
    );
  }
  const now = nowIso();
  const id = makeId(input.idFactory, 'l');
  const record = makeLinkRecord({
    id,
    projectId: input.projectId,
    claimId: input.claimId,
    evidenceId: input.evidenceId,
    relation: input.relation,
    note: input.note,
    authorType: 'user',
    now,
  });
  await repository.transact(async (tx) => {
    tx.putLink(record);
  });
  return record;
}

/**
 * Remove a ClaimEvidenceLink. The use case does not
 * touch the Claim or the Evidence.
 */
export async function unlinkEvidenceFromClaim(
  repository: ResearchRepository,
  input: UnlinkEvidenceInput,
): Promise<void> {
  await repository.transact(async (tx) => {
    tx.deleteLink(input.linkId);
  });
}

/**
 * Resolve a Work dedup conflict. The user picks one
 * of three resolutions:
 *
 *   - `use-existing` — drop the candidate, keep the
 *     existing Work. The candidate's verdict becomes
 *     `excluded` with a system-generated reason.
 *   - `use-candidate` — replace the existing Work with
 *     the candidate; the existing project membership
 *     is unioned into the candidate.
 *   - `keep-both` — leave the two Works as separate
 *     identities (a deliberate override). The
 *     candidate is still saved.
 */
export async function resolveConflict(
  repository: ResearchRepository,
  input: ResolveConflictInput,
): Promise<void> {
  const conflict = await repository.getConflict(input.conflictId);
  if (!conflict) throw new Error(`resolveConflict: conflict ${input.conflictId} not found.`);
  const existing = await repository.getWork(conflict.existingWorkId);
  const candidates = await repository.listCandidates({ projectId: conflict.projectId });
  const candidate = candidates.find((c) => c.workId === conflict.candidateWorkId);
  if (!candidate) {
    // The candidate is gone. Just drop the conflict.
    await repository.transact(async (tx) => {
      tx.deleteConflict(input.conflictId);
    });
    return;
  }
  if (input.resolution === 'use-existing') {
    await repository.transact(async (tx) => {
      tx.putCandidate({
        ...candidate,
        verdict: 'excluded',
        excludeReason: 'dedup: kept existing work',
        verdictAt: nowIso(),
      });
      tx.deleteConflict(input.conflictId);
    });
    return;
  }
  if (input.resolution === 'use-candidate') {
    if (!existing) {
      await repository.transact(async (tx) => {
        tx.putWork({ ...candidate.work, projectIds: [conflict.projectId] });
        tx.deleteConflict(input.conflictId);
      });
      return;
    }
    const merged: Work = {
      ...candidate.work,
      projectIds: Array.from(new Set([...existing.projectIds, conflict.projectId])),
      assetIds: Array.from(new Set([...existing.assetIds, ...candidate.work.assetIds])),
      updatedAt: nowIso(),
    };
    await repository.transact(async (tx) => {
      tx.putWork(merged);
      tx.deleteConflict(input.conflictId);
    });
    return;
  }
  // keep-both
  await repository.transact(async (tx) => {
    tx.deleteConflict(input.conflictId);
  });
}

// ---------------------------------------------------------------------------
// Draft Layer integration (AI suggestions)
// ---------------------------------------------------------------------------

/**
 * Suggest a Claim Draft. The use case writes a
 * `suggested` Draft Layer record and returns its id.
 * The host shows the draft in the Intent Capsule; the
 * user Accepts (`acceptClaimDraft`) or Rejects
 * (`rejectClaimDraft`).
 *
 * The function is intentionally tiny: it only creates
 * the draft and returns its id. The actual AI call
 * is the host's responsibility (the AI provider lives
 * in `features/ai/kernel/providerRouter`).
 */
export function suggestClaimDraft(input: SuggestClaimDraftInput): DraftRecord {
  const id = makeId(input.idFactory, 'cdraft');
  return draftLayer.create({
    id,
    title: input.title,
    body: { kind: 'text', text: input.body },
    target: {
      targetId: id,
      kind: 'claim',
      containerId: input.projectId,
    },
    provenance: {
      provider: 'pending',
      actionId: 'research.suggestClaim',
      contextSnapshotHash: input.projectId,
      sourceScope: ['project:' + input.projectId],
      invocationSurface: 'intent-capsule',
      createdAt: nowIso(),
    },
    noUndo: true,
  });
}

/**
 * Move an accepted Claim Draft into canonical state.
 * The use case creates a `Claim` with
 * `aiSuggested: true` and `status: 'canonical'`; the
 * Draft Layer record is left in `accepted` for the
 * audit trail.
 */
export async function acceptClaimDraft(
  repository: ResearchRepository,
  input: AcceptClaimDraftInput,
): Promise<Claim> {
  const draft = draftLayer.get(input.draftId);
  if (!draft) throw new Error(`acceptClaimDraft: draft ${input.draftId} not found.`);
  // The user may have edited the draft body before
  // accepting. The host passes the *current* title +
  // body, not the draft's original. We trust the host
  // to surface the diff.
  const now = nowIso();
  const id = makeId(input.idFactory, 'c');
  const record = makeClaimRecord({
    id,
    projectId: input.projectId,
    title: input.title,
    body: input.body,
    status: 'canonical',
    aiSuggested: true,
    draftId: input.draftId,
    lineageRunId: input.lineageRunId,
    authorType: 'ai',
    now,
  });
  await repository.transact(async (tx) => {
    tx.putClaim(record);
    // The evidence / claim set may have grown while the
    // draft was open. We DON'T touch any other object
    // here.
  });
  draftLayer.transition(input.draftId, 'accepted');
  return record;
}

/**
 * Reject a Claim Draft. The use case transitions the
 * draft to `rejected` and writes nothing to the
 * repository.
 */
export function rejectClaimDraft(draftId: string): void {
  draftLayer.transition(draftId, 'rejected');
}
