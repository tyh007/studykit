/**
 * StudyKit v0.4 — `DraftStatus` and `AIDraft`
 *
 * Per the v0.4 decision log (D-008, D-016) and PRD §8.3:
 *   - AI must never silently modify canonical content.
 *   - Every AI change is first written to a Draft Layer.
 *   - The user accepts or edits the draft before it becomes canonical.
 *   - Every AI result keeps source scope, provider, model, action,
 *     timestamp, and accept/reject history.
 *
 * WP-00 only defines the *type* of that draft. The actual DraftLayer
 * store, Action Registry, and provenance recorder are introduced in
 * later Work Packets (WP-03 / WP-04 / WP-05).
 */

export type DraftStatus =
  | 'pending'     // Generated, waiting for the user
  | 'accepted'    // User accepted into canonical content
  | 'rejected'    // User rejected
  | 'superseded'; // Replaced by a newer draft for the same intent

export const DRAFT_STATUSES: readonly DraftStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'superseded',
] as const;

export function isDraftStatus(value: unknown): value is DraftStatus {
  return (
    value === 'pending' ||
    value === 'accepted' ||
    value === 'rejected' ||
    value === 'superseded'
  );
}

/** A textual description of what generated or proposed this draft. */
export type DraftOrigin =
  | { readonly kind: 'selection'; readonly objectId: string }
  | { readonly kind: 'intent-capsule'; readonly intentId: string }
  | { readonly kind: 'transition-suggestion'; readonly transitionId: string }
  | { readonly kind: 'background-job'; readonly jobId: string }
  | { readonly kind: 'imported' };

/** A handle to the canonical object the draft proposes to modify. */
export interface DraftTarget {
  /** Canonical object the draft will become when accepted. */
  readonly targetObjectId: string;
  /** What kind of canonical object the draft will produce. */
  readonly targetKind: DraftTargetKind;
}

/** The kinds of canonical object a draft can target. */
export type DraftTargetKind =
  | 'note'
  | 'concept'
  | 'question'
  | 'claim'
  | 'evidence'
  | 'task'
  | 'output';

export const DRAFT_TARGET_KINDS: readonly DraftTargetKind[] = [
  'note',
  'concept',
  'question',
  'claim',
  'evidence',
  'task',
  'output',
] as const;

export function isDraftTargetKind(value: unknown): value is DraftTargetKind {
  return (
    value === 'note' ||
    value === 'concept' ||
    value === 'question' ||
    value === 'claim' ||
    value === 'evidence' ||
    value === 'task' ||
    value === 'output'
  );
}

/**
 * Type guard for `DraftTarget`. Both `targetObjectId` (a non-empty
 * string) and `targetKind` (one of the declared `DraftTargetKind`
 * values) are required — a draft that does not name the object it
 * will modify is not a draft we can accept.
 */
export function isDraftTarget(value: unknown): value is DraftTarget {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.targetObjectId !== 'string' || v.targetObjectId.length === 0) return false;
  if (!isDraftTargetKind(v.targetKind)) return false;
  return true;
}

/**
 * The provenance block required by D-008. `sourceScope` is opaque here;
 * WP-03 will give it a richer shape (selection bounds, source locator,
 * pinned context ids, etc.). For WP-00 it is kept as a string list so the
 * contract is testable without dragging in the future Context Resolver.
 */
export interface DraftProvenance {
  readonly provider: string;        // e.g. "ollama", "openai", "human"
  readonly model?: string;          // e.g. "llama3.1:8b"
  readonly generatedAt: string;     // ISO timestamp
  readonly sourceScope: readonly string[]; // opaque scope tokens
  readonly origin: DraftOrigin;
}

export interface AIDraft {
  readonly id: string;
  readonly status: DraftStatus;
  /** Human-readable title shown in the Drafts panel. */
  readonly title: string;
  /** Body of the draft (markdown). */
  readonly body: string;
  readonly target: DraftTarget;
  readonly provenance: DraftProvenance;
  /** Optional notes the user attached while reviewing. */
  readonly reviewNote?: string;
  /** When the status transitioned away from `pending`. */
  readonly resolvedAt?: string;
}

export function isDraftProvenance(value: unknown): value is DraftProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== 'string') return false;
  if (v.model !== undefined && typeof v.model !== 'string') return false;
  if (typeof v.generatedAt !== 'string') return false;
  if (!Array.isArray(v.sourceScope)) return false;
  for (const s of v.sourceScope) {
    if (typeof s !== 'string') return false;
  }
  if (typeof v.origin !== 'object' || v.origin === null) return false;
  return isDraftOrigin((v.origin as Record<string, unknown>));
}

export function isDraftOrigin(value: unknown): value is DraftOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'selection':
      return typeof v.objectId === 'string';
    case 'intent-capsule':
      return typeof v.intentId === 'string';
    case 'transition-suggestion':
      return typeof v.transitionId === 'string';
    case 'background-job':
      return typeof v.jobId === 'string';
    case 'imported':
      return true;
    default:
      return false;
  }
}

export function isAIDraft(value: unknown): value is AIDraft {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (!isDraftStatus(v.status)) return false;
  if (typeof v.title !== 'string') return false;
  if (typeof v.body !== 'string') return false;
  if (!isDraftTarget(v.target)) return false;
  if (!isDraftProvenance(v.provenance)) return false;
  if (v.reviewNote !== undefined && typeof v.reviewNote !== 'string') return false;
  if (v.resolvedAt !== undefined && typeof v.resolvedAt !== 'string') return false;
  return true;
}

/** Terminal statuses cannot transition further. */
export function isTerminalDraftStatus(status: DraftStatus): boolean {
  return status === 'accepted' || status === 'rejected' || status === 'superseded';
}
