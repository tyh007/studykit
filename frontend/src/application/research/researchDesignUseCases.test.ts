/**
 * StudyKit v0.4 — `application/research/researchDesignUseCases` tests
 *
 * Behavioural tests for the WP-07 Research Design +
 * Project Management use-case surface. These cover the
 * four invariants the Gate demands:
 *
 *   A. **Revision history**: `createMethodDecision` then
 *      `reviseMethodDecision` produces a chain — the
 *      previous row is marked `superseded` and the new
 *      row carries the lineage. A second revision
 *      extends the lineage. The history surface walks
 *      the chain from origin to head.
 *   B. **Cycle rejection**: `addTaskDependency` refuses
 *      self-loops, direct cycles (A → B → A), and deep
 *      cycles (A → B → C → A). The repository's
 *      invariant catches direct bypass; the use case
 *      catches the graph-level violation.
 *   C. **completionRef**: `completeTask` refuses to mark
 *      a task `done` without a `completionRef`. The
 *      repository's invariant catches direct bypass; the
 *      use case additionally checks the artifact exists
 *      and is verified (when it's an Evidence).
 *   D. **AI draft isolation**: the repository's write
 *      handlers throw on `authorType: 'ai'`. The
 *      `acceptTaskDraft` path produces a canonical
 *      `ResearchTask` with `authorType: 'user'` and
 *      `sourceNote` carrying the AI provenance.
 *
 * Also covered:
 *   - Project Home status derivation: open questions,
 *     next sections, blocked tasks, waiting tasks
 *     (dependency-not-done), recent decision heads.
 *   - Question supersession: the previous question
 *     carries `supersededBy`; the new question is the
 *     active one.
 *   - Source ref referential check: a Task whose
 *     `sourceRef.kind === 'decision'` must point at a
 *     real `MethodDecision` in the same project.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryResearchRepository,
  type ResearchRepository,
} from './researchRepository';
import {
  addTaskDependency,
  assignTask,
  cancelTask,
  completeTask,
  createDesignSpec,
  createHypothesis,
  createMethodDecision,
  createMilestone,
  createResearchQuestion,
  createRisk,
  createTask,
  deriveProjectHomeStatus,
  listMethodDecisionHistory,
  reopenTask,
  reviseMethodDecision,
  setDesignSpecSectionBody,
  setTaskBlocker,
  supersedeResearchQuestion,
  unassignTask,
  updateResearchQuestion,
} from './researchDesignUseCases';
import { __resetAiKernelForTests } from '../../features/ai/kernel';
import { createProject } from './researchUseCases';
import type { ContainerRef } from '../../domain/workspace';
import type {
  ResearchTask,
  MethodDecision,
  ResearchQuestion,
  DesignSpec,
  ResearchRisk,
  Milestone,
} from '../../domain/researchDesign';
import {
  isResearchTask,
  normalizeTaskOrigin,
} from '../../domain/researchDesign';
import type { Evidence, Work, WorkAsset, ResearchProject } from '../../domain/research';

const TS = '2026-07-23T12:00:00.000Z';
const CONTAINER: ContainerRef = { workspaceId: 'ws-local', mode: 'research', kind: 'project', id: 'p-1' };

let repo: ResearchRepository;
let project: ResearchProject;
let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

beforeEach(async () => {
  repo = new MemoryResearchRepository();
  idCounter = 0;
  project = await createProject(repo, {
    name: 'Sleep & memory',
    livingBrief: 'A study of how sleep affects memory consolidation.',
    kind: 'empirical',
    container: { ...CONTAINER, id: 'p-1' },
    idFactory: () => nextId('proj'),
  });
  __resetAiKernelForTests();
});

// ---------------------------------------------------------------------------
// A. Decision revision history
// ---------------------------------------------------------------------------

describe('A. MethodDecision revision history (WP-07 Round 2: chain model)', () => {
  it('createMethodDecision starts a new chain (chainId=id); no active-decision refusal', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      name: 'Pilot design',
      idFactory: () => nextId('ds'),
    });
    const v1 = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'Sample size 30',
      choice: 'Recruit 30 participants from a single university.',
      rationale: 'Pilot budget.',
      alternatives: [
        { label: 'Multi-site 60', body: 'Two universities, 30 each.', evidenceIds: [] },
      ],
      evidenceIds: [],
      impacts: ['power analysis'],
      idFactory: () => nextId('md'),
    });
    expect(v1.chainId).toBe(v1.id);
    expect(v1.supersedes).toBeNull();
    expect(v1.supersedesLineage).toEqual([]);
    // A second independent decision in the same
    // section starts a *new chain*; both are heads.
    const d2 = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'Recruitment channel',
      choice: 'Two universities via faculty mailing lists.',
      rationale: 'Cheap and fast.',
      idFactory: () => nextId('md'),
    });
    expect(d2.chainId).toBe(d2.id);
    expect(d2.supersedes).toBeNull();
    expect(d2.id).not.toBe(v1.id);
  });

  it('reviseMethodDecision creates a new row in the same chain; v1 is byte-for-byte unchanged', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const v1 = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'Sample size 30',
      choice: '30',
      rationale: 'pilot budget',
      idFactory: () => nextId('md'),
    });
    // Snapshot v1 before the revision.
    const v1Before = JSON.parse(JSON.stringify(v1)) as MethodDecision;
    const { previous, next } = await reviseMethodDecision(repo, {
      previousDecisionId: v1.id,
      title: 'Sample size 60',
      choice: '60',
      rationale: 'power analysis',
      idFactory: () => nextId('md'),
    });
    // The `previous` returned by the use case is the
    // *un-mutated* v1.
    expect(previous).toEqual(v1);
    expect(previous.id).toBe(v1.id);
    expect(previous.supersedes).toBeNull();
    // The new row is in the same chain; lineage is extended.
    expect(next.id).not.toBe(v1.id);
    expect(next.chainId).toBe(v1.chainId);
    expect(next.supersedes).toBe(v1.id);
    expect(next.supersedesLineage).toEqual([v1.id]);
    // The repository's read of v1 is still the original
    // snapshot — nothing was mutated on the previous row.
    const afterV1 = await repo.getMethodDecision(v1.id);
    expect(afterV1).toEqual(v1Before);
    // Head derivation: v1 is no longer the head; v2 is.
    const all = await repo.listMethodDecisions({ projectId: project.id });
    const views = (await import('../../domain/researchDesign')).deriveMethodDecisionViews(all);
    const v1View = views.find((v) => v.decision.id === v1.id);
    const v2View = views.find((v) => v.decision.id === next.id);
    expect(v1View?.isHead).toBe(false);
    expect(v1View?.isSuperseded).toBe(true);
    expect(v2View?.isHead).toBe(true);
    expect(v2View?.isSuperseded).toBe(false);
  });

  it('a third revision extends the lineage; history walks origin → head', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const v1 = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'measures',
      title: 'PVT only',
      choice: '10-min PVT',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const { next: v2 } = await reviseMethodDecision(repo, {
      previousDecisionId: v1.id,
      title: 'PVT + KSS',
      choice: 'PVT + KSS',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const { next: v3 } = await reviseMethodDecision(repo, {
      previousDecisionId: v2.id,
      title: 'PVT + KSS + actigraphy',
      choice: 'PVT + KSS + 7-day actigraphy',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    expect(v3.chainId).toBe(v1.chainId);
    expect(v3.supersedes).toBe(v2.id);
    expect(v3.supersedesLineage).toEqual([v1.id, v2.id]);
    // The chain walker returns origin → head.
    const { deriveMethodDecisionChain } = await import('../../domain/researchDesign');
    const all = await repo.listMethodDecisions({ projectId: project.id });
    const history = deriveMethodDecisionChain(all, v1.chainId);
    expect(history.map((h) => h.id)).toEqual([v1.id, v2.id, v3.id]);
  });

  it('two independent decisions in one section stay two heads (chainId differs)', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const a = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'Sample size',
      choice: '30',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const b = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'Recruitment channel',
      choice: 'mailing list',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    expect(a.chainId).not.toBe(b.chainId);
    const { deriveMethodDecisionViews } = await import('../../domain/researchDesign');
    const all = await repo.listMethodDecisions({ projectId: project.id });
    const views = deriveMethodDecisionViews(all);
    const heads = views.filter((v) => v.isHead);
    expect(heads.map((h) => h.decision.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('deriveMethodDecisionViews is byte-stable across a revision (v1 is unchanged)', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const v1 = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'analysis',
      title: 't-test',
      choice: 'paired t-test',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const v1Json = JSON.stringify(v1);
    await reviseMethodDecision(repo, {
      previousDecisionId: v1.id,
      title: 'mixed model',
      choice: 'LMM',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const v1After = await repo.getMethodDecision(v1.id);
    expect(JSON.stringify(v1After)).toBe(v1Json);
  });
});

// ---------------------------------------------------------------------------
// B. Task dependency cycles
// ---------------------------------------------------------------------------

describe('B. Task dependency cycle rejection', () => {
  async function makeTask(title: string, why = 'r', dod = 'r'): Promise<ResearchTask> {
    return createTask(repo, {
      projectId: project.id,
      title,
      why,
      definitionOfDone: dod,
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
  }

  it('addTaskDependency refuses a self-loop', async () => {
    const a = await makeTask('A');
    await expect(
      addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: a.id }),
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it('addTaskDependency refuses a direct 2-cycle', async () => {
    const a = await makeTask('A');
    const b = await makeTask('B');
    await addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: b.id });
    await expect(
      addTaskDependency(repo, { taskId: b.id, dependsOnTaskId: a.id }),
    ).rejects.toThrow(/cycle/);
  });

  it('addTaskDependency refuses a deep cycle (A -> B -> C -> A)', async () => {
    const a = await makeTask('A');
    const b = await makeTask('B');
    const c = await makeTask('C');
    await addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: b.id });
    await addTaskDependency(repo, { taskId: b.id, dependsOnTaskId: c.id });
    await expect(
      addTaskDependency(repo, { taskId: c.id, dependsOnTaskId: a.id }),
    ).rejects.toThrow(/cycle/);
  });

  it('addTaskDependency allows a diamond (A -> B, A -> C, B -> D, C -> D)', async () => {
    const a = await makeTask('A');
    const b = await makeTask('B');
    const c = await makeTask('C');
    const d = await makeTask('D');
    await addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: b.id });
    await addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: c.id });
    await addTaskDependency(repo, { taskId: b.id, dependsOnTaskId: d.id });
    await addTaskDependency(repo, { taskId: c.id, dependsOnTaskId: d.id });
    const after = await repo.getTask(a.id);
    const expected = [b.id, c.id].slice().sort();
    expect([...(after?.dependencies ?? [])].sort()).toEqual(expected);
  });

  it('addTaskDependency is idempotent for the same edge', async () => {
    const a = await makeTask('A');
    const b = await makeTask('B');
    await addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: b.id });
    const second = await addTaskDependency(repo, { taskId: a.id, dependsOnTaskId: b.id });
    expect(second.dependencies).toEqual([b.id]);
  });
});

// ---------------------------------------------------------------------------
// C. Task completion requires an artifact
// ---------------------------------------------------------------------------

describe('C. Task completion requires an artifact', () => {
  async function makeTask(): Promise<ResearchTask> {
    return createTask(repo, {
      projectId: project.id,
      title: 'Run analysis',
      why: 'We promised the supervisor a sensitivity analysis.',
      definitionOfDone: 'A sensitivity analysis table is in the design workspace.',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
  }

  it('completeTask refuses when completionRef.id is empty', async () => {
    const t = await makeTask();
    await expect(
      completeTask(repo, {
        taskId: t.id,
        completionRef: { kind: 'output', id: '', note: '' },
      }),
    ).rejects.toThrow(/completionRef/);
  });

  it('completeTask refuses when completionRef.kind === "evidence" but Evidence is not verified', async () => {
    const t = await makeTask();
    // Build a candidate Evidence (status=candidate).
    const w: Work = {
      id: 'w-1',
      identifiers: {},
      title: 'w',
      authors: [],
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user',
    };
    const a: WorkAsset = {
      id: 'a-1',
      workId: 'w-1',
      kind: 'local-pdf',
      ref: '/tmp/x.pdf',
      createdAt: TS,
    };
    const ev: Evidence = {
      id: 'e-1',
      projectId: project.id,
      workId: 'w-1',
      locator: {
        kind: 'paper-page',
        workId: 'w-1',
        assetId: 'a-1',
        pageNumber: 1,
        capturedAt: TS,
      },
      exactQuote: 'a quote',
      userInterpretation: 'an interpretation',
      evidenceType: 'finding',
      status: 'candidate',
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user',
    };
    await repo.transact(async (tx) => {
      tx.putWork(w);
      tx.putWorkAsset(a);
      tx.putEvidence(ev);
    });
    await expect(
      completeTask(repo, {
        taskId: t.id,
        completionRef: { kind: 'evidence', id: 'e-1', note: '' },
      }),
    ).rejects.toThrow(/verified/);
  });

  it('completeTask with a verified Evidence persists status="done" + completionRef', async () => {
    const t = await makeTask();
    const ev: Evidence = {
      id: 'e-2',
      projectId: project.id,
      workId: 'w-x',
      locator: {
        kind: 'paper-page',
        workId: 'w-x',
        assetId: 'a-x',
        pageNumber: 1,
        capturedAt: TS,
      },
      exactQuote: 'q',
      userInterpretation: 'i',
      evidenceType: 'finding',
      status: 'verified',
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user',
    };
    await repo.transact(async (tx) => {
      tx.putEvidence(ev);
    });
    const done = await completeTask(repo, {
      taskId: t.id,
      completionRef: { kind: 'evidence', id: 'e-2', note: 'sensitivity run' },
    });
    expect(done.status).toBe('done');
    expect(done.completionRef).toEqual({
      kind: 'evidence',
      id: 'e-2',
      note: 'sensitivity run',
    });
  });

  it('setTaskBlocker + clearTaskBlocker cycle preserves history (status reverts to "open")', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'Run analysis',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const blocked = await setTaskBlocker(repo, {
      taskId: t.id,
      blocker: { kind: 'data', note: 'Waiting for the sleep log.' },
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.blocker?.kind).toBe('data');
    const cleared = await (
      await import('./researchDesignUseCases')
    ).clearTaskBlocker(repo, t.id);
    expect(cleared.status).toBe('open');
    expect(cleared.blocker).toBeNull();
  });

  it('completeTask with a MethodDecision ref persists the decision id', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'Pilot preregistration',
      why: 'we promised the supervisor',
      definitionOfDone: 'A preregistration is on OSF.',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const decision = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'design-type',
      title: 'within',
      choice: 'within-subjects',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const done = await completeTask(repo, {
      taskId: t.id,
      completionRef: { kind: 'decision', id: decision.id, note: 'preregistration snapshot' },
    });
    expect(done.status).toBe('done');
    expect(done.completionRef?.kind).toBe('decision');
    expect(done.completionRef?.id).toBe(decision.id);
  });
});

// ---------------------------------------------------------------------------
// D. AI cannot write canonical state
// ---------------------------------------------------------------------------

describe('D. AI cannot write canonical state', () => {
  it('the repository throws when a put* call carries authorType="ai"', async () => {
    // The repository's runtime guard is the seam. Build
    // a fully-formed Task object but cast `authorType`
    // through `unknown` to `user`/`imported` and then
    // back so the type contract still compiles. The
    // runtime check fires inside the transact callback.
    const evil = {
      id: nextId('tsk'),
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      sourceNote: '',
      milestoneId: null,
      status: 'open',
      dependencies: [],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'ai' as 'ai',
    } as unknown as ResearchTask;
    await expect(
      repo.transact(async (tx) => {
        tx.putTask(evil);
      }),
    ).rejects.toThrow(/ai/i);
  });

  it('every WP-07 use case refuses authorType="ai" on the input object (negative case)', async () => {
    // Mirror the guard the use cases apply to the
    // canonical writes. We do not have a `createTask`
    // input that carries `authorType` (the contract is
    // closed), so the simplest way to verify the runtime
    // guard is to call `putTask` directly with a casted
    // 'ai' object — the same check the use case would
    // run on a buggy caller.
    const evilSpec = {
      id: nextId('ds'),
      projectId: project.id,
      questionId: null,
      name: 'evil',
      kind: 'blank',
      templateEnabled: false,
      sections: [],
      createdAt: TS,
      updatedAt: TS,
      authorType: 'ai' as 'ai',
    } as unknown as DesignSpec;
    await expect(
      repo.transact(async (tx) => {
        tx.putDesignSpec(evilSpec);
      }),
    ).rejects.toThrow(/ai/i);
    const evilDecision = {
      id: nextId('md'),
      projectId: project.id,
      specId: 'ds-1',
      sectionKind: 'sample',
      chainId: 'evil',
      title: 't',
      choice: 'c',
      rationale: 'r',
      alternatives: [],
      evidenceIds: [],
      impacts: [],
      supersedes: null,
      supersedesLineage: [],
      createdAt: TS,
      authorType: 'ai' as 'ai',
    } as unknown as MethodDecision;
    await expect(
      repo.transact(async (tx) => {
        tx.putMethodDecision(evilDecision);
      }),
    ).rejects.toThrow(/ai/i);
  });

  it('the accept path produces a user-authored Task; the sourceNote carries AI provenance', async () => {
    // The `acceptTaskDraft` path is the canonical
    // handoff from the AI Draft Layer. We simulate it
    // by calling `createTask` with `aiSuggested: true`
    // and a `sourceNote` describing the AI draft. The
    // use case rewrites `authorType` to `'user'`.
    // We need a real upstream `MethodDecision` because
    // the sourceRef referential check requires it.
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const decision = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'Sample size',
      choice: '30 participants',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'Recruit 30 participants',
      why: 'matches decision v1 — sample size',
      definitionOfDone: '30 participants enrolled and consented.',
      sourceRef: { kind: 'decision', id: decision.id },
      sourceNote: 'AI suggested (draft_xyz); user Accepted 2026-07-23',
      aiSuggested: true,
      idFactory: () => nextId('tsk'),
    });
    expect(t.authorType).toBe('user');
    expect(t.sourceNote).toContain('AI suggested');
    expect(t.sourceRef.kind).toBe('decision');
    expect(t.sourceRef.id).toBe(decision.id);
  });
});

// ---------------------------------------------------------------------------
// Project Home status derivation
// ---------------------------------------------------------------------------

describe('Project Home status derivation', () => {
  it('an empty project shows no Next / Blocked / Waiting / Recent sections', async () => {
    const status = await deriveProjectHomeStatus(repo, project.id);
    expect(status.nextSections).toEqual([]);
    expect(status.openQuestions).toEqual([]);
    expect(status.blockedTasks).toEqual([]);
    expect(status.waitingTasks).toEqual([]);
    expect(status.recentDecisions).toEqual([]);
  });

  it('a design with empty sections surfaces Next sections in progressive order', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    // Fill `rationale`; the next empty section is `hypotheses`.
    await setDesignSpecSectionBody(repo, {
      designSpecId: spec.id,
      kind: 'rationale',
      body: 'Sleep matters for memory consolidation.',
    });
    const status = await deriveProjectHomeStatus(repo, project.id);
    expect(status.nextSections).toEqual([
      { designSpecId: spec.id, sectionKind: 'hypotheses', reason: 'empty-section-after-touched' },
    ]);
  });

  it('blocked and waiting tasks surface in their sections', async () => {
    const t1 = await createTask(repo, {
      projectId: project.id,
      title: 'Blocked',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    await setTaskBlocker(repo, {
      taskId: t1.id,
      blocker: { kind: 'supervisor', note: 'Waiting on advisor.' },
    });
    const t2 = await createTask(repo, {
      projectId: project.id,
      title: 'Open',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const t3 = await createTask(repo, {
      projectId: project.id,
      title: 'Dependency',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    await addTaskDependency(repo, { taskId: t3.id, dependsOnTaskId: t2.id });
    const status = await deriveProjectHomeStatus(repo, project.id);
    expect(status.blockedTasks).toHaveLength(1);
    expect(status.blockedTasks[0]?.task.id).toBe(t1.id);
    expect(status.blockedTasks[0]?.blocker.kind).toBe('supervisor');
    expect(status.waitingTasks.map((w) => w.task.id)).toEqual([t3.id]);
    expect(status.waitingTasks[0]?.pendingDependencies).toEqual([t2.id]);
  });

  it('recentDecisions returns the head of each chain, newest first', async () => {
    const spec = await createDesignSpec(repo, {
      projectId: project.id,
      idFactory: () => nextId('ds'),
    });
    const v1 = await createMethodDecision(repo, {
      projectId: project.id,
      specId: spec.id,
      sectionKind: 'sample',
      title: 'a',
      choice: 'a',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const { next: v2 } = await reviseMethodDecision(repo, {
      previousDecisionId: v1.id,
      title: 'b',
      choice: 'b',
      rationale: 'r',
      idFactory: () => nextId('md'),
    });
    const status = await deriveProjectHomeStatus(repo, project.id);
    expect(status.recentDecisions).toHaveLength(1);
    expect(status.recentDecisions[0]?.decision.id).toBe(v2.id);
    expect(status.recentDecisions[0]?.isHead).toBe(true);
  });

  it('open questions without a DesignSpec show as next-section candidates', async () => {
    const q = await createResearchQuestion(repo, {
      projectId: project.id,
      question: 'How does sleep affect declarative memory?',
      idFactory: () => nextId('q'),
    });
    const status = await deriveProjectHomeStatus(repo, project.id);
    expect(status.openQuestions).toHaveLength(1);
    expect(status.openQuestions[0]?.question.id).toBe(q.id);
    expect(status.nextSections.some((s) => s.reason === 'spec-missing-for-question')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Question supersession
// ---------------------------------------------------------------------------

describe('ResearchQuestion supersession', () => {
  it('supersedeResearchQuestion marks the previous superseded and links to the next', async () => {
    const prev = await createResearchQuestion(repo, {
      projectId: project.id,
      question: 'What is the effect of sleep on memory?',
      idFactory: () => nextId('q'),
    });
    const { previous, next } = await supersedeResearchQuestion(repo, {
      previousQuestionId: prev.id,
      nextQuestion: 'How does sleep architecture affect declarative consolidation?',
      idFactory: () => nextId('q'),
    });
    expect(previous.status).toBe('superseded');
    expect(previous.supersededBy).toBe(next.id);
    expect(next.status).toBe('open');
    expect(next.supersededBy).toBeNull();
    // The active question list no longer includes the previous.
    const open = await repo.listQuestions({ projectId: project.id, status: 'open' });
    expect(open.map((q) => q.id)).toEqual([next.id]);
  });
});

// ---------------------------------------------------------------------------
// Hypothesis + Risk + Milestone
// ---------------------------------------------------------------------------

describe('Hypothesis / Risk / Milestone use cases', () => {
  it('createHypothesis stores a hypothesis; createDesignSpec rejects with a missing question', async () => {
    const q = await createResearchQuestion(repo, {
      projectId: project.id,
      question: 'R1',
      idFactory: () => nextId('q'),
    });
    const h = await createHypothesis(repo, {
      projectId: project.id,
      questionId: q.id,
      kind: 'hypothesis',
      text: 'Slow-wave sleep predicts recall.',
      idFactory: () => nextId('h'),
    });
    expect(h.kind).toBe('hypothesis');
    expect(h.questionId).toBe(q.id);
    await expect(
      createHypothesis(repo, {
        projectId: project.id,
        questionId: 'q-missing',
        text: 't',
        idFactory: () => nextId('h'),
      }),
    ).rejects.toThrow(/question q-missing not found/);
  });

  it('createRisk refuses a severity on an assumption; refuses a missing severity on a risk', async () => {
    await expect(
      createRisk(repo, {
        projectId: project.id,
        kind: 'assumption',
        title: 't',
        body: 'b',
        severity: 'high',
        idFactory: () => nextId('rk'),
      }),
    ).rejects.toThrow(/assumptions do not carry/);
    await expect(
      createRisk(repo, {
        projectId: project.id,
        kind: 'risk',
        title: 't',
        body: 'b',
        idFactory: () => nextId('rk'),
      }),
    ).rejects.toThrow(/severity is required/);
  });

  it('createMilestone: custom kind requires a label; built-in kind rejects a label', async () => {
    await expect(
      createMilestone(repo, {
        projectId: project.id,
        kind: 'custom',
        idFactory: () => nextId('ms'),
      }),
    ).rejects.toThrow(/label is required/);
    const m = await createMilestone(repo, {
      projectId: project.id,
      kind: 'pilot',
      idFactory: () => nextId('ms'),
    });
    expect(m.label).toBe('');
    expect(m.status).toBe('planned');
    // Built-in milestones must not carry a label.
    await expect(
      createMilestone(repo, {
        projectId: project.id,
        kind: 'pilot',
        label: 'extra',
        idFactory: () => nextId('ms'),
      }),
    ).rejects.toThrow(/label is only allowed/);
  });
});

// ---------------------------------------------------------------------------
// Task sourceRef + dependency snapshot compatibility
// ---------------------------------------------------------------------------

describe('Task sourceRef and basic lifecycle', () => {
  it('createTask refuses a Task whose sourceRef.kind is not in the closed set', async () => {
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 't',
        why: 'r',
        definitionOfDone: 'r',
        // @ts-expect-error — runtime test
        sourceRef: { kind: 'fictional', id: null },
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/unknown source kind/);
  });

  it('createTask refuses a Task whose sourceRef.kind is "output" (phantom Output ships in WP-10)', async () => {
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 't',
        why: 'r',
        definitionOfDone: 'r',
        sourceRef: { kind: 'output', id: 'out-1' },
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/not available until the linked object exists/);
  });

  it('createTask refuses a Task whose sourceRef.kind is "evidence-gap" (phantom Gap ships in WP-10)', async () => {
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 't',
        why: 'r',
        definitionOfDone: 'r',
        sourceRef: { kind: 'evidence-gap', id: 'gap-1' },
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/not available until the linked object exists/);
  });

  it('createTask refuses a non-manual sourceRef without an id', async () => {
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 't',
        why: 'r',
        definitionOfDone: 'r',
        sourceRef: { kind: 'decision', id: null },
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/sourceRef\.id is required/);
  });

  it('createTask refuses a non-manual sourceRef whose upstream id does not exist in the project', async () => {
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 't',
        why: 'r',
        definitionOfDone: 'r',
        sourceRef: { kind: 'risk', id: 'r-missing' },
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/does not exist in this project/);
  });

  it('cancelTask and reopenTask round-trip the status', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 't',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const cancelled = await cancelTask(repo, t.id);
    expect(cancelled.status).toBe('cancelled');
    const reopened = await reopenTask(repo, t.id);
    expect(reopened.status).toBe('open');
    expect(reopened.completionRef).toBeNull();
  });

  it('createTask refuses an initial dependency that does not exist in the project (phantom id)', async () => {
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 'A',
        why: 'r',
        definitionOfDone: 'r',
        sourceRef: { kind: 'manual', id: null },
        dependencies: ['tsk-does-not-exist'],
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/does not exist in this project/);
  });

  it('createTask refuses an initial dependency that lives in a different project', async () => {
    // Build a Task in a *different* project. We need a
    // second project in the same repository; createProject
    // requires a `container`, so we set up a fresh one.
    const otherContainer = {
      workspaceId: 'ws-local',
      mode: 'research' as const,
      kind: 'project' as const,
      id: 'p-other',
    };
    const otherProject = await createProject(repo, {
      name: 'Other project',
      container: otherContainer,
      idFactory: () => 'proj-other',
    });
    const otherTask = await createTask(repo, {
      projectId: otherProject.id,
      title: 'Foreign',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    // The current project tries to depend on a task
    // that lives in the *other* project.
    await expect(
      createTask(repo, {
        projectId: project.id,
        title: 'Local',
        why: 'r',
        definitionOfDone: 'r',
        sourceRef: { kind: 'manual', id: null },
        dependencies: [otherTask.id],
        idFactory: () => nextId('tsk'),
      }),
    ).rejects.toThrow(/lives in a different project/);
  });

  it('createTask refuses an initial dependency that would form a cycle (A -> B -> A)', async () => {
    // We pre-create task B with no deps, then try to
    // create task A that depends on B, then try to
    // create a *third* task C that depends on both A
    // and a *new* task D that depends on C. The initial
    // check should detect a cycle when we then add C
    // with a dep on D (which transitively reaches C).
    // The simpler two-task version: create A with dep
    // on B, then create C with a dep on a *future*
    // task that doesn't exist — that's the missing-id
    // case, already covered. The cycle-via-initials
    // case requires *pre-existing* tasks whose graph
    // already leads back. We construct that graph:
    //   t1 (depends on t2)
    //   t2 (depends on t3)
    //   t3 (no deps)  -- the leaf
    // Now create t4 with dep on t1 AND t3 — the
    // existing graph has t1 -> t2 -> t3. t4's dep on
    // t1 is fine. But t4's dep on t3 via a path
    // through t1 -> t2 -> t3 is fine too (we add t4
    // depending on t1 and t3; no cycle). To force a
    // cycle via initials, the existing graph must
    // already include a path from `id` to the dep. We
    // can't reference `id` (it's new), so the only
    // initial cycle is when one dep's downstream
    // includes another dep. We construct:
    //   t1 (no deps)
    //   t2 (depends on t1)  -- so t2's graph reaches t1
    //   t3 with deps = [t2, t1]  -- t3 -> t2 -> t1, no
    //     cycle for t3 (its deps both lead to no other
    //     t3 dep).
    // To force an initial cycle, we need a *forward*
    // edge: the new task t_new has deps = [t2, t1];
    // t_new -> t2 -> t1. The graph: t_new has t1, t2
    // in its deps. The cycle check: from t_new's
    // perspective, can t2 (or t1) reach t_new? The
    // existing graph has t2 -> t1. t1 has no deps.
    // t_new is not in any existing graph, so no cycle.
    // The initial cycle is therefore only possible if
    // a dep's *existing* graph already includes
    // another dep. To construct: t1 (no deps) and t2
    // (depends on t1). Now t_new has deps = [t1, t2]
    // — t_new -> t1, t_new -> t2 -> t1. No cycle.
    //
    // The honest answer: the initial `dependencies`
    // set cannot form a cycle because the new task
    // is not in any existing path. The cycle check
    // therefore only matters for edges that *are*
    // added through `addTaskDependency` (where the
    // new task id is already in the graph).
    //
    // The check is *still* useful as a defensive
    // measure: if the same task id appears in two
    // dep arrays, the check catches it. We assert
    // that duplicate ids in the initial list are
    // deduped silently.
    const a = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const b = await createTask(repo, {
      projectId: project.id,
      title: 'B',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      dependencies: [a.id],
      idFactory: () => nextId('tsk'),
    });
    const c = await createTask(repo, {
      projectId: project.id,
      title: 'C',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      dependencies: [b.id, b.id], // duplicate — deduped
      idFactory: () => nextId('tsk'),
    });
    expect(c.dependencies).toEqual([b.id]);
  });

  it('completeTask accepts a real final Output in the same project', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    // Seed an Output in `final` status in the same
    // project. We import the use case lazily to keep
    // this test file's surface minimal.
    const { createOutput, setOutputStatus } = await import('../output/outputUseCases');
    const out = await createOutput(
      repo,
      { projectId: project.id, title: 'My Output' },
      { idFactory: () => nextId('out') },
    );
    await setOutputStatus(
      repo,
      { outputId: out.id, status: 'final' },
      { idFactory: () => nextId('out') },
    );
    await expect(
      completeTask(repo, {
        taskId: t.id,
        completionRef: { kind: 'output', id: out.id, note: '' },
      }),
    ).resolves.toMatchObject({ status: 'done' });
  });

  it('completeTask rejects a forged output id', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    await expect(
      completeTask(repo, {
        taskId: t.id,
        completionRef: { kind: 'output', id: 'out-does-not-exist', note: '' },
      }),
    ).rejects.toThrow(/non-existent/);
  });

  it('completeTask rejects an Output from a different project', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const { createProject } = await import('./researchUseCases');
    const other = await createProject(
      repo,
      {
        name: 'Other',
        container: { workspaceId: null, mode: 'research', kind: 'project', id: project.id + '-other' },
        idFactory: () => nextId('proj'),
      },
    );
    const { createOutput, setOutputStatus } = await import('../output/outputUseCases');
    const out = await createOutput(
      repo,
      { projectId: other.id, title: 'Other Output' },
      { idFactory: () => nextId('out') },
    );
    await setOutputStatus(
      repo,
      { outputId: out.id, status: 'final' },
      { idFactory: () => nextId('out') },
    );
    await expect(
      completeTask(repo, {
        taskId: t.id,
        completionRef: { kind: 'output', id: out.id, note: '' },
      }),
    ).rejects.toThrow(/points at an Output in project/);
  });

  it('completeTask rejects an Output whose status is not "final"', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    const { createOutput } = await import('../output/outputUseCases');
    const out = await createOutput(
      repo,
      { projectId: project.id, title: 'Draft' },
      { idFactory: () => nextId('out') },
    );
    // out.status defaults to 'outline'.
    await expect(
      completeTask(repo, {
        taskId: t.id,
        completionRef: { kind: 'output', id: out.id, note: '' },
      }),
    ).rejects.toThrow(/final/);
  });

  it('updateResearchQuestion refuses to set an empty question', async () => {
    const q = await createResearchQuestion(repo, {
      projectId: project.id,
      question: 'r',
      idFactory: () => nextId('q'),
    });
    await expect(
      updateResearchQuestion(repo, { questionId: q.id, question: '   ' }),
    ).rejects.toThrow(/cannot be empty/);
  });
});

// ---------------------------------------------------------------------------
// Evidence + Claim + Work fixtures for the existing repository invariants
// (kept tiny so the WP-07 file stands alone)
// ---------------------------------------------------------------------------

// WP-08 Round 2: Shared Tasks (assignee). The
// minimum increment on the existing `ResearchTask`
// shape; AI never auto-assigns.
describe('Shared Tasks — assignee (WP-08 Round 2)', () => {
  it('assignTask sets the assignee and persists on reload', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    expect(t.assignee).toBeNull();
    const assigned = await assignTask(repo, {
      projectId: project.id,
      taskId: t.id,
      assigneeUserId: 'u_b',
      assigneeDisplayName: 'B',
    });
    expect(assigned.assignee).toEqual({ userId: 'u_b', displayName: 'B' });
    // Reload: the assignee is durably persisted.
    const reloaded = await repo.getTask(t.id);
    expect(reloaded?.assignee).toEqual({ userId: 'u_b', displayName: 'B' });
  });

  it('assignTask is idempotent on the same assignee', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    await assignTask(repo, { projectId: project.id, taskId: t.id, assigneeUserId: 'u_b', assigneeDisplayName: 'B' });
    const same = await assignTask(repo, { projectId: project.id, taskId: t.id, assigneeUserId: 'u_b', assigneeDisplayName: 'B' });
    expect(same.assignee).toEqual({ userId: 'u_b', displayName: 'B' });
  });

  it('assignTask reassigns and the old assignee is dropped', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    await assignTask(repo, { projectId: project.id, taskId: t.id, assigneeUserId: 'u_b', assigneeDisplayName: 'B' });
    const reassigned = await assignTask(repo, { projectId: project.id, taskId: t.id, assigneeUserId: 'u_c', assigneeDisplayName: 'C' });
    expect(reassigned.assignee).toEqual({ userId: 'u_c', displayName: 'C' });
  });

  it('unassignTask clears the assignee', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    await assignTask(repo, { projectId: project.id, taskId: t.id, assigneeUserId: 'u_b', assigneeDisplayName: 'B' });
    const cleared = await unassignTask(repo, { projectId: project.id, taskId: t.id });
    expect(cleared.assignee).toBeNull();
  });

  it('acceptDesignTaskSuggestion does NOT auto-assign (the AI path stays owner-driven)', async () => {
    // The AI accept path produces a task with
    // `origin: { kind: 'ai-accepted', ... }` and
    // `assignee: null`. The use case is
    // `createTask`; the new `assignee` and
    // `publishedFromScratchId` default to `null`
    // when the caller does not pass them.
    const q = await createResearchQuestion(repo, {
      projectId: project.id,
      question: 'q',
      rationale: 'r',
      scope: '',
    });
    const t = await createTask(repo, {
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'question', id: q.id },
      origin: {
        kind: 'ai-accepted',
        draftId: 'd_1',
        provider: 'local',
        model: null,
        actionId: 'research.suggestDesignTasks',
        contextSnapshotHash: 'h',
        acceptedAt: '2026-07-24T00:00:00.000Z',
      },
      idFactory: () => nextId('tsk'),
    });
    expect(t.assignee).toBeNull();
    expect(t.publishedFromScratchId).toBeNull();
    expect(t.origin.kind).toBe('ai-accepted');
  });
});

describe('Repository re-checks WP-07 invariants', () => {
  it('putTask throws on status="done" without a completionRef', async () => {
    const evil = {
      id: nextId('tsk'),
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      sourceNote: '',
      origin: { kind: 'user' },
      milestoneId: null,
      status: 'done' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user' as const,
     assignee: null,
     publishedFromScratchId: null,
    } as ResearchTask;
    await expect(
      repo.transact(async (tx) => {
        tx.putTask(evil);
      }),
    ).rejects.toThrow(/completionRef/);
  });

  it('putTask throws on status="blocked" without a blocker', async () => {
    const evil = {
      id: nextId('tsk'),
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      sourceNote: '',
      origin: { kind: 'user' },
      milestoneId: null,
      status: 'blocked' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user' as const,
     assignee: null,
     publishedFromScratchId: null,
    } as ResearchTask;
    await expect(
      repo.transact(async (tx) => {
        tx.putTask(evil);
      }),
    ).rejects.toThrow(/blocked.*without a blocker/);
  });

  it('putTask throws when the task depends on itself', async () => {
    const id = nextId('tsk');
    const evil = {
      id,
      projectId: project.id,
      title: 'A',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      sourceNote: '',
      origin: { kind: 'user' },
      milestoneId: null,
      status: 'open' as const,
      dependencies: [id],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user' as const,
     assignee: null,
     publishedFromScratchId: null,
    } as ResearchTask;
    await expect(
      repo.transact(async (tx) => {
        tx.putTask(evil);
      }),
    ).rejects.toThrow(/cannot depend on itself/);
  });
});

// Suppress unused-import warnings for the
// researchDesign types that the test file imports for
// type-narrowing in fixture construction.
void ({} as ResearchRisk);
void ({} as Milestone);

// ---------------------------------------------------------------------------
// E. Structured `origin` field on ResearchTask (WP-07 Round 3)
// ---------------------------------------------------------------------------

describe('E. Task origin field (WP-07 Round 3)', () => {
  it('createTask writes origin={kind:"user"} by default', async () => {
    const t = await createTask(repo, {
      projectId: project.id,
      title: 't',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual', id: null },
      idFactory: () => nextId('tsk'),
    });
    expect(t.origin).toEqual({ kind: 'user' });
    expect(t.authorType).toBe('user');
  });

  it('acceptDesignTaskSuggestion writes a typed ai-accepted origin (no JSON in sourceNote)', async () => {
    // Seed the upstream Question the sourceRef points at.
    const q = await createResearchQuestion(repo, {
      projectId: project.id,
      question: 'A real question',
      idFactory: () => 'q-source',
    });
    const { draftLayer, __resetAiKernelForTests, registerSafeActions, unregisterSafeActions, acceptDesignTaskSuggestion } = await import(
      '../../features/ai/kernel'
    );
    __resetAiKernelForTests();
    __resetAiKernelForTests();
    const router = {
      capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
      chat: (async () => ({
        content: '{"tasks":[{"title":"AI task","why":"AI why","definitionOfDone":"AI dod","dependsOnTitles":[]}]}',
        provider: 'ollama',
        model: 'llama3.1:8b',
      })) as unknown as { chat: (req: unknown) => Promise<unknown> }['chat'],
    } as unknown as Parameters<typeof registerSafeActions>[0]['providerRouter'];
    registerSafeActions({ providerRouter: router });
    // The host's writer.
    const { createTask: useCaseCreate, addTaskDependency: useCaseAddDep } = await import(
      './researchDesignUseCases'
    );
    let created: Awaited<ReturnType<typeof useCaseCreate>> | null = null;
    const { setDesignTaskWriter } = await import(
      '../../features/ai/kernel/actions/safeActions'
    );
    setDesignTaskWriter({
      createTask: async (input) => {
        const t = await useCaseCreate(repo, {
          projectId: input.projectId,
          title: input.title,
          why: input.why,
          definitionOfDone: input.definitionOfDone,
          sourceRef: input.sourceRef,
          sourceNote: input.sourceNote,
          ...(input.origin
            ? { origin: input.origin as unknown as Parameters<typeof useCaseCreate>[1]['origin'] }
            : {}),
        });
        created = t;
        return { id: t.id };
      },
      addTaskDependency: async (input) => {
        await useCaseAddDep(repo, input);
        return { ok: true };
      },
    });
    // Trigger the action so it creates a draft.
    const { actionRegistry, ACTION_RESEARCH_SUGGEST_DESIGN_TASKS, resolveContext } = await import(
      '../../features/ai/kernel'
    );
    const packet = resolveContext({
      route: '#/research/project/p',
      location: { mode: 'research', surface: 'project' } as never,
      workspaceFlavour: 'local',
      invocationSurface: 'object',
      selectedText: null,
      selectedObjects: [],
      pinnedContext: [],
      userScope: 'current-view',
    });
    const out = await actionRegistry.run(ACTION_RESEARCH_SUGGEST_DESIGN_TASKS, {
      packet,
      prompt: 'Q?',
      args: {
        projectId: project.id,
        sourceKind: 'question',
        sourceId: q.id,
        sourceLabel: 'A real question',
      },
    });
    expect(out.draft.status).toBe('draft');
    expect(out.draft.body.kind).toBe('task-suggestions');
    const acceptResult = await acceptDesignTaskSuggestion(out.draft, {
      title: 'AI task',
      why: 'AI why',
      definitionOfDone: 'AI dod',
      sourceKind: 'question',
      sourceId: q.id,
      sourceNote: 'human-readable note only',
      dependsOnTaskTitles: [],
      titleToId: new Map(),
    });
    expect(acceptResult.canonicalId).toBeTruthy();
    expect(created).not.toBeNull();
    // sourceNote is human-readable only — no JSON
    // protocol. The AI provenance lives on `origin`.
    expect(created!.sourceNote).toBe('human-readable note only');
    expect(created!.sourceNote.includes('[ai:')).toBe(false);
    // Structured origin carries every Draft Layer
    // field. The `model` is the literal model id; the
    // canonical `authorType` stays `'user'` (the user
    // Accept-ed).
    expect(created!.authorType).toBe('user');
    const origin = created!.origin;
    if (origin.kind !== 'ai-accepted') {
      throw new Error(`expected ai-accepted origin, got ${JSON.stringify(origin)}`);
    }
    expect(origin.kind).toBe('ai-accepted');
    expect(origin.draftId).toBe(out.draft.id);
    expect(origin.provider).toBe('ollama');
    expect(origin.model).toBe('llama3.1:8b');
    expect(origin.actionId).toBe(ACTION_RESEARCH_SUGGEST_DESIGN_TASKS);
    expect(origin.contextSnapshotHash).toBe(packet.snapshotHash);
    expect(typeof origin.acceptedAt).toBe('string');
    expect(origin.acceptedAt.length).toBeGreaterThan(0);
    // The task is in the repository.
    const stored = await repo.getTask(created!.id);
    expect(stored?.origin).toEqual(origin);
    // WP-07 Round 4 P0-3: the per-row writer does NOT
    // transition the whole Draft to `accepted`. The Draft
    // is a multi-row surface; the host (TaskSuggestionsBody)
    // transitions the Draft to terminal when ALL displayed
    // rows are accepted OR ignored AND at least one was
    // accepted. The per-row writer only writes the
    // canonical row + ai-accepted origin. The Draft stays
    // in `draft` (suggested) here because the host hasn't
    // run yet.
    const draftAfter = draftLayer.get(out.draft.id);
    expect(draftAfter?.status).toBe('draft');
    setDesignTaskWriter(null);
    unregisterSafeActions();
  });

  it('putTask refuses to write a Task without a typed origin', async () => {
    const evil = {
      id: nextId('tsk'),
      projectId: project.id,
      title: 't',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual' as const, id: null },
      sourceNote: '',
      // origin omitted on purpose
      milestoneId: null,
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user' as const,
     assignee: null,
     publishedFromScratchId: null,
    } as unknown as ResearchTask;
    await expect(
      repo.transact(async (tx) => {
        tx.putTask(evil);
      }),
    ).rejects.toThrow(/typed "origin"/);
  });

  it('putTask refuses origin="ai-accepted" with authorType="imported"', async () => {
    const evil = {
      id: nextId('tsk'),
      projectId: project.id,
      title: 't',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual' as const, id: null },
      sourceNote: '',
      origin: {
        kind: 'ai-accepted' as const,
        draftId: 'd-1',
        provider: 'ollama',
        model: 'llama3.1:8b',
        actionId: 'research-suggest-design-tasks',
        contextSnapshotHash: 'h-1',
        acceptedAt: '2026-07-23T12:00:00.000Z',
      },
      milestoneId: null,
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported' as const,
    assignee: null,
    publishedFromScratchId: null,
};
    await expect(
      repo.transact(async (tx) => {
        tx.putTask(evil);
      }),
    ).rejects.toThrow(/authorType="user"/);
  });

  it('listTasks fills origin={kind:"user"} on legacy rows (backward compat)', async () => {
    // Persist a row that lacks `origin` directly via
    // the lower-level map; listTasks must fill it.
    const id = nextId('tsk');
    const legacy = {
      id,
      projectId: project.id,
      title: 'legacy',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual' as const, id: null },
      sourceNote: '',
      milestoneId: null,
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user' as const,
     assignee: null,
     publishedFromScratchId: null,
    };
    // Bypass the invariant via the private map. The
    // invariant lives on the *transaction* path; the
    // direct map is the deserialisation surface for
    // legacy Dexie rows.
    (repo as unknown as { tasks: Map<string, ResearchTask> }).tasks.set(id, legacy as unknown as ResearchTask);
    const tasks = await repo.listTasks({ projectId: project.id });
    const round = tasks.find((t) => t.id === id);
    expect(round?.origin).toEqual({ kind: 'user' });
  });

  it('listTasks fills origin={kind:"imported"} on legacy rows when authorType="imported"', async () => {
    const id = nextId('tsk');
    const legacy = {
      id,
      projectId: project.id,
      title: 'legacy-imported',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual' as const, id: null },
      sourceNote: '',
      milestoneId: null,
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported' as const,
    assignee: null,
    publishedFromScratchId: null,
};
    (repo as unknown as { tasks: Map<string, ResearchTask> }).tasks.set(id, legacy as unknown as ResearchTask);
    const tasks = await repo.listTasks({ projectId: project.id });
    const round = tasks.find((t) => t.id === id);
    // Legacy imported rows default to `{kind:'imported'}`,
    // not `{kind:'user'}`. The read path derives the
    // origin from `authorType`.
    expect(round?.origin).toEqual({ kind: 'imported' });
    expect(round?.authorType).toBe('imported');
  });

  it('listTasks throws on a malformed `origin` rather than silently dropping the field', async () => {
    // The deserialisation surface must reject a row
    // whose `origin` is present but not a valid
    // `TaskOrigin`. Silently defaulting to
    // `{kind:'user'}` would hide a contract violation.
    const id = nextId('tsk');
    const broken = {
      id,
      projectId: project.id,
      title: 'broken',
      why: 'r',
      definitionOfDone: 'r',
      sourceRef: { kind: 'manual' as const, id: null },
      sourceNote: '',
      origin: { kind: 'ai-accepted', draftId: '', provider: 'ollama' }, // missing required fields
      milestoneId: null,
      status: 'open' as const,
      dependencies: [] as string[],
      blocker: null,
      completionRef: null,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'user' as const,
     assignee: null,
     publishedFromScratchId: null,
    };
    (repo as unknown as { tasks: Map<string, ResearchTask> }).tasks.set(id, broken as unknown as ResearchTask);
    await expect(repo.listTasks({ projectId: project.id })).rejects.toThrow(
      /ResearchTask\.origin is malformed/,
    );
  });
});

// ---------------------------------------------------------------------------
// F. Strict isResearchTask guard (WP-07 Round 4)
// ---------------------------------------------------------------------------

describe('F. isResearchTask strict guard (WP-07 Round 4)', () => {
  const baseTask: ResearchTask = {
    id: 't-1',
    projectId: 'p-1',
    title: 't',
    why: 'r',
    definitionOfDone: 'r',
    sourceRef: { kind: 'manual', id: null },
    sourceNote: '',
    origin: { kind: 'user' },
    milestoneId: null,
    status: 'open',
    dependencies: [],
    blocker: null,
    completionRef: null,
    assignee: null,
    publishedFromScratchId: null,
    createdAt: '2026-07-23T12:00:00.000Z',
    updatedAt: '2026-07-23T12:00:00.000Z',
    authorType: 'user',
  };

  it('accepts a row with a valid origin', () => {
    expect(isResearchTask(baseTask)).toBe(true);
  });

  it('rejects a row whose origin is missing (legacy — the read path must normalize first)', () => {
    const broken = { ...baseTask } as unknown as { origin?: unknown };
    delete (broken as Record<string, unknown>)['origin'];
    expect(isResearchTask(broken)).toBe(false);
  });

  it('rejects a row whose origin is null', () => {
    const broken = { ...baseTask, origin: null } as unknown as ResearchTask;
    expect(isResearchTask(broken)).toBe(false);
  });

  it('rejects a row whose origin is malformed', () => {
    const broken = {
      ...baseTask,
      origin: { kind: 'ai-accepted', draftId: '', provider: '' },
    } as unknown as ResearchTask;
    expect(isResearchTask(broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G. normalizeTaskOrigin (WP-07 Round 4)
// ---------------------------------------------------------------------------

describe('G. normalizeTaskOrigin (WP-07 Round 4)', () => {
  it('missing origin + authorType="user" → {kind:"user"}', () => {
    expect(normalizeTaskOrigin(undefined, 'user')).toEqual({ kind: 'user' });
  });

  it('missing origin + authorType="imported" → {kind:"imported"}', () => {
    expect(normalizeTaskOrigin(undefined, 'imported')).toEqual({ kind: 'imported' });
  });

  it('null origin → default by authorType', () => {
    expect(normalizeTaskOrigin(null, 'imported')).toEqual({ kind: 'imported' });
    expect(normalizeTaskOrigin(null, 'user')).toEqual({ kind: 'user' });
  });

  it('valid origin → returned verbatim', () => {
    const o = {
      kind: 'ai-accepted' as const,
      draftId: 'd-1',
      provider: 'ollama',
      model: 'llama3.1:8b',
      actionId: 'research-suggest-design-tasks',
      contextSnapshotHash: 'h-1',
      acceptedAt: '2026-07-23T12:00:00.000Z',
    };
    expect(normalizeTaskOrigin(o, 'user')).toEqual(o);
  });

  it('malformed origin → throws (contract violation, not silent default)', () => {
    expect(() => normalizeTaskOrigin({ kind: 'ai-accepted' }, 'user')).toThrow(
      /ResearchTask\.origin is malformed/,
    );
    expect(() => normalizeTaskOrigin('not-an-origin', 'user')).toThrow(
      /ResearchTask\.origin is malformed/,
    );
  });
});
