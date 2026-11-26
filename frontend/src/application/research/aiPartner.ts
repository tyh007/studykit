/**
 * StudyKit v0.5 P4 — the project AI as a thinking partner (ADR-003 §4–§6).
 *
 * Principles from the v0.5 strategy:
 *
 *   - Small steps. One counterexample, one missing piece of evidence or
 *     one alternative at a time, ending with a question back.
 *   - Think first, then look (“先想再看”). “What am I missing?” asks for
 *     the user's own ideas first. Skipping is allowed and recorded.
 *   - One “Challenge” button with roles (“挑刺”): skeptic, methods
 *     reviewer, outside reader, second examiner.
 *   - Nothing the AI says becomes part of the project without a click.
 *     Suggestions arrive as draft cards; applying or dismissing one is
 *     an append-only decision record.
 *
 * Threads are shared with project members by default. Messages are
 * append-only and store exactly the context the model was sent.
 */

import {
  AI_CONTEXT_MAX_EXCERPT,
  AI_MESSAGE_MAX_BODY,
  type AiContextRef,
  type AiDraftDecision,
  type AiDraftProposal,
  type AiMessage,
  type AiMove,
  type AiRole,
  type AiThread,
} from '../../domain/aiThread';
import { nowIso } from '../../domain/research';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import { normaliseProviderError } from '../../features/ai/kernel/providerRouter';
import type { ResearchRepository } from './researchRepository';
import { addPoint } from './argument';
import { isPublished, publishThread, type AiSyncPort } from './aiSync';

// ---------------------------------------------------------------------------
// Roles and copy
// ---------------------------------------------------------------------------

export const AI_ROLES: readonly { readonly id: AiRole; readonly label: string; readonly brief: string }[] = [
  {
    id: 'skeptic',
    label: 'Skeptic',
    brief: 'Doubt the strongest-looking claim. Offer one concrete counterexample or alternative explanation.',
  },
  {
    id: 'methods',
    label: 'Methods reviewer',
    brief: 'Look at how the evidence was produced. Name one design, sample or measurement problem that would weaken it.',
  },
  {
    id: 'outsider',
    label: 'Outside reader',
    brief: 'Read as a smart person from another field. Point to one step that is unclear or assumed without saying so.',
  },
  {
    id: 'examiner',
    label: 'Second examiner',
    brief: 'Read as a thesis examiner. Name the one question you would ask at the defence that the argument cannot yet answer.',
  },
];

export function roleLabel(role: AiRole): string {
  return AI_ROLES.find((r) => r.id === role)?.label ?? role;
}

const BASE_SYSTEM = [
  'You are a thinking partner inside a researcher’s project, not a ghostwriter.',
  'Reply in at most three short sentences and take one small step: one counterexample, one missing piece of evidence, or one alternative.',
  'End with a single question back to the researcher.',
  'Do not write paragraphs of their paper unless they explicitly ask for wording.',
  'Use only what is in the project context below; when you go beyond it, say so plainly.',
  'If, and only if, you think a new point belongs in their argument, add at the very end a block exactly like:',
  '```suggestions',
  '{"points": ["one-sentence point"]}',
  '```',
  'with at most two points. Otherwise add nothing.',
].join('\n');

// ---------------------------------------------------------------------------
// Prompt building (pure)
// ---------------------------------------------------------------------------

export interface PartnerRequest {
  readonly move: AiMove;
  readonly prompt: string;
  readonly role?: AiRole;
  /** For “What am I missing?”: the user's own ideas, one per line. */
  readonly ownIdeas?: string;
  readonly context: readonly AiContextRef[];
}

export function contextBlock(context: readonly AiContextRef[]): string {
  if (context.length === 0) return 'Project context: (none shared)';
  return [
    'Project context:',
    ...context.map((c) => `## ${c.label}${c.excerpt ? `\n${c.excerpt}` : ''}`),
  ].join('\n');
}

