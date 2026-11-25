/**
 * StudyKit v0.4 — `platforms/web/dexieResearchRepository`
 *
 * The Dexie / IndexedDB-backed implementation of the
 * `ResearchRepository` contract. This is the production
 * adapter the Research use cases talk to; the in-memory
 * `MemoryResearchRepository` is for tests.
 *
 * Schema strategy
 * ---------------
 *
 *   - One new Dexie table per Research object:
 *     `researchProjects`, `researchQuerySpecs`,
 *     `researchRuns`, `researchCandidates`,
 *     `researchWorks`, `researchWorkAssets`,
 *     `researchEvidence`, `researchClaims`,
 *     `researchLinks`, `researchConflicts`.
 *   - Additive Dexie migration `v5` — older databases
 *     (v1–v4) open unchanged. The migration declares
 *     the ten new tables; it never touches existing
 *     tables. WP-05 Gate "若需要 Dexie schema/migration，
 *     必须可回滚、幂等、有 fixture/round-trip tests".
 *   - The `v04Research` flag is the runtime gate: when
 *     off, the production composition does not mount a
 *     `<ResearchProvider>`, the repository is never
 *     constructed, and no read / write happens. A
 *     flag-off build behaves exactly like a fresh v4
 *     database from the v0.3 product's point of view.
 *
 * Subscriptions
 * -------------
 *
 *   Dexie has no `subscribe` primitive. We attach to the
 *   table's `creating` / `updating` / `deleting` hooks so
 *   any `put` / `delete` on the ten tables fires a
 *   `notify()` that the `ResearchRepository.subscribe`
 *   consumer listens to. The in-memory adapter uses its
 *   own implementation; both call the same `notify()`
 *   shape so callers don't care.
 *
 * UI guard
 * --------
 *
 *   `application/research/researchUseCases` is the only
 *   consumer; it imports this file through the
 *   `ResearchRepository` interface and never imports
 *   `lib/db` directly.
 */

import type { Table } from 'dexie';
import { db } from '../../lib/db';
import type {
  Claim,
  ClaimEvidenceLink,
  Evidence,
  QuerySpec,
  ResearchProject,
  SearchCandidate,
  SearchRun,
  Work,
  WorkAsset,
  WorkConflict,
} from '../../domain/research';
import type {
  DesignSpec,
  Hypothesis,
  MethodDecision,
  Milestone,
  ResearchQuestion,
  ResearchRisk,
  ResearchTask,
} from '../../domain/researchDesign';
import { defaultTaskOrigin, normalizeTaskOrigin } from '../../domain/researchDesign';
import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../../domain/output';
import { stableSectionOrder, stableStatementOrder, supportDedupKey } from '../../domain/output';
import type { StatementCitation } from '../../domain/citation';
import { citationDedupKey } from '../../domain/citation';
import type {
  ResearchRepository,
  ResearchRepositoryTransaction,
  ResearchSnapshot,
} from '../../application/research/researchRepository';
import {
  assertEvidenceInvariants,
  assertOutputInvariants,
  assertOutputSectionInvariants,
  assertOutputStatementInvariants,
  assertStatementCitationInvariants,
  assertStatementSupportInvariants,
  assertTaskInvariants,
} from '../../application/research/researchRepository';

// ---------------------------------------------------------------------------
// Dexie adapter shape. Dexie's real `Table` exposes a
// superset of these methods, so we narrow the surface to
// the minimum this file uses.
// ---------------------------------------------------------------------------

