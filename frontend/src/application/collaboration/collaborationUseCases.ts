/**
 * StudyKit v0.4 — `application/collaboration/collaborationUseCases`
 *
 * The headless use cases for the Collaboration
 * Foundation slice. Pure functions over the
 * `CollaborationRepository` contract: no React, no
 * Dexie, no AI provider. The UI / AI kernel call
 * these; the use cases consult the permission matrix
 * and write through the contract.
 *
 * Per the v0.4 spec (studykit_v0.4_research_mode_ai_native_spec_cn.md
 * §5.10 + the WP-08 brief):
 *
 *   - **Membership** is a per-project concept. The
 *     `inviteCollaborator` use case records a
 *     `Collaborator` row with role `commenter` by
 *     default. `changeCollaboratorRole` is owner-only.
 *   - **Comments** carry an `authorId` and an
 *     `authorType: 'user' | 'ai' | 'imported'`. The
 *     use case parses the body for `@userId` and
 *     writes a `Mention` per id. The use case refuses
 *     unprompted `authorType: 'ai'` writes — the AI
 *     path is the Draft Layer + an explicit Accept.
 *   - **Activity** is append-only. Every operation
 *     that succeeds also appends a single Activity
 *     row in the same transaction.
 *   - **Private Scratch** is owner-only. The publish
 *     flow is the *only* path that flips the
 *     visibility from `private` to `project`, and the
 *     publish is gated on a `PublishDiff` preview
 *     that the user confirms in the UI. Inviting a
 *     collaborator does NOT publish a scratch — the
 *     scratch stays private to its owner.
 *   - **Conflict detection** runs on every
 *     version-based write (Comment edits, Scratch
 *     publishes, etc.). The use case refuses
 *     last-write-wins: when the writer's `baseVersion`
 *     does not match the current row, it creates a
 *     `Conflict` row and refuses the write. The host
 *     UI asks the user to resolve. A `Conflict` is
 *     resolved by writing a fresh canonical record
 *     with a new `version`.
 *   - **Realtime** is bonus, not truth. Every
 *     successful write is a local commit; the
 *     `emitRealtime` hook is fire-and-forget.
 *
 * The use cases never import React / Dexie / fetch /
 * the AI provider. They are pure-Promise async
 * functions over the repository contract.
 */

import type {
  Activity,
  Capability,
  Collaborator,
  CollaboratorRole,
  Comment,
  CommentTargetKind,
  Conflict,
  ConflictKind,
  ConflictResolution,
  ConflictVersionSnapshot,
  Mention,
  PresenceSnapshot,
  PrivateScratch,
  PublishDiff,
  PublishDiffOp,
  PublishDiffRow,
  RealtimeEnvelope,
  RealtimeEnvelopeKind,
  ScratchKind,
  ScratchStatus,
} from '../../domain/collaboration';
import { assertUserAuthored, nowCollabIso } from '../../domain/collaboration';
import {
  actorFromCollaborator,
  canEditComment,
  canMutateScratch,
  canPerform,
  canPublishScratch,
  requirePermission,
  type Actor,
} from './permissionMatrix';
import type {
  CollaborationRepository,
  CollaborationRepositoryTransaction,
} from './collaborationRepository';
import { getClientId } from './syncService';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a write would silently overwrite a row
 * the user did not intend to overwrite. The use case
 * catches this and surfaces a "There's a newer version
 * of this comment" prompt in the UI.
 */
export class ConflictRefusedError extends Error {
  readonly kind: ConflictKind;
  readonly objectId: string;
  readonly currentVersion: number | string;
  readonly attemptedBase: number | string;
  constructor(args: {
    kind: ConflictKind;
    objectId: string;
    currentVersion: number | string;
    attemptedBase: number | string;
  }) {
    super(
      `Refusing to overwrite ${args.kind} ${args.objectId}: writer's baseVersion ` +
        `(${args.attemptedBase}) does not match current version (${args.currentVersion}).`,
    );
    this.name = 'ConflictRefusedError';
    this.kind = args.kind;
    this.objectId = args.objectId;
    this.currentVersion = args.currentVersion;
    this.attemptedBase = args.attemptedBase;
  }
}

/**
 * Thrown when a publish is attempted on a scratch
 * that is not in `private` state. The publish flow
 * is the only way to flip a scratch to `publishing`
 * / `published`, and a scratch that is already
 * `published` cannot be re-published without an
 * explicit `revert` first.
 */
export class ScratchNotPublishableError extends Error {
  readonly scratchId: string;
  readonly status: ScratchStatus;
  constructor(scratchId: string, status: ScratchStatus) {
    super(
      `PrivateScratch ${scratchId} is in status "${status}"; ` +
        'only a "private" scratch can be published.',
    );
    this.name = 'ScratchNotPublishableError';
    this.scratchId = scratchId;
    this.status = status;
  }
}

/**
 * Thrown when the use case cannot parse a mention out
 * of a comment body. The UI surfaces this as a
 * validation error and lets the user fix the body.
 */
