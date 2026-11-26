import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import {
  askPartner,
  buildPartnerMessages,
  createThread,
  decideDraft,
  parsePartnerReply,
  shareThread,
  userMessageBody,
} from './aiPartner';
import { contextForFocus } from './aiContext';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import type { AiContextRef } from '../../domain/aiThread';
import {
  makeClaim,
  makeClaimEvidenceLink,
  makeEvidence,
  makeResearchLocator,
  makeResearchProject,
} from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
let repo: MemoryResearchRepository;
let n = 0;
const deps = { userId: 'u-1', idFactory: (prefix: string) => `${prefix}-${++n}` };

function router(reply: string | Error): ProviderRouter & { chat: ReturnType<typeof vi.fn> } {
  return {
    probe: async () => ({ aiAvailable: true, providerName: 'cloud' }),
    chat: vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return { content: reply, provider: 'cloud' as const, model: 'm' };
    }),
  } as ProviderRouter & { chat: ReturnType<typeof vi.fn> };
}

const ctx: AiContextRef[] = [{ kind: 'project', objectId: null, label: 'Your question', locator: null, excerpt: 'Does sleep help memory?' }];

beforeEach(async () => {
  n = 0;
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => tx.putProject(makeResearchProject({ id: P })));
});

describe('askPartner', () => {
  it('starts a shared thread, stores both turns with the exact context, and survives a restart', async () => {
    const r = router('One study only used young adults. Does your claim hold for older people?');
    const result = await askPartner(repo, r, { projectId: P, move: 'ask', prompt: 'Is my argument convincing?', context: ctx }, deps);
    expect(result.thread).toMatchObject({ visibility: 'shared', title: 'Is my argument convincing?', createdBy: 'u-1' });
    const messages = await repo.listAiMessages({ threadId: result.thread.id });
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'complete'],
      ['assistant', 'complete'],
    ]);
    expect(messages[1]).toMatchObject({ authorId: 'u-1', provider: { id: 'cloud', model: 'm' }, context: ctx });
    // The system prompt carries the context and the small-step rule.
    const sent = r.chat.mock.calls[0]![0].messages;
    expect(sent[0].content).toContain('Does sleep help memory?');
    expect(sent[0].content).toContain('at most three short sentences');
  });

  it('keeps the question and records a failed reply when the provider fails', async () => {
    const result = await askPartner(repo, router(new Error('Ollama is not running')), { projectId: P, move: 'ask', prompt: 'Hi', context: [] }, deps);
    expect(result.reply).toMatchObject({ status: 'failed', body: 'Ollama is not running', provider: null });
    expect(await repo.listAiMessages({ threadId: result.thread.id })).toHaveLength(2);
  });

  it('sends earlier turns as history and continues the same thread', async () => {
    const r = router('Next step.');
    const first = await askPartner(repo, r, { projectId: P, move: 'ask', prompt: 'First', context: [] }, deps);
    await askPartner(repo, r, { projectId: P, threadId: first.thread.id, move: 'ask', prompt: 'Second', context: [] }, deps);
    const sent = r.chat.mock.calls[1]![0].messages.map((m: { role: string; content: string }) => [m.role, m.content]);
    expect(sent.slice(1)).toEqual([
      ['user', 'First'],
      ['assistant', 'Next step.'],
      ['user', 'Second'],
    ]);
    expect(await repo.listAiThreads({ projectId: P })).toHaveLength(1);
  });

  it('records honestly when the user skipped “think first”', async () => {
    const r = router('Consider circadian timing.');
    const skipped = await askPartner(repo, r, { projectId: P, move: 'missing', prompt: '', context: [] }, deps);
    expect(skipped.question.skippedOwnThinking).toBe(true);
    const own = await askPartner(repo, r, { projectId: P, move: 'missing', prompt: '', ownIdeas: 'naps\nREM', context: [] }, deps);
    expect(own.question.skippedOwnThinking).toBeUndefined();
    expect(own.question.body).toBe('My ideas so far:\nnaps\nREM\n\nWhat am I missing?');
    expect(r.chat.mock.calls[1]![0].messages[0].content).toContain('Do not repeat or polish theirs');
  });

  it('speaks in the chosen challenge role', () => {
    const msgs = buildPartnerMessages({ move: 'challenge', prompt: '', role: 'methods', context: [] }, []);
    expect(msgs[0]!.content).toContain('methods reviewer');
    expect(userMessageBody({ move: 'challenge', prompt: '', role: 'methods', context: [] })).toBe('Challenge this as the methods reviewer.');
  });
});