interface ResearchDexieTable<T> {
  toArray(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
  delete(id: string): Promise<void>;
  where(field: string): {
    equals(value: unknown): { toArray(): Promise<T[]>; first(): Promise<T | undefined> };
  };
  hook(hooks: {
    creating?: (key: string, obj: T) => void;
    updating?: (modifications: Partial<T>, key: string, obj: T) => void;
    deleting?: (key: string) => void;
  }): void;
  clear(): Promise<void>;
}

function readResearchTables(): ResearchTables {
  const extended = db as unknown as {
    researchProjects: Table<ResearchProject, string>;
    researchQuerySpecs: Table<QuerySpec, string>;
    researchRuns: Table<SearchRun, string>;
    researchCandidates: Table<SearchCandidate, string>;
    researchWorks: Table<Work, string>;
    researchWorkAssets: Table<WorkAsset, string>;
    researchEvidence: Table<Evidence, string>;
    researchClaims: Table<Claim, string>;
    researchLinks: Table<ClaimEvidenceLink, string>;
    researchConflicts: Table<WorkConflict, string>;
    researchQuestions: Table<ResearchQuestion, string>;
    researchHypotheses: Table<Hypothesis, string>;
    researchDesignSpecs: Table<DesignSpec, string>;
    researchMethodDecisions: Table<MethodDecision, string>;
    researchRisks: Table<ResearchRisk, string>;
    researchMilestones: Table<Milestone, string>;
    researchTasks: Table<ResearchTask, string>;
    researchOutputs: Table<OutputDocument, string>;
    researchOutputSections: Table<OutputSection, string>;
    researchOutputStatements: Table<OutputStatement, string>;
    researchStatementSupports: Table<StatementSupport, string>;
    researchStatementCitations: Table<StatementCitation, string>;
  };
  return {
    projects: extended.researchProjects as unknown as ResearchDexieTable<ResearchProject>,
    querySpecs: extended.researchQuerySpecs as unknown as ResearchDexieTable<QuerySpec>,
    runs: extended.researchRuns as unknown as ResearchDexieTable<SearchRun>,
    candidates: extended.researchCandidates as unknown as ResearchDexieTable<SearchCandidate>,
    works: extended.researchWorks as unknown as ResearchDexieTable<Work>,
    workAssets: extended.researchWorkAssets as unknown as ResearchDexieTable<WorkAsset>,
    evidence: extended.researchEvidence as unknown as ResearchDexieTable<Evidence>,
    claims: extended.researchClaims as unknown as ResearchDexieTable<Claim>,
    links: extended.researchLinks as unknown as ResearchDexieTable<ClaimEvidenceLink>,
    conflicts: extended.researchConflicts as unknown as ResearchDexieTable<WorkConflict>,
    questions: extended.researchQuestions as unknown as ResearchDexieTable<ResearchQuestion>,
    hypotheses: extended.researchHypotheses as unknown as ResearchDexieTable<Hypothesis>,
    designSpecs: extended.researchDesignSpecs as unknown as ResearchDexieTable<DesignSpec>,
    methodDecisions: extended.researchMethodDecisions as unknown as ResearchDexieTable<MethodDecision>,
    risks: extended.researchRisks as unknown as ResearchDexieTable<ResearchRisk>,
    milestones: extended.researchMilestones as unknown as ResearchDexieTable<Milestone>,
    tasks: extended.researchTasks as unknown as ResearchDexieTable<ResearchTask>,
    outputs: extended.researchOutputs as unknown as ResearchDexieTable<OutputDocument>,
    outputSections: extended.researchOutputSections as unknown as ResearchDexieTable<OutputSection>,
    outputStatements: extended.researchOutputStatements as unknown as ResearchDexieTable<OutputStatement>,
    statementSupports: extended.researchStatementSupports as unknown as ResearchDexieTable<StatementSupport>,
    statementCitations: extended.researchStatementCitations as unknown as ResearchDexieTable<StatementCitation>,
  };
}

interface ResearchTables {
  projects: ResearchDexieTable<ResearchProject>;
  querySpecs: ResearchDexieTable<QuerySpec>;
  runs: ResearchDexieTable<SearchRun>;
  candidates: ResearchDexieTable<SearchCandidate>;
  works: ResearchDexieTable<Work>;
  workAssets: ResearchDexieTable<WorkAsset>;
  evidence: ResearchDexieTable<Evidence>;
  claims: ResearchDexieTable<Claim>;
  links: ResearchDexieTable<ClaimEvidenceLink>;
  conflicts: ResearchDexieTable<WorkConflict>;
  questions: ResearchDexieTable<ResearchQuestion>;
  hypotheses: ResearchDexieTable<Hypothesis>;
  designSpecs: ResearchDexieTable<DesignSpec>;
  methodDecisions: ResearchDexieTable<MethodDecision>;
  risks: ResearchDexieTable<ResearchRisk>;
  milestones: ResearchDexieTable<Milestone>;
  tasks: ResearchDexieTable<ResearchTask>;
  outputs: ResearchDexieTable<OutputDocument>;
  outputSections: ResearchDexieTable<OutputSection>;
  outputStatements: ResearchDexieTable<OutputStatement>;
  statementSupports: ResearchDexieTable<StatementSupport>;
  statementCitations: ResearchDexieTable<StatementCitation>;
}

class ResearchDexieDB {
  private readonly listeners = new Set<(s: ResearchSnapshot) => void>();
  private notifyScheduled: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly tables: ResearchTables) {
    const fire = (): void => this.scheduleNotify();
    const tArr: ResearchDexieTable<unknown>[] = [
      tables.projects,
      tables.querySpecs,
      tables.runs,
      tables.candidates,
      tables.works,
      tables.workAssets,
      tables.evidence,
      tables.claims,
      tables.links,
      tables.conflicts,
      tables.questions,
      tables.hypotheses,
      tables.designSpecs,
      tables.methodDecisions,
      tables.risks,
      tables.milestones,
      tables.tasks,
      tables.outputs,
      tables.outputSections,
      tables.outputStatements,
      tables.statementSupports,
      tables.statementCitations,
    ];
    for (const t of tArr) {
      t.hook({
        creating: fire,
        updating: fire,
        deleting: fire,
      });
    }
  }