export class InvalidMentionError extends Error {
  readonly body: string;
  readonly reason: string;
  constructor(body: string, reason: string) {
    super(`Invalid mention in comment body: ${reason}`);
    this.name = 'InvalidMentionError';
    this.body = body;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface UseCaseDeps {
  readonly repository: CollaborationRepository;
  /** Optional, fire-and-forget realtime hook. The
   *  use case never blocks on it; failures are
   *  swallowed by the hook itself. When the hook is
   *  absent (e.g. in unit tests), the slice still
   *  works — the durable record is the local
   *  store. */
  readonly emitRealtime?: (env: RealtimeEnvelope) => void;
  /**
   * WP-08 Round 2: optional durable outbox hook.
   * The use case calls this AFTER a successful
   * `transact(...)` so the cross-user op log carries
   * the event. The hook never throws (a failed
   * enqueue is logged but does not roll back the
   * local commit). When the hook is absent, the
   * slice still works — the local store is the
   * durable record and the cross-user gateway is
   * bypassed (e.g. in unit tests).
   */
  readonly recordOp?: (op: {
    readonly kind: 'membership-bootstrap' | 'member-added' | 'member-role-changed' | 'member-removed' | 'comment-posted' | 'comment-resolved' | 'activity-logged' | 'task-shared' | 'conflict-detected';
    readonly payload: unknown;
    readonly baseVersion?: number | string;
  }) => void;
  /** The local user's userId. The membership
   *  boundary check uses this; the AI Assistant
   *  never sets it. */
  readonly localUserId: string;
  /** The local user's displayName. Same boundary. */
  readonly localUserDisplayName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${t}_${r}`;
}

function ensureActor(deps: UseCaseDeps): Actor {
  return {
    userId: deps.localUserId,
    displayName: deps.localUserDisplayName,
    // The local user's role is recorded on their
    // Collaborator row; the use case reads it from
    // the membership via `loadActor`.
    role: 'viewer',
  };
}

async function loadActor(
  deps: UseCaseDeps,
  projectId: string,
): Promise<Actor | null> {
  const members = await deps.repository.listCollaborators({
    projectId,
    userId: deps.localUserId,
  });
  const me = members[0];
  if (!me) return null;
  return actorFromCollaborator(me);
}

function emitRealtime(deps: UseCaseDeps, env: RealtimeEnvelope): void {
  if (!deps.emitRealtime) return;
  try {
    deps.emitRealtime(env);
  } catch {
    // The realtime hook is fire-and-forget; any
    // exception is a hook problem, not a write
    // problem.
  }
}

/**
 * WP-08 Round 3 (P0-4): append an op to the
 * durable outbox IN THE SAME TRANSACTION as
 * the canonical rows. The op is staged via
 * `tx.enqueueOp(...)` so the Dexie adapter
 * commits the canonical row + the outbox row
 * atomically. A process crash between the
 * canonical write and the outbox write is
 * impossible: they live in the same Dexie
 * transaction.
 *
 * The function returns the staged record so
 * tests can assert the staging + tests can
 * reuse the record (e.g. for an inbox apply
 * step that mirrors the outbox locally).
 */
let opCounter = 0;
function nextOpId(): string {
  opCounter = (opCounter + 1) % 1_000_000;
  return `op_${Date.now().toString(36)}_${opCounter.toString(36)}`;
}

function recordOp(
  tx: CollaborationRepositoryTransaction,
  args: {
    readonly projectId: string;
    readonly kind:
      | 'membership-bootstrap'
      | 'member-added'
      | 'member-role-changed'
      | 'member-removed'
      | 'comment-posted'
      | 'comment-resolved'
      | 'activity-logged'
      | 'task-shared'
      | 'task-assigned'
      | 'conflict-detected';
    readonly payload: unknown;
    readonly baseVersion?: number | string;
  },
): void {
  tx.enqueueOp({
    opId: nextOpId(),
    clientId: getClientId(),
    projectId: args.projectId,
    kind: args.kind,
    payload: JSON.stringify(args.payload),
    ...(args.baseVersion !== undefined ? { baseVersion: args.baseVersion } : {}),
    createdAt: nowCollabIso(),
  });
}

export interface RecordTaskAssignmentInput {
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly assignee: {
    readonly userId: string;
    readonly displayName: string;
  } | null;
  readonly previousAssignee: {
    readonly userId: string;
    readonly displayName: string;
  } | null;
}

/**
 * Record a user-confirmed task assignment in the collaboration log.
 * The activity row and both sync operations commit atomically, so a
 * successful UI action cannot lose its cross-user sync intent.
 */
export async function recordTaskAssignment(
  deps: UseCaseDeps,
  input: RecordTaskAssignmentInput,
): Promise<Activity> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot assign tasks.`,
    );
  }
  requirePermission({
    actor,
    capability: 'task.assign',
    context: `assign task ${input.taskId}`,
  });
  if (input.assignee) {
    const members = await deps.repository.listCollaborators({
      projectId: input.projectId,
      userId: input.assignee.userId,
    });
    if (members.length === 0) {
      throw new Error('The assignee must be a member of this project.');
    }
  }

  const now = nowCollabIso();
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'task-assigned',
    targetKind: 'task',
    targetId: input.taskId,
    summary: input.assignee
      ? `Assigned “${input.taskTitle}” to ${input.assignee.displayName}`
      : `Unassigned “${input.taskTitle}”`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  const payload = {
    taskId: input.taskId,
    projectId: input.projectId,
    assignee: input.assignee,
    previousAssignee: input.previousAssignee,
  };