/** The user turn as stored in the thread (what the user sees). */
export function userMessageBody(req: PartnerRequest): string {
  const prompt = req.prompt.trim();
  switch (req.move) {
    case 'challenge':
      return prompt || `Challenge this as the ${roleLabel(req.role ?? 'skeptic').toLowerCase()}.`;
    case 'missing': {
      const ideas = req.ownIdeas?.trim();
      return ideas ? `My ideas so far:\n${ideas}\n\nWhat am I missing?` : 'What am I missing? (I skipped writing my own ideas first.)';
    }
    default:
      return prompt;
  }
}

/** The instruction for this turn, appended to the system prompt. */
export function moveInstruction(req: PartnerRequest): string {
  switch (req.move) {
    case 'challenge': {
      const role = AI_ROLES.find((r) => r.id === (req.role ?? 'skeptic')) ?? AI_ROLES[0]!;
      return `Speak as the ${role.label.toLowerCase()}. ${role.brief} One or two sentences, then your question.`;
    }
    case 'missing':
      return req.ownIdeas?.trim()
        ? 'The researcher listed their own ideas. Name at most two directions they have not covered. Do not repeat or polish theirs.'
        : 'The researcher chose to see directions before writing their own. Name at most three, briefly, and invite them to add their own.';
    default:
      return 'Answer the question in one small step.';
  }
}

export function buildPartnerMessages(
  req: PartnerRequest,
  history: readonly AiMessage[],
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const past = history
    .filter((m) => m.status === 'complete')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.body }));
  return [
    { role: 'system', content: `${BASE_SYSTEM}\n\n${moveInstruction(req)}\n\n${contextBlock(req.context)}` },
    ...past,
    { role: 'user', content: userMessageBody(req) },
  ];
}

// ---------------------------------------------------------------------------
// Reply parsing (pure)
// ---------------------------------------------------------------------------

const SUGGESTIONS_BLOCK = /```(?:suggestions|json)\s*([\s\S]*?)```\s*$/;

/**
 * Split a reply into the text shown to the user and draft cards. A
 * malformed suggestions block is dropped from the text and ignored.
 */
export function parsePartnerReply(
  content: string,
  makeDraftId: () => string,
  projectId: string,
): { body: string; drafts: AiDraftProposal[] } {
  const match = SUGGESTIONS_BLOCK.exec(content.trim());
  if (!match) return { body: content.trim(), drafts: [] };
  const body = content.trim().slice(0, match.index).trim();
  let points: string[] = [];
  try {
    const parsed = JSON.parse(match[1] ?? '') as { points?: unknown };
    if (Array.isArray(parsed.points)) {
      points = parsed.points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim());
    }
  } catch {
    points = [];
  }
  const drafts = points.slice(0, 2).map(
    (title): AiDraftProposal => ({
      draftId: makeDraftId(),
      actionId: 'add-point',
      target: { kind: 'argument', id: projectId },
      summary: title.length > 200 ? `${title.slice(0, 200)}…` : title,
      args: { title: title.slice(0, 500) },
    }),
  );
  return { body, drafts };
}

/** Keep a context excerpt within the stored limit. */
export function clampExcerpt(text: string): string {
  return text.length > AI_CONTEXT_MAX_EXCERPT ? `${text.slice(0, AI_CONTEXT_MAX_EXCERPT - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

export interface PartnerDeps {
  readonly idFactory?: (prefix: string) => string;
  /** The signed-in user's id, or 'local'. */
  readonly userId: string;
  /** P4b: sends shared threads to project members. Omit when not collaborating. */
  readonly sync?: AiSyncPort;
}

function id(deps: PartnerDeps, prefix: string): string {
  return deps.idFactory?.(prefix) ?? `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New conversation';
}

