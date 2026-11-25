/**
 * StudyKit v0.4 — `domain/collaboration`
 *
 * Canonical contracts for the **Collaboration Foundation**
 * slice (WP-08). Sits beside `domain/researchDesign.ts`
 * (Design + Project Management) and `domain/research.ts`
 * (Evidence). Mirrors their discipline:
 *
 *   - Every persisted object carries `projectId`,
 *     `createdAt`, `updatedAt`, and an explicit
 *     `authorType: 'user' | 'ai' | 'imported'`.
 *   - AI never writes canonical state. Use cases refuse
 *     `authorType: 'ai'`; AI suggestions go through the
 *     Draft Layer and the host Accepts a draft into
 *     canonical.
 *   - Membership/role + comments + activity are append-only
 *     or are revised with a version bump so concurrent
 *     edits can be detected and reconciled without a
 *     silent overwrite.
 *
 * Why a separate file? WP-08 introduces nine new
 * canonical kinds (Collaborator, Comment, Mention,
 * Activity, PrivateScratch, PublishDiff, Conflict,
 * PresenceSnapshot, RealtimeEnvelope) with their own
 * permission matrix and lifecycle rules. Splitting the
 * file by slice keeps `domain/research.ts` and
 * `domain/researchDesign.ts` from becoming a single
 * 4000-line surface.
 *
 * Design rules (enforced by type guards + use cases):
 *
 *   1. **One concept, one truth.** A `Comment` is the only
 *      object that knows about its mentions; `Activity`
 *      never embeds a `Comment.body`, it links by id.
 *   2. **AI distinction is explicit.** `Collaborator` /
 *      `Comment` / `Activity` / `PrivateScratch` carry
 *      `authorType: 'user' | 'ai' | 'imported'`. Use
 *      cases refuse `'ai'`; the AI path is the Draft
 *      Layer + an explicit user Accept.
 *   3. **Roles are explicit, not magic.** A `Collaborator.role`
 *      is one of `'owner' | 'editor' | 'commenter' | 'viewer'`.
 *      The use cases consult the role through a single
 *      `canPerform(actor, capability)` function. Components
 *      never `if (role === 'editor')` themselves.
 *   4. **Private Scratch never leaks.** A `PrivateScratch`
 *      carries `ownerId` and `visibility: 'private'`. The
 *      publish flow is the *only* path that flips visibility
 *      to `'project'`, and the publish is gated on an
 *      explicit `PublishDiff` + user confirmation. Inviting a
 *      collaborator never re-shares an existing Private
 *      Scratch.
 *   5. **Conflicts are preserved, not merged.** When two
 *      writers touch the same shared object the second
 *      write creates a `Conflict` row that records the
 *      *base*, *local* and *remote* versions. The use case
 *      never silently overwrites either side; the host UI
 *      asks the user to choose. A `Conflict` is resolved by
 *      writing a fresh canonical record with a new
 *      `version` and a `supersedes` lineage.
 *   6. **Realtime is bonus, async is truth.** Every
 *      collaborative write goes through the local
 *      repository first; realtime sync (when available)
 *      fires a `RealtimeEnvelope` for live awareness but
 *      the durable record is the local store. A
 *      `PresenceSnapshot` is *ephemeral* and never becomes
 *      a canonical row.
 *   7. **Timestamps are mandatory.** Every persisted
 *      collaboration object has `createdAt` and
 *      `updatedAt`. `Activity` is `createdAt`-only
 *      (append-only).
 */

// ---------------------------------------------------------------------------
// Scope + role
// ---------------------------------------------------------------------------

/**
 * The visibility scope of a shared object. A `PrivateScratch`
 * is always `private`; promoting to `project` is the
 * publish flow. A canonical project object (Evidence, Claim,
 * Design, Task, etc.) is always `project` in this slice.
 *
 * `workspace` is reserved for the future Workspace-wide
 * membership; the v0.4 Beta does not use it yet. The type
 * carries it so the schema does not need a migration when
 * the future Workspace layer lands.
 */
export type CollaborationScope = 'private' | 'project' | 'workspace';

export const COLLABORATION_SCOPES: readonly CollaborationScope[] = [
  'private',
  'project',
  'workspace',
] as const;

