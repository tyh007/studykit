import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { askPartner, createThread, decideDraft, renameThread, shareThread } from './aiPartner';
import { aiApplyTarget, canPostShared, listUnsentSharedThreads, settleEarlierThreads, type AiSyncOp, type AiSyncPort } from './aiSync';
import { pullAndApply, __setClientIdForTests, __resetCursorsForTests } from '../collaboration/syncService';
import type { CollabGateway, CollabOp } from '../../lib/collab-api';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import { makeResearchProject } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
let repo: MemoryResearchRepository;
let n = 0;

function port(hasMembers = true): AiSyncPort & { ops: AiSyncOp[] } {
  const ops: AiSyncOp[] = [];
  return { hasMembers, ops, record: (op) => void ops.push(op) };
}

const router = (content = 'Small step?\n```suggestions\n{"points": ["P"]}\n```'): ProviderRouter => ({
  probe: async () => ({ aiAvailable: true, providerName: 'cloud' }),
  chat: async () => ({ content, provider: 'cloud', model: 'm' }),
});

const deps = (sync?: AiSyncPort) => ({ userId: 'u-a', idFactory: (p: string) => `${p}-${++n}`, ...(sync ? { sync } : {}) });
const kinds = (ops: readonly AiSyncOp[]): string[] => ops.map((o) => o.kind);

beforeEach(async () => {
  n = 0;
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => tx.putProject(makeResearchProject({ id: P })));
});

describe('sending shared threads', () => {
  it('sends nothing while the user is alone in the project', async () => {
    const sync = port(false);
    const { thread } = await askPartner(repo, router(), { projectId: P, move: 'ask', prompt: 'Hi', context: [] }, deps(sync));
    expect(sync.ops).toEqual([]);
    expect(thread.publishedAt).toBeUndefined();
  });

  it('sends a new shared thread and both turns when the project has members; never a private one', async () => {
    const sync = port();
    const { thread, reply } = await askPartner(repo, router(), { projectId: P, move: 'ask', prompt: 'Hi', context: [] }, deps(sync));
    expect(kinds(sync.ops)).toEqual(['ai-thread-created', 'ai-message-appended', 'ai-message-appended']);
    expect(thread.publishedAt).toBeDefined();

    await decideDraft(repo, { message: reply, draftId: reply.drafts[0]!.draftId, decision: 'rejected' }, deps(sync));
    await renameThread(repo, thread.id, 'Renamed', deps(sync));
    expect(kinds(sync.ops).slice(3)).toEqual(['ai-draft-decided', 'ai-thread-updated']);

    const priv = port();
    await askPartner(repo, router(), { projectId: P, move: 'ask', prompt: 'Mine', visibility: 'private', context: [] }, deps(priv));
    expect(priv.ops).toEqual([]);
  });

  it('sends the whole history when a private thread is shared', async () => {
    const { thread } = await askPartner(repo, router(), { projectId: P, move: 'ask', prompt: 'x', visibility: 'private', context: [] }, deps());
    const sync = port();
    const shared = await shareThread(repo, thread.id, deps(sync));
    expect(shared.publishedAt).toBeDefined();
    expect(kinds(sync.ops)).toEqual(['ai-thread-created', 'ai-message-appended', 'ai-message-appended']);
  });

  it('asks before sending earlier conversations: chosen ones go out, the rest turn private', async () => {
    const a = await askPartner(repo, router(), { projectId: P, move: 'ask', prompt: 'Keep', context: [] }, deps());
    const b = await askPartner(repo, router(), { projectId: P, move: 'ask', prompt: 'Hide', context: [] }, deps());
    await createThread(repo, { projectId: P, visibility: 'private' }, deps());
    expect((await listUnsentSharedThreads(repo, P, 'u-a')).map((t) => t.id).sort()).toEqual([a.thread.id, b.thread.id].sort());
    // Someone else's thread is never ours to publish.
    expect(await listUnsentSharedThreads(repo, P, 'u-other')).toEqual([]);

    const sync = port();
    await settleEarlierThreads(repo, sync, { projectId: P, userId: 'u-a', share: [a.thread.id] });
    expect(sync.ops.filter((o) => o.kind === 'ai-thread-created').map((o) => o.payload.id)).toEqual([a.thread.id]);
    expect(sync.ops.every((o) => o.kind === 'ai-thread-created' || ('threadId' in o.payload && o.payload.threadId === a.thread.id))).toBe(true);
    expect((await repo.getAiThread(b.thread.id))?.visibility).toBe('private');
    expect(await listUnsentSharedThreads(repo, P, 'u-a')).toEqual([]);
  });

  it('mirrors the server role rule', () => {
    expect(['owner', 'editor', null].map(canPostShared)).toEqual([true, true, true]);
    expect(['commenter', 'viewer'].map(canPostShared)).toEqual([false, false]);
  });
});

describe('receiving shared threads', () => {
  it('applies remote thread, message and decision ops once, and ignores private or malformed ones', async () => {
    // Another member's device produced these.
    const other = new MemoryResearchRepository();
    await other.transact(async (tx) => tx.putProject(makeResearchProject({ id: P })));
    const sync = port();
    const { thread, reply } = await askPartner(other, router(), { projectId: P, move: 'ask', prompt: 'From B', context: [] }, { userId: 'u-b', sync });
    await decideDraft(other, { message: reply, draftId: reply.drafts[0]!.draftId, decision: 'applied' }, { userId: 'u-b', sync });

    let i = 0;
    const toOp = (o: AiSyncOp): CollabOp => ({
      id: `op-${++i}`,
      clientId: 'cli-b',
      projectId: P,
      kind: o.kind,
      payload: JSON.stringify(o.payload),
      createdAt: new Date(Date.now() + i).toISOString(),
    });
    const ops = [
      ...sync.ops.map(toOp),
      ...sync.ops.map(toOp), // duplicates, e.g. a resend
      toOp({ kind: 'ai-thread-created', payload: { ...thread, id: 'thr-private', visibility: 'private' } }),
      { ...toOp(sync.ops[1]!), payload: '{"not":"a message"}' },
    ];
    const gateway = { id: 'memory', pullOps: vi.fn(async () => ({ ops, cursor: 'c' })) } as unknown as CollabGateway;
    __setClientIdForTests('cli-a');
    __resetCursorsForTests();
    await pullAndApply(
      {
        gateway,
        localUserId: 'u-a',
        collabRepository: {} as never,
        researchRepository: { upsertTask: async () => undefined, getTask: async () => null, ...aiApplyTarget(repo) },
      },
      P,
    );
    const threads = await repo.listAiThreads({ projectId: P });
    expect(threads.map((t) => t.id)).toEqual([thread.id]);
    expect(threads[0]!.publishedAt).toBeDefined();
    expect((await repo.listAiMessages({ threadId: thread.id })).map((m) => m.authorId)).toEqual(['u-b', 'u-b']);
    expect(await repo.listAiDraftDecisions({ threadId: thread.id })).toHaveLength(1);
    // The decision is recorded; the point it created stays on B's device.
    expect(await repo.listClaims({ projectId: P })).toHaveLength(0);
  });
});
