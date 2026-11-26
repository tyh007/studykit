/**
 * StudyKit v0.5 P4 — project AI threads (ADR-003 §4).
 *
 * A thread belongs to a Research project and is shared with project
 * members by default. Messages are append-only: a reply is never
 * edited, regenerating writes a new message, and what happened to a
 * suggested draft is a separate decision record. `context` records
 * exactly what the model was sent, so every answer stays auditable.
 */

import type { ResearchSourceLocator } from './research';

export type AiThreadVisibility = 'shared' | 'private';

export interface AiThread {
  readonly id: string;
  readonly projectId: string;
  /** User-editable; defaults to the first prompt. */
  readonly title: string;
  readonly visibility: AiThreadVisibility;
  /** User id, or 'local' in a local-only workspace. */
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export type AiContextKind = 'project' | 'work' | 'evidence' | 'claim' | 'argument' | 'output' | 'note' | 'selection';

export interface AiContextRef {
  readonly kind: AiContextKind;
  readonly objectId: string | null;
  readonly label: string;
  readonly locator: ResearchSourceLocator | null;
  /** Exactly what the model was sent for this item, ≤ 2,000 chars. */
  readonly excerpt: string | null;
}

/** What the user asked the partner to do. */
export type AiMove = 'ask' | 'challenge' | 'missing';

/** A voice the partner speaks in when challenging (“挑刺”). */
export type AiRole = 'skeptic' | 'methods' | 'outsider' | 'examiner';

export interface AiDraftProposal {
  readonly draftId: string;
  /** What applying it does. P4 ships `add-point` only. */
  readonly actionId: 'add-point';
  readonly target: { readonly kind: 'argument'; readonly id: string };
  readonly summary: string;
  readonly args: Readonly<Record<string, string>>;
}

export interface AiMessage {
  readonly id: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly role: 'user' | 'assistant';
  /** The user who wrote it, or who requested the reply. AI never posts as itself. */
  readonly authorId: string;
  /** Markdown-ish plain text, ≤ 64 KiB. */
  readonly body: string;
  readonly context: readonly AiContextRef[];
  readonly drafts: readonly AiDraftProposal[];
  readonly provider: { readonly id: string; readonly model: string } | null;
  readonly status: 'complete' | 'failed' | 'cancelled';
  readonly move?: AiMove;
  readonly aiRole?: AiRole;
  /**
   * “Think first, then look”: true when the user asked for missing
   * directions without writing their own first. Recorded honestly,
   * never blocked.
   */
  readonly skippedOwnThinking?: boolean;
  readonly createdAt: string;
}

export interface AiDraftDecision {
  readonly id: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly draftId: string;
  readonly decision: 'applied' | 'rejected';
  readonly decidedBy: string;
  readonly decidedAt: string;
  /** The canonical object created or changed, when applied. */
  readonly resultRef: { readonly kind: string; readonly id: string } | null;
}

export const AI_MESSAGE_MAX_BODY = 64 * 1024;
export const AI_CONTEXT_MAX_EXCERPT = 2000;

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const iso = (v: unknown): boolean => str(v) && !Number.isNaN(Date.parse(v));

export function isAiThread(value: unknown): value is AiThread {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    str(v.id) &&
    str(v.projectId) &&
    typeof v.title === 'string' &&
    (v.visibility === 'shared' || v.visibility === 'private') &&
    str(v.createdBy) &&
    iso(v.createdAt) &&
    iso(v.updatedAt) &&
    (v.archivedAt === null || iso(v.archivedAt))
  );
}

function isContextRef(value: unknown): value is AiContextRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kind === 'string' &&
    (v.objectId === null || typeof v.objectId === 'string') &&
    typeof v.label === 'string' &&
    (v.locator === null || typeof v.locator === 'object') &&
    (v.excerpt === null || (typeof v.excerpt === 'string' && v.excerpt.length <= AI_CONTEXT_MAX_EXCERPT))
  );
}

function isDraftProposal(value: unknown): value is AiDraftProposal {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return str(v.draftId) && v.actionId === 'add-point' && typeof v.summary === 'string' && typeof v.args === 'object' && v.args !== null;
}

export function isAiMessage(value: unknown): value is AiMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!(str(v.id) && str(v.threadId) && str(v.projectId) && str(v.authorId) && iso(v.createdAt))) return false;
  if (v.role !== 'user' && v.role !== 'assistant') return false;
  if (typeof v.body !== 'string' || v.body.length > AI_MESSAGE_MAX_BODY) return false;
  if (!Array.isArray(v.context) || !v.context.every(isContextRef)) return false;
  if (!Array.isArray(v.drafts) || !v.drafts.every(isDraftProposal)) return false;
  if (v.role === 'user' && (v.drafts.length > 0 || v.provider !== null)) return false;
  if (v.status !== 'complete' && v.status !== 'failed' && v.status !== 'cancelled') return false;
  return true;
}

export function isAiDraftDecision(value: unknown): value is AiDraftDecision {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    str(v.id) &&
    str(v.projectId) &&
    str(v.threadId) &&
    str(v.messageId) &&
    str(v.draftId) &&
    (v.decision === 'applied' || v.decision === 'rejected') &&
    str(v.decidedBy) &&
    iso(v.decidedAt)
  );
}