export function isCollaborationScope(value: unknown): value is CollaborationScope {
  return value === 'private' || value === 'project' || value === 'workspace';
}

/**
 * The role a Collaborator plays in a project. Mirrors
 * the Zotero Groups / OSF contributor permissions the
 * v0.4 spec calls out (studykit_v0.4_research_mode_ai_native_spec_cn.md
 * §5.10): Owner, Editor, Commenter, Viewer.
 */
export type CollaboratorRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export const COLLABORATOR_ROLES: readonly CollaboratorRole[] = [
  'owner',
  'editor',
  'commenter',
  'viewer',
] as const;

export function isCollaboratorRole(value: unknown): value is CollaboratorRole {
  return (
    value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer'
  );
}

/**
 * The role ordering used by the UI when rendering
 * "Member X is more senior than Y". `owner` is the top;
 * `viewer` is the bottom. The matrix does not need this
 * to enforce permissions — `canPerform` is the only
 * authority — but the ordering is used by the
 * Collaborators list to sort rows.
 */
export const COLLABORATOR_ROLE_RANK: Readonly<Record<CollaboratorRole, number>> = Object.freeze({
  owner: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
});

// ---------------------------------------------------------------------------
// Collaborator
// ---------------------------------------------------------------------------

/**
 * A user that has been added to a project. The
 * `displayName` is what the host UI shows next to
 * comments / activity rows. A `userId` is the stable
 * identity (think: a Zotero user key or an OSF guid;
 * in v0.4 the value is the device-local user id).
 */
