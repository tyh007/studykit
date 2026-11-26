/**
 * StudyKit v0.4 — `application/research/researchRepository`
 *
 * Persistence contract for the Research Evidence Slice
 * (WP-05). Mirrors the shape of the Study repository
 * (atomic `transact`, live `subscribe`, in-memory +
 * Dexie adapters) but scoped to the Research objects:
 *
 *   - `ResearchProject`     — the container.
 *   - `QuerySpec`           — structured search query.
 *   - `SearchRun`           — executed search.
 *   - `SearchCandidate`     — one Work + why-it-appeared.
 *   - `Work`                — canonical academic Work.
 *   - `WorkAsset`           — local PDF / OA URL.
 *   - `Evidence`            — passage + locator + interpretation.
 *   - `Claim`               — user / AI claim.
 *   - `ClaimEvidenceLink`   — directional relation.
 *   - `WorkConflict`        — a dedup disagreement for the
 *                              user to resolve.
 *
 * Why a separate contract (not the WP-00 generic
 * `StudyKitRepository`)? Two reasons:
 *
 *   1. The Research slice has a much wider surface
 *      (ten tables) and a different query shape (by
 *      project + verdict + workId, not by kind +
 *      containerId). A separate contract is honest
 *      about the surface.
 *   2. The Research slice is opt-in (gated by the
 *      `v04Research` flag). Until the flag is on, the
 *      Dexie schema's v5 tables are simply not opened —
 *      the migration is additive, but the repository
 *      factory is a no-op.
 *
 * Invariants the contract enforces:
 *
 *   - `transact` is the only way to write. The
 *     transaction callback receives a single
 *     `ResearchRepositoryTransaction` whose methods
 *     stage every change; the adapter applies the whole
 *     batch atomically at the end of the callback.
 *   - `subscribe` fires on every commit. Adapters MUST
 *     debounce so a single transact is one notification.
 *   - `putEvidence` and `putClaim` (write paths) keep
 *     field-level invariants: an `Evidence` cannot be
 *     `verified` without a complete locator, a non-empty
 *     quote, and a non-empty user interpretation. The
 *     contract throws on the first violation, so the
 *     UI never sees a half-baked record.
 */