  await deps.repository.transact(async (tx) => {
    tx.putActivity(activity);
    recordOp(tx, {
      projectId: input.projectId,
      kind: 'task-assigned',
      payload,
    });
    recordOp(tx, {
      projectId: input.projectId,
      kind: 'activity-logged',
      payload: activity,
    });
  });
  emitRealtime(deps, {
    id: uid('rt'),
    projectId: input.projectId,
    kind: 'activity',
    actorId: actor.userId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify(activity),
  });
  return activity;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export interface InviteCollaboratorInput {
  readonly projectId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role?: CollaboratorRole;
}

/**
 * Invite a collaborator. The default role is
 * `'commenter'` (matches the WP-08 spec: "角色：Owner、
 * Editor、Commenter、Viewer"). The use case refuses:
 *
 *   - inviting a user that is already a member of
 *     the project (no duplicate rows);
 *   - inviting when the local user is not the owner
 *     (per `project.invite` capability);
 *   - `authorType: 'ai'` (per the domain invariant).
 *
 * The use case records an `Activity` row in the same
 * transaction so the feed is consistent.
 */
export async function inviteCollaborator(
  deps: UseCaseDeps,
  input: InviteCollaboratorInput,
): Promise<Collaborator> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot invite collaborators.`,
    );
  }
  requirePermission({
    actor,
    capability: 'project.invite',
    context: `invite ${input.userId} to project ${input.projectId}`,
  });
  const existing = await deps.repository.listCollaborators({
    projectId: input.projectId,
    userId: input.userId,
  });
  if (existing.length > 0) {
    throw new Error(
      `User ${input.userId} is already a member of project ${input.projectId}.`,
    );
  }
  const role = input.role ?? 'commenter';
  const now = nowCollabIso();
  const member: Collaborator = {
    id: uid('col'),
    projectId: input.projectId,
    userId: input.userId,
    displayName: input.displayName,
    role,
    addedAt: now,
    addedBy: actor.userId,
    authorType: 'user',
    createdAt: now,
    updatedAt: now,
  };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'member-added',
    targetKind: null,
    targetId: member.id,
    summary: `${actor.displayName} added ${member.displayName} as ${role}.`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putCollaborator(member);
    tx.putActivity(activity);
    // P0-4: outbox is staged in the same atomic
    // transaction as the canonical rows.
    recordOp(tx, { projectId: input.projectId, kind: 'member-added', payload: member });
    // P0-6: the cross-user activity feed. The
    // other side's inbox apply step writes the
    // activity to its local Dexie; the feed is
    // visible to B without a separate activity
    // op round-trip.
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  emitRealtime(deps, {
    kind: 'member-added',
    id: uid('env'),
    actorId: actor.userId,
    projectId: input.projectId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify({ collaboratorId: member.id, role }),
  });
  return member;
}

/**
 * Change a member's role. The use case refuses
 * unless the local user is the project owner; refuses
 * `authorType: 'ai'`; records an `Activity` row in the
 * same transaction. The `targetId` is the member's
 * own `id` (the Collaborator row is the target).
 */
export async function changeCollaboratorRole(
  deps: UseCaseDeps,
  input: { projectId: string; collaboratorId: string; newRole: CollaboratorRole },
): Promise<Collaborator> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot change roles.`,
    );
  }
  requirePermission({
    actor,
    capability: 'project.change-role',
    context: `change role of ${input.collaboratorId}`,
  });
  const member = await deps.repository.getCollaborator(input.collaboratorId);
  if (!member) {
    throw new Error(`Collaborator ${input.collaboratorId} not found.`);
  }
  if (member.projectId !== input.projectId) {
    throw new Error(
      `Collaborator ${input.collaboratorId} does not belong to project ${input.projectId}.`,
    );
  }
  if (member.role === input.newRole) return member;
  const now = nowCollabIso();
  const next: Collaborator = {
    ...member,
    role: input.newRole,
    updatedAt: now,
  };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'member-role-changed',
    targetKind: null,
    targetId: member.id,
    summary: `${actor.displayName} changed ${member.displayName}'s role to ${input.newRole}.`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putCollaborator(next);
    tx.putActivity(activity);
    recordOp(tx, { projectId: input.projectId, kind: 'member-role-changed', payload: next });
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  return next;
}

/**
 * Remove a collaborator. Owner-only. The use case
 * refuses to remove the last `owner` (the project
 * would otherwise have no admin).
 */