export interface Collaborator {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: CollaboratorRole;
  readonly addedAt: string;
  readonly addedBy: string;
  /** `authorType: 'user' | 'imported'`. AI cannot
   *  create a Collaborator — the use case refuses
   *  `'ai'`. The Draft Layer is the AI path. */
  readonly authorType: 'user' | 'imported';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isCollaborator(value: unknown): value is Collaborator {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.userId !== 'string' || v.userId.length === 0) return false;
  if (typeof v.displayName !== 'string' || v.displayName.trim().length === 0) return false;
  if (!isCollaboratorRole(v.role)) return false;
  if (typeof v.addedAt !== 'string' || v.addedAt.length === 0) return false;
  if (typeof v.addedBy !== 'string' || v.addedBy.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

/**
 * What kind of canonical object a `Comment` is attached
 * to. The comment body is the same regardless of target;
 * the target kind lets the UI render the right "show
 * referenced object" badge.
 */
export type CommentTargetKind =
  | 'project'
  | 'claim'
  | 'evidence'
  | 'task'
  | 'decision'
  | 'output'
  | 'design-spec'
  | 'risk'
  | 'milestone'
  | 'hypothesis'
  | 'question';

export const COMMENT_TARGET_KINDS: readonly CommentTargetKind[] = [
  'project',
  'claim',
  'evidence',
  'task',
  'decision',
  'output',
  'design-spec',
  'risk',
  'milestone',
  'hypothesis',
  'question',
] as const;

export function isCommentTargetKind(value: unknown): value is CommentTargetKind {
  return (
    value === 'project' ||
    value === 'claim' ||
    value === 'evidence' ||
    value === 'task' ||
    value === 'decision' ||
    value === 'output' ||
    value === 'design-spec' ||
    value === 'risk' ||
    value === 'milestone' ||
    value === 'hypothesis' ||
    value === 'question'
  );
}

/**
 * A user-authored comment on a project or a specific
 * object inside it. `parentId` enables threading:
 * a comment with `parentId` is a reply. `resolvedAt`
 * marks the thread as resolved (and freezes the
 * comment for further edits, except for an un-resolve
 * by the resolver / owner).
 */
export interface Comment {
  readonly id: string;
  readonly projectId: string;
  readonly targetKind: CommentTargetKind;
  /** The id of the object the comment is attached to
   *  (the project id when `targetKind === 'project'`). */
  readonly targetId: string;
  /** The thread root: `parentId ?? id`. Use this
   *  to group replies in the UI. */
  readonly threadId: string;
  /** `null` for a top-level comment; the parent
   *  comment's id for a reply. */
  readonly parentId: string | null;
  /** Author identity — a `userId` (matches a
   *  `Collaborator.userId`). */
  readonly authorId: string;
  readonly authorDisplayName: string;
  /** `user` for a real collaborator; `ai` is
   *  reserved for an accepted AI draft (a comment
   *  the user wrote but attributed to the AI
   *  helper) and `imported` for a future import
   *  path. The use case refuses unprompted AI
   *  writes. */
  readonly authorType: 'user' | 'ai' | 'imported';
  readonly body: string;
  /** Ordered mention list. The use case
   *  `postComment` parses the body for `@userId`
   *  and writes a stable mention row per id. */
  readonly mentions: readonly Mention[];
  readonly resolvedAt: string | null;
  /** `userId` who resolved the thread. */
  readonly resolvedBy: string | null;
  /** The version of the comment body. Bumped on
   *  every edit. Used by the conflict detector. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isComment(value: unknown): value is Comment {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (!isCommentTargetKind(v.targetKind)) return false;
  if (typeof v.targetId !== 'string' || v.targetId.length === 0) return false;
  if (typeof v.threadId !== 'string' || v.threadId.length === 0) return false;
  if (v.parentId !== null && typeof v.parentId !== 'string') return false;
  if (typeof v.authorId !== 'string' || v.authorId.length === 0) return false;
  if (typeof v.authorDisplayName !== 'string' || v.authorDisplayName.trim().length === 0) {
    return false;
  }
  if (v.authorType !== 'user' && v.authorType !== 'ai' && v.authorType !== 'imported') {
    return false;
  }
  if (typeof v.body !== 'string' || v.body.trim().length === 0) return false;
  if (!Array.isArray(v.mentions)) return false;
  for (const m of v.mentions) if (!isMention(m)) return false;
  if (v.resolvedAt !== null && typeof v.resolvedAt !== 'string') return false;
  if (v.resolvedBy !== null && typeof v.resolvedBy !== 'string') return false;
  if (typeof v.version !== 'number' || !Number.isFinite(v.version) || v.version < 1 || !Number.isInteger(v.version)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mention
// ---------------------------------------------------------------------------

/**
 * A `@userId` mention parsed out of a `Comment.body`.
 * `displayName` is what the chip shows; `position` is
 * the byte index in the body (UTF-16 length) so the UI
 * can highlight the range and the search index can
 * skip tokens.
 */
export interface Mention {
  readonly userId: string;
  readonly displayName: string;
  /** UTF-16 index in the body where the mention
   *  starts (the index of the leading `@`). */
  readonly position: number;
  /** Length in UTF-16 units of the mention
   *  string, including the leading `@`. */
  readonly length: number;
}

export function isMention(value: unknown): value is Mention {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.userId !== 'string' || v.userId.length === 0) return false;
  if (typeof v.displayName !== 'string' || v.displayName.trim().length === 0) return false;
  if (typeof v.position !== 'number' || !Number.isFinite(v.position) || v.position < 0) {
    return false;
  }
  if (typeof v.length !== 'number' || !Number.isFinite(v.length) || v.length < 2) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * The kind of event a `Activity` row records. The
 * activity log is append-only; the use case refuses
 * updates. The list below covers the WP-08 events.
 * Future packets may add new kinds without a schema
 * migration (the table is a single string).
 */
export type ActivityKind =
  | 'member-added'
  | 'member-removed'
  | 'member-role-changed'
  | 'comment-posted'
  | 'comment-resolved'
  | 'comment-reopened'
  | 'task-shared'
  | 'task-assigned'
  | 'task-completed'
  | 'scratch-published'
  | 'scratch-reverted'
  | 'design-decision-accepted'
  | 'design-decision-revised'
  | 'evidence-shared'
  | 'claim-shared'
  | 'output-shared'
  | 'presence-joined'
  | 'presence-left'
  | 'conflict-detected'
  | 'conflict-resolved'
  | 'ai-draft-suggested'
  | 'ai-draft-accepted'
  | 'ai-draft-rejected'
  | 'other';

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'member-added',
  'member-removed',
  'member-role-changed',
  'comment-posted',
  'comment-resolved',
  'comment-reopened',
  'task-shared',
  'task-assigned',
  'task-completed',
  'scratch-published',
  'scratch-reverted',
  'design-decision-accepted',
  'design-decision-revised',
  'evidence-shared',
  'claim-shared',
  'output-shared',
  'presence-joined',
  'presence-left',
  'conflict-detected',
  'conflict-resolved',
  'ai-draft-suggested',
  'ai-draft-accepted',
  'ai-draft-rejected',
  'other',
] as const;

export function isActivityKind(value: unknown): value is ActivityKind {
  return ACTIVITY_KINDS.includes(value as ActivityKind);
}

/**
 * One entry in the project activity log. Append-only;
 * the use case refuses `putActivity` for an existing
 * id. `actorId` is the userId of the actor (a
 * Collaborator); `actorType: 'user' | 'ai' | 'system'`
 * distinguishes a real collaborator from an AI-driven
 * event and a system-level event (e.g. presence join
 * is `user`; an AI-draft suggestion is `ai`; a
 * presence-reconnect after a long offline gap is
 * `system`).
 */
export interface Activity {
  readonly id: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly actorDisplayName: string;
  readonly actorType: 'user' | 'ai' | 'system';
  readonly kind: ActivityKind;
  /** The kind of canonical object the activity
   *  touches (e.g. `task` for a `task-shared`
   *  activity). `null` when the activity is not
   *  attached to a single object (e.g.
   *  `member-added`). */
  readonly targetKind: CommentTargetKind | null;
  /** The id of the target object; `null` when
   *  `targetKind` is `null`. */
  readonly targetId: string | null;
  /** Short, human-readable summary (≤ 140 chars).
   *  The UI uses this as the headline of the
   *  activity row. */
  readonly summary: string;
  /** Optional, longer body. The activity feed
   *  expands on click. */
  readonly body: string;
  /** Visibility: a `private` activity is one the
   *  owner records for their own audit; in v0.4 we
   *  only use `project`. The `private` value is
   *  reserved for the future private scratch
   *  activity. */
  readonly scope: CollaborationScope;
  /** When `true`, the activity is an
   *  ephemeral signal (e.g. `presence-joined`)
   *  and the feed may suppress it. The default
   *  is `false` (durable). */
  readonly ephemeral: boolean;
  /** `createdAt`-only: the activity log is
   *  append-only. The use case does not write
   *  `updatedAt`. */
  readonly createdAt: string;
}

export function isActivity(value: unknown): value is Activity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.actorId !== 'string' || v.actorId.length === 0) return false;
  if (typeof v.actorDisplayName !== 'string' || v.actorDisplayName.trim().length === 0) {
    return false;
  }
  if (v.actorType !== 'user' && v.actorType !== 'ai' && v.actorType !== 'system') return false;
  if (!isActivityKind(v.kind)) return false;
  if (v.targetKind !== null && !isCommentTargetKind(v.targetKind)) return false;
  if (v.targetId !== null && typeof v.targetId !== 'string') return false;
  if (typeof v.summary !== 'string') return false;
  if (typeof v.body !== 'string') return false;
  if (!isCollaborationScope(v.scope)) return false;
  if (typeof v.ephemeral !== 'boolean') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// PrivateScratch
// ---------------------------------------------------------------------------

/**
 * What kind of canonical object a `PrivateScratch` is a
 * private copy of. The publish flow resolves a scratch
 * into the target canonical table.
 */
export type ScratchKind = 'note' | 'task' | 'claim' | 'evidence' | 'output';

export const SCRATCH_KINDS: readonly ScratchKind[] = [
  'note',
  'task',
  'claim',
  'evidence',
  'output',
] as const;

export function isScratchKind(value: unknown): value is ScratchKind {
  return (
    value === 'note' ||
    value === 'task' ||
    value === 'claim' ||
    value === 'evidence' ||
    value === 'output'
  );
}

/**
 * Status of a PrivateScratch. `private` is the
 * resting state; `publishing` is the in-flight
 * publish preview; `published` records that the
 * scratch has been resolved into a canonical row;
 * `reverted` records a previously-published
 * scratch that the user un-published.
 */
export type ScratchStatus = 'private' | 'publishing' | 'published' | 'reverted';

export const SCRATCH_STATUSES: readonly ScratchStatus[] = [
  'private',
  'publishing',
  'published',
  'reverted',
] as const;

export function isScratchStatus(value: unknown): value is ScratchStatus {
  return (
    value === 'private' ||
    value === 'publishing' ||
    value === 'published' ||
    value === 'reverted'
  );
}

/**
 * A user-owned draft. The scratch is *never* in the
 * shared canonical store until the publish flow
 * finishes; inviting a collaborator does NOT publish
 * a scratch.
 */
export interface PrivateScratch {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly kind: ScratchKind;
  /** Free-form body. The publish preview renders
   *  this as a diff against the matching canonical
   *  row (if any). */
  readonly body: string;
  /** Optional free-form title. */
  readonly title: string;
  readonly status: ScratchStatus;
  /** When `status === 'published'`, the id of the
   *  canonical row the scratch resolved into. */
  readonly publishedRef: string | null;
  /** ISO timestamp of the publish; `null` while
   *  still private. */
  readonly publishedAt: string | null;
  /** ISO timestamp of the revert (if
   *  `status === 'reverted'`). */
  readonly revertedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** `user` for a real user-authored scratch;
   *  `ai` is reserved for an AI-suggested
   *  scratch the user explicitly Saved. The
   *  use case refuses unprompted AI writes. */
  readonly authorType: 'user' | 'ai' | 'imported';
}

export function isPrivateScratch(value: unknown): value is PrivateScratch {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.ownerId !== 'string' || v.ownerId.length === 0) return false;
  if (!isScratchKind(v.kind)) return false;
  if (typeof v.body !== 'string') return false;
  if (typeof v.title !== 'string') return false;
  if (!isScratchStatus(v.status)) return false;
  if (v.publishedRef !== null && typeof v.publishedRef !== 'string') return false;
  if (v.publishedAt !== null && typeof v.publishedAt !== 'string') return false;
  if (v.revertedAt !== null && typeof v.revertedAt !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'ai' && v.authorType !== 'imported') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// PublishDiff
// ---------------------------------------------------------------------------

/**
 * One row in a publish preview. The publish flow
 * produces a list of `PublishDiffRow`s (added / changed /
 * removed) so the host UI can render a clear before/
 * after. The rows reference the *scratch* id, not the
 * canonical id, until the user confirms.
 */
export type PublishDiffOp = 'added' | 'changed' | 'removed';

export const PUBLISH_DIFF_OPS: readonly PublishDiffOp[] = [
  'added',
  'changed',
  'removed',
] as const;

export function isPublishDiffOp(value: unknown): value is PublishDiffOp {
  return value === 'added' || value === 'changed' || value === 'removed';
}

export interface PublishDiffRow {
  readonly op: PublishDiffOp;
  readonly path: string;
  /** The previous value (undefined for `added`). */
  readonly before: string | null;
  /** The new value (undefined for `removed`). */
  readonly after: string | null;
}

export function isPublishDiffRow(value: unknown): value is PublishDiffRow {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isPublishDiffOp(v.op)) return false;
  if (typeof v.path !== 'string' || v.path.length === 0) return false;
  if (v.before !== null && typeof v.before !== 'string') return false;
  if (v.after !== null && typeof v.after !== 'string') return false;
  return true;
}

