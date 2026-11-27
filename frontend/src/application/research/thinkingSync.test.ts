/**
 * v0.5 P5b — brainstorms and disagreements between two members' devices.
 * Device A pushes; its ops go through `pullAndApply` into device B.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import {
  addIdea,
  addPosition,
  attachEvidence,
  editIdea,
  openDisagreement,
  revealIdeas,
  setBrainstormMode,
  settleDisagreement,
  startBrainstorm,
} from './brainstorm';
import { addPoint } from './argument';
import { memoryMarks, pushThinking, thinkingAccess, thinkingApplyTarget, type SyncMarks, type ThinkingAccess, type ThinkingOp } from './thinkingSync';
import { pullAndApply, __setClientIdForTests, __resetCursorsForTests } from '../collaboration/syncService';
import type { CollabGateway, CollabOp } from '../../lib/collab-api';
import { makeEvidence, makeResearchLocator, makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
let a: MemoryResearchRepository;
let b: MemoryResearchRepository;
let marksA: SyncMarks;
let marksB: SyncMarks;
let n = 0;
let opN = 0;

const deps = (userId: string) => ({ userId, idFactory: (p: string) => `${p}-${++n}` });

async function seed(repo: MemoryResearchRepository, withEvidence: boolean): Promise<void> {
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P }));
    if (withEvidence) {
      tx.putWork(makeWork({ id: 'w-1', title: 'Walker 2004', projectIds: [P] }));
      tx.putEvidence(
        makeEvidence({ id: 'e-1', projectId: P, workId: 'w-1', status: 'verified', exactQuote: 'Only students were tested.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 11 }) }),
      );
    }
  });
}

async function push(repo: MemoryResearchRepository, marks: SyncMarks, userId: string, access: ThinkingAccess = 'manage'): Promise<ThinkingOp[]> {
  const ops: ThinkingOp[] = [];
  await pushThinking(repo, { record: (op) => void ops.push(op) }, marks, { projectId: P, userId, access });
  return ops;
}

/** Deliver ops from another client into `repo`, as the inbox would. */
async function deliver(ops: readonly ThinkingOp[], repo: MemoryResearchRepository, marks: SyncMarks): Promise<void> {
  const collabOps: CollabOp[] = ops.map((o) => ({
    id: `op-${++opN}`,
    clientId: 'cli-other',
    projectId: P,
    kind: o.kind,
    payload: JSON.stringify(o.payload),
    createdAt: new Date(Date.now() + opN).toISOString(),
  }));
  const gateway = { id: 'memory', pullOps: vi.fn(async () => ({ ops: collabOps, cursor: 'c' })) } as unknown as CollabGateway;
  __resetCursorsForTests();
  await pullAndApply(
    {
      gateway,
      localUserId: 'me',
      collabRepository: {} as never,
      researchRepository: { upsertTask: async () => undefined, getTask: async () => null, ...thinkingApplyTarget(repo, () => marks) },
    },
    P,
  );
}

const kinds = (ops: readonly ThinkingOp[]): string[] => ops.map((o) => o.kind);

beforeEach(async () => {
  n = 0;
  a = new MemoryResearchRepository();
  b = new MemoryResearchRepository();
  marksA = memoryMarks();
  marksB = memoryMarks();
  await seed(a, true);
  await seed(b, false);
  __setClientIdForTests('cli-me');
});

describe('who may send what', () => {
  it('maps roles to access the same way as the server', () => {
    expect(thinkingAccess(null)).toBe('manage');
    expect(thinkingAccess('owner')).toBe('manage');
    expect(thinkingAccess('editor')).toBe('manage');
    expect(thinkingAccess('commenter')).toBe('contribute');
    expect(thinkingAccess('viewer')).toBe('read');
  });
});