  subscribe(listener: (s: ResearchSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = setTimeout(() => {
      this.notifyScheduled = null;
      void this.emit();
    }, 0);
  }

  private async emit(): Promise<void> {
    const t = this.tables;
    const [
      projects,
      querySpecs,
      runs,
      candidates,
      works,
      workAssets,
      evidence,
      claims,
      links,
      conflicts,
      questions,
      hypotheses,
      designSpecs,
      methodDecisions,
      risks,
      milestones,
      tasks,
      outputs,
      outputSections,
      outputStatements,
      statementSupports,
      statementCitations,
    ] = await Promise.all([
      t.projects.toArray(),
      t.querySpecs.toArray(),
      t.runs.toArray(),
      t.candidates.toArray(),
      t.works.toArray(),
      t.workAssets.toArray(),
      t.evidence.toArray(),
      t.claims.toArray(),
      t.links.toArray(),
      t.conflicts.toArray(),
      t.questions.toArray(),
      t.hypotheses.toArray(),
      t.designSpecs.toArray(),
      t.methodDecisions.toArray(),
      t.risks.toArray(),
      t.milestones.toArray(),
      t.tasks.toArray(),
      t.outputs.toArray(),
      t.outputSections.toArray(),
      t.outputStatements.toArray(),
      t.statementSupports.toArray(),
      t.statementCitations.toArray(),
    ]);
    const snap: ResearchSnapshot = {
      projects,
      querySpecs,
      runs,
      candidates,
      works,
      workAssets,
      evidence,
      claims,
      links,
      conflicts,
      questions,
      hypotheses,
      designSpecs,
      methodDecisions,
      risks,
      milestones,
      tasks,
      outputs,
      outputSections,
      outputStatements,
      statementSupports,
      statementCitations,
    };
    for (const l of this.listeners) l(snap);
  }
}

// ---------------------------------------------------------------------------
// Lazy init.
// ---------------------------------------------------------------------------

let cached: ResearchDexieDB | null = null;

export function getResearchDb(): ResearchDexieDB {
  if (cached) return cached;
  cached = new ResearchDexieDB(readResearchTables());
  return cached;
}

/** Test-only reset. */
export function __resetResearchDbForTests(): void {
  cached = null;
}

export type { ResearchDexieDB };

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Build a `ResearchRepository` backed by the singleton
 * Research Dexie DB. The factory exists so tests can
 * inject a fake without touching Dexie; the real
 * production call is `createDexieResearchRepository()`.
 */
export function createDexieResearchRepository(): ResearchRepository {
  return new DexieResearchRepository();
}

class DexieResearchRepository implements ResearchRepository {
  async getProject(id: string): Promise<ResearchProject | null> {
    return (await readResearchTables().projects.get(id)) ?? null;
  }