/**
 * A preview of the change a `PrivateScratch.publish`
 * will produce. The publish flow always materialises
 * a `PublishDiff` BEFORE asking the user to confirm;
 * the `confirmedAt` is `null` until the user clicks
 * "Publish", at which point the use case writes the
 * scratch + the diff in a single transaction.
 */
export interface PublishDiff {
  readonly id: string;
  readonly scratchId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly rows: readonly PublishDiffRow[];
  /** The canonical id the publish will produce /
   *  touch (filled in by the use case when the
   *  scratch is a `changed` op). `null` for a
   *  pure `added` op. */
  readonly targetId: string | null;
  readonly createdAt: string;
  /** When the user confirmed; `null` while the
   *  preview is still open. */
  readonly confirmedAt: string | null;
  /** When the user cancelled; `null` while the
   *  preview is still open or after a
   *  confirmation. */
  readonly cancelledAt: string | null;
}

export function isPublishDiff(value: unknown): value is PublishDiff {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.scratchId !== 'string' || v.scratchId.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.ownerId !== 'string' || v.ownerId.length === 0) return false;
  if (!Array.isArray(v.rows)) return false;
  for (const r of v.rows) if (!isPublishDiffRow(r)) return false;
  if (v.targetId !== null && typeof v.targetId !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (v.confirmedAt !== null && typeof v.confirmedAt !== 'string') return false;
  if (v.cancelledAt !== null && typeof v.cancelledAt !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Conflict
// ---------------------------------------------------------------------------

/**
 * The kind of canonical object a `Conflict` is about.
 * The matrix below is the *set* of shared objects the
 * WP-08 conflict detector knows about. New kinds in
 * future packets can be added without a schema
 * migration.
 */
export type ConflictKind =
  | 'comment'
  | 'scratch'
  | 'task'
  | 'evidence'
  | 'claim'
  | 'design-spec'
  | 'design-decision';

export const CONFLICT_KINDS: readonly ConflictKind[] = [
  'comment',
  'scratch',
  'task',
  'evidence',
  'claim',
  'design-spec',
  'design-decision',
] as const;

export function isConflictKind(value: unknown): value is ConflictKind {
  return (
    value === 'comment' ||
    value === 'scratch' ||
    value === 'task' ||
    value === 'evidence' ||
    value === 'claim' ||
    value === 'design-spec' ||
    value === 'design-decision'
  );
}

export type ConflictResolution = 'kept-local' | 'kept-remote' | 'merged' | 'dropped';

export const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] = [
  'kept-local',
  'kept-remote',
  'merged',
  'dropped',
] as const;

export function isConflictResolution(value: unknown): value is ConflictResolution {
  return (
    value === 'kept-local' ||
    value === 'kept-remote' ||
    value === 'merged' ||
    value === 'dropped'
  );
}

/**
 * A snapshot of a single side of a conflict. We keep
 * the *full* row on each side (not just a diff) so the
 * user can paste either side back into the canonical
 * store. The version is the `Comment.version` /
 * `Scratch.updatedAt` etc. that the writer saw when
 * they made the change.
 */
export interface ConflictVersionSnapshot {
  /** The side this snapshot came from (`local` or
   *  `remote`). */
  readonly side: 'local' | 'remote';
  /** The writer's userId. */
  readonly actorId: string;
  readonly actorDisplayName: string;
  /** The version number / timestamp the writer
   *  observed before making the change. For
   *  `version`-based objects this is the
   *  numeric `version`; for time-based objects
   *  this is the ISO timestamp. */
  readonly baseVersion: number | string;
  /** The new value the writer attempted to commit. */
  readonly payload: string;
  /** ISO timestamp the writer committed. */
  readonly writtenAt: string;
}

export function isConflictVersionSnapshot(value: unknown): value is ConflictVersionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.side !== 'local' && v.side !== 'remote') return false;
  if (typeof v.actorId !== 'string' || v.actorId.length === 0) return false;
  if (typeof v.actorDisplayName !== 'string' || v.actorDisplayName.trim().length === 0) {
    return false;
  }
  if (typeof v.baseVersion !== 'number' && typeof v.baseVersion !== 'string') return false;
  if (typeof v.baseVersion === 'string' && v.baseVersion.length === 0) return false;
  if (typeof v.payload !== 'string') return false;
  if (typeof v.writtenAt !== 'string' || v.writtenAt.length === 0) return false;
  return true;
}

