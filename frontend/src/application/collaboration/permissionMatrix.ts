/**
 * StudyKit v0.4 — `application/collaboration/permissionMatrix`
 *
 * The single source of truth for "can this actor do X
 * in this project?" across the collaboration slice.
 *
 * Why a separate module? Because the *shape* of the
 * matrix is data, not code: a new role or a new
 * capability should be one row / one column, not a
 * cascade of `if (role === 'editor')` checks. This
 * file owns the matrix; every use case calls
 * `canPerform(actor, capability)`. Components and AI
 * actions also call this; nothing branches on the
 * role string directly.
 *
 * Design rules (per the v0.4 spec:
 * studykit_v0.4_research_mode_ai_native_spec_cn.md §5.10
 * "成员与空间" + §5.4 "权限与内容层" + the WP-08 brief):
 *
 *   - `owner`     — full control. The only role that
 *                   can invite, change roles, remove
 *                   members, delete the project, or
 *                   resolve any conflict. (Single owner
 *                   per project in v0.4; transferring
 *                   ownership is future work.)
 *   - `editor`    — can write to the canonical
 *                   project: tasks, evidence, claims,
 *                   design, outputs, comments, mentions.
 *                   Can also create, publish, and
 *                   delete *their own* Private Scratch.
 *                   Cannot invite / remove / change
 *                   role.
 *   - `commenter` — can read everything in the project
 *                   and post comments + mentions on
 *                   shared objects. Cannot write
 *                   canonical rows (no task create,
 *                   no design decide, no scratch
 *                   publish).
 *   - `viewer`    — read-only. Cannot post, cannot
 *                   create, cannot publish.
 *
 * The matrix below is also used by the AI Interaction
 * Kernel: any AI action that wants to read collaboration
 * context must hold `ai.read-context`; running a
 * local AI requires `ai.run-local`; running a cloud
 * AI requires `ai.run-cloud`. These are denied to
 * `viewer` (so a guest viewer does not silently
 * trigger a cloud AI run on shared data).
 *
 * The local user is the *actor*; the matrix does
 * not deal with anonymous or system actors — those
 * are encoded as `actorType: 'system'` in the
 * Activity log and never touch the permission
 * matrix.
 */

import type {
  Capability,
  Collaborator,
  CollaboratorRole,
  Comment,
  PrivateScratch,
} from '../../domain/collaboration';

// ---------------------------------------------------------------------------
// Role → capability matrix
// ---------------------------------------------------------------------------

/**
 * The mapping from `CollaboratorRole` to the set of
 * capabilities that role grants. The matrix is the
 * single source of truth; every other file calls
 * `canPerform` rather than reading this table.
 *
 * The "owns" capabilities (e.g. `comment.update-own`,
 * `scratch.delete-own`) are *gated by ownership* in
 * addition to role: the matrix grants the capability,
 * but `canPerform` returns `false` when the actor is
 * not the owner of the target row. See
 * `canPerform` for the ownership check.
 */
const ROLE_CAPABILITIES: Readonly<Record<CollaboratorRole, ReadonlySet<Capability>>> = Object.freeze({
  owner: new Set<Capability>([
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
    'ai-thread.read',
    'ai-thread.post',
  ]),
  editor: new Set<Capability>([
    'project.read',
    'comment.read',
    'comment.post',
    'comment.update-own',
    'comment.update-any',
    'comment.resolve',
    'comment.delete-own',
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
    'ai-thread.read',
    'ai-thread.post',
  ]),
  commenter: new Set<Capability>([
    'project.read',
    'comment.read',
    'comment.post',
    'comment.update-own',
    'comment.delete-own',
    'mention.use',
    'task.read',
    'scratch.read-own',
    'scratch.create',
    'scratch.update-own',
    'scratch.delete-own',
    'evidence.read',
    'claim.read',
    'design.read',
    'output.read',
    'ai.read-context',
    'ai-thread.read',
  ]),
  viewer: new Set<Capability>([
    'project.read',
    'comment.read',
    'task.read',
    'evidence.read',
    'claim.read',
    'design.read',
    'output.read',
    'ai-thread.read',
  ]),
});

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/**
 * The actor the matrix consults. A real Collaborator
 * row is the normal input; tests / system code can
 * pass an anonymous `{ userId, role }` shape for a
 * system actor that has no membership row.
 */
export interface Actor {
  readonly userId: string;
  readonly displayName: string;
  readonly role: CollaboratorRole;
}

// ---------------------------------------------------------------------------
// Permission error
// ---------------------------------------------------------------------------

/**
 * Thrown by use cases when `canPerform` returns
 * `false`. The use case catches this and surfaces a
 * human-readable error to the UI; the matrix never
 * throws on its own.
 */
export class PermissionDeniedError extends Error {
  readonly actorId: string;
  readonly capability: Capability;
  readonly role: CollaboratorRole;
  readonly context: string;
  constructor(args: {
    actorId: string;
    capability: Capability;
    role: CollaboratorRole;
    context: string;
  }) {
    super(
      `Permission denied: actor ${args.actorId} (role=${args.role}) cannot perform ` +
        `${args.capability} in ${args.context}.`,
    );
    this.name = 'PermissionDeniedError';
    this.actorId = args.actorId;
    this.capability = args.capability;
    this.role = args.role;
    this.context = args.context;
  }
}

// ---------------------------------------------------------------------------
// Public matrix API
// ---------------------------------------------------------------------------

/**
 * Capabilities that are *role-gated only* (no
 * ownership check on top). Reading the project,
 * posting a comment, running an AI: all of these
 * work for *any* member of the role, regardless of
 * who owns the target row.
 */
