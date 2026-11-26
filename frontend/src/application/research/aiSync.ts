/**
 * StudyKit v0.5 P4b — sending shared AI threads to project members
 * (ADR-003 §5).
 *
 * Rules:
 *
 *   - Private threads never leave the device.
 *   - A shared thread is sent only while the project has other members.
 *     Threads written while the user was alone wait: when members
 *     arrive, the user picks which earlier conversations to share
 *     (the rest become private) before anything is sent. The server
 *     keeps the op log, so a later joiner would otherwise see them all.
 *   - Once sent (`publishedAt`), every new message and draft decision in
 *     the thread follows. Making a private thread shared sends its whole
 *     history. Shared never turns private again.
 *   - Only owners and editors post; commenters and viewers read.
 *
 * Ops go through the collaboration outbox right after the local write.
 * They are idempotent (op id), retried by the drain, and re-checked by
 * the server.
 */

import { nowIso } from '../../domain/research';
import type { AiDraftDecision, AiMessage, AiThread } from '../../domain/aiThread';
import type { ResearchRepository } from './researchRepository';
import { isCollaboratorRole } from '../../domain/collaboration';
import { capabilitiesForRole } from '../collaboration/permissionMatrix';

export type AiSyncOp =
  | { readonly kind: 'ai-thread-created' | 'ai-thread-updated'; readonly payload: AiThread }
  | { readonly kind: 'ai-message-appended'; readonly payload: AiMessage }
  | { readonly kind: 'ai-draft-decided'; readonly payload: AiDraftDecision };

export interface AiSyncPort {
  /** True while the project has members other than the current user. */
  readonly hasMembers: boolean;
  /** Append an op to the collaboration outbox (best effort, never throws). */
  record(op: AiSyncOp): void;
}

/**
 * May this role post in shared threads? Not collaborating (null) means
 * the user's own project. Mirrors the server's ROLE_ALLOWED_OPS.
 */
export function canPostShared(role: string | null): boolean {
  if (role === null) return true;
  return isCollaboratorRole(role) && capabilitiesForRole(role).includes('ai-thread.post');
}

export function isPublished(thread: AiThread): boolean {
  return thread.visibility === 'shared' && typeof thread.publishedAt === 'string';
}

/** Send a whole shared thread for the first time: the thread, then its history. */
export async function publishThread(
  repository: ResearchRepository,
  sync: AiSyncPort,
  threadId: string,
): Promise<AiThread> {
  const thread = await repository.getAiThread(threadId);
  if (!thread) throw new Error(`publishThread: thread ${threadId} not found.`);
  if (thread.visibility !== 'shared') throw new Error('publishThread: only shared conversations are sent.');
  if (!sync.hasMembers || isPublished(thread)) return thread;
  const next: AiThread = { ...thread, publishedAt: nowIso() };
  await repository.transact(async (tx) => tx.putAiThread(next));
  const [messages, decisions] = await Promise.all([
    repository.listAiMessages({ threadId }),
    repository.listAiDraftDecisions({ threadId }),
  ]);
  sync.record({ kind: 'ai-thread-created', payload: next });
  for (const m of messages) sync.record({ kind: 'ai-message-appended', payload: m });
  for (const d of decisions) sync.record({ kind: 'ai-draft-decided', payload: d });
  return next;
}

/** Shared threads this user wrote that have never been sent. */
export async function listUnsentSharedThreads(
  repository: ResearchRepository,
  projectId: string,
  userId: string,
): Promise<AiThread[]> {
  const threads = await repository.listAiThreads({ projectId });
  return threads.filter((t) => t.visibility === 'shared' && !t.publishedAt && t.createdBy === userId);
}

/**
 * The one-time choice when a project gains members: send the chosen
 * earlier conversations, make the others private. Nothing was sent
 * before, so turning those private is honest.
 */
export async function settleEarlierThreads(
  repository: ResearchRepository,
  sync: AiSyncPort,
  input: { projectId: string; userId: string; share: readonly string[] },
): Promise<void> {
  if (!sync.hasMembers) return;
  const pending = await listUnsentSharedThreads(repository, input.projectId, input.userId);
  const keep = new Set(input.share);
  const now = nowIso();
  const toPrivate = pending.filter((t) => !keep.has(t.id));
  if (toPrivate.length > 0) {
    await repository.transact(async (tx) => {
      for (const t of toPrivate) tx.putAiThread({ ...t, visibility: 'private', updatedAt: now });
    });
  }
  for (const t of pending) if (keep.has(t.id)) await publishThread(repository, sync, t.id);
}

/**
 * How rows received from other members land locally. A received thread
 * counts as sent, so this device never re-publishes it. Messages and
 * decisions are append-only: one that already exists is skipped.
 */
export function aiApplyTarget(repository: ResearchRepository): {
  applyAiThread(row: AiThread): Promise<void>;
  applyAiMessage(row: AiMessage): Promise<void>;
  applyAiDraftDecision(row: AiDraftDecision): Promise<void>;
} {
  return {
    async applyAiThread(row) {
      const existing = await repository.getAiThread(row.id);
      await repository.transact(async (tx) => {
        tx.putAiThread({ ...row, publishedAt: existing?.publishedAt ?? row.publishedAt ?? nowIso() });
      });
    },
    async applyAiMessage(row) {
      const existing = await repository.listAiMessages({ threadId: row.threadId });
      if (existing.some((m) => m.id === row.id)) return;
      await repository.transact(async (tx) => tx.appendAiMessage(row));
    },
    async applyAiDraftDecision(row) {
      const existing = await repository.listAiDraftDecisions({ threadId: row.threadId });
      if (existing.some((d) => d.id === row.id || d.draftId === row.draftId)) return;
      await repository.transact(async (tx) => tx.appendAiDraftDecision(row));
    },
  };
}
