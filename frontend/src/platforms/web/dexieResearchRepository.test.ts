/**
 * StudyKit v0.4 — `platforms/web/dexieResearchRepository` tests
 *
 * Round-trip tests that prove the Dexie adapter behaves
 * identically to the in-memory adapter. happy-dom does
 * not ship IndexedDB, so the test replaces the ten
 * research tables with in-memory fakes. The v5 Dexie
 * migration is part of `lib/db.ts`'s constructor; the
 * fake tables sit on top of the same `db` instance so
 * `createDexieResearchRepository()` reads them through
 * the public `db.researchProjects` shape.
 *
 * The tests cover:
 *   - round-trip of every record type
 *   - atomic transact (rollback on throw)
 *   - evidence invariant (verified requires
 *     locator + quote + interpretation)
 *   - re-running with the v3 / v4 schema (additive
 *     migration: existing tables unchanged, new tables
 *     open empty)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDexieResearchRepository,
  getResearchDb,
  __resetResearchDbForTests,
} from './dexieResearchRepository';
import { db as prodDb } from '../../lib/db';
import {
  makeProjectContainer,
  makeResearchProject,
  makeQuerySpec,
  makeSearchRun,
  makeSearchCandidate,
  makeWork,
  makeEvidence,
  makeClaim,
  makeClaimEvidenceLink,
  makeResearchLocator,
} from '../../domain/__fixtures__/domain-fixtures';

interface FakeTable<T extends { id: string }> {
  toArray(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
  delete(id: string): Promise<void>;
  // Dexie 4 event form: `table.hook('creating', fn)`.
  hook(event: 'creating' | 'updating' | 'deleting', subscriber: (...args: never[]) => void): void;
  clear(): Promise<void>;
  __txBegin(): void;
  __txCommit(): void;
  __txRollback(): void;
}

function makeFakeTable<T extends { id: string }>(): FakeTable<T> {
  const rows = new Map<string, T>();
  const hooks: { creating?: (key: string, obj: T) => void; deleting?: (key: string) => void } = {};
  let txSnapshot: Map<string, T> | null = null;
  const begin = (): void => {
    if (txSnapshot) return;
    txSnapshot = new Map(rows);
  };
  const commit = (): void => {
    txSnapshot = null;
  };
  const rollback = (): void => {
    if (!txSnapshot) return;
    rows.clear();
    for (const [k, v] of txSnapshot) rows.set(k, v);
    txSnapshot = null;
  };
  return {
    toArray: async () => Array.from(rows.values()),
    get: async (id) => rows.get(id),
    put: async (row) => {
      if (txSnapshot) begin();
      rows.set(row.id, row);
      hooks.creating?.(row.id, row);
    },
    delete: async (id) => {
      if (txSnapshot) begin();
      rows.delete(id);
      hooks.deleting?.(id);
    },
    hook: (event, subscriber) => {
      (hooks as Record<string, unknown>)[event] = subscriber;
    },
    clear: async () => rows.clear(),
    __txBegin: begin,
    __txCommit: commit,
    __txRollback: rollback,
  };
}

beforeEach(() => {
  const fProjects = makeFakeTable();
  const fQuerySpecs = makeFakeTable();
  const fRuns = makeFakeTable();
  const fCandidates = makeFakeTable();
  const fWorks = makeFakeTable();
  const fWorkAssets = makeFakeTable();
  const fEvidence = makeFakeTable();
  const fClaims = makeFakeTable();
  const fLinks = makeFakeTable();
  const fConflicts = makeFakeTable();
  // WP-07 tables: the Dexie adapter's `readResearchTables()`
  // reaches through `prodDb.<tableName>`, so the test has
  // to stub them on the same object or the adapter will
  // throw on every read.
  const fQuestions = makeFakeTable();
  const fHypotheses = makeFakeTable();
  const fDesignSpecs = makeFakeTable();
  const fMethodDecisions = makeFakeTable();
  const fRisks = makeFakeTable();
  const fMilestones = makeFakeTable();
  const fTasks = makeFakeTable();
  // WP-10 Round 1 tables (v10 schema). Same in-memory
  // stub pattern as the WP-05 / WP-07 tables above.
  const fOutputs = makeFakeTable();
  const fOutputSections = makeFakeTable();
  const fOutputStatements = makeFakeTable();
  const fStatementSupports = makeFakeTable();
  const fStatementCitations = makeFakeTable();
  (prodDb as unknown as { researchProjects: unknown }).researchProjects = fProjects;
  (prodDb as unknown as { researchQuerySpecs: unknown }).researchQuerySpecs = fQuerySpecs;
  (prodDb as unknown as { researchRuns: unknown }).researchRuns = fRuns;
  (prodDb as unknown as { researchCandidates: unknown }).researchCandidates = fCandidates;
  (prodDb as unknown as { researchWorks: unknown }).researchWorks = fWorks;
  (prodDb as unknown as { researchWorkAssets: unknown }).researchWorkAssets = fWorkAssets;
  (prodDb as unknown as { researchEvidence: unknown }).researchEvidence = fEvidence;
  (prodDb as unknown as { researchClaims: unknown }).researchClaims = fClaims;
  (prodDb as unknown as { researchLinks: unknown }).researchLinks = fLinks;
  (prodDb as unknown as { researchConflicts: unknown }).researchConflicts = fConflicts;
  (prodDb as unknown as { researchQuestions: unknown }).researchQuestions = fQuestions;
  (prodDb as unknown as { researchHypotheses: unknown }).researchHypotheses = fHypotheses;
  (prodDb as unknown as { researchDesignSpecs: unknown }).researchDesignSpecs = fDesignSpecs;
  (prodDb as unknown as { researchMethodDecisions: unknown }).researchMethodDecisions = fMethodDecisions;
  (prodDb as unknown as { researchRisks: unknown }).researchRisks = fRisks;
  (prodDb as unknown as { researchMilestones: unknown }).researchMilestones = fMilestones;
  (prodDb as unknown as { researchTasks: unknown }).researchTasks = fTasks;
  (prodDb as unknown as { researchOutputs: unknown }).researchOutputs = fOutputs;
  (prodDb as unknown as { researchOutputSections: unknown }).researchOutputSections = fOutputSections;
  (prodDb as unknown as { researchOutputStatements: unknown }).researchOutputStatements = fOutputStatements;
  (prodDb as unknown as { researchStatementSupports: unknown }).researchStatementSupports = fStatementSupports;
  (prodDb as unknown as { researchStatementCitations: unknown }).researchStatementCitations = fStatementCitations;
  const allTables: FakeTable<{ id: string }>[] = [
    fProjects,
    fQuerySpecs,
    fRuns,
    fCandidates,
    fWorks,
    fWorkAssets,
    fEvidence,
    fClaims,
    fLinks,
    fConflicts,
    fQuestions,
    fHypotheses,
    fDesignSpecs,
    fMethodDecisions,
    fRisks,
    fMilestones,
    fTasks,
    fOutputs,
    fOutputSections,
    fOutputStatements,
    fStatementSupports,
    fStatementCitations,
  ];
  (prodDb as unknown as { transaction: (...args: unknown[]) => Promise<unknown> }).transaction =
    (async (...args: unknown[]) => {
      for (const t of allTables) t.__txBegin();
      const last = args[args.length - 1];
      if (typeof last !== 'function') return undefined;
      try {
        const out = await (last as () => Promise<unknown> | unknown)();
        for (const t of allTables) t.__txCommit();
        return out;
      } catch (err) {
        for (const t of allTables) t.__txRollback();
        throw err;
      }
    }) as never;
  __resetResearchDbForTests();
});

afterEach(() => {
  __resetResearchDbForTests();
});

describe('platforms/web/dexieResearchRepository / round-trip', () => {
  it('round-trips a ResearchProject', async () => {
    const repo = createDexieResearchRepository();
    const p = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(p));
    expect((await repo.getProject('p-1'))?.id).toBe('p-1');
    expect((await repo.listProjects({})).map((x) => x.id)).toEqual(['p-1']);
  });

  it('round-trips QuerySpec, SearchRun, SearchCandidate', async () => {
    const repo = createDexieResearchRepository();
    const p = makeResearchProject({ id: 'p-1' });
    const q = makeQuerySpec({ id: 'qs-1', projectId: 'p-1' });
    const r = makeSearchRun({ id: 'r-1', projectId: 'p-1' });
    const c = makeSearchCandidate({ id: 'c-1', projectId: 'p-1', runId: 'r-1' });
    await repo.transact(async (tx) => {
      tx.putProject(p);
      tx.putQuerySpec(q);
      tx.putRun(r);
      tx.putCandidate(c);
    });
    expect((await repo.getQuerySpec('qs-1'))?.id).toBe('qs-1');
    expect((await repo.listRuns({ projectId: 'p-1' })).map((x) => x.id)).toEqual(['r-1']);
    expect((await repo.listCandidates({ runId: 'r-1' })).map((x) => x.id)).toEqual(['c-1']);
  });

  it('round-trips a Work + WorkAsset', async () => {
    const repo = createDexieResearchRepository();
    const w = makeWork({ id: 'w-1' });
    const a = {
      id: 'asset-1',
      workId: 'w-1',
      kind: 'local-pdf' as const,
      ref: '/tmp/foo.pdf',
      createdAt: '2026-07-21T12:00:00.000Z',
    };
    await repo.transact(async (tx) => {
      tx.putWork(w);
      tx.putWorkAsset(a);
    });
    expect((await repo.listWorkAssetsForWork('w-1')).map((x) => x.id)).toEqual(['asset-1']);
    expect((await repo.findWorkByAssetRef('/tmp/foo.pdf'))?.id).toBe('w-1');
  });

  it('round-trips Evidence (verified requires locator + quote + interpretation)', async () => {
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    const work = makeWork({ id: 'w-1' });
    const evidence = makeEvidence({
      id: 'e-1',
      projectId: 'p-1',
      workId: 'w-1',
      userInterpretation: 'A clear reading.',
      status: 'verified',
    });
    await repo.transact(async (tx) => {
      tx.putProject(project);
      tx.putWork(work);
      tx.putEvidence(evidence);
    });
    expect((await repo.listEvidence({ projectId: 'p-1' })).length).toBe(1);
  });

  it('refuses to persist a verified Evidence without a complete locator', async () => {
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    const work = makeWork({ id: 'w-1' });
    await repo.transact(async (tx) => {
      tx.putProject(project);
      tx.putWork(work);
    });
    const broken: Parameters<typeof repo.transact>[0] extends (tx: infer T) => unknown
      ? T extends { putEvidence: (e: infer E) => void }
        ? E
        : never
      : never = {
      id: 'e-broken',
      projectId: 'p-1',
      workId: 'w-1',
      locator: {
        kind: 'paper-page',
        workId: 'w-1',
        capturedAt: '2026-07-21T12:00:00.000Z',
        // no assetId, no pageNumber
      },
      exactQuote: 'A quote.',
      userInterpretation: 'A reading.',
      evidenceType: 'finding',
      status: 'verified',
      createdAt: '2026-07-21T12:00:00.000Z',
      updatedAt: '2026-07-21T12:00:00.000Z',
      authorType: 'user',
      assignee: null,
      publishedFromScratchId: null,
    } as never;
    await expect(repo.transact(async (tx) => tx.putEvidence(broken))).rejects.toThrow(
      /complete locator/,
    );
    // Nothing leaked.
    expect((await repo.listEvidence({ projectId: 'p-1' })).length).toBe(0);
  });

  it('round-trips Claim + ClaimEvidenceLink + WorkConflict', async () => {
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    const work = makeWork({ id: 'w-1' });
    const evidence = makeEvidence({
      id: 'e-1',
      projectId: 'p-1',
      workId: 'w-1',
      status: 'verified',
    });
    const claim = makeClaim({ id: 'c-1', projectId: 'p-1' });
    const link = makeClaimEvidenceLink({
      id: 'l-1',
      projectId: 'p-1',
      claimId: 'c-1',
      evidenceId: 'e-1',
    });
    const conflict = {
      id: 'wc-1',
      projectId: 'p-1',
      candidateWorkId: 'w-1',
      existingWorkId: 'w-2',
      fields: ['title'] as const,
      createdAt: '2026-07-21T12:00:00.000Z',
    };
    await repo.transact(async (tx) => {
      tx.putProject(project);
      tx.putWork(work);
      tx.putEvidence(evidence);
      tx.putClaim(claim);
      tx.putLink(link);
      tx.putConflict(conflict);
    });
    expect((await repo.listClaims({ projectId: 'p-1' })).map((c) => c.id)).toEqual(['c-1']);
    expect((await repo.listLinks({ projectId: 'p-1' })).map((l) => l.id)).toEqual(['l-1']);
    expect((await repo.listConflicts({ projectId: 'p-1' })).map((c) => c.id)).toEqual(['wc-1']);
  });

  it('atomic transact: a thrown callback does not leak any puts', async () => {
    const repo = createDexieResearchRepository();
    await expect(
      repo.transact(async (tx) => {
        tx.putProject(makeResearchProject({ id: 'p-1' }));
        tx.putWork(makeWork({ id: 'w-1' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Both rows were rolled back.
    expect((await repo.listProjects({})).length).toBe(0);
    expect((await repo.listWorks({})).length).toBe(0);
  });

  it('listWorks filters by projectId / doi / readingStatus / assetRef', async () => {
    const repo = createDexieResearchRepository();
    const w1 = makeWork({ id: 'w-1', projectIds: ['p-1'], readingStatus: 'unread' });
    const w2 = makeWork({
      id: 'w-2',
      identifiers: { doi: '10.1/x' },
      projectIds: ['p-1'],
      readingStatus: 'read',
    });
    await repo.transact(async (tx) => {
      tx.putWork(w1);
      tx.putWork(w2);
    });
    expect((await repo.listWorks({ projectId: 'p-1' })).length).toBe(2);
    expect((await repo.listWorks({ projectId: 'p-1', doi: '10.1/x' })).map((w) => w.id)).toEqual([
      'w-2',
    ]);
    expect((await repo.listWorks({ projectId: 'p-1', readingStatus: 'read' })).map((w) => w.id)).toEqual(
      ['w-2'],
    );
  });

  it('subscribe fires after a transact', async () => {
    const repo = createDexieResearchRepository();
    const listener = vi.fn();
    repo.subscribe(listener);
    await repo.transact(async (tx) => {
      tx.putProject(makeResearchProject({ id: 'p-1' }));
    });
    // Wait one tick for the scheduled notify.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(listener).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WP-07 round-trip tests. The Dexie adapter now persists
// 7 new tables (questions, hypotheses, designSpecs,
// methodDecisions, risks, milestones, tasks). The test
// exercises the additive migration: re-opening the
// `db` after writing the new tables must keep the v5
// (Research Evidence) tables intact and add the v7
// (Design + PM) tables. The Dexie v7 declaration lives
// in `lib/db.ts`; the fake-table harness sits on top of
// the same `db` instance so the adapter reads/writes
// through the real schema object.
// ---------------------------------------------------------------------------

describe('platforms/web/dexieResearchRepository / WP-07 round-trip', () => {
  it('round-trips a ResearchQuestion + Hypothesis + DesignSpec + MethodDecision chain', async () => {
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(project));
    const question = {
      id: 'q-1',
      projectId: project.id,
      question: 'How does sleep affect memory consolidation?',
      rationale: 'Pilot evidence',
      scope: 'university students',
      status: 'open' as const,
      supersededBy: null,
      lineageRunId: null,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const hypothesis = {
      id: 'h-1',
      projectId: project.id,
      questionId: 'q-1',
      kind: 'hypothesis' as const,
      text: 'Slow-wave sleep predicts recall',
      rationale: 'r',
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const spec = {
      id: 'ds-1',
      projectId: project.id,
      questionId: 'q-1',
      name: 'Pilot design',
      kind: 'empirical' as const,
      templateEnabled: true,
      sections: [
        { kind: 'rationale' as const, body: 'why', expanded: true },
      ],
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const v1 = {
      id: 'md-1',
      projectId: project.id,
      specId: 'ds-1',
      sectionKind: 'sample' as const,
      chainId: 'md-1',
      title: 'Sample size 30',
      choice: '30 participants',
      rationale: 'pilot budget',
      alternatives: [
        { id: 'a-1', label: 'Multi-site 60', body: 'Two sites', evidenceIds: [] as string[] },
      ],
      evidenceIds: [] as string[],
      impacts: ['power analysis'],
      supersedes: null,
      supersedesLineage: [] as string[],
      createdAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const v2 = {
      ...v1,
      id: 'md-2',
      chainId: 'md-1',
      title: 'Sample size 60',
      choice: '60 participants',
      supersedes: 'md-1',
      supersedesLineage: ['md-1'],
    };
    await repo.transact(async (tx) => {
      tx.putQuestion(question);
      tx.putHypothesis(hypothesis);
      tx.putDesignSpec(spec);
      tx.putMethodDecision(v1);
      tx.putMethodDecision(v2);
    });
    // Both rows survive. The previous row is
    // byte-for-byte unchanged (the use case never
    // re-writes the prior row). Head state is derived
    // from the supersedes link, not stored.
    const all = await repo.listMethodDecisions({ projectId: project.id });
    expect(all).toHaveLength(2);
    const byId = new Map(all.map((d) => [d.id, d]));
    expect(byId.get('md-1')?.supersedes).toBeNull();
    expect(byId.get('md-2')?.supersedes).toBe('md-1');
    expect(byId.get('md-2')?.supersedesLineage).toEqual(['md-1']);
    // The chain view computes isHead / isSuperseded.
    const { deriveMethodDecisionViews } = await import('../../domain/researchDesign');
    const views = deriveMethodDecisionViews(all);
    const v1View = views.find((v) => v.decision.id === 'md-1');
    const v2View = views.find((v) => v.decision.id === 'md-2');
    expect(v1View?.isHead).toBe(false);
    expect(v1View?.isSuperseded).toBe(true);
    expect(v2View?.isHead).toBe(true);
    expect(v2View?.isSuperseded).toBe(false);
  });

  it('round-trips a Risk + Milestone + Task with dependencies', async () => {
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(project));
    const risk = {
      id: 'rk-1',
      projectId: project.id,
      kind: 'risk' as const,
      title: 'Pilot dropout',
      body: '20% dropout expected',
      severity: 'medium' as const,
      mitigation: 'over-recruit by 5',
      status: 'open' as const,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const milestone = {
      id: 'ms-1',
      projectId: project.id,
      kind: 'pilot' as const,
      label: '',
      targetDate: null,
      completedAt: null,
      status: 'planned' as const,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const a = {
      id: 't-1',
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual' as const, id: null },
      sourceNote: '',
      origin: { kind: 'user' as const },
      milestoneId: 'ms-1',
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    const b = {
      ...a,
      id: 't-2',
      title: 'B',
      dependencies: ['t-1'],
    };
    await repo.transact(async (tx) => {
      tx.putRisk(risk);
      tx.putMilestone(milestone);
      tx.putTask(a);
      tx.putTask(b);
    });
    expect((await repo.listRisks({ projectId: project.id })).map((r) => r.id)).toEqual(['rk-1']);
    expect((await repo.listMilestones({ projectId: project.id })).map((m) => m.id)).toEqual(['ms-1']);
    const tasks = await repo.listTasks({ projectId: project.id });
    expect(tasks).toHaveLength(2);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get('t-1')?.dependencies).toEqual([]);
    expect(byId.get('t-2')?.dependencies).toEqual(['t-1']);
    expect(byId.get('t-2')?.milestoneId).toBe('ms-1');
  });

  it('WP-07 schema is additive: re-opening the db keeps v5 tables + adds v7 tables', async () => {
    // Simulate a v5 database (Research Evidence only)
    // by writing a row to one of the v5 tables, then
    // opening the v7 db and asserting both the v5 row
    // and a fresh v7 row are present. The Dexie v5 +
    // v6 + v7 declarations are additive, so the v5
    // table is preserved.
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(project));
    // A WP-05 Evidence round-trip through the v5
    // table still works (no schema change in v7).
    const evidence = makeEvidence({
      id: 'e-1',
      projectId: project.id,
      workId: 'w-1',
    });
    await repo.transact(async (tx) => tx.putEvidence(evidence));
    // A WP-07 Question round-trip is new in v7.
    const question = {
      id: 'q-1',
      projectId: project.id,
      question: 'RQ',
      rationale: '',
      scope: '',
      status: 'open' as const,
      supersededBy: null,
      lineageRunId: null,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    await repo.transact(async (tx) => tx.putQuestion(question));
    // Both rows survive the round-trip.
    expect((await repo.getProject('p-1'))?.id).toBe('p-1');
    expect((await repo.getEvidence('e-1'))?.id).toBe('e-1');
    expect((await repo.getQuestion('q-1'))?.id).toBe('q-1');
  });

  it('WP-07 Round 4 P0-4: listTasks / getTask normalize a legacy row that lacks `origin` (by authorType)', async () => {
    // Persist a row whose `origin` field is missing.
    // The repository's read path must default the
    // origin by `authorType` (Round 4 P0-4) — NOT
    // silently default everything to `{kind:'user'}`.
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(project));
    // Bypass the invariant by writing directly to
    // the fake table. This simulates a legacy Dexie
    // row written before the `origin` field was
    // additive.
    const prodDb = (await import('../../lib/db')).db;
    const tasks = (prodDb as unknown as { researchTasks: { put: (r: unknown) => Promise<unknown> } }).researchTasks;
    const userLegacy = {
      id: 't-legacy-user',
      projectId: project.id,
      title: 'legacy user',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      sourceNote: '',
      milestoneId: null,
      status: 'open',
      dependencies: [],
      blocker: null,
      completionRef: null,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user',
      assignee: null,
      publishedFromScratchId: null,
    };
    const importedLegacy = {
      ...userLegacy,
      id: 't-legacy-imported',
      authorType: 'imported',
    };
    await tasks.put(userLegacy);
    await tasks.put(importedLegacy);
    // Read via the repo. Both rows must come back
    // with a typed origin; the user row gets
    // `{kind:'user'}`, the imported row gets
    // `{kind:'imported'}`.
    const all = await repo.listTasks({ projectId: project.id });
    const byId = new Map(all.map((t) => [t.id, t]));
    expect(byId.get('t-legacy-user')?.origin).toEqual({ kind: 'user' });
    expect(byId.get('t-legacy-user')?.authorType).toBe('user');
    expect(byId.get('t-legacy-imported')?.origin).toEqual({ kind: 'imported' });
    expect(byId.get('t-legacy-imported')?.authorType).toBe('imported');
    // `getTask` returns the same normalised row.
    const one = await repo.getTask('t-legacy-imported');
    expect(one?.origin).toEqual({ kind: 'imported' });
  });

  it('WP-07 Round 4 P0-4: listTasks throws on a row whose `origin` is present but malformed', async () => {
    // A row whose `origin` is shaped wrong is a
    // contract violation, not a recoverable
    // default. The read path throws so the test
    // suite (and the production console) catches
    // the regression.
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(project));
    const prodDb = (await import('../../lib/db')).db;
    const tasks = (prodDb as unknown as { researchTasks: { put: (r: unknown) => Promise<unknown> } }).researchTasks;
    await tasks.put({
      id: 't-broken',
      projectId: project.id,
      title: 'broken',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      sourceNote: '',
      origin: { kind: 'ai-accepted', draftId: '', provider: 'ollama' }, // missing required fields
      milestoneId: null,
      status: 'open',
      dependencies: [],
      blocker: null,
      completionRef: null,
      createdAt: '2026-07-23T12:00:00.000Z',
      updatedAt: '2026-07-23T12:00:00.000Z',
      authorType: 'user',
      assignee: null,
      publishedFromScratchId: null,
    });
    await expect(repo.listTasks({ projectId: project.id })).rejects.toThrow(
      /ResearchTask\.origin is malformed/,
    );
  });

  it('WP-07 Round 3 P0-B: round-trips a Task with `origin: ai-accepted` and every typed field', async () => {
    // The `ai-accepted` shape carries the full Draft
    // Layer provenance: draftId + provider + model +
    // actionId + contextSnapshotHash + acceptedAt.
    // The Dexie adapter must persist every field
    // byte-for-byte (no JSON-in-sourceNote, no
    // dropped fields).
    const repo = createDexieResearchRepository();
    const project = makeResearchProject({ id: 'p-1' });
    await repo.transact(async (tx) => tx.putProject(project));
    const acceptedAt = '2026-07-23T20:00:00.000Z';
    const aiAcceptedTask = {
      id: 't-ai-1',
      projectId: project.id,
      title: 'Run a 2-night PSG pilot',
      why: 'A small pilot validates the sleep-staging pipeline.',
      definitionOfDone: '2 nights of PSG from 3 participants are staged.',
      sourceRef: { kind: 'question' as const, id: 'q-1' },
      sourceNote: '',
      origin: {
        kind: 'ai-accepted' as const,
        draftId: 'draft_abcdef123',
        provider: 'ollama',
        model: 'llama3.1:8b',
        actionId: 'research-suggest-design-tasks',
        contextSnapshotHash: 'hash-xyz-42',
        acceptedAt,
      },
      milestoneId: null,
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: '2026-07-23T20:00:00.000Z',
      updatedAt: '2026-07-23T20:00:00.000Z',
      authorType: 'user' as const,
      assignee: null,
      publishedFromScratchId: null,
    };
    await repo.transact(async (tx) => tx.putTask(aiAcceptedTask));
    // Read it back through the canonical getters and
    // assert every field — including the structured
    // `origin` payload — survives the round-trip.
    const byGet = await repo.getTask('t-ai-1');
    expect(byGet).toBeDefined();
    expect(byGet?.title).toBe('Run a 2-night PSG pilot');
    expect(byGet?.origin.kind).toBe('ai-accepted');
    if (byGet?.origin.kind === 'ai-accepted') {
      expect(byGet.origin.draftId).toBe('draft_abcdef123');
      expect(byGet.origin.provider).toBe('ollama');
      expect(byGet.origin.model).toBe('llama3.1:8b');
      expect(byGet.origin.actionId).toBe('research-suggest-design-tasks');
      expect(byGet.origin.contextSnapshotHash).toBe('hash-xyz-42');
      expect(byGet.origin.acceptedAt).toBe(acceptedAt);
    }
    // And through the list path.
    const listed = await repo.listTasks({ projectId: project.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.origin).toEqual(aiAcceptedTask.origin);
    // The `sourceRef` also round-trips — this is the
    // link back to the Question that drove the
    // suggestion, and the UI uses it to render the
    // "from question" pill.
    expect(listed[0]?.sourceRef).toEqual({ kind: 'question', id: 'q-1' });
  });
});

// Make `vi` available for the subscribe test.
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// WP-10 Round 1 — Output / Section / Statement / Support parity
// ---------------------------------------------------------------------------

import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../../domain/output';
import type { StatementCitation } from '../../domain/citation';

function makeOutputFixture(overrides: Partial<OutputDocument> = {}): OutputDocument {
  return {
    id: 'o-001',
    projectId: 'p-001',
    title: 'My Output',
    status: 'outline',
    authorType: 'user',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeSectionFixture(overrides: Partial<OutputSection> = {}): OutputSection {
  return {
    id: 'sec-001',
    projectId: 'p-001',
    outputId: 'o-001',
    title: 'Intro',
    order: 0,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeStatementFixture(overrides: Partial<OutputStatement> = {}): OutputStatement {
  return {
    id: 'st-001',
    projectId: 'p-001',
    outputId: 'o-001',
    sectionId: 'sec-001',
    body: 'Sleep loss reduces recall.',
    order: 0,
    authorType: 'user',
    status: 'draft',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeSupportFixture(overrides: Partial<StatementSupport> = {}): StatementSupport {
  return {
    id: 'sup-001',
    projectId: 'p-001',
    outputId: 'o-001',
    statementId: 'st-001',
    ref: { kind: 'evidence', id: 'e-001' },
    relation: 'supports',
    authorType: 'user',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeCitationFixture(overrides: Partial<StatementCitation> = {}): StatementCitation {
  return {
    id: 'cite-001', projectId: 'p-001', outputId: 'o-001', statementId: 'st-001',
    workId: 'work-001', citeKey: 'doe2025sleep-work001', authorType: 'user',
    createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('platforms/web/dexieResearchRepository / WP-10 Output parity', () => {
  it('round-trips StatementCitation and rejects a duplicate across transactions', async () => {
    const repo = createDexieResearchRepository();
    const citation = makeCitationFixture();
    await repo.transact((tx) => tx.putStatementCitation(citation));
    expect(await repo.getStatementCitation(citation.id)).toEqual(citation);
    await expect(repo.transact((tx) => tx.putStatementCitation(
      makeCitationFixture({ id: 'cite-duplicate' }),
    ))).rejects.toThrow(/duplicate/);
    expect(await repo.listStatementCitations({ outputId: 'o-001' })).toHaveLength(1);
  });

  it('round-trips OutputDocument through put + get + list', async () => {
    const repo = createDexieResearchRepository();
    const o = makeOutputFixture({ id: 'o-a' });
    await repo.transact(async (tx) => tx.putOutput(o));
    expect((await repo.getOutput('o-a'))?.title).toBe('My Output');
    expect((await repo.listOutputs({ projectId: 'p-001' })).map((x) => x.id)).toEqual(['o-a']);
  });

  it('round-trips OutputSection through put + listOutputSections (stable order)', async () => {
    const repo = createDexieResearchRepository();
    const a = makeSectionFixture({ id: 'sec-a', order: 0 });
    const b = makeSectionFixture({ id: 'sec-b', order: 1 });
    await repo.transact(async (tx) => {
      tx.putOutputSection(b);
      tx.putOutputSection(a);
    });
    const listed = await repo.listOutputSections({ outputId: 'o-001' });
    expect(listed.map((s) => s.id)).toEqual(['sec-a', 'sec-b']);
  });

  it('round-trips OutputStatement through put + list', async () => {
    const repo = createDexieResearchRepository();
    const s = makeStatementFixture({ id: 'st-a', body: 'x' });
    await repo.transact(async (tx) => tx.putOutputStatement(s));
    expect((await repo.getOutputStatement('st-a'))?.body).toBe('x');
    const all = await repo.listOutputStatements({ outputId: 'o-001' });
    expect(all.map((x) => x.id)).toEqual(['st-a']);
  });

  it('round-trips StatementSupport through put + list', async () => {
    const repo = createDexieResearchRepository();
    const s = makeSupportFixture({ id: 'sup-a' });
    await repo.transact(async (tx) => tx.putStatementSupport(s));
    const listed = await repo.listStatementSupports({ statementId: 'st-001' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.ref).toEqual({ kind: 'evidence', id: 'e-001' });
  });

  it('deleteOutput cascades to sections + statements + supports inside one transact', async () => {
    const repo = createDexieResearchRepository();
    const out = makeOutputFixture({ id: 'o-cascade' });
    const section = makeSectionFixture({ id: 'sec-c', outputId: 'o-cascade' });
    const statement = makeStatementFixture({ id: 'st-c', outputId: 'o-cascade', sectionId: 'sec-c' });
    const support = makeSupportFixture({ id: 'sup-c', outputId: 'o-cascade', statementId: 'st-c' });
    await repo.transact(async (tx) => {
      tx.putOutput(out);
      tx.putOutputSection(section);
      tx.putOutputStatement(statement);
      tx.putStatementSupport(support);
    });
    await repo.transact(async (tx) => {
      tx.deleteOutput('o-cascade');
      tx.deleteOutputSection('sec-c');
      tx.deleteOutputStatement('st-c');
      tx.deleteStatementSupport('sup-c');
    });
    expect(await repo.getOutput('o-cascade')).toBeNull();
    expect(await repo.getOutputSection('sec-c')).toBeNull();
    expect(await repo.getOutputStatement('st-c')).toBeNull();
    expect(await repo.listStatementSupports({ statementId: 'st-c' })).toHaveLength(0);
  });

  it('duplicate (statement, ref, relation) is refused inside one transaction', async () => {
    const repo = createDexieResearchRepository();
    const sup = makeSupportFixture({ id: 'sup-dup' });
    const sup2 = makeSupportFixture({ id: 'sup-dup-2' });
    await expect(
      repo.transact(async (tx) => {
        tx.putStatementSupport(sup);
        tx.putStatementSupport(sup2);
      }),
    ).rejects.toThrow(/duplicate/);
    expect(await repo.listStatementSupports({ statementId: 'st-001' })).toHaveLength(0);
  });

  it('duplicate (statement, ref, relation) is refused across transactions', async () => {
    const repo = createDexieResearchRepository();
    const first = makeSupportFixture({ id: 'sup-existing' });
    const duplicate = makeSupportFixture({ id: 'sup-later' });
    await repo.transact((tx) => tx.putStatementSupport(first));
    await expect(
      repo.transact((tx) => tx.putStatementSupport(duplicate)),
    ).rejects.toThrow(/duplicate/);
    expect(await repo.listStatementSupports({ statementId: 'st-001' })).toEqual([
      first,
    ]);
  });

  it('allows updating a support when its dedup identity is unchanged', async () => {
    const repo = createDexieResearchRepository();
    const original = makeSupportFixture({ id: 'sup-update' });
    await repo.transact((tx) => tx.putStatementSupport(original));
    await repo.transact((tx) =>
      tx.putStatementSupport({ ...original, updatedAt: '2026-07-31T00:00:00.000Z' }),
    );
    expect(await repo.listStatementSupports({ statementId: 'st-001' })).toHaveLength(1);
  });

  it('memory ↔ Dexie parity: same writes look the same through both adapters', async () => {
    const mem = new (await import('../../application/research/researchRepository')).MemoryResearchRepository();
    const dex = createDexieResearchRepository();
    const o = makeOutputFixture({ id: 'o-par' });
    const sec = makeSectionFixture({ id: 'sec-par', outputId: 'o-par' });
    const stmt = makeStatementFixture({ id: 'st-par', outputId: 'o-par', sectionId: 'sec-par' });
    const sup = makeSupportFixture({ id: 'sup-par', outputId: 'o-par', statementId: 'st-par' });
    for (const r of [mem, dex]) {
      await r.transact(async (tx) => {
        tx.putOutput(o);
        tx.putOutputSection(sec);
        tx.putOutputStatement(stmt);
        tx.putStatementSupport(sup);
      });
    }
    const memGet = await mem.getOutput('o-par');
    const dexGet = await dex.getOutput('o-par');
    expect(memGet).toMatchObject({ id: dexGet?.id, title: dexGet?.title, status: dexGet?.status });
  });
});