export async function createThread(
  repository: ResearchRepository,
  input: { projectId: string; title?: string; visibility?: AiThread['visibility'] },
  deps: PartnerDeps,
): Promise<AiThread> {
  const now = nowIso();
  const thread: AiThread = {
    id: id(deps, 'thr'),
    projectId: input.projectId,
    title: input.title?.trim() || 'New conversation',
    visibility: input.visibility ?? 'shared',
    createdBy: deps.userId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await repository.transact(async (tx) => tx.putAiThread(thread));
  return thread;
}

/** Private → shared only. Shared threads can't be made private again. */
export async function shareThread(
  repository: ResearchRepository,
  threadId: string,
  deps?: Pick<PartnerDeps, 'sync'>,
): Promise<AiThread> {
  const thread = await repository.getAiThread(threadId);
  if (!thread) throw new Error(`shareThread: thread ${threadId} not found.`);
  if (thread.visibility === 'shared') return thread;
  const next: AiThread = { ...thread, visibility: 'shared', updatedAt: nowIso() };
  await repository.transact(async (tx) => tx.putAiThread(next));
  // Sharing publishes the conversation so far (ADR-003 §5).
  return deps?.sync ? publishThread(repository, deps.sync, threadId) : next;
}

export async function renameThread(
  repository: ResearchRepository,
  threadId: string,
  title: string,
  deps?: Pick<PartnerDeps, 'sync'>,
): Promise<AiThread> {
  const thread = await repository.getAiThread(threadId);
  if (!thread) throw new Error(`renameThread: thread ${threadId} not found.`);
  const t = title.trim();
  if (!t) throw new Error('renameThread: a conversation needs a title.');
  const next: AiThread = { ...thread, title: t, updatedAt: nowIso() };
  await repository.transact(async (tx) => tx.putAiThread(next));
  if (deps?.sync?.hasMembers && isPublished(next)) deps.sync.record({ kind: 'ai-thread-updated', payload: next });
  return next;
}

export interface AskPartnerInput extends PartnerRequest {
  readonly projectId: string;
  /** Omit to start a new conversation. */
  readonly threadId?: string;
  readonly visibility?: AiThread['visibility'];
}

export interface AskPartnerResult {
  readonly thread: AiThread;
  readonly question: AiMessage;
  readonly reply: AiMessage;
}

/**
 * Post the user's turn and the partner's reply. The user's message is
 * written before the provider is called, so it survives a failure; a
 * failed call is recorded as a `failed` reply the user can retry.
 */
export async function askPartner(
  repository: ResearchRepository,
  router: ProviderRouter,
  input: AskPartnerInput,
  deps: PartnerDeps,
): Promise<AskPartnerResult> {
  const body = userMessageBody(input);
  if (!body) throw new Error('askPartner: write something first.');
  if (body.length > AI_MESSAGE_MAX_BODY) throw new Error('askPartner: that message is too long.');

  let thread = input.threadId ? await repository.getAiThread(input.threadId) : null;
  if (input.threadId && !thread) throw new Error(`askPartner: thread ${input.threadId} not found.`);
  if (thread && thread.projectId !== input.projectId) throw new Error('askPartner: thread belongs to another project.');
  const history = thread ? await repository.listAiMessages({ threadId: thread.id }) : [];
  const now = nowIso();
  let isNewThread = false;
  if (!thread) {
    isNewThread = true;
    const visibility = input.visibility ?? 'shared';
    thread = {
      id: id(deps, 'thr'),
      projectId: input.projectId,
      title: titleFrom(input.move === 'ask' ? input.prompt : body),
      visibility,
      createdBy: deps.userId,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      // Sent from the start when the project already has members.
      ...(visibility === 'shared' && deps.sync?.hasMembers ? { publishedAt: now } : {}),
    };
  }
  const context = input.context.map((c) => ({ ...c, excerpt: c.excerpt === null ? null : clampExcerpt(c.excerpt) }));
  const question: AiMessage = {
    id: id(deps, 'msg'),
    threadId: thread.id,
    projectId: input.projectId,
    role: 'user',
    authorId: deps.userId,
    body,
    context,
    drafts: [],
    provider: null,
    status: 'complete',
    move: input.move,
    ...(input.role ? { aiRole: input.role } : {}),
    ...(input.move === 'missing' && !input.ownIdeas?.trim() ? { skippedOwnThinking: true } : {}),
    createdAt: now,
  };
  const threadAtQuestion: AiThread = { ...thread, updatedAt: now };
  await repository.transact(async (tx) => {
    tx.putAiThread(threadAtQuestion);
    tx.appendAiMessage(question);
  });
  const sending = Boolean(deps.sync?.hasMembers) && isPublished(threadAtQuestion);
  if (sending) {
    if (isNewThread) deps.sync!.record({ kind: 'ai-thread-created', payload: threadAtQuestion });
    deps.sync!.record({ kind: 'ai-message-appended', payload: question });
  }

  let reply: AiMessage;
  try {
    const response = await router.chat({ messages: buildPartnerMessages({ ...input, context }, history) });
    const parsed = parsePartnerReply(response.content, () => id(deps, 'drf'), input.projectId);
    reply = {
      id: id(deps, 'msg'),
      threadId: thread.id,
      projectId: input.projectId,
      role: 'assistant',
      authorId: deps.userId,
      body: parsed.body.slice(0, AI_MESSAGE_MAX_BODY),
      context,
      drafts: parsed.drafts,
      provider: { id: response.provider, model: response.model ?? '' },
      status: 'complete',
      move: input.move,
      ...(input.role ? { aiRole: input.role } : {}),
      createdAt: nowIso(),
    };
  } catch (err) {
    reply = {
      id: id(deps, 'msg'),
      threadId: thread.id,
      projectId: input.projectId,
      role: 'assistant',
      authorId: deps.userId,
      body: normaliseProviderError(err).message,
      context,
      drafts: [],
      provider: null,
      status: 'failed',
      move: input.move,
      ...(input.role ? { aiRole: input.role } : {}),
      createdAt: nowIso(),
    };
  }
  const finalThread: AiThread = { ...threadAtQuestion, updatedAt: reply.createdAt };
  await repository.transact(async (tx) => {
    tx.putAiThread(finalThread);
    tx.appendAiMessage(reply);
  });
  if (sending) deps.sync!.record({ kind: 'ai-message-appended', payload: reply });
  return { thread: finalThread, question, reply };
}

/** Apply or dismiss a draft card. Applying runs the canonical use case. */
export async function decideDraft(
  repository: ResearchRepository,
  input: { message: AiMessage; draftId: string; decision: AiDraftDecision['decision'] },
  deps: PartnerDeps,
): Promise<AiDraftDecision> {
  const draft = input.message.drafts.find((d) => d.draftId === input.draftId);
  if (!draft) throw new Error(`decideDraft: draft ${input.draftId} not found.`);
  const earlier = await repository.listAiDraftDecisions({ threadId: input.message.threadId });
  if (earlier.some((d) => d.draftId === input.draftId)) throw new Error('decideDraft: this suggestion was already handled.');

  const resultRef: AiDraftDecision['resultRef'] =
    input.decision === 'applied' ? await AI_DRAFT_ACTIONS[draft.actionId](repository, draft, input.message) : null;
  const decision: AiDraftDecision = {
    id: id(deps, 'dec'),
    projectId: input.message.projectId,
    threadId: input.message.threadId,
    messageId: input.message.id,
    draftId: input.draftId,
    decision: input.decision,
    decidedBy: deps.userId,
    decidedAt: nowIso(),
    resultRef,
  };
  await repository.transact(async (tx) => tx.appendAiDraftDecision(decision));
  const thread = await repository.getAiThread(input.message.threadId);
  if (deps.sync?.hasMembers && thread && isPublished(thread)) deps.sync.record({ kind: 'ai-draft-decided', payload: decision });
  return decision;
}

/**
 * Everything a draft card can do, in one place. Applying a card is the
 * only path from AI text to the project, and each entry runs the same
 * canonical use case the user's own action would. (Thread drafts are
 * accepted here rather than through the capsule's ActionRegistry: they
 * are already drafts, and registering them there would surface them as
 * capsule chips.)
 */
export const AI_DRAFT_ACTIONS: Readonly<
  Record<
    AiDraftProposal['actionId'],
    (repository: ResearchRepository, draft: AiDraftProposal, message: AiMessage) => Promise<AiDraftDecision['resultRef']>
  >
> = {
  'add-point': async (repository, draft, message) => {
    const claim = await addPoint(repository, {
      projectId: message.projectId,
      title: draft.args.title ?? draft.summary,
      aiDraftId: draft.draftId,
    });
    return { kind: 'claim', id: claim.id };
  },
};