describe('brainwriting between two devices', () => {
  it('sends group brainstorms and ideas, never solo ones, and does not echo what it received', async () => {
    const solo = await startBrainstorm(a, { projectId: P, prompt: 'Mine' }, deps('u-a'));
    await addIdea(a, { brainstormId: solo.id, text: 'Private thought' }, deps('u-a'));
    const g = await startBrainstorm(a, { projectId: P, prompt: 'Why?' }, deps('u-a'));
    await setBrainstormMode(a, g.id, 'group', deps('u-a'));
    await addIdea(a, { brainstormId: g.id, text: 'Replay' }, deps('u-a'));

    const first = await push(a, marksA, 'u-a');
    expect(kinds(first)).toEqual(['brainstorm-saved', 'idea-saved']);
    expect(await push(a, marksA, 'u-a')).toEqual([]); // nothing changed

    await deliver(first, b, marksB);
    expect((await b.listBrainstorms({ projectId: P })).map((x) => x.id)).toEqual([g.id]);
    // B received these; pushing from B sends nothing back.
    expect(await push(b, marksB, 'u-b')).toEqual([]);

    // B (a commenter) adds an idea of their own: only that goes out.
    await addIdea(b, { brainstormId: g.id, text: 'Less interference' }, deps('u-b'));
    const fromB = await push(b, marksB, 'u-b', 'contribute');
    expect(kinds(fromB)).toEqual(['idea-saved']);
    await deliver(fromB, a, marksA);
    expect((await a.listIdeas({ brainstormId: g.id })).map((i) => i.text).sort()).toEqual(['Less interference', 'Replay']);

    // A reveals; B learns of it. An edit and a removal on A follow.
    await revealIdeas(a, g.id, deps('u-a'));
    const replay = (await a.listIdeas({ brainstormId: g.id })).find((i) => i.text === 'Replay')!;
    await editIdea(a, replay.id, '', g.id, deps('u-a')); // emptying an idea removes it
    const later = await push(a, marksA, 'u-a');
    expect(kinds(later)).toEqual(['brainstorm-saved', 'idea-removed']);
    await deliver(later, b, marksB);
    expect((await b.getBrainstorm(g.id))?.revealedAt).toBeDefined();
    expect((await b.listIdeas({ brainstormId: g.id })).map((i) => i.text)).toEqual(['Less interference']);
  });

  it('a commenter never sends other members’ ideas, and a viewer sends nothing', async () => {
    const g = await startBrainstorm(a, { projectId: P, prompt: 'Why?' }, deps('u-a'));
    await setBrainstormMode(a, g.id, 'group', deps('u-a'));
    await addIdea(a, { brainstormId: g.id, text: 'By A' }, deps('u-a'));
    await addIdea(a, { brainstormId: g.id, text: 'By C' }, deps('u-c'));
    expect(kinds(await push(a, memoryMarks(), 'u-c', 'contribute'))).toEqual(['idea-saved']);
    expect(await push(a, memoryMarks(), 'u-v', 'read')).toEqual([]);
  });
});

describe('disagreements between two devices', () => {
  it('carries the point title and excerpt copies, so B sees them without A’s sources', async () => {
    const point = await addPoint(a, { projectId: P, title: 'Sleep helps memory' });
    const d = await openDisagreement(a, { projectId: P, claimId: point.id, question: 'Older adults?' }, deps('u-a'));
    const pos = await addPosition(a, { disagreementId: d.id, stance: 'No, only students', holder: 'Supervisor' }, deps('u-a'));
    await attachEvidence(a, { disagreementId: d.id, positionId: pos.id, evidenceId: 'e-1' });

    const ops = await push(a, marksA, 'u-a');
    expect(kinds(ops)).toEqual(['disagreement-saved', 'disagreement-position-saved']);
    await deliver(ops, b, marksB);
    expect((await b.getDisagreement(d.id))?.pointTitle).toBe('Sleep helps memory');
    const [received] = await b.listDisagreementPositions({ disagreementId: d.id });
    expect(received?.citations).toEqual([{ evidenceId: 'e-1', quote: 'Only students were tested.', source: 'Walker 2004', pageNumber: 11 }]);
  });

  it('never reopens a settled disagreement from a stale copy', async () => {
    const d = await openDisagreement(a, { projectId: P, question: 'Older adults?' }, deps('u-a'));
    await addPosition(a, { disagreementId: d.id, stance: 'Both in part' }, deps('u-a'));
    const openOps = await push(a, marksA, 'u-a');
    await settleDisagreement(a, { disagreementId: d.id, summary: 'Narrow it', positionId: null }, deps('u-a'));
    const settledOps = await push(a, marksA, 'u-a');
    await deliver(settledOps, b, marksB);
    await deliver(openOps.filter((o) => o.kind === 'disagreement-saved'), b, marksB); // arrives late
    expect((await b.getDisagreement(d.id))?.status).toBe('settled');
  });
});