describe('draft cards', () => {
  it('turns a suggestions block into cards and strips it from the text', () => {
    let i = 0;
    const parsed = parsePartnerReply(
      'Your second point lacks a mechanism. What drives it?\n```suggestions\n{"points": ["Slow-wave sleep replays memories", "", 3]}\n```',
      () => `d${++i}`,
      P,
    );
    expect(parsed.body).toBe('Your second point lacks a mechanism. What drives it?');
    expect(parsed.drafts).toEqual([
      { draftId: 'd1', actionId: 'add-point', target: { kind: 'argument', id: P }, summary: 'Slow-wave sleep replays memories', args: { title: 'Slow-wave sleep replays memories' } },
    ]);
    expect(parsePartnerReply('No block here.', () => 'x', P)).toEqual({ body: 'No block here.', drafts: [] });
    expect(parsePartnerReply('Text\n```suggestions\nnot json\n```', () => 'x', P)).toEqual({ body: 'Text', drafts: [] });
  });

  it('writes nothing until applied, then adds an AI-suggested point and records the decision once', async () => {
    const r = router('Try this.\n```suggestions\n{"points": ["Naps help too"]}\n```');
    const { reply } = await askPartner(repo, r, { projectId: P, move: 'ask', prompt: 'Ideas?', context: [] }, deps);
    expect(await repo.listClaims({ projectId: P })).toHaveLength(0);

    const decision = await decideDraft(repo, { message: reply, draftId: reply.drafts[0]!.draftId, decision: 'applied' }, deps);
    const [claim] = await repo.listClaims({ projectId: P });
    expect(claim).toMatchObject({ title: 'Naps help too', aiSuggested: true, authorType: 'ai', draftId: reply.drafts[0]!.draftId });
    expect(decision).toMatchObject({ decision: 'applied', decidedBy: 'u-1', resultRef: { kind: 'claim', id: claim!.id } });
    await expect(
      decideDraft(repo, { message: reply, draftId: reply.drafts[0]!.draftId, decision: 'rejected' }, deps),
    ).rejects.toThrow(/already handled/);
  });

  it('records a dismissal without touching the project', async () => {
    const r = router('Hm.\n```suggestions\n{"points": ["X"]}\n```');
    const { reply } = await askPartner(repo, r, { projectId: P, move: 'ask', prompt: '?', context: [] }, deps);
    const d = await decideDraft(repo, { message: reply, draftId: reply.drafts[0]!.draftId, decision: 'rejected' }, deps);
    expect(d.resultRef).toBeNull();
    expect(await repo.listClaims({ projectId: P })).toHaveLength(0);
  });
});

describe('threads', () => {
  it('can be made shared but never private again, and messages are append-only', async () => {
    const t = await createThread(repo, { projectId: P, visibility: 'private' }, deps);
    expect((await shareThread(repo, t.id)).visibility).toBe('shared');
    const msg = { id: 'm-1', threadId: t.id, projectId: P, role: 'user' as const, authorId: 'u-1', body: 'x', context: [], drafts: [], provider: null, status: 'complete' as const, createdAt: new Date().toISOString() };
    await repo.transact(async (tx) => tx.appendAiMessage(msg));
    await expect(repo.transact(async (tx) => tx.appendAiMessage({ ...msg, body: 'edited' }))).rejects.toThrow(/append-only/);
  });

  it('deleting a thread removes its messages', async () => {
    const { thread } = await askPartner(repo, router('ok'), { projectId: P, move: 'ask', prompt: 'x', context: [] }, deps);
    await repo.transact(async (tx) => tx.deleteAiThread(thread.id));
    expect(await repo.listAiMessages({ projectId: P })).toHaveLength(0);
  });
});

describe('contextForFocus', () => {
  const src = {
    projectName: 'Sleep',
    question: 'Does sleep help memory?',
    works: [{ id: 'w-1', title: 'Walker 2004' }],
    outputs: [],
    claims: [makeClaim({ id: 'c-1', projectId: P, title: 'Sleep helps', body: '' })],
    evidence: [makeEvidence({ id: 'e-1', projectId: P, workId: 'w-1', exactQuote: 'Recall rose.', userInterpretation: 'Supports it', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 4 }) })],
    links: [makeClaimEvidenceLink({ projectId: P, claimId: 'c-1', evidenceId: 'e-1' })],
  };

  it('follows the open editor, then the project question', () => {
    const arg = contextForFocus(src, { kind: 'argument', id: P });
    expect(arg.map((r) => r.label)).toEqual(['Your argument', 'Your question']);
    expect(arg[0]!.excerpt).toContain('1. Sleep helps');
    expect(arg[0]!.excerpt).toContain('Why it holds: (empty)');
    const work = contextForFocus(src, { kind: 'work', id: 'w-1' });
    expect(work[0]).toMatchObject({ kind: 'work', label: 'Walker 2004' });
    expect(work[0]!.excerpt).toContain('“Recall rose.”, p. 4 — Supports it');
    expect(contextForFocus(src, null).map((r) => r.label)).toEqual(['Your points', 'Your question']);
  });
});