  async listProjects(query: { kind?: ResearchProject['kind'] } = {}): Promise<ResearchProject[]> {
    const all = await readResearchTables().projects.toArray();
    let filtered = all;
    if (query.kind) filtered = filtered.filter((p) => p.kind === query.kind);
    filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return filtered;
  }

  async getQuerySpec(id: string): Promise<QuerySpec | null> {
    return (await readResearchTables().querySpecs.get(id)) ?? null;
  }

  async listQuerySpecsForProject(projectId: string): Promise<QuerySpec[]> {
    const all = await readResearchTables().querySpecs.toArray();
    return all
      .filter((q) => q.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getRun(id: string): Promise<SearchRun | null> {
    return (await readResearchTables().runs.get(id)) ?? null;
  }

  async listRuns(query: { projectId: string; status?: SearchRun['status']; limit?: number }): Promise<SearchRun[]> {
    let all = (await readResearchTables().runs.toArray()).filter((r) => r.projectId === query.projectId);
    if (query.status) all = all.filter((r) => r.status === query.status);
    all.sort((a, b) => b.runNumber - a.runNumber);
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listCandidates(query: { runId?: string; projectId?: string; verdict?: SearchCandidate['verdict'] }): Promise<SearchCandidate[]> {
    let all = await readResearchTables().candidates.toArray();
    if (query.runId) all = all.filter((c) => c.runId === query.runId);
    if (query.projectId) all = all.filter((c) => c.projectId === query.projectId);
    if (query.verdict) all = all.filter((c) => c.verdict === query.verdict);
    all.sort((a, b) => a.providerRank - b.providerRank);
    return all;
  }

  async getCandidate(id: string): Promise<SearchCandidate | null> {
    return (await readResearchTables().candidates.get(id)) ?? null;
  }

  async getWork(id: string): Promise<Work | null> {
    return (await readResearchTables().works.get(id)) ?? null;
  }

  async listWorks(query: {
    projectId?: string;
    doi?: string;
    pmid?: string;
    arxiv?: string;
    openAlex?: string;
    semanticScholar?: string;
    zotero?: string;
    text?: string;
    readingStatus?: Work['readingStatus'];
    assetRef?: string;
    limit?: number;
  } = {}): Promise<Work[]> {
    let all = await readResearchTables().works.toArray();
    if (query.projectId) all = all.filter((w) => w.projectIds.includes(query.projectId as string));
    if (query.doi) all = all.filter((w) => w.identifiers.doi === query.doi);
    if (query.pmid) all = all.filter((w) => w.identifiers.pmid === query.pmid);
    if (query.arxiv) all = all.filter((w) => w.identifiers.arxiv === query.arxiv);
    if (query.openAlex) all = all.filter((w) => w.identifiers.openAlex === query.openAlex);
    if (query.semanticScholar) all = all.filter((w) => w.identifiers.semanticScholar === query.semanticScholar);
    if (query.zotero) all = all.filter((w) => w.identifiers.zotero === query.zotero);
    if (query.readingStatus) all = all.filter((w) => w.readingStatus === query.readingStatus);
    if (query.text) {
      const needle = query.text.toLowerCase();
      all = all.filter((w) => w.title.toLowerCase().includes(needle));
    }
    if (query.assetRef) {
      const ref = query.assetRef;
      const assets = await readResearchTables().workAssets.toArray();
      const matchingWorkIds = new Set(assets.filter((a) => a.ref === ref).map((a) => a.workId));
      all = all.filter((w) => matchingWorkIds.has(w.id));
    }
    all.sort((a, b) => a.title.localeCompare(b.title));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listWorkAssetsForWork(workId: string): Promise<WorkAsset[]> {
    const all = await readResearchTables().workAssets.toArray();
    return all
      .filter((a) => a.workId === workId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findWorkByAssetRef(ref: string): Promise<Work | null> {
    const all = await readResearchTables().workAssets.toArray();
    const hit = all.find((a) => a.ref === ref);
    if (!hit) return null;
    return (await readResearchTables().works.get(hit.workId)) ?? null;
  }

  async listEvidence(query: {
    projectId: string;
    workId?: string;
    status?: Evidence['status'];
    evidenceType?: Evidence['evidenceType'];
    limit?: number;
  }): Promise<Evidence[]> {
    let all = (await readResearchTables().evidence.toArray()).filter(
      (e) => e.projectId === query.projectId,
    );
    if (query.workId) all = all.filter((e) => e.workId === query.workId);
    if (query.status) all = all.filter((e) => e.status === query.status);
    if (query.evidenceType) all = all.filter((e) => e.evidenceType === query.evidenceType);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getEvidence(id: string): Promise<Evidence | null> {
    return (await readResearchTables().evidence.get(id)) ?? null;
  }

  async listClaims(query: { projectId: string; status?: Claim['status']; limit?: number }): Promise<Claim[]> {
    let all = (await readResearchTables().claims.toArray()).filter((c) => c.projectId === query.projectId);
    if (query.status) all = all.filter((c) => c.status === query.status);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getClaim(id: string): Promise<Claim | null> {
    return (await readResearchTables().claims.get(id)) ?? null;
  }

  async listLinks(query: {
    projectId: string;
    claimId?: string;
    evidenceId?: string;
  }): Promise<ClaimEvidenceLink[]> {
    let all = (await readResearchTables().links.toArray()).filter(
      (l) => l.projectId === query.projectId,
    );
    if (query.claimId) all = all.filter((l) => l.claimId === query.claimId);
    if (query.evidenceId) all = all.filter((l) => l.evidenceId === query.evidenceId);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all;
  }

  async listConflicts(query: { projectId: string }): Promise<WorkConflict[]> {
    const all = await readResearchTables().conflicts.toArray();
    return all
      .filter((c) => c.projectId === query.projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getConflict(id: string): Promise<WorkConflict | null> {
    return (await readResearchTables().conflicts.get(id)) ?? null;
  }

  // --- WP-07 reads

  async listQuestions(query: { projectId: string; status?: ResearchQuestion['status']; limit?: number }): Promise<ResearchQuestion[]> {
    let all = (await readResearchTables().questions.toArray()).filter(
      (q) => q.projectId === query.projectId,
    );
    if (query.status) all = all.filter((q) => q.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getQuestion(id: string): Promise<ResearchQuestion | null> {
    return (await readResearchTables().questions.get(id)) ?? null;
  }

  async listHypotheses(query: { projectId: string; questionId?: string; limit?: number }): Promise<Hypothesis[]> {
    let all = (await readResearchTables().hypotheses.toArray()).filter(
      (h) => h.projectId === query.projectId,
    );
    if (query.questionId !== undefined) {
      all = all.filter((h) => h.questionId === query.questionId);
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listDesignSpecs(query: { projectId: string; questionId?: string; limit?: number }): Promise<DesignSpec[]> {
    let all = (await readResearchTables().designSpecs.toArray()).filter(
      (s) => s.projectId === query.projectId,
    );
    if (query.questionId !== undefined) {
      all = all.filter((s) => s.questionId === query.questionId);
    }
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getDesignSpec(id: string): Promise<DesignSpec | null> {
    return (await readResearchTables().designSpecs.get(id)) ?? null;
  }

  async listMethodDecisions(query: {
    projectId: string;
    specId?: string;
    sectionKind?: MethodDecision['sectionKind'];
    chainId?: string;
    limit?: number;
  }): Promise<MethodDecision[]> {
    let all = (await readResearchTables().methodDecisions.toArray()).filter(
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
    return (await readResearchTables().methodDecisions.get(id)) ?? null;
  }

  async listRisks(query: { projectId: string; kind?: ResearchRisk['kind']; status?: ResearchRisk['status']; limit?: number }): Promise<ResearchRisk[]> {
    let all = (await readResearchTables().risks.toArray()).filter((r) => r.projectId === query.projectId);
    if (query.kind) all = all.filter((r) => r.kind === query.kind);
    if (query.status) all = all.filter((r) => r.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listMilestones(query: { projectId: string; status?: Milestone['status']; limit?: number }): Promise<Milestone[]> {
    let all = (await readResearchTables().milestones.toArray()).filter(
      (m) => m.projectId === query.projectId,
    );
    if (query.status) all = all.filter((m) => m.status === query.status);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listTasks(query: { projectId: string; status?: ResearchTask['status']; milestoneId?: string; limit?: number }): Promise<ResearchTask[]> {
    let all = (await readResearchTables().tasks.toArray()).filter((t) => t.projectId === query.projectId);
    if (query.status) all = all.filter((t) => t.status === query.status);
    if (query.milestoneId !== undefined) {
      all = all.filter((t) => t.milestoneId === query.milestoneId);
    }
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    // The read path normalizes the `origin` field at
    // the boundary: legacy rows (no `origin`) get a
    // typed value derived from `authorType`; malformed
    // rows throw. The `isResearchTask` type guard stays
    // strict because the helper has already filled in
    // the missing field.
    return all.map((t) => {
      const raw = t as unknown as { origin?: unknown };
      const origin = normalizeTaskOrigin(raw.origin, t.authorType);
      return { ...t, origin };
    });
  }

  async getTask(id: string): Promise<ResearchTask | null> {
    const t = (await readResearchTables().tasks.get(id)) ?? null;
    if (!t) return null;
    const raw = t as unknown as { origin?: unknown };
    const origin = normalizeTaskOrigin(raw.origin, t.authorType);
    return { ...t, origin };
  }

  // --- WP-10 Round 1: Output reads

  async getOutput(id: string): Promise<OutputDocument | null> {
    return (await readResearchTables().outputs.get(id)) ?? null;
  }

  async listOutputs(
    query: { projectId?: string; status?: OutputDocument['status']; limit?: number } = {},
  ): Promise<OutputDocument[]> {
    let all = await readResearchTables().outputs.toArray();
    if (query.projectId) all = all.filter((o) => o.projectId === query.projectId);
    if (query.status) all = all.filter((o) => o.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getOutputSection(id: string): Promise<OutputSection | null> {
    return (await readResearchTables().outputSections.get(id)) ?? null;
  }

  async listOutputSections(query: { outputId: string }): Promise<OutputSection[]> {
    const all = await readResearchTables().outputSections.toArray();
    return stableSectionOrder(all.filter((s) => s.outputId === query.outputId));
  }

  async getOutputStatement(id: string): Promise<OutputStatement | null> {
    return (await readResearchTables().outputStatements.get(id)) ?? null;
  }

  async listOutputStatements(query: {
    outputId?: string;
    sectionId?: string;
    projectId?: string;
  }): Promise<OutputStatement[]> {
    let all = await readResearchTables().outputStatements.toArray();
    if (query.outputId) all = all.filter((s) => s.outputId === query.outputId);
    if (query.sectionId) all = all.filter((s) => s.sectionId === query.sectionId);
    if (query.projectId) all = all.filter((s) => s.projectId === query.projectId);
    return stableStatementOrder(all);
  }

  async listStatementSupports(query: {
    statementId?: string;
    outputId?: string;
    projectId?: string;
  }): Promise<StatementSupport[]> {
    let all = await readResearchTables().statementSupports.toArray();
    if (query.statementId) {
      all = all.filter((s) => s.statementId === query.statementId);
    }
    if (query.outputId) all = all.filter((s) => s.outputId === query.outputId);
    if (query.projectId) all = all.filter((s) => s.projectId === query.projectId);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all;
  }

  async getStatementCitation(id: string): Promise<StatementCitation | null> {
    return (await readResearchTables().statementCitations.get(id)) ?? null;
  }

  async listStatementCitations(query: {
    statementId?: string;
    outputId?: string;
    projectId?: string;
    workId?: string;
  }): Promise<StatementCitation[]> {
    let all = await readResearchTables().statementCitations.toArray();
    if (query.statementId) all = all.filter((c) => c.statementId === query.statementId);
    if (query.outputId) all = all.filter((c) => c.outputId === query.outputId);
    if (query.projectId) all = all.filter((c) => c.projectId === query.projectId);
    if (query.workId) all = all.filter((c) => c.workId === query.workId);
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async transact<T>(fn: (tx: ResearchRepositoryTransaction) => T | Promise<T>): Promise<T> {
    const tables = readResearchTables();
    return db.transaction(
      'rw',
      [
        tables.projects as unknown as Table<unknown, string>,
        tables.querySpecs as unknown as Table<unknown, string>,
        tables.runs as unknown as Table<unknown, string>,
        tables.candidates as unknown as Table<unknown, string>,
        tables.works as unknown as Table<unknown, string>,
        tables.workAssets as unknown as Table<unknown, string>,
        tables.evidence as unknown as Table<unknown, string>,
        tables.claims as unknown as Table<unknown, string>,
        tables.links as unknown as Table<unknown, string>,
        tables.conflicts as unknown as Table<unknown, string>,
        tables.questions as unknown as Table<unknown, string>,
        tables.hypotheses as unknown as Table<unknown, string>,
        tables.designSpecs as unknown as Table<unknown, string>,
        tables.methodDecisions as unknown as Table<unknown, string>,
        tables.risks as unknown as Table<unknown, string>,
        tables.milestones as unknown as Table<unknown, string>,
        tables.tasks as unknown as Table<unknown, string>,
        tables.outputs as unknown as Table<unknown, string>,
        tables.outputSections as unknown as Table<unknown, string>,
        tables.outputStatements as unknown as Table<unknown, string>,
        tables.statementSupports as unknown as Table<unknown, string>,
        tables.statementCitations as unknown as Table<unknown, string>,
      ],
      async () => {
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
        };
        const tx: ResearchRepositoryTransaction = {
          putProject: (p) => {
            if (p.container.mode !== 'research' || p.container.kind !== 'project') {
              throw new Error('ResearchProject container must be a research project.');
            }
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
          // WP-07 writes mirror the in-memory adapter.
          putQuestion: (q) => {
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
          // WP-10 Round 1: Output writes. Same pattern as
          // the in-memory adapter: every write goes
          // through its domain invariant guard plus a
          // duplicate-support check.
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
            // Duplicate detection: scan the staged batch
            // to refuse a same-batch collision. Dexie's
            // transactional context guarantees a
            // cross-batch collision is impossible — the
            // previous transaction either committed (and
            // the live row is visible to subsequent
            // reads) or rolled back.
            const key = supportDedupKey(s);
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
            for (const [id, item] of staged.statementCitations) {
              if (id !== c.id && item && citationDedupKey(item) === key) {
                throw new Error(`StatementCitation duplicate: ${key}.`);
              }
            }
            staged.statementCitations.set(c.id, c);
          },
          deleteStatementCitation: (id) => staged.statementCitations.set(id, null),
        };
        const result = await fn(tx);
        const persistedSupports = await tables.statementSupports.toArray();
        for (const [id, support] of staged.statementSupports) {
          if (
            support &&
            persistedSupports.some(
              (persisted) =>
                persisted.id !== id &&
                supportDedupKey(persisted) === supportDedupKey(support),
            )
          ) {
            throw new Error(
              `StatementSupport duplicate: ${supportDedupKey(support)} already exists for this statement.`,
            );
          }
        }
        const persistedCitations = await tables.statementCitations.toArray();
        for (const [id, citation] of staged.statementCitations) {
          if (
            citation &&
            persistedCitations.some(
              (persisted) =>
                persisted.id !== id &&
                citationDedupKey(persisted) === citationDedupKey(citation),
            )
          ) {
            throw new Error(`StatementCitation duplicate: ${citationDedupKey(citation)}.`);
          }
        }
        await Promise.all([
          ...Array.from(staged.projects).map(([id, v]) =>
            v === null ? tables.projects.delete(id) : tables.projects.put(v),
          ),
          ...Array.from(staged.querySpecs).map(([id, v]) =>
            v === null ? tables.querySpecs.delete(id) : tables.querySpecs.put(v),
          ),
          ...Array.from(staged.runs).map(([id, v]) =>
            v === null ? tables.runs.delete(id) : tables.runs.put(v),
          ),
          ...Array.from(staged.candidates).map(([id, v]) =>
            v === null ? tables.candidates.delete(id) : tables.candidates.put(v),
          ),
          ...Array.from(staged.works).map(([id, v]) =>
            v === null ? tables.works.delete(id) : tables.works.put(v),
          ),
          ...Array.from(staged.workAssets).map(([id, v]) =>
            v === null ? tables.workAssets.delete(id) : tables.workAssets.put(v),
          ),
          ...Array.from(staged.evidence).map(([id, v]) =>
            v === null ? tables.evidence.delete(id) : tables.evidence.put(v),
          ),
          ...Array.from(staged.claims).map(([id, v]) =>
            v === null ? tables.claims.delete(id) : tables.claims.put(v),
          ),
          ...Array.from(staged.links).map(([id, v]) =>
            v === null ? tables.links.delete(id) : tables.links.put(v),
          ),
          ...Array.from(staged.conflicts).map(([id, v]) =>
            v === null ? tables.conflicts.delete(id) : tables.conflicts.put(v),
          ),
          ...Array.from(staged.questions).map(([id, v]) =>
            v === null ? tables.questions.delete(id) : tables.questions.put(v),
          ),
          ...Array.from(staged.hypotheses).map(([id, v]) =>
            v === null ? tables.hypotheses.delete(id) : tables.hypotheses.put(v),
          ),
          ...Array.from(staged.designSpecs).map(([id, v]) =>
            v === null ? tables.designSpecs.delete(id) : tables.designSpecs.put(v),
          ),
          ...Array.from(staged.methodDecisions).map(([id, v]) =>
            v === null ? tables.methodDecisions.delete(id) : tables.methodDecisions.put(v),
          ),
          ...Array.from(staged.risks).map(([id, v]) =>
            v === null ? tables.risks.delete(id) : tables.risks.put(v),
          ),
          ...Array.from(staged.milestones).map(([id, v]) =>
            v === null ? tables.milestones.delete(id) : tables.milestones.put(v),
          ),
          ...Array.from(staged.tasks).map(([id, v]) =>
            v === null ? tables.tasks.delete(id) : tables.tasks.put(v),
          ),
          ...Array.from(staged.outputs).map(([id, v]) =>
            v === null ? tables.outputs.delete(id) : tables.outputs.put(v),
          ),
          ...Array.from(staged.outputSections).map(([id, v]) =>
            v === null ? tables.outputSections.delete(id) : tables.outputSections.put(v),
          ),
          ...Array.from(staged.outputStatements).map(([id, v]) =>
            v === null ? tables.outputStatements.delete(id) : tables.outputStatements.put(v),
          ),
          ...Array.from(staged.statementSupports).map(([id, v]) =>
            v === null ? tables.statementSupports.delete(id) : tables.statementSupports.put(v),
          ),
          ...Array.from(staged.statementCitations).map(([id, v]) =>
            v === null ? tables.statementCitations.delete(id) : tables.statementCitations.put(v),
          ),
        ]);
        return result;
      },
    );
  }

  subscribe(listener: (s: ResearchSnapshot) => void): () => void {
    return getResearchDb().subscribe(listener);
  }
}