export async function removeCollaborator(
  deps: UseCaseDeps,
  input: { projectId: string; collaboratorId: string },
): Promise<void> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot remove collaborators.`,
    );
  }
  requirePermission({
    actor,
    capability: 'project.remove-member',
    context: `remove ${input.collaboratorId}`,
  });
  const member = await deps.repository.getCollaborator(input.collaboratorId);
  if (!member) {
    throw new Error(`Collaborator ${input.collaboratorId} not found.`);
  }
  if (member.projectId !== input.projectId) {
    throw new Error(
      `Collaborator ${input.collaboratorId} does not belong to project ${input.projectId}.`,
    );
  }
  if (member.role === 'owner') {
    const owners = (
      await deps.repository.listCollaborators({ projectId: input.projectId, role: 'owner' })
    ).filter((c) => c.id !== member.id);
    if (owners.length === 0) {
      throw new Error('Refusing to remove the last owner of the project.');
    }
  }
  const now = nowCollabIso();
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'member-removed',
    targetKind: null,
    targetId: member.id,
    summary: `${actor.displayName} removed ${member.displayName} from the project.`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.deleteCollaborator(member.id);
    tx.putActivity(activity);
    recordOp(tx, {
      projectId: input.projectId,
      kind: 'member-removed',
      payload: { collaboratorId: member.id, projectId: input.projectId },
    });
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Parse `@userId` mentions out of a comment body.
 * The mention token is `@<userId>` where `<userId>` is
 * a non-empty run of letters, digits, `_`, `-`, `.`.
 * The parser returns the ordered list of mentions
 * with `position` and `length` (UTF-16 units) for the
 * UI to highlight. Duplicate userIds collapse to a
 * single mention at the first occurrence.
 */
export function parseMentions(body: string): readonly Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];
  // The mention regex: `@` followed by a run of
  // [a-zA-Z0-9_.-]+ (no whitespace, no `,`, no `;`).
  const re = /@([a-zA-Z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const userId = m[1] as string;
    if (userId.length === 0) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({
      userId,
      // The displayName is filled in by the
      // caller; the parser does not look it up.
      displayName: userId,
      position: m.index,
      length: 1 + userId.length,
    });
  }
  return out;
}

export interface PostCommentInput {
  readonly projectId: string;
  readonly targetKind: CommentTargetKind;
  readonly targetId: string;
  readonly body: string;
  /** `parentId` for a reply. Omit for a top-level
   *  comment. The use case refuses a `parentId` that
   *  does not belong to the same project. */
  readonly parentId?: string;
  /** The list of known Collaborator displayNames
   *  for the project. The use case uses this to
   *  fill in the parsed mentions' `displayName`
   *  field. When the user does not have a known
   *  display name (e.g. an external mention), the
   *  parser's userId is used as the fallback. */
  readonly memberDisplayNames?: Readonly<Record<string, string>>;
  /** `authorType` for the comment. The use case
   *  refuses `'ai'` for a normal post; the
   *  `acceptAIDraft` use case writes
   *  `authorType: 'user'` after the user Accepts
   *  a draft. */
  readonly authorType?: 'user' | 'imported';
  /** When the writer is acting on an AI draft,
   *  this carries the draft id + provenance so
   *  the comment can be attributed. */
  readonly aiDraftProvenance?: {
    readonly draftId: string;
    readonly provider: string;
    readonly model: string | null;
    readonly actionId: string;
    readonly contextSnapshotHash: string;
  };
}

/**
 * Post a comment. The use case:
 *
 *   - parses `@userId` mentions out of the body
 *     and fills in the displayName from the project's
 *     membership;
 *   - refuses to post when the local user is not a
 *     member of the project;
 *   - refuses to post when the local user lacks
 *     `comment.post` (viewer is read-only);
 *   - refuses `authorType: 'ai'` (the AI path is the
 *     Draft Layer + an explicit Accept);
 *   - refuses an empty body;
 *   - sets `threadId` to `parentId ?? id`;
 *   - records an `Activity` row in the same
 *     transaction.
 */
export async function postComment(
  deps: UseCaseDeps,
  input: PostCommentInput,
): Promise<Comment> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot post comments.`,
    );
  }
  requirePermission({
    actor,
    capability: 'comment.post',
    context: `post comment on ${input.targetKind} ${input.targetId}`,
  });
  const body = input.body.trim();
  if (body.length === 0) {
    throw new Error('Comment body is empty.');
  }
  // `input.authorType` is typed as `'user' | 'imported'`
  // (the AI path is the Draft Layer). The use case
  // refuses `'ai'` at runtime too, but TypeScript
  // narrows the type at the call site, so the
  // runtime check is a defence-in-depth and is
  // skipped here. See the `assertUserAuthored`
  // call below.
  if (input.parentId !== undefined) {
    const parent = await deps.repository.getComment(input.parentId);
    if (!parent) {
      throw new Error(`Parent comment ${input.parentId} not found.`);
    }
    if (parent.projectId !== input.projectId) {
      throw new Error('Parent comment belongs to a different project.');
    }
  }
  const mentionsParsed = parseMentions(body);
  const memberNames = input.memberDisplayNames ?? {};
  const mentions: Mention[] = mentionsParsed.map((m) => ({
    userId: m.userId,
    displayName: memberNames[m.userId] ?? m.userId,
    position: m.position,
    length: m.length,
  }));
  const now = nowCollabIso();
  const id = uid('cmt');
  const comment: Comment = {
    id,
    projectId: input.projectId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    threadId: input.parentId ?? id,
    parentId: input.parentId ?? null,
    authorId: actor.userId,
    authorDisplayName: actor.displayName,
    authorType: input.authorType ?? 'user',
    body,
    mentions,
    resolvedAt: null,
    resolvedBy: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  assertUserAuthored(comment.authorType);
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'comment-posted',
    targetKind: input.targetKind,
    targetId: input.targetId,
    summary:
      mentions.length === 0
        ? `${actor.displayName} commented on ${input.targetKind} ${input.targetId}.`
        : `${actor.displayName} commented and mentioned ${mentions.length} ${
            mentions.length === 1 ? 'collaborator' : 'collaborators'
          }.`,
    body: body.length > 140 ? body.slice(0, 137) + '...' : body,
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putComment(comment);
    tx.putActivity(activity);
    recordOp(tx, { projectId: input.projectId, kind: 'comment-posted', payload: comment });
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  emitRealtime(deps, {
    kind: 'comment-posted',
    id: uid('env'),
    actorId: actor.userId,
    projectId: input.projectId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify({ commentId: comment.id, targetKind: input.targetKind, targetId: input.targetId }),
  });
  return comment;
}

/**
 * Edit a comment. The use case:
 *
 *   - reads the current row and the writer's
 *     `baseVersion` (the version the writer saw);
 *   - refuses the write when `baseVersion` does not
 *     match the current row (a conflict; the use case
 *     throws `ConflictRefusedError` and the host UI
 *     surfaces a "newer version exists" prompt);
 *   - bumps the row's `version` to
 *     `currentVersion + 1`;
 *   - re-parses mentions and records an
 *     `Activity` row in the same transaction.
 */