/**
 * A non-destructive conflict record. The use case
 * never silently overwrites either side; it writes a
 * `Conflict` row with both versions. The host UI
 * surfaces the conflict and the user picks a
 * resolution (or merges manually). The
 * `resolvedAt` / `resolvedBy` / `resolution` are
 * filled in by the resolve use case.
 */
export interface Conflict {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ConflictKind;
  readonly objectId: string;
  readonly local: ConflictVersionSnapshot;
  readonly remote: ConflictVersionSnapshot;
  readonly resolution: ConflictResolution | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  /** Optional note the resolver attaches when
   *  picking the resolution. */
  readonly resolutionNote: string;
  readonly detectedAt: string;
}

export function isConflict(value: unknown): value is Conflict {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (!isConflictKind(v.kind)) return false;
  if (typeof v.objectId !== 'string' || v.objectId.length === 0) return false;
  if (!isConflictVersionSnapshot(v.local)) return false;
  if (!isConflictVersionSnapshot(v.remote)) return false;
  if (v.resolution !== null && !isConflictResolution(v.resolution)) return false;
  if (v.resolvedBy !== null && typeof v.resolvedBy !== 'string') return false;
  if (v.resolvedAt !== null && typeof v.resolvedAt !== 'string') return false;
  if (typeof v.resolutionNote !== 'string') return false;
  if (typeof v.detectedAt !== 'string' || v.detectedAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Presence (ephemeral, NOT canonical)
// ---------------------------------------------------------------------------

/**
 * One peer's presence in a project. `lastSeenAt` is
 * updated on every awareness beat; a peer is "online"
 * when their `lastSeenAt` is within
 * `PRESENCE_STALE_MS` of now. The presence snapshot
 * is *not* a canonical store row — it is rebuilt on
 * every page load from the realtime channel and from
 * the `presence_*` activity log.
 */
export interface PresenceSnapshot {
  readonly peerId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly projectId: string;
  readonly role: CollaboratorRole;
  readonly online: boolean;
  readonly lastSeenAt: string;
}

export function isPresenceSnapshot(value: unknown): value is PresenceSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.peerId !== 'string' || v.peerId.length === 0) return false;
  if (typeof v.userId !== 'string' || v.userId.length === 0) return false;
  if (typeof v.displayName !== 'string' || v.displayName.trim().length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (!isCollaboratorRole(v.role)) return false;
  if (typeof v.online !== 'boolean') return false;
  if (typeof v.lastSeenAt !== 'string' || v.lastSeenAt.length === 0) return false;
  return true;
}

/** A presence row is considered stale after 60s
 *  without a heartbeat. Pure constant; the
 *  presence provider consults it on every read. */
export const PRESENCE_STALE_MS = 60_000;

// ---------------------------------------------------------------------------
// Realtime envelope (transport-level, NOT canonical)
// ---------------------------------------------------------------------------

/**
 * A wire-format event a realtime channel can carry.
 * `payload` is JSON-serialisable; the channel routes
 * the envelope to subscribers by `kind`. Realtime is
 * bonus: the durable record is the local store.
 */
export type RealtimeEnvelopeKind =
  | 'presence'
  | 'comment-posted'
  | 'comment-updated'
  | 'comment-resolved'
  | 'activity'
  | 'conflict-detected'
  | 'member-added'
  | 'scratch-published';

export const REALTIME_ENVELOPE_KINDS: readonly RealtimeEnvelopeKind[] = [
  'presence',
  'comment-posted',
  'comment-updated',
  'comment-resolved',
  'activity',
  'conflict-detected',
  'member-added',
  'scratch-published',
] as const;

export interface RealtimeEnvelope {
  readonly kind: RealtimeEnvelopeKind;
  /** Stable envelope id (the writer's id +
   *  a per-process counter). */
  readonly id: string;
  readonly actorId: string;
  readonly projectId: string;
  /** Monotonic version the writer observed. */
  readonly version: number;
  /** Wall-clock time on the writer. */
  readonly clientTime: string;
  /** Wall-clock time the channel saw the envelope.
   *  `null` until the channel stamps it. */
  readonly serverTime: string | null;
  /** JSON-serialised body. The shape depends on
   *  `kind`. */
  readonly payload: string;
}

export function isRealtimeEnvelope(value: unknown): value is RealtimeEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !REALTIME_ENVELOPE_KINDS.includes(v.kind as RealtimeEnvelopeKind)) {
    return false;
  }
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.actorId !== 'string' || v.actorId.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.version !== 'number' || !Number.isFinite(v.version) || v.version < 0) return false;
  if (typeof v.clientTime !== 'string' || v.clientTime.length === 0) return false;
  if (v.serverTime !== null && typeof v.serverTime !== 'string') return false;
  if (typeof v.payload !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Capability (permission) matrix
// ---------------------------------------------------------------------------

/**
 * The set of capabilities the permission matrix
 * enforces. Each capability maps to one or more
 * roles; the matrix in `canPerform` is the single
 * source of truth.
 */
export type Capability =
  | 'project.read'
  | 'project.invite'
  | 'project.remove-member'
  | 'project.change-role'
  | 'project.delete'
  | 'comment.read'
  | 'comment.post'
  | 'comment.update-own'
  | 'comment.update-any'
  | 'comment.resolve'
  | 'comment.delete-own'
  | 'comment.delete-any'
  | 'mention.use'
  | 'task.read'
  | 'task.create'
  | 'task.assign'
  | 'task.complete'
  | 'scratch.read-own'
  | 'scratch.create'
  | 'scratch.update-own'
  | 'scratch.delete-own'
  | 'scratch.publish'
  | 'evidence.read'
  | 'evidence.create'
  | 'evidence.verify'
  | 'claim.read'
  | 'claim.create'
  | 'claim.update'
  | 'design.read'
  | 'design.create'
  | 'design.update'
  | 'design.decide'
  | 'output.read'
  | 'output.create'
  | 'ai.read-context'
  | 'ai.run-local'
  | 'ai.run-cloud';

export const CAPABILITIES: readonly Capability[] = [
  'project.read',
  'project.invite',
  'project.remove-member',
  'project.change-role',
  'project.delete',
  'comment.read',
  'comment.post',
  'comment.update-own',
  'comment.update-any',
  'comment.resolve',
  'comment.delete-own',
  'comment.delete-any',
  'mention.use',
  'task.read',
  'task.create',
  'task.assign',
  'task.complete',
  'scratch.read-own',
  'scratch.create',
  'scratch.update-own',
  'scratch.delete-own',
  'scratch.publish',
  'evidence.read',
  'evidence.create',
  'evidence.verify',
  'claim.read',
  'claim.create',
  'claim.update',
  'design.read',
  'design.create',
  'design.update',
  'design.decide',
  'output.read',
  'output.create',
  'ai.read-context',
  'ai.run-local',
  'ai.run-cloud',
] as const;

export function isCapability(value: unknown): value is Capability {
  return CAPABILITIES.includes(value as Capability);
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Throw if the author type is `'ai'`. Use cases that
 * write canonical collaboration state MUST call this
 * on every input. The Draft Layer is the only path
 * the AI has to the user's collaboration data.
 */
export function assertUserAuthored(authorType: string): void {
  if (authorType !== 'user' && authorType !== 'imported') {
    throw new Error(
      `Refusing to write canonical collaboration state with authorType="${authorType}"; ` +
        'AI must go through the Draft Layer.',
    );
  }
}

/**
 * Throw if a publish diff row points at a side that
 * would silently overwrite the other. The
 * conflict-detector use case calls this when it sees
 * two writers trying to commit the same object at the
 * same time.
 */
export function assertConflictResolved(args: {
  readonly conflict: Conflict;
  readonly resolution: ConflictResolution;
}): void {
  if (args.conflict.resolution !== null) {
    throw new Error(
      `Conflict ${args.conflict.id} is already resolved (${args.conflict.resolution}); cannot re-resolve.`,
    );
  }
  if (
    args.resolution !== 'kept-local' &&
    args.resolution !== 'kept-remote' &&
    args.resolution !== 'merged' &&
    args.resolution !== 'dropped'
  ) {
    throw new Error(`Unknown conflict resolution: ${args.resolution as string}`);
  }
}

/**
 * Default `displayName` placeholder for the local
 * user when no name is set. The WP-08 slice does
 * not own user identity; the local workspace
 * passes a stable `userId` and a placeholder name
 * to the membership and activity records. The
 * "Settings" page (WP-01 surface) is the future
 * home of a real `displayName`.
 */
export const LOCAL_USER_DISPLAY_NAME_FALLBACK = 'You (local)';

// ---------------------------------------------------------------------------
// Time helper
// ---------------------------------------------------------------------------

/** ISO timestamp at call time. Pure helper. Tests freeze `Date.now`. */
export function nowCollabIso(): string {
  return new Date().toISOString();
}