import type {
  Claim,
  ClaimEvidenceLink,
  Evidence,
  QuerySpec,
  ResearchProject,
  SearchCandidate,
  SearchRun,
  SearchRunStatus,
  Work,
  WorkAsset,
  WorkConflict,
} from '../../domain/research';
import { isEvidenceReadyForVerification } from '../../domain/research';
import type {
  DesignSpec,
  Hypothesis,
  MethodDecision,
  Milestone,
  ResearchQuestion,
  ResearchRisk,
  ResearchTask,
} from '../../domain/researchDesign';
import { defaultTaskOrigin, isTaskOrigin, normalizeTaskOrigin } from '../../domain/researchDesign';
import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../../domain/output';
import {
  isOutputDocument,
  isOutputSection,
  isOutputStatement,
  isStatementSupport,
  stableSectionOrder,
  stableStatementOrder,
  supportDedupKey,
} from '../../domain/output';
import type { StatementCitation } from '../../domain/citation';
import {
  isAiDraftDecision,
  isAiMessage,
  isAiThread,
  type AiDraftDecision,
  type AiMessage,
  type AiThread,
} from '../../domain/aiThread';
import {
  citationDedupKey,
  isStatementCitation,
} from '../../domain/citation';

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export interface ResearchRepositoryTransaction {
  putProject(p: ResearchProject): void;
  deleteProject(id: string): void;
  putQuerySpec(q: QuerySpec): void;
  deleteQuerySpec(id: string): void;
  putRun(r: SearchRun): void;
  deleteRun(id: string): void;
  putCandidate(c: SearchCandidate): void;
  deleteCandidate(id: string): void;
  putWork(w: Work): void;
  deleteWork(id: string): void;
  putWorkAsset(a: WorkAsset): void;
  deleteWorkAsset(id: string): void;
  putEvidence(e: Evidence): void;
  deleteEvidence(id: string): void;
  putClaim(c: Claim): void;
  deleteClaim(id: string): void;
  putLink(l: ClaimEvidenceLink): void;
  deleteLink(id: string): void;
  putConflict(c: WorkConflict): void;
  deleteConflict(id: string): void;
  // WP-07: Research Design + Project Management.
  putQuestion(q: ResearchQuestion): void;
  deleteQuestion(id: string): void;
  putHypothesis(h: Hypothesis): void;
  deleteHypothesis(id: string): void;
  putDesignSpec(s: DesignSpec): void;
  deleteDesignSpec(id: string): void;
  putMethodDecision(d: MethodDecision): void;
  deleteMethodDecision(id: string): void;
  putRisk(r: ResearchRisk): void;
  deleteRisk(id: string): void;
  putMilestone(m: Milestone): void;
  deleteMilestone(id: string): void;
  putTask(t: ResearchTask): void;
  deleteTask(id: string): void;
  // WP-10 Round 1: Evidence-backed Output. The four
  // tables share the `ResearchRepository` transaction
  // surface so there is exactly one canonical store;
  // there is no parallel `OutputRepository`.
  putOutput(o: OutputDocument): void;
  deleteOutput(id: string): void;
  putOutputSection(s: OutputSection): void;
  deleteOutputSection(id: string): void;
  putOutputStatement(s: OutputStatement): void;
  deleteOutputStatement(id: string): void;
  putStatementSupport(s: StatementSupport): void;
  deleteStatementSupport(id: string): void;
  putStatementCitation(c: StatementCitation): void;
  deleteStatementCitation(id: string): void;
  // v0.5 P4: project AI threads (ADR-003 §4). Messages and draft
  // decisions are append-only: putting an id that already exists throws.
  putAiThread(t: AiThread): void;
  deleteAiThread(id: string): void;
  appendAiMessage(m: AiMessage): void;
  appendAiDraftDecision(d: AiDraftDecision): void;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ResearchProjectQuery {
  readonly kind?: ResearchProject['kind'];
}

export interface SearchRunQuery {
  readonly projectId: string;
  readonly status?: SearchRunStatus;
  readonly limit?: number;
}

export interface SearchCandidateQuery {
  readonly runId?: string;
  readonly projectId?: string;
  readonly verdict?: SearchCandidate['verdict'];
}

export interface WorkQuery {
  readonly projectId?: string;
  /** Filter by one of the canonical identifier values. */
  readonly doi?: string;
  readonly pmid?: string;
  readonly arxiv?: string;
  readonly openAlex?: string;
  readonly semanticScholar?: string;
  readonly zotero?: string;
  /** Free-text search on title. Adapter-defined. */
  readonly text?: string;
  /** Reading status filter. */
  readonly readingStatus?: Work['readingStatus'];
  /** Asset ref path (for "which Work does this PDF belong to?"). */
  readonly assetRef?: string;
  readonly limit?: number;
}

export interface EvidenceQuery {
  readonly projectId: string;
  readonly workId?: string;
  readonly status?: Evidence['status'];
  readonly evidenceType?: Evidence['evidenceType'];
  readonly limit?: number;
}

export interface ClaimQuery {
  readonly projectId: string;
  readonly status?: Claim['status'];
  readonly limit?: number;
}

export interface ClaimLinkQuery {
  readonly projectId: string;
  readonly claimId?: string;
  readonly evidenceId?: string;
}

export interface WorkConflictQuery {
  readonly projectId: string;
}

// WP-07: Design + Project Management queries.

export interface ResearchQuestionQuery {
  readonly projectId: string;
  readonly status?: ResearchQuestion['status'];
  readonly limit?: number;
}

export interface HypothesisQuery {
  readonly projectId: string;
  readonly questionId?: string;
  readonly limit?: number;
}

export interface DesignSpecQuery {
  readonly projectId: string;
  readonly questionId?: string;
  readonly limit?: number;
}

export interface MethodDecisionQuery {
  readonly projectId: string;
  readonly specId?: string;
  readonly sectionKind?: MethodDecision['sectionKind'];
  /** Optional chain id filter (WP-07 Round 2). */
  readonly chainId?: string;
  readonly limit?: number;
}

export interface ResearchRiskQuery {
  readonly projectId: string;
  readonly kind?: ResearchRisk['kind'];
  readonly status?: ResearchRisk['status'];
  readonly limit?: number;
}

export interface MilestoneQuery {
  readonly projectId: string;
  readonly status?: Milestone['status'];
  readonly limit?: number;
}

export interface ResearchTaskQuery {
  readonly projectId: string;
  readonly status?: ResearchTask['status'];
  readonly milestoneId?: string;
  readonly limit?: number;
}

// WP-10 Round 1: Evidence-backed Output queries.

export interface ResearchOutputQuery {
  readonly projectId?: string;
  readonly status?: OutputDocument['status'];
  readonly limit?: number;
}

export interface OutputSectionQuery {
  readonly outputId: string;
}

export interface OutputStatementQuery {
  readonly outputId?: string;
  readonly sectionId?: string;
  readonly projectId?: string;
}

export interface StatementSupportQuery {
  readonly statementId?: string;
  readonly outputId?: string;
  readonly projectId?: string;
}

export interface AiThreadQuery {
  readonly projectId: string;
}

export interface AiMessageQuery {
  readonly threadId?: string;
  readonly projectId?: string;
}

export interface StatementCitationQuery {
  readonly statementId?: string;
  readonly outputId?: string;
  readonly projectId?: string;
  readonly workId?: string;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type ResearchQueryListener = (snapshot: ResearchSnapshot) => void;
export type Unsubscribe = () => void;

export interface ResearchSnapshot {
  readonly projects: readonly ResearchProject[];
  readonly querySpecs: readonly QuerySpec[];
  readonly runs: readonly SearchRun[];
  readonly candidates: readonly SearchCandidate[];
  readonly works: readonly Work[];
  readonly workAssets: readonly WorkAsset[];
  readonly evidence: readonly Evidence[];
  readonly claims: readonly Claim[];
  readonly links: readonly ClaimEvidenceLink[];
  readonly conflicts: readonly WorkConflict[];
  // WP-07: Design + Project Management.
  readonly questions: readonly ResearchQuestion[];
  readonly hypotheses: readonly Hypothesis[];
  readonly designSpecs: readonly DesignSpec[];
  readonly methodDecisions: readonly MethodDecision[];
  readonly risks: readonly ResearchRisk[];
  readonly milestones: readonly Milestone[];
  readonly tasks: readonly ResearchTask[];
  // WP-10 Round 1: Evidence-backed Output snapshot
  // fields. The contract is a single canonical store
  // for the entire research vertical; downstream
  // subscribers can pick the fields they need.
  readonly outputs: readonly OutputDocument[];
  readonly outputSections: readonly OutputSection[];
  readonly outputStatements: readonly OutputStatement[];
  readonly statementSupports: readonly StatementSupport[];
  readonly statementCitations: readonly StatementCitation[];
  readonly aiThreads: readonly AiThread[];
  readonly aiMessages: readonly AiMessage[];
  readonly aiDraftDecisions: readonly AiDraftDecision[];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface ResearchRepository {
  // --- read
  getProject(id: string): Promise<ResearchProject | null>;
  listProjects(query?: ResearchProjectQuery): Promise<ResearchProject[]>;
  getQuerySpec(id: string): Promise<QuerySpec | null>;
  listQuerySpecsForProject(projectId: string): Promise<QuerySpec[]>;
  getRun(id: string): Promise<SearchRun | null>;
  listRuns(query: SearchRunQuery): Promise<SearchRun[]>;
  listCandidates(query: SearchCandidateQuery): Promise<SearchCandidate[]>;
  getCandidate(id: string): Promise<SearchCandidate | null>;
  getWork(id: string): Promise<Work | null>;
  listWorks(query?: WorkQuery): Promise<Work[]>;
  listWorkAssetsForWork(workId: string): Promise<WorkAsset[]>;
  findWorkByAssetRef(ref: string): Promise<Work | null>;
  listEvidence(query: EvidenceQuery): Promise<Evidence[]>;
  getEvidence(id: string): Promise<Evidence | null>;
  listClaims(query: ClaimQuery): Promise<Claim[]>;
  getClaim(id: string): Promise<Claim | null>;
  listLinks(query: ClaimLinkQuery): Promise<ClaimEvidenceLink[]>;
  listConflicts(query: WorkConflictQuery): Promise<WorkConflict[]>;
  getConflict(id: string): Promise<WorkConflict | null>;

  // --- WP-07: Design + Project Management reads
  listQuestions(query: ResearchQuestionQuery): Promise<ResearchQuestion[]>;
  getQuestion(id: string): Promise<ResearchQuestion | null>;
  listHypotheses(query: HypothesisQuery): Promise<Hypothesis[]>;
  listDesignSpecs(query: DesignSpecQuery): Promise<DesignSpec[]>;
  getDesignSpec(id: string): Promise<DesignSpec | null>;
  listMethodDecisions(query: MethodDecisionQuery): Promise<MethodDecision[]>;
  getMethodDecision(id: string): Promise<MethodDecision | null>;
  listRisks(query: ResearchRiskQuery): Promise<ResearchRisk[]>;
  listMilestones(query: MilestoneQuery): Promise<Milestone[]>;
  listTasks(query: ResearchTaskQuery): Promise<ResearchTask[]>;
  getTask(id: string): Promise<ResearchTask | null>;

  // --- WP-10 Round 1: Evidence-backed Output reads
  getOutput(id: string): Promise<OutputDocument | null>;
  listOutputs(query?: ResearchOutputQuery): Promise<OutputDocument[]>;
  getOutputSection(id: string): Promise<OutputSection | null>;
  listOutputSections(query: OutputSectionQuery): Promise<OutputSection[]>;
  getOutputStatement(id: string): Promise<OutputStatement | null>;
  listOutputStatements(query: OutputStatementQuery): Promise<OutputStatement[]>;
  listStatementSupports(query: StatementSupportQuery): Promise<StatementSupport[]>;
  getStatementCitation(id: string): Promise<StatementCitation | null>;
  listStatementCitations(query: StatementCitationQuery): Promise<StatementCitation[]>;
  getAiThread(id: string): Promise<AiThread | null>;
  listAiThreads(query: AiThreadQuery): Promise<AiThread[]>;
  listAiMessages(query: AiMessageQuery): Promise<AiMessage[]>;
  listAiDraftDecisions(query: AiMessageQuery): Promise<AiDraftDecision[]>;

  // --- atomic writes
  transact<T>(fn: (tx: ResearchRepositoryTransaction) => T | Promise<T>): Promise<T>;

  // --- live updates
  subscribe(listener: ResearchQueryListener): Unsubscribe;
}

// ---------------------------------------------------------------------------
// Helpers — invariants
// ---------------------------------------------------------------------------

/**
 * Throw with a helpful message if the evidence record
 * cannot be in `verified` state. The repository runs
 * this on every `putEvidence` so a buggy caller cannot
 * silently corrupt the canonical store.
 */
export function assertEvidenceInvariants(e: Evidence): void {
  if (e.status === 'verified' && !isEvidenceReadyForVerification(e)) {
    throw new Error(
      'Evidence cannot be verified without a complete locator, a non-empty quote, ' +
        'and a non-empty user interpretation.',
    );
  }
}

/**
 * Throw when a `ResearchTask` is being persisted in an
 * invalid state. The repository runs this on every
 * `putTask` so a buggy use case cannot silently corrupt
 * the canonical store. Invariants:
 *
 *   1. `why` and `definitionOfDone` MUST be non-empty
 *      (a task the user can't explain is worse than no
 *      task at all).
 *   2. `status: 'done'` requires `completionRef` to be
 *      set with a non-empty `id`.
 *   3. `status: 'blocked'` requires a `blocker` (without
 *      a blocker note the user can't see *why* they're
 *      waiting).
 *   4. `dependencies` MUST NOT include the task's own
 *      id.
 *   5. `blocker` MUST be `null` for any non-blocked
 *      status (the workspace should not silently show
 *      "still blocked" after the user moved on).
 */
export function assertTaskInvariants(t: ResearchTask): void {
  if (t.why.trim().length === 0) {
    throw new Error('ResearchTask must have a non-empty "why".');
  }
  if (t.definitionOfDone.trim().length === 0) {
    throw new Error('ResearchTask must have a non-empty "definitionOfDone".');
  }
  if (t.status === 'done') {
    if (!t.completionRef) {
      throw new Error(
        'ResearchTask cannot be marked "done" without a completionRef (an Output, Decision, or verified Evidence).',
      );
    }
    if (t.completionRef.id.length === 0) {
      throw new Error('ResearchTask completionRef.id must be non-empty.');
    }
  }
  if (t.status === 'blocked' && !t.blocker) {
    throw new Error('ResearchTask cannot be "blocked" without a blocker (kind + note).');
  }
  if (t.status !== 'blocked' && t.blocker) {
    throw new Error('ResearchTask has a blocker but status is not "blocked"; clear the blocker first.');
  }
  if (t.dependencies.includes(t.id)) {
    throw new Error('ResearchTask cannot depend on itself.');
  }
  // WP-07 Round 3: validate the structured origin.
  // Legacy rows pre-date the field; the read path
  // fills in `{ kind: 'user' }` at deserialisation.
  // Every new write must carry a typed origin.
  const origin = (t as unknown as { origin?: unknown }).origin;
  if (origin === undefined || origin === null) {
    throw new Error('ResearchTask must carry a typed "origin" (use {kind:"user"} for manual tasks).');
  }
  if (!isTaskOrigin(origin)) {
    throw new Error('ResearchTask "origin" is not a valid TaskOrigin.');
  }
  if (origin.kind === 'ai-accepted' && t.authorType !== 'user') {
    throw new Error('ResearchTask with origin="ai-accepted" must have authorType="user".');
  }
}

/**
 * Backward-compatible read helper: legacy rows
 * pre-date the structured `origin` field. The
 * repository stores the field as the writer wrote it;
 * the read path fills in a typed value derived from
 * the row's `authorType` (`imported` → `imported`,
 * otherwise `user`). Malformed origins are a
 * contract violation: the read path throws rather
 * than silently dropping the field, so the test
 * suite catches the regression.
 */
function withDefaultOrigin(t: ResearchTask): ResearchTask {
  const raw = t as unknown as { origin?: unknown };
  const origin = normalizeTaskOrigin(raw.origin, t.authorType);
  return { ...t, origin };
}

/**
 * Throw when `from -> to` (a "to depends on from" edge)
 * would form a cycle in the existing graph. The map is
 * keyed by task id with the array of ids the task
 * depends on. Pure function; the use case builds the map
 * from a `listTasks` snapshot.
 */
export function assertNoDependencyCycle(args: {
  readonly existing: ReadonlyMap<string, readonly string[]>;
  readonly from: string;
  readonly to: string;
}): void {
  // Walk forward from `to`; if we ever reach `from`, the
  // new edge closes a loop.
  const stack: string[] = [args.to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === args.from) {
      throw new Error(
        `Task dependency would create a cycle: ${args.from} -> ... -> ${args.from}.`,
      );
    }
    if (seen.has(node)) continue;
    seen.add(node);
    const next = args.existing.get(node) ?? [];
    for (const n of next) {
      if (!seen.has(n)) stack.push(n);
    }
  }
}

// ---------------------------------------------------------------------------
// WP-10 Round 1: Output invariants. The repository
// runs these on every write so a buggy use case cannot
// silently corrupt the canonical store.
// ---------------------------------------------------------------------------

/**
 * Throw when an `OutputDocument` is invalid. The
 * repository runs this on every `putOutput`. The
 * domain guard `isOutputDocument` already rejects the
 * obvious shape problems (empty ids, bad timestamps,
 * AI claiming `final`); this helper is a second-line
 * defence with clearer error messages.
 */
export function assertOutputInvariants(o: OutputDocument): void {
  if (!isOutputDocument(o)) {
    throw new Error('OutputDocument does not satisfy the canonical domain contract.');
  }
  if (!o.id) throw new Error('OutputDocument must have an id.');
  if (!o.projectId) throw new Error('OutputDocument must have a projectId.');
  if (!o.title.trim()) throw new Error('OutputDocument title cannot be empty.');
  if (o.authorType === 'ai' && o.status === 'final') {
    throw new Error('An AI-authored OutputDocument cannot be in "final" status.');
  }
}

export function assertOutputSectionInvariants(s: OutputSection): void {
  if (!isOutputSection(s)) {
    throw new Error('OutputSection does not satisfy the canonical domain contract.');
  }
  if (!s.id) throw new Error('OutputSection must have an id.');
  if (!s.projectId) throw new Error('OutputSection must have a projectId.');
  if (!s.outputId) throw new Error('OutputSection must have an outputId.');
  if (typeof s.order !== 'number' || !Number.isFinite(s.order) || s.order < 0) {
    throw new Error(
      `OutputSection.order must be a non-negative finite number (got ${String(s.order)}).`,
    );
  }
  if (!s.title.trim()) throw new Error('OutputSection title cannot be empty.');
}

export function assertOutputStatementInvariants(s: OutputStatement): void {
  if (!isOutputStatement(s)) {
    throw new Error('OutputStatement does not satisfy the canonical domain contract.');
  }
  if (!s.id) throw new Error('OutputStatement must have an id.');
  if (!s.projectId) throw new Error('OutputStatement must have a projectId.');
  if (!s.outputId) throw new Error('OutputStatement must have an outputId.');
  if (!s.sectionId) throw new Error('OutputStatement must have a sectionId.');
  if (typeof s.order !== 'number' || !Number.isFinite(s.order) || s.order < 0) {
    throw new Error(
      `OutputStatement.order must be a non-negative finite number (got ${String(s.order)}).`,
    );
  }
  if (!s.body.trim()) {
    throw new Error('OutputStatement body cannot be empty.');
  }
  // The repository never persists AI text directly.
  // The Draft Layer is the only path AI text takes to
  // become canonical — and that path writes
  // `authorType: 'user'` because the user is the one
  // who Accepts.
  if (s.authorType === 'ai') {
    throw new Error(
      'OutputStatement authorType="ai" is not allowed; AI text lives in the Draft Layer.',
    );
  }
}

export function assertStatementSupportInvariants(s: StatementSupport): void {
  if (!isStatementSupport(s)) {
    throw new Error('StatementSupport does not satisfy the canonical domain contract.');
  }
  if (!s.id) throw new Error('StatementSupport must have an id.');
  if (!s.projectId) throw new Error('StatementSupport must have a projectId.');
  if (!s.outputId) throw new Error('StatementSupport must have an outputId.');
  if (!s.statementId) throw new Error('StatementSupport must have a statementId.');
  if (s.ref.kind !== 'claim' && s.ref.kind !== 'evidence') {
    throw new Error('StatementSupport.ref.kind must be "claim" or "evidence".');
  }
  if (!s.ref.id) throw new Error('StatementSupport.ref.id cannot be empty.');
}

export function assertAiThreadInvariants(t: AiThread): void {
  if (!isAiThread(t)) throw new Error('AiThread does not satisfy the domain contract.');
}

export function assertAiMessageInvariants(m: AiMessage): void {
  if (!isAiMessage(m)) throw new Error('AiMessage does not satisfy the domain contract.');
}

export function assertAiDraftDecisionInvariants(d: AiDraftDecision): void {
  if (!isAiDraftDecision(d)) throw new Error('AiDraftDecision does not satisfy the domain contract.');
}

/** Threads newest first; messages and decisions oldest first. */
export function sortAiThreads(all: AiThread[]): AiThread[] {
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function sortByCreated<T extends { createdAt?: string; decidedAt?: string; id: string }>(all: T[]): T[] {
  const at = (x: T): string => x.createdAt ?? x.decidedAt ?? '';
  return all.sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id));
}

export function assertStatementCitationInvariants(c: StatementCitation): void {
  if (!isStatementCitation(c)) {
    throw new Error('StatementCitation does not satisfy the canonical domain contract.');
  }
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory implementation. The Dexie adapter
 * lives under `platforms/web/`. This class is what the
 * use-case tests + the production composition tests
 * use; the Dexie adapter is the production store.
 */
export class MemoryResearchRepository implements ResearchRepository {
  private readonly projects = new Map<string, ResearchProject>();
  private readonly querySpecs = new Map<string, QuerySpec>();
  private readonly runs = new Map<string, SearchRun>();
  private readonly candidates = new Map<string, SearchCandidate>();
  private readonly works = new Map<string, Work>();
  private readonly workAssets = new Map<string, WorkAsset>();
  private readonly evidence = new Map<string, Evidence>();
  private readonly claims = new Map<string, Claim>();
  private readonly links = new Map<string, ClaimEvidenceLink>();
  private readonly conflicts = new Map<string, WorkConflict>();
  // WP-07: Design + Project Management.
  private readonly questions = new Map<string, ResearchQuestion>();
  private readonly hypotheses = new Map<string, Hypothesis>();
  private readonly designSpecs = new Map<string, DesignSpec>();
  private readonly methodDecisions = new Map<string, MethodDecision>();
  private readonly risks = new Map<string, ResearchRisk>();
  private readonly milestones = new Map<string, Milestone>();
  private readonly tasks = new Map<string, ResearchTask>();
  // WP-10 Round 1: Evidence-backed Output. Four
  // additional maps; no parallel `OutputRepository`.
  private readonly outputs = new Map<string, OutputDocument>();
  private readonly outputSections = new Map<string, OutputSection>();
  private readonly outputStatements = new Map<string, OutputStatement>();
  private readonly statementSupports = new Map<string, StatementSupport>();
  private readonly statementCitations = new Map<string, StatementCitation>();
  private readonly aiThreads = new Map<string, AiThread>();
  private readonly aiMessages = new Map<string, AiMessage>();
  private readonly aiDraftDecisions = new Map<string, AiDraftDecision>();
  private readonly listeners = new Set<ResearchQueryListener>();

  async getProject(id: string): Promise<ResearchProject | null> {
    return this.projects.get(id) ?? null;
  }

  async listProjects(query: ResearchProjectQuery = {}): Promise<ResearchProject[]> {
    let all = Array.from(this.projects.values());
    if (query.kind) all = all.filter((p) => p.kind === query.kind);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all;
  }

  async getQuerySpec(id: string): Promise<QuerySpec | null> {
    return this.querySpecs.get(id) ?? null;
  }

  async listQuerySpecsForProject(projectId: string): Promise<QuerySpec[]> {
    return Array.from(this.querySpecs.values())
      .filter((q) => q.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getRun(id: string): Promise<SearchRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(query: SearchRunQuery): Promise<SearchRun[]> {
    let all = Array.from(this.runs.values()).filter((r) => r.projectId === query.projectId);
    if (query.status) all = all.filter((r) => r.status === query.status);
    all.sort((a, b) => b.runNumber - a.runNumber);
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listCandidates(query: SearchCandidateQuery): Promise<SearchCandidate[]> {
    let all = Array.from(this.candidates.values());
    if (query.runId) all = all.filter((c) => c.runId === query.runId);
    if (query.projectId) all = all.filter((c) => c.projectId === query.projectId);
    if (query.verdict) all = all.filter((c) => c.verdict === query.verdict);
    all.sort((a, b) => a.providerRank - b.providerRank);
    return all;
  }

  async getCandidate(id: string): Promise<SearchCandidate | null> {
    return this.candidates.get(id) ?? null;
  }

  async getWork(id: string): Promise<Work | null> {
    return this.works.get(id) ?? null;
  }

  async listWorks(query: WorkQuery = {}): Promise<Work[]> {
    let all = Array.from(this.works.values());
    if (query.projectId) all = all.filter((w) => w.projectIds.includes(query.projectId as string));
    if (query.doi) all = all.filter((w) => w.identifiers.doi === query.doi);
    if (query.pmid) all = all.filter((w) => w.identifiers.pmid === query.pmid);
    if (query.arxiv) all = all.filter((w) => w.identifiers.arxiv === query.arxiv);
    if (query.openAlex) all = all.filter((w) => w.identifiers.openAlex === query.openAlex);
    if (query.semanticScholar) {
      all = all.filter((w) => w.identifiers.semanticScholar === query.semanticScholar);
    }
    if (query.zotero) all = all.filter((w) => w.identifiers.zotero === query.zotero);
    if (query.readingStatus) all = all.filter((w) => w.readingStatus === query.readingStatus);
    if (query.text) {
      const needle = query.text.toLowerCase();
      all = all.filter((w) => w.title.toLowerCase().includes(needle));
    }
    all.sort((a, b) => a.title.localeCompare(b.title));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listWorkAssetsForWork(workId: string): Promise<WorkAsset[]> {
    return Array.from(this.workAssets.values())
      .filter((a) => a.workId === workId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findWorkByAssetRef(ref: string): Promise<Work | null> {
    for (const a of this.workAssets.values()) {
      if (a.ref === ref) {
        return this.works.get(a.workId) ?? null;
      }
    }
    return null;
  }

  async listEvidence(query: EvidenceQuery): Promise<Evidence[]> {
    let all = Array.from(this.evidence.values()).filter((e) => e.projectId === query.projectId);
    if (query.workId) all = all.filter((e) => e.workId === query.workId);
    if (query.status) all = all.filter((e) => e.status === query.status);
    if (query.evidenceType) all = all.filter((e) => e.evidenceType === query.evidenceType);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getEvidence(id: string): Promise<Evidence | null> {
    return this.evidence.get(id) ?? null;
  }

  async listClaims(query: ClaimQuery): Promise<Claim[]> {
    let all = Array.from(this.claims.values()).filter((c) => c.projectId === query.projectId);
    if (query.status) all = all.filter((c) => c.status === query.status);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getClaim(id: string): Promise<Claim | null> {
    return this.claims.get(id) ?? null;
  }

  async listLinks(query: ClaimLinkQuery): Promise<ClaimEvidenceLink[]> {
    let all = Array.from(this.links.values()).filter((l) => l.projectId === query.projectId);
    if (query.claimId) all = all.filter((l) => l.claimId === query.claimId);
    if (query.evidenceId) all = all.filter((l) => l.evidenceId === query.evidenceId);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all;
  }

  async listConflicts(query: WorkConflictQuery): Promise<WorkConflict[]> {
    return Array.from(this.conflicts.values())
      .filter((c) => c.projectId === query.projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getConflict(id: string): Promise<WorkConflict | null> {
    return this.conflicts.get(id) ?? null;
  }

  // --- WP-07 reads

  async listQuestions(query: { projectId: string; status?: ResearchQuestion['status']; limit?: number }): Promise<ResearchQuestion[]> {
    let all = Array.from(this.questions.values()).filter((q) => q.projectId === query.projectId);
    if (query.status) all = all.filter((q) => q.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getQuestion(id: string): Promise<ResearchQuestion | null> {
    return this.questions.get(id) ?? null;
  }

  async listHypotheses(query: { projectId: string; questionId?: string; limit?: number }): Promise<Hypothesis[]> {
    let all = Array.from(this.hypotheses.values()).filter((h) => h.projectId === query.projectId);
    if (query.questionId !== undefined) {
      all = all.filter((h) => h.questionId === query.questionId);
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listDesignSpecs(query: { projectId: string; questionId?: string; limit?: number }): Promise<DesignSpec[]> {
    let all = Array.from(this.designSpecs.values()).filter((s) => s.projectId === query.projectId);
    if (query.questionId !== undefined) {
      all = all.filter((s) => s.questionId === query.questionId);
    }
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getDesignSpec(id: string): Promise<DesignSpec | null> {
    return this.designSpecs.get(id) ?? null;
  }

  async listMethodDecisions(query: {
    projectId: string;
    specId?: string;
    sectionKind?: MethodDecision['sectionKind'];
    chainId?: string;
    limit?: number;
  }): Promise<MethodDecision[]> {
    let all = Array.from(this.methodDecisions.values()).filter(
      (d) => d.projectId === query.projectId,
    );
    if (query.specId) all = all.filter((d) => d.specId === query.specId);
    if (query.sectionKind) all = all.filter((d) => d.sectionKind === query.sectionKind);
    if (query.chainId) all = all.filter((d) => d.chainId === query.chainId);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getMethodDecision(id: string): Promise<MethodDecision | null> {
    return this.methodDecisions.get(id) ?? null;
  }

  async listRisks(query: { projectId: string; kind?: ResearchRisk['kind']; status?: ResearchRisk['status']; limit?: number }): Promise<ResearchRisk[]> {
    let all = Array.from(this.risks.values()).filter((r) => r.projectId === query.projectId);
    if (query.kind) all = all.filter((r) => r.kind === query.kind);
    if (query.status) all = all.filter((r) => r.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listMilestones(query: { projectId: string; status?: Milestone['status']; limit?: number }): Promise<Milestone[]> {
    let all = Array.from(this.milestones.values()).filter((m) => m.projectId === query.projectId);
    if (query.status) all = all.filter((m) => m.status === query.status);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listTasks(query: { projectId: string; status?: ResearchTask['status']; milestoneId?: string; limit?: number }): Promise<ResearchTask[]> {
    let all = Array.from(this.tasks.values()).filter((t) => t.projectId === query.projectId);
    if (query.status) all = all.filter((t) => t.status === query.status);
    if (query.milestoneId !== undefined) {
      all = all.filter((t) => t.milestoneId === query.milestoneId);
    }
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all.map(withDefaultOrigin);
  }

  async getTask(id: string): Promise<ResearchTask | null> {
    const t = this.tasks.get(id) ?? null;
    return t ? withDefaultOrigin(t) : null;
  }

  // --- WP-10 Round 1: Output reads

  async getOutput(id: string): Promise<OutputDocument | null> {
    return this.outputs.get(id) ?? null;
  }

  async listOutputs(query: ResearchOutputQuery = {}): Promise<OutputDocument[]> {
    let all = Array.from(this.outputs.values());
    if (query.projectId) all = all.filter((o) => o.projectId === query.projectId);
    if (query.status) all = all.filter((o) => o.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getOutputSection(id: string): Promise<OutputSection | null> {
    return this.outputSections.get(id) ?? null;
  }

  async listOutputSections(query: OutputSectionQuery): Promise<OutputSection[]> {
    const all = Array.from(this.outputSections.values()).filter(
      (s) => s.outputId === query.outputId,
    );
    return stableSectionOrder(all);
  }

  async getOutputStatement(id: string): Promise<OutputStatement | null> {
    return this.outputStatements.get(id) ?? null;
  }

  async listOutputStatements(query: OutputStatementQuery): Promise<OutputStatement[]> {
    let all = Array.from(this.outputStatements.values());
    if (query.outputId) all = all.filter((s) => s.outputId === query.outputId);
    if (query.sectionId) all = all.filter((s) => s.sectionId === query.sectionId);
    if (query.projectId) all = all.filter((s) => s.projectId === query.projectId);
    return stableStatementOrder(all);
  }

  async listStatementSupports(query: StatementSupportQuery): Promise<StatementSupport[]> {
    let all = Array.from(this.statementSupports.values());
    if (query.statementId) {
      all = all.filter((s) => s.statementId === query.statementId);
    }
    if (query.outputId) all = all.filter((s) => s.outputId === query.outputId);
    if (query.projectId) all = all.filter((s) => s.projectId === query.projectId);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all;
  }

  async getStatementCitation(id: string): Promise<StatementCitation | null> {
    return this.statementCitations.get(id) ?? null;
  }

  async listStatementCitations(query: StatementCitationQuery): Promise<StatementCitation[]> {
    let all = Array.from(this.statementCitations.values());
    if (query.statementId) all = all.filter((c) => c.statementId === query.statementId);
    if (query.outputId) all = all.filter((c) => c.outputId === query.outputId);
    if (query.projectId) all = all.filter((c) => c.projectId === query.projectId);
    if (query.workId) all = all.filter((c) => c.workId === query.workId);
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async getAiThread(id: string): Promise<AiThread | null> {
    return this.aiThreads.get(id) ?? null;
  }

  async listAiThreads(query: AiThreadQuery): Promise<AiThread[]> {
    return sortAiThreads(Array.from(this.aiThreads.values()).filter((t) => t.projectId === query.projectId));
  }

  async listAiMessages(query: AiMessageQuery): Promise<AiMessage[]> {
    let all = Array.from(this.aiMessages.values());
    if (query.threadId) all = all.filter((m) => m.threadId === query.threadId);
    if (query.projectId) all = all.filter((m) => m.projectId === query.projectId);
    return sortByCreated(all);
  }

  async listAiDraftDecisions(query: AiMessageQuery): Promise<AiDraftDecision[]> {
    let all = Array.from(this.aiDraftDecisions.values());
    if (query.threadId) all = all.filter((d) => d.threadId === query.threadId);
    if (query.projectId) all = all.filter((d) => d.projectId === query.projectId);
    return sortByCreated(all);
  }

  async transact<T>(fn: (tx: ResearchRepositoryTransaction) => T | Promise<T>): Promise<T> {
    const staged = {
      projects: new Map<string, ResearchProject | null>(),
      querySpecs: new Map<string, QuerySpec | null>(),
      runs: new Map<string, SearchRun | null>(),
      candidates: new Map<string, SearchCandidate | null>(),
      works: new Map<string, Work | null>(),
      workAssets: new Map<string, WorkAsset | null>(),
      evidence: new Map<string, Evidence | null>(),
      claims: new Map<string, Claim | null>(),
      links: new Map<string, ClaimEvidenceLink | null>(),
      conflicts: new Map<string, WorkConflict | null>(),
      questions: new Map<string, ResearchQuestion | null>(),
      hypotheses: new Map<string, Hypothesis | null>(),
      designSpecs: new Map<string, DesignSpec | null>(),
      methodDecisions: new Map<string, MethodDecision | null>(),
      risks: new Map<string, ResearchRisk | null>(),
      milestones: new Map<string, Milestone | null>(),
      tasks: new Map<string, ResearchTask | null>(),
      outputs: new Map<string, OutputDocument | null>(),
      outputSections: new Map<string, OutputSection | null>(),
      outputStatements: new Map<string, OutputStatement | null>(),
      statementSupports: new Map<string, StatementSupport | null>(),
      statementCitations: new Map<string, StatementCitation | null>(),
      aiThreads: new Map<string, AiThread | null>(),
      aiMessages: new Map<string, AiMessage>(),
      aiDraftDecisions: new Map<string, AiDraftDecision>(),
    };
    const tx: ResearchRepositoryTransaction = {
      putProject: (p) => {
        assertResearchProjectInvariants(p);
        staged.projects.set(p.id, p);
      },
      deleteProject: (id) => staged.projects.set(id, null),
      putQuerySpec: (q) => staged.querySpecs.set(q.id, q),
      deleteQuerySpec: (id) => staged.querySpecs.set(id, null),
      putRun: (r) => staged.runs.set(r.id, r),
      deleteRun: (id) => staged.runs.set(id, null),
      putCandidate: (c) => staged.candidates.set(c.id, c),
      deleteCandidate: (id) => staged.candidates.set(id, null),
      putWork: (w) => staged.works.set(w.id, w),
      deleteWork: (id) => staged.works.set(id, null),
      putWorkAsset: (a) => staged.workAssets.set(a.id, a),
      deleteWorkAsset: (id) => staged.workAssets.set(id, null),
      putEvidence: (e) => {
        assertEvidenceInvariants(e);
        staged.evidence.set(e.id, e);
      },
      deleteEvidence: (id) => staged.evidence.set(id, null),
      putClaim: (c) => staged.claims.set(c.id, c),
      deleteClaim: (id) => staged.claims.set(id, null),
      putLink: (l) => staged.links.set(l.id, l),
      deleteLink: (id) => staged.links.set(id, null),
      putConflict: (c) => staged.conflicts.set(c.id, c),
      deleteConflict: (id) => staged.conflicts.set(id, null),
      // WP-07: every write goes through the author check
      // and the relevant shape guard. The host UI never
      // bypasses the use case.
      putQuestion: (q) => {
        // `q.authorType` is typed as `'user' | 'imported'`
        // (AI is excluded by the domain contract), so the
        // runtime guard above is a TypeScript no-op — but
        // we keep a defensive runtime check that throws
        // when a downstream cast widens the type. A
        // malformed object therefore cannot quietly slip
        // into the canonical store.
        if ((q as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical Question with authorType="ai".');
        }
        staged.questions.set(q.id, q);
      },
      deleteQuestion: (id) => staged.questions.set(id, null),
      putHypothesis: (h) => {
        if ((h as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical Hypothesis with authorType="ai".');
        }
        staged.hypotheses.set(h.id, h);
      },
      deleteHypothesis: (id) => staged.hypotheses.set(id, null),
      putDesignSpec: (s) => {
        if ((s as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical DesignSpec with authorType="ai".');
        }
        staged.designSpecs.set(s.id, s);
      },
      deleteDesignSpec: (id) => staged.designSpecs.set(id, null),
      putMethodDecision: (d) => {
        if ((d as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical MethodDecision with authorType="ai".');
        }
        staged.methodDecisions.set(d.id, d);
      },
      deleteMethodDecision: (id) => staged.methodDecisions.set(id, null),
      putRisk: (r) => {
        if ((r as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical Risk/Assumption with authorType="ai".');
        }
        staged.risks.set(r.id, r);
      },
      deleteRisk: (id) => staged.risks.set(id, null),
      putMilestone: (m) => {
        if ((m as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical Milestone with authorType="ai".');
        }
        staged.milestones.set(m.id, m);
      },
      deleteMilestone: (id) => staged.milestones.set(id, null),
      putTask: (t) => {
        if ((t as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical Task with authorType="ai".');
        }
        assertTaskInvariants(t);
        staged.tasks.set(t.id, t);
      },
      deleteTask: (id) => staged.tasks.set(id, null),
      // WP-10 Round 1: Output writes. Every write goes
      // through its domain invariant guard plus a
      // duplicate-support check inside the same
      // transaction, so a buggy use case cannot sneak
      // a malformed row past the boundary.
      putOutput: (o) => {
        assertOutputInvariants(o);
        staged.outputs.set(o.id, o);
      },
      deleteOutput: (id) => staged.outputs.set(id, null),
      putOutputSection: (s) => {
        assertOutputSectionInvariants(s);
        staged.outputSections.set(s.id, s);
      },
      deleteOutputSection: (id) => staged.outputSections.set(id, null),
      putOutputStatement: (s) => {
        assertOutputStatementInvariants(s);
        staged.outputStatements.set(s.id, s);
      },
      deleteOutputStatement: (id) => staged.outputStatements.set(id, null),
      putStatementSupport: (s) => {
        assertStatementSupportInvariants(s);
        // Duplicate detection inside the staged batch.
        // We honour the in-store row first (it may have
        // been staged earlier in the same transaction);
        // then we honour any earlier staged put. Either
        // way, the dedup key is the same.
        const key = supportDedupKey(s);
        const existingInStore = Array.from(this.statementSupports.values()).find(
          (x) => x.id !== s.id && supportDedupKey(x) === key,
        );
        if (existingInStore) {
          throw new Error(
            `StatementSupport duplicate: ${key} already exists for this statement.`,
          );
        }
        for (const [stagedId, stagedValue] of staged.statementSupports) {
          if (
            stagedId !== s.id &&
            stagedValue &&
            supportDedupKey(stagedValue) === key
          ) {
            throw new Error(
              `StatementSupport duplicate: ${key} was already written in this transaction.`,
            );
          }
        }
        staged.statementSupports.set(s.id, s);
      },
      deleteStatementSupport: (id) => staged.statementSupports.set(id, null),
      putStatementCitation: (c) => {
        assertStatementCitationInvariants(c);
        const key = citationDedupKey(c);
        const existing = Array.from(this.statementCitations.values()).find(
          (item) => item.id !== c.id && citationDedupKey(item) === key,
        );
        if (existing) throw new Error(`StatementCitation duplicate: ${key}.`);
        for (const [id, item] of staged.statementCitations) {
          if (id !== c.id && item && citationDedupKey(item) === key) {
            throw new Error(`StatementCitation duplicate: ${key}.`);
          }
        }
        staged.statementCitations.set(c.id, c);
      },
      deleteStatementCitation: (id) => staged.statementCitations.set(id, null),
      putAiThread: (t) => {
        assertAiThreadInvariants(t);
        staged.aiThreads.set(t.id, t);
      },
      deleteAiThread: (id) => staged.aiThreads.set(id, null),
      appendAiMessage: (m) => {
        assertAiMessageInvariants(m);
        if (this.aiMessages.has(m.id) || staged.aiMessages.has(m.id)) {
          throw new Error(`AiMessage ${m.id} already exists; messages are append-only.`);
        }
        staged.aiMessages.set(m.id, m);
      },
      appendAiDraftDecision: (d) => {
        assertAiDraftDecisionInvariants(d);
        if (this.aiDraftDecisions.has(d.id) || staged.aiDraftDecisions.has(d.id)) {
          throw new Error(`AiDraftDecision ${d.id} already exists; decisions are append-only.`);
        }
        staged.aiDraftDecisions.set(d.id, d);
      },
    };
    const result = await fn(tx);
    for (const [id, v] of staged.projects) apply(this.projects, id, v);
    for (const [id, v] of staged.querySpecs) apply(this.querySpecs, id, v);
    for (const [id, v] of staged.runs) apply(this.runs, id, v);
    for (const [id, v] of staged.candidates) apply(this.candidates, id, v);
    for (const [id, v] of staged.works) apply(this.works, id, v);
    for (const [id, v] of staged.workAssets) apply(this.workAssets, id, v);
    for (const [id, v] of staged.evidence) apply(this.evidence, id, v);
    for (const [id, v] of staged.claims) apply(this.claims, id, v);
    for (const [id, v] of staged.links) apply(this.links, id, v);
    for (const [id, v] of staged.conflicts) apply(this.conflicts, id, v);
    for (const [id, v] of staged.questions) apply(this.questions, id, v);
    for (const [id, v] of staged.hypotheses) apply(this.hypotheses, id, v);
    for (const [id, v] of staged.designSpecs) apply(this.designSpecs, id, v);
    for (const [id, v] of staged.methodDecisions) apply(this.methodDecisions, id, v);
    for (const [id, v] of staged.risks) apply(this.risks, id, v);
    for (const [id, v] of staged.milestones) apply(this.milestones, id, v);
    for (const [id, v] of staged.tasks) apply(this.tasks, id, v);
    for (const [id, v] of staged.outputs) apply(this.outputs, id, v);
    for (const [id, v] of staged.outputSections) apply(this.outputSections, id, v);
    for (const [id, v] of staged.outputStatements) apply(this.outputStatements, id, v);
    for (const [id, v] of staged.statementSupports) apply(this.statementSupports, id, v);
    for (const [id, v] of staged.statementCitations) apply(this.statementCitations, id, v);
    for (const [id, v] of staged.aiThreads) {
      apply(this.aiThreads, id, v);
      // Deleting a thread removes its messages and decisions with it.
      if (v === null) {
        for (const [mid, m] of this.aiMessages) if (m.threadId === id) this.aiMessages.delete(mid);
        for (const [did, d] of this.aiDraftDecisions) if (d.threadId === id) this.aiDraftDecisions.delete(did);
      }
    }
    for (const [id, v] of staged.aiMessages) this.aiMessages.set(id, v);
    for (const [id, v] of staged.aiDraftDecisions) this.aiDraftDecisions.set(id, v);
    this.notify();
    return result;
  }

  subscribe(listener: ResearchQueryListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap: ResearchSnapshot = {
      projects: Array.from(this.projects.values()),
      querySpecs: Array.from(this.querySpecs.values()),
      runs: Array.from(this.runs.values()),
      candidates: Array.from(this.candidates.values()),
      works: Array.from(this.works.values()),
      workAssets: Array.from(this.workAssets.values()),
      evidence: Array.from(this.evidence.values()),
      claims: Array.from(this.claims.values()),
      links: Array.from(this.links.values()),
      conflicts: Array.from(this.conflicts.values()),
      questions: Array.from(this.questions.values()),
      hypotheses: Array.from(this.hypotheses.values()),
      designSpecs: Array.from(this.designSpecs.values()),
      methodDecisions: Array.from(this.methodDecisions.values()),
      risks: Array.from(this.risks.values()),
      milestones: Array.from(this.milestones.values()),
      tasks: Array.from(this.tasks.values()),
      outputs: Array.from(this.outputs.values()),
      outputSections: Array.from(this.outputSections.values()),
      outputStatements: Array.from(this.outputStatements.values()),
      statementSupports: Array.from(this.statementSupports.values()),
      statementCitations: Array.from(this.statementCitations.values()),
      aiThreads: Array.from(this.aiThreads.values()),
      aiMessages: Array.from(this.aiMessages.values()),
      aiDraftDecisions: Array.from(this.aiDraftDecisions.values()),
    };
    for (const l of this.listeners) l(snap);
  }
}

function apply<T>(map: Map<string, T>, id: string, value: T | null): void {
  if (value === null) map.delete(id);
  else map.set(id, value);
}

function assertResearchProjectInvariants(p: ResearchProject): void {
  if (!p.id) throw new Error('ResearchProject must have an id.');
  if (p.container.mode !== 'research' || p.container.kind !== 'project') {
    throw new Error('ResearchProject container must be a research project.');
  }
}