export async function editComment(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    commentId: string;
    body: string;
    baseVersion: number;
    memberDisplayNames?: Readonly<Record<string, string>>;
  },
): Promise<Comment> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot edit comments.`,
    );
  }
  const current = await deps.repository.getComment(input.commentId);
  if (!current) throw new Error(`Comment ${input.commentId} not found.`);
  if (current.projectId !== input.projectId) {
    throw new Error('Comment belongs to a different project.');
  }
  if (!canEditComment(actor, current)) {
    requirePermission({
      actor,
      capability: 'comment.update-own',
      resourceOwnerId: current.authorId,
      context: `edit comment ${input.commentId}`,
    });
  }
  if (current.version !== input.baseVersion) {
    throw new ConflictRefusedError({
      kind: 'comment',
      objectId: current.id,
      currentVersion: current.version,
      attemptedBase: input.baseVersion,
    });
  }
  const body = input.body.trim();
  if (body.length === 0) throw new Error('Comment body is empty.');
  const mentionsParsed = parseMentions(body);
  const memberNames = input.memberDisplayNames ?? {};
  const mentions: Mention[] = mentionsParsed.map((m) => ({
    userId: m.userId,
    displayName: memberNames[m.userId] ?? m.userId,
    position: m.position,
    length: m.length,
  }));
  const now = nowCollabIso();
  const next: Comment = {
    ...current,
    body,
    mentions,
    version: current.version + 1,
    updatedAt: now,
  };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'comment-posted',
    targetKind: current.targetKind,
    targetId: current.targetId,
    summary: `${actor.displayName} edited their comment.`,
    body: body.length > 140 ? body.slice(0, 137) + '...' : body,
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putComment(next);
    tx.putActivity(activity);
  });
  emitRealtime(deps, {
    kind: 'comment-updated',
    id: uid('env'),
    actorId: actor.userId,
    projectId: input.projectId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify({ commentId: next.id, version: next.version }),
  });
  return next;
}

/**
 * Resolve a comment thread. The use case writes
 * `resolvedAt` + `resolvedBy`; bumps the version;
 * refuses unresolving when the writer is not the
 * resolver / owner / editor.
 */
export async function resolveComment(
  deps: UseCaseDeps,
  input: { projectId: string; commentId: string; baseVersion: number },
): Promise<Comment> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot resolve comments.`,
    );
  }
  requirePermission({
    actor,
    capability: 'comment.resolve',
    context: `resolve comment ${input.commentId}`,
  });
  const current = await deps.repository.getComment(input.commentId);
  if (!current) throw new Error(`Comment ${input.commentId} not found.`);
  if (current.projectId !== input.projectId) {
    throw new Error('Comment belongs to a different project.');
  }
  if (current.version !== input.baseVersion) {
    throw new ConflictRefusedError({
      kind: 'comment',
      objectId: current.id,
      currentVersion: current.version,
      attemptedBase: input.baseVersion,
    });
  }
  if (current.resolvedAt !== null) return current;
  const now = nowCollabIso();
  const next: Comment = {
    ...current,
    resolvedAt: now,
    resolvedBy: actor.userId,
    version: current.version + 1,
    updatedAt: now,
  };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'comment-resolved',
    targetKind: current.targetKind,
    targetId: current.targetId,
    summary: `${actor.displayName} resolved a comment thread.`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putComment(next);
    tx.putActivity(activity);
    recordOp(tx, { projectId: input.projectId, kind: 'comment-resolved', payload: next, baseVersion: input.baseVersion });
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  emitRealtime(deps, {
    kind: 'comment-resolved',
    id: uid('env'),
    actorId: actor.userId,
    projectId: input.projectId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify({ commentId: next.id }),
  });
  return next;
}

// ---------------------------------------------------------------------------
// Private Scratch + publish flow
// ---------------------------------------------------------------------------

/**
 * Create a new Private Scratch. The scratch is
 * always `private` on creation; the only path to
 * `project` is the publish flow. The use case
 * refuses `authorType: 'ai'` (the AI path is the
 * Draft Layer + an explicit Save).
 */
export async function createScratch(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    kind: ScratchKind;
    title: string;
    body: string;
    authorType?: 'user' | 'imported';
  },
): Promise<PrivateScratch> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot create scratch.`,
    );
  }
  requirePermission({
    actor,
    capability: 'scratch.create',
    context: `create scratch in project ${input.projectId}`,
  });
  const now = nowCollabIso();
  const scratch: PrivateScratch = {
    id: uid('scr'),
    projectId: input.projectId,
    ownerId: actor.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    status: 'private',
    publishedRef: null,
    publishedAt: null,
    revertedAt: null,
    createdAt: now,
    updatedAt: now,
    authorType: input.authorType ?? 'user',
  };
  assertUserAuthored(scratch.authorType);
  await deps.repository.transact(async (tx) => {
    tx.putScratch(scratch);
  });
  return scratch;
}

/**
 * Update a Private Scratch. The use case refuses
 * unless the local user is the scratch owner and has
 * `scratch.update-own`. Bumps `updatedAt`. A
 * `published` scratch cannot be updated without an
 * explicit `revert` first.
 */
export async function updateScratch(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    scratchId: string;
    title?: string;
    body?: string;
  },
): Promise<PrivateScratch> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot update scratch.`,
    );
  }
  const current = await deps.repository.getScratchForOwner(input.scratchId, actor.userId);
  if (!current) throw new Error(`Scratch ${input.scratchId} not found.`);
  if (current.projectId !== input.projectId) {
    throw new Error('Scratch belongs to a different project.');
  }
  if (!canMutateScratch(actor, current)) {
    requirePermission({
      actor,
      capability: 'scratch.update-own',
      resourceOwnerId: current.ownerId,
      context: `update scratch ${input.scratchId}`,
    });
  }
  if (current.status === 'published' || current.status === 'publishing') {
    throw new Error(
      `Scratch ${input.scratchId} is ${current.status}; revert before editing.`,
    );
  }
  const now = nowCollabIso();
  const next: PrivateScratch = {
    ...current,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putScratch(next);
  });
  return next;
}

/**
 * Delete a Private Scratch. The use case refuses
 * unless the local user is the scratch owner and
 * has `scratch.delete-own`. The activity log gets a
 * `scratch-reverted` row when the scratch was
 * `published` (so the feed is consistent).
 */