const NO_OWNERSHIP_CHECK: ReadonlySet<Capability> = new Set<Capability>([
  'project.read',
  'project.invite',
  'project.remove-member',
  'project.change-role',
  'project.delete',
  'comment.read',
  'comment.post',
  'comment.resolve',
  'comment.update-any',
  'comment.delete-any',
  'mention.use',
  'task.read',
  'task.create',
  'task.assign',
  'task.complete',
  'scratch.create',
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
]);

/**
 * Capabilities that require the actor to be the
 * *owner* of the target row. The matrix checks
 * `resourceOwnerId === actor.userId`.
 */
const OWNERSHIP_GUARDED: ReadonlySet<Capability> = new Set<Capability>([
  'comment.update-own',
  'comment.delete-own',
  'scratch.read-own',
  'scratch.update-own',
  'scratch.delete-own',
]);

/**
 * Return `true` when `actor` may perform `capability`
 * in this project. Pure function; no I/O, no time
 * side-effects.
 *
 * `resourceOwnerId` is required for the ownership-
 * guarded capabilities (e.g. `comment.update-own`).
 * The caller passes the *target row's* owner. For
 * role-gated capabilities the owner argument is
 * ignored.
 */
export function canPerform(args: {
  readonly actor: Actor;
  readonly capability: Capability;
  /** The owner of the target row. Required for
   *  ownership-guarded capabilities; ignored
   *  for role-gated ones. */
  readonly resourceOwnerId?: string;
}): boolean {
  const caps = ROLE_CAPABILITIES[args.actor.role];
  if (!caps.has(args.capability)) return false;
  if (!OWNERSHIP_GUARDED.has(args.capability)) return true;
  if (args.resourceOwnerId === undefined) {
    // Ownership-guarded capability without an owner
    // is a programming error in the caller; we
    // return `false` rather than throwing so the
    // matrix stays pure.
    return false;
  }
  return args.resourceOwnerId === args.actor.userId;
}

/**
 * The same as `canPerform` but throws a
 * `PermissionDeniedError` when the answer is
 * `false`. Use cases that need to refuse a write
 * call this; the UI never calls `requirePermission`
 * directly (it reads the error code).
 */
export function requirePermission(args: {
  readonly actor: Actor;
  readonly capability: Capability;
  readonly resourceOwnerId?: string;
  readonly context: string;
}): void {
  if (
    !canPerform({
      actor: args.actor,
      capability: args.capability,
      ...(args.resourceOwnerId !== undefined ? { resourceOwnerId: args.resourceOwnerId } : {}),
    })
  ) {
    throw new PermissionDeniedError({
      actorId: args.actor.userId,
      capability: args.capability,
      role: args.actor.role,
      context: args.context,
    });
  }
}

/**
 * Build an `Actor` from a `Collaborator` row. The
 * matrix is a pure function; the use case that has
 * the `Collaborator` calls this once and passes the
 * result to `canPerform` / `requirePermission`.
 */
export function actorFromCollaborator(c: Collaborator): Actor {
  return { userId: c.userId, displayName: c.displayName, role: c.role };
}

// ---------------------------------------------------------------------------
// Domain-specific convenience predicates
// ---------------------------------------------------------------------------

/**
 * True when the actor may edit the comment body.
 * `owner` can edit any (`comment.update-any`).
 * `editor` and `commenter` can edit their own
 * (`comment.update-own`). `viewer` cannot edit.
 */
export function canEditComment(actor: Actor, comment: Comment): boolean {
  if (canPerform({ actor, capability: 'comment.update-any' })) return true;
  return canPerform({
    actor,
    capability: 'comment.update-own',
    resourceOwnerId: comment.authorId,
  });
}

/**
 * True when the actor may delete the comment.
 * `owner` can delete any (`comment.delete-any`).
 * `editor` and `commenter` can delete their own
 * (`comment.delete-own`). `viewer` cannot delete.
 */
export function canDeleteComment(actor: Actor, comment: Comment): boolean {
  if (canPerform({ actor, capability: 'comment.delete-any' })) return true;
  return canPerform({
    actor,
    capability: 'comment.delete-own',
    resourceOwnerId: comment.authorId,
  });
}

/**
 * True when the actor may update / delete a
 * `PrivateScratch`. Only the owner of the scratch
 * (i.e. the row's `ownerId`) can mutate it; the
 * role gates the existence of the capability.
 */
export function canMutateScratch(actor: Actor, scratch: PrivateScratch): boolean {
  if (actor.userId !== scratch.ownerId) return false;
  if (actor.role === 'owner' || actor.role === 'editor') {
    return canPerform({ actor, capability: 'scratch.update-own' });
  }
  // Commenters may keep their own scratch; viewers
  // cannot.
  return canPerform({
    actor,
    capability: 'scratch.update-own',
    resourceOwnerId: scratch.ownerId,
  });
}

/**
 * True when the actor may *publish* a
 * `PrivateScratch`. Only the scratch owner can
 * publish; viewer cannot publish (the matrix
 * never grants `scratch.publish` to viewer).
 */
export function canPublishScratch(actor: Actor, scratch: PrivateScratch): boolean {
  if (actor.userId !== scratch.ownerId) return false;
  return canPerform({ actor, capability: 'scratch.publish' });
}

/**
 * List the capabilities a role has. The UI uses
 * this when rendering the "Member permissions" pill
 * next to a role; the matrix tests use it to assert
 * the table.
 */
export function capabilitiesForRole(role: CollaboratorRole): readonly Capability[] {
  return Array.from(ROLE_CAPABILITIES[role]);
}

/**
 * True when `capability` requires the actor to be
 * the owner of the target row. Used by the use
 * cases to decide whether to pass
 * `resourceOwnerId` to `canPerform`.
 */
export function isOwnershipGuarded(capability: Capability): boolean {
  return OWNERSHIP_GUARDED.has(capability);
}