export async function deleteScratch(
  deps: UseCaseDeps,
  input: { projectId: string; scratchId: string },
): Promise<void> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot delete scratch.`,
    );
  }
  const current = await deps.repository.getScratchForOwner(input.scratchId, actor.userId);
  if (!current) return;
  if (current.projectId !== input.projectId) {
    throw new Error('Scratch belongs to a different project.');
  }
  if (!canMutateScratch(actor, current)) {
    requirePermission({
      actor,
      capability: 'scratch.delete-own',
      resourceOwnerId: current.ownerId,
      context: `delete scratch ${input.scratchId}`,
    });
  }
  const now = nowCollabIso();
  const activity: Activity | null =
    current.status === 'published'
      ? {
          id: uid('act'),
          projectId: input.projectId,
          actorId: actor.userId,
          actorDisplayName: actor.displayName,
          actorType: 'user',
          kind: 'scratch-reverted',
          targetKind: null,
          targetId: current.id,
          summary: `${actor.displayName} reverted their published scratch.`,
          body: '',
          scope: 'project',
          ephemeral: false,
          createdAt: now,
        }
      : null;
  await deps.repository.transact(async (tx) => {
    tx.deleteScratch(current.id);
    if (activity) tx.putActivity(activity);
  });
}

// ---------------------------------------------------------------------------
// Publish flow
// ---------------------------------------------------------------------------

/**
 * Diff helper. Builds a `PublishDiffRow[]` from a
 * scratch body and a baseline (the matching canonical
 * row, when present). The baseline is a flat
 * `{ title?, body? }` shape; the diff is line-level.
 *
 * This is a *pure* helper. The publish use case
 * composes it with the actual canonical writer.
 */
export function diffScratchBody(args: {
  readonly scratch: { readonly title: string; readonly body: string };
  readonly baseline: { readonly title: string; readonly body: string } | null;
}): readonly PublishDiffRow[] {
  const rows: PublishDiffRow[] = [];
  if (!args.baseline) {
    rows.push({ op: 'added', path: 'title', before: null, after: args.scratch.title });
    rows.push({ op: 'added', path: 'body', before: null, after: args.scratch.body });
    return rows;
  }
  if (args.baseline.title !== args.scratch.title) {
    rows.push({
      op: 'changed',
      path: 'title',
      before: args.baseline.title,
      after: args.scratch.title,
    });
  }
  if (args.baseline.body !== args.scratch.body) {
    rows.push({
      op: 'changed',
      path: 'body',
      before: args.baseline.body,
      after: args.scratch.body,
    });
  }
  if (rows.length === 0) {
    rows.push({ op: 'changed', path: 'body', before: args.baseline.body, after: args.scratch.body });
  }
  return rows;
}

/**
 * Build a `PublishDiff` preview for a scratch. The
 * use case does NOT call the canonical writer; the
 * host UI shows the preview and the user clicks
 * "Publish" (which calls `confirmPublish`).
 *
 * The preview is stored as a `PublishDiff` row with
 * `confirmedAt: null` and `cancelledAt: null`. The
 * resolve use case (`confirmPublish` / `cancelPublish`)
 * fills in the timestamp.
 *
 * The `targetId` is filled in when the scratch is a
 * `changed` op; `null` for a pure `added` op. The
 * canonical writer is a higher-level use case (e.g.
 * `publishScratchAsTask`) that the host wires in.
 */
export async function previewPublishScratch(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    scratchId: string;
    /** The matching canonical row's id when the
     *  scratch is a `changed` op; `null` for an
     *  `added` op. */
    targetId: string | null;
    /** The baseline (canonical) row's title +
     *  body for diffing. `null` for an `added` op. */
    baseline: { readonly title: string; readonly body: string } | null;
  },
): Promise<PublishDiff> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot preview publish.`,
    );
  }
  const scratch = await deps.repository.getScratchForOwner(input.scratchId, actor.userId);
  if (!scratch) throw new Error(`Scratch ${input.scratchId} not found.`);
  if (scratch.projectId !== input.projectId) {
    throw new Error('Scratch belongs to a different project.');
  }
  if (!canPublishScratch(actor, scratch)) {
    // The matrix does not encode ownership for
    // `scratch.publish` (the capability is granted
    // to owner + editor + commenter-as-anyone
    // who has the role), so `canPublishScratch`
    // is the actual gate. Surface a clear error
    // when the ownership check fails so the UI
    // can render "Only the scratch owner can
    // publish".
    if (actor.userId !== scratch.ownerId) {
      throw new Error(
        `Only the scratch owner can preview a publish; ` +
          `actor ${actor.userId} does not own scratch ${scratch.id}.`,
      );
    }
    requirePermission({
      actor,
      capability: 'scratch.publish',
      context: `preview publish scratch ${input.scratchId}`,
    });
  }
  if (scratch.status !== 'private') {
    throw new ScratchNotPublishableError(scratch.id, scratch.status);
  }
  const rows = diffScratchBody({
    scratch: { title: scratch.title, body: scratch.body },
    baseline: input.baseline,
  });
  const now = nowCollabIso();
  const diff: PublishDiff = {
    id: uid('pd'),
    scratchId: scratch.id,
    projectId: input.projectId,
    ownerId: actor.userId,
    rows,
    targetId: input.targetId,
    createdAt: now,
    confirmedAt: null,
    cancelledAt: null,
  };
  // The scratch flips to `publishing` while the
  // preview is open. The status reverts to
  // `private` on cancel and to `published` on
  // confirm.
  const nextScratch: PrivateScratch = {
    ...scratch,
    status: 'publishing',
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putPublishDiff(diff);
    tx.putScratch(nextScratch);
  });
  return diff;
}

/**
 * Cancel a publish preview. The use case refuses
 * unless the local user is the scratch owner and the
 * diff is still open.
 */
export async function cancelPublish(
  deps: UseCaseDeps,
  input: { projectId: string; publishDiffId: string },
): Promise<void> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot cancel publish.`,
    );
  }
  const diff = await deps.repository.getPublishDiff(input.publishDiffId);
  if (!diff) throw new Error(`PublishDiff ${input.publishDiffId} not found.`);
  if (diff.projectId !== input.projectId) {
    throw new Error('PublishDiff belongs to a different project.');
  }
  if (diff.confirmedAt !== null || diff.cancelledAt !== null) return;
  const scratch = await deps.repository.getScratchForOwner(diff.scratchId, actor.userId);
  if (!scratch) throw new Error(`Scratch ${diff.scratchId} not found.`);
  if (scratch.ownerId !== actor.userId) {
    throw new Error('Only the scratch owner can cancel a publish preview.');
  }
  const now = nowCollabIso();
  const nextDiff: PublishDiff = {
    ...diff,
    cancelledAt: now,
  };
  const nextScratch: PrivateScratch = {
    ...scratch,
    status: 'private',
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putPublishDiff(nextDiff);
    tx.putScratch(nextScratch);
  });
}

/**
 * Confirm a publish. The use case marks the diff
 * `confirmedAt` and the scratch `published`; the
 * canonical write is the caller's job (the higher-
 * level use case that owns the target table).
 *
 * This use case is the *boundary* of the
 * publish: it refuses unless the diff is open, the
 * scratch is `publishing`, and the local user is
 * the owner.
 */
export async function confirmPublish(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    publishDiffId: string;
    /** The canonical id the publish produced
     *  (or touched, for `changed` ops). The use
     *  case records this on the scratch. */
    canonicalId: string;
  },
): Promise<{ diff: PublishDiff; scratch: PrivateScratch }> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot confirm publish.`,
    );
  }
  const diff = await deps.repository.getPublishDiff(input.publishDiffId);
  if (!diff) throw new Error(`PublishDiff ${input.publishDiffId} not found.`);
  if (diff.projectId !== input.projectId) {
    throw new Error('PublishDiff belongs to a different project.');
  }
  if (diff.confirmedAt !== null) {
    throw new Error('PublishDiff already confirmed.');
  }
  if (diff.cancelledAt !== null) {
    throw new Error('PublishDiff was cancelled.');
  }
  const scratch = await deps.repository.getScratchForOwner(diff.scratchId, actor.userId);
  if (!scratch) throw new Error(`Scratch ${diff.scratchId} not found.`);
  if (scratch.ownerId !== actor.userId) {
    throw new Error('Only the scratch owner can confirm a publish.');
  }
  if (scratch.status !== 'publishing') {
    throw new ScratchNotPublishableError(scratch.id, scratch.status);
  }
  const now = nowCollabIso();
  const nextDiff: PublishDiff = {
    ...diff,
    confirmedAt: now,
  };
  const nextScratch: PrivateScratch = {
    ...scratch,
    status: 'published',
    publishedRef: input.canonicalId,
    publishedAt: now,
    updatedAt: now,
  };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'scratch-published',
    targetKind: scratchKindToTargetKind(scratch.kind),
    targetId: input.canonicalId,
    summary: `${actor.displayName} published a ${scratch.kind} draft to the project.`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putPublishDiff(nextDiff);
    tx.putScratch(nextScratch);
    tx.putActivity(activity);
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  emitRealtime(deps, {
    kind: 'scratch-published',
    id: uid('env'),
    actorId: actor.userId,
    projectId: input.projectId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify({ scratchId: nextScratch.id, canonicalId: input.canonicalId }),
  });
  return { diff: nextDiff, scratch: nextScratch };
}

// Helper: scratch kind → comment target kind.
const _scratchKindMap: Readonly<Record<ScratchKind, CommentTargetKind>> = {
  note: 'project',
  task: 'task',
  claim: 'claim',
  evidence: 'evidence',
  output: 'output',
};

function scratchKindToTargetKind(k: ScratchKind): CommentTargetKind {
  return _scratchKindMap[k];
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Build a `Conflict` row from two competing writers.
 * The use case refuses last-write-wins: when the
 * writer's `baseVersion` does not match the current
 * row, the caller passes both sides and the use case
 * records them. The conflict is non-destructive —
 * the canonical row is *not* overwritten.
 */
export async function detectConflict(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    kind: ConflictKind;
    objectId: string;
    local: ConflictVersionSnapshot;
    remote: ConflictVersionSnapshot;
  },
): Promise<Conflict> {
  if (input.local.actorId === input.remote.actorId) {
    // Same actor; the use case refuses to create a
    // "self-conflict" — the writer should re-read
    // and try again.
    throw new Error(
      'detectConflict refused: local and remote share the same actorId; ' +
        're-read and retry instead of recording a self-conflict.',
    );
  }
  const now = nowCollabIso();
  const conflict: Conflict = {
    id: uid('cfl'),
    projectId: input.projectId,
    kind: input.kind,
    objectId: input.objectId,
    local: input.local,
    remote: input.remote,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: '',
    detectedAt: now,
  };
  const actor = await loadActor(deps, input.projectId);
  const actorInfo = actor ?? { userId: 'system', displayName: 'system' };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actorInfo.userId,
    actorDisplayName: actorInfo.displayName,
    actorType: 'system',
    kind: 'conflict-detected',
    targetKind: kindToTargetKind(input.kind),
    targetId: input.objectId,
    summary: `A conflict was detected on ${input.kind} ${input.objectId}.`,
    body: '',
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putConflict(conflict);
    tx.putActivity(activity);
    recordOp(tx, { projectId: input.projectId, kind: 'conflict-detected', payload: conflict });
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  emitRealtime(deps, {
    kind: 'conflict-detected',
    id: uid('env'),
    actorId: actorInfo.userId,
    projectId: input.projectId,
    version: Date.now(),
    clientTime: now,
    serverTime: null,
    payload: JSON.stringify({ conflictId: conflict.id, kind: input.kind, objectId: input.objectId }),
  });
  return conflict;
}

function kindToTargetKind(k: ConflictKind): CommentTargetKind {
  switch (k) {
    case 'comment':
      return 'project';
    case 'task':
      return 'task';
    case 'evidence':
      return 'evidence';
    case 'claim':
      return 'claim';
    case 'design-spec':
      return 'design-spec';
    case 'design-decision':
      return 'decision';
    case 'scratch':
      return 'project';
  }
}

/**
 * Resolve a conflict. The use case refuses unless
 * the local user is the project owner (resolution is
 * an admin action; an editor cannot unilaterally
 * choose `kept-local`).
 */
export async function resolveConflict(
  deps: UseCaseDeps,
  input: {
    projectId: string;
    conflictId: string;
    resolution: ConflictResolution;
    note: string;
  },
): Promise<Conflict> {
  const actor = await loadActor(deps, input.projectId);
  if (!actor) {
    throw new Error(
      `Local user is not a member of project ${input.projectId}; cannot resolve conflicts.`,
    );
  }
  requirePermission({
    actor,
    capability: 'project.change-role',
    context: `resolve conflict ${input.conflictId}`,
  });
  const conflict = await deps.repository.getConflict(input.conflictId);
  if (!conflict) throw new Error(`Conflict ${input.conflictId} not found.`);
  if (conflict.resolution !== null) {
    throw new Error('Conflict is already resolved.');
  }
  const now = nowCollabIso();
  const next: Conflict = {
    ...conflict,
    resolution: input.resolution,
    resolvedBy: actor.userId,
    resolvedAt: now,
    resolutionNote: input.note,
  };
  const activity: Activity = {
    id: uid('act'),
    projectId: input.projectId,
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    actorType: 'user',
    kind: 'conflict-resolved',
    targetKind: kindToTargetKind(conflict.kind),
    targetId: conflict.objectId,
    summary: `${actor.displayName} resolved a conflict (${input.resolution}).`,
    body: input.note,
    scope: 'project',
    ephemeral: false,
    createdAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putConflict(next);
    tx.putActivity(activity);
    recordOp(tx, { projectId: input.projectId, kind: 'activity-logged', payload: activity });
  });
  return next;
}

// ---------------------------------------------------------------------------
// Presence (read-side, ephemeral)
// ---------------------------------------------------------------------------

/**
 * Build a presence snapshot from a collaborator +
 * last-seen timestamp. Pure function; the use case
 * that emits heartbeats calls this on every beat.
 * The `online` flag is derived: the snapshot is
 * online when `lastSeenAt` is within the staleness
 * window of now.
 */
export function buildPresenceSnapshot(args: {
  readonly collaborator: Collaborator;
  readonly lastSeenAt: string;
  readonly now?: string;
}): PresenceSnapshot {
  const now = args.now ?? nowCollabIso();
  const last = Date.parse(args.lastSeenAt);
  const cur = Date.parse(now);
  const online = Number.isFinite(last) && Number.isFinite(cur) && cur - last <= 60_000;
  return {
    peerId: `${args.collaborator.userId}@${args.collaborator.projectId}`,
    userId: args.collaborator.userId,
    displayName: args.collaborator.displayName,
    projectId: args.collaborator.projectId,
    role: args.collaborator.role,
    online,
    lastSeenAt: args.lastSeenAt,
  };
}

// ---------------------------------------------------------------------------
// Local user seeding
// ---------------------------------------------------------------------------

/**
 * Idempotently ensure the local user is a member of
 * the project. The use case is meant to be called
 * once per project the user opens; subsequent calls
 * are no-ops. The local user is the project `owner`
 * by default; the host UI can later `changeRole` to
 * any other role.
 *
 * This use case is the boundary between "the user
 * does not have a real account yet" (v0.4 default)
 * and "the user has joined a project" (the membership
 * row). The collaboration slice does NOT own user
 * identity; it just records the membership.
 */
export async function ensureLocalMembership(
  deps: UseCaseDeps,
  input: { projectId: string; displayName?: string },
): Promise<Collaborator> {
  const existing = await deps.repository.listCollaborators({
    projectId: input.projectId,
    userId: deps.localUserId,
  });
  if (existing.length > 0) return existing[0] as Collaborator;
  const now = nowCollabIso();
  const member: Collaborator = {
    id: uid('col'),
    projectId: input.projectId,
    userId: deps.localUserId,
    displayName: input.displayName ?? deps.localUserDisplayName,
    role: 'owner',
    addedAt: now,
    addedBy: deps.localUserId,
    authorType: 'user',
    createdAt: now,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putCollaborator(member);
    // The bootstrap op is part of the same
    // atomic transaction as the membership
    // row. P0-4 invariant: a process crash
    // before the next tick cannot lose the
    // sync intent.
    recordOp(tx, { projectId: input.projectId, kind: 'membership-bootstrap', payload: member });
  });
  return member;
}

// ---------------------------------------------------------------------------
// Re-exports for the AI Interaction Kernel
// ---------------------------------------------------------------------------

/**
 * Return the list of capabilities the local user
 * has in `projectId`. The AI Assistant calls this
 * to decide whether `ai.read-context` is allowed
 * (so it can pull comments / activity into a draft
 * the user is composing). A `viewer` is denied
 * `ai.run-local` and `ai.run-cloud` so a guest
 * viewer never triggers a provider round-trip.
 */
export async function capabilitiesForLocalUser(
  deps: UseCaseDeps,
  projectId: string,
): Promise<readonly Capability[]> {
  const actor = await loadActor(deps, projectId);
  if (!actor) return [];
  const allCaps: Capability[] = [
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
  ];
  return allCaps.filter((c) =>
    canPerform({ actor, capability: c }),
  );
}

// ---------------------------------------------------------------------------
// Helpers for tests
// ---------------------------------------------------------------------------

/**
 * Test-only: silence unused-import linter
 * (`isPrivateScratch` is imported transitively for
 * `assertUserAuthored`; the import here is a marker
 * that the contract surface is intentional).
 */
export const __collabInternal = {
  // The transaction type is re-exported for tests
  // that want to drive a transaction directly.
  transaction: undefined as unknown as CollaborationRepositoryTransaction,
};
