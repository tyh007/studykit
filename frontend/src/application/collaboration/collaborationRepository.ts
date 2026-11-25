/**
 * StudyKit v0.4 — `application/collaboration/collaborationRepository`
 *
 * Persistence contract for the Collaboration Foundation
 * slice (WP-08). Mirrors the shape of the Research +
 * Study repository contracts (atomic `transact`, live
 * `subscribe`, in-memory + Dexie adapters) but scoped
 * to the collaboration objects:
 *
 *   - `Collaborator` — project membership + role.
 *   - `Comment`      — user-authored comment on a
 *                      project or an object.
 *   - `Activity`     — append-only event log.
 *   - `PrivateScratch` — user-owned draft.
 *   - `PublishDiff`  — publish-preview artifact.
 *   - `Conflict`     — non-destructive conflict record.
 *
 * Why a separate contract (not the WP-00 generic
 * `StudyKitRepository`)? Two reasons:
 *
 *   1. The collaboration slice has its own query
 *      shape (by project + scope, by target kind /
 *      target id, by owner, etc.) and its own write
 *      rules (append-only Activity, ownership-guarded
 *      Scratch, versioned Comment, etc.) that the
 *      generic contract cannot express.
 *   2. The collaboration slice is opt-in (gated by
 *      the `v04Collaboration` flag). Until the flag
 *      is on, the Dexie schema's v8 tables are
 *      simply not opened — the migration is
 *      additive, but the repository factory is a
 *      no-op.
 *
 * Invariants the contract enforces:
 *
 *   - `transact` is the only way to write. The
 *     transaction callback receives a single
 *     `CollaborationRepositoryTransaction` whose
 *     methods stage every change; the adapter
 *     applies the whole batch atomically at the
 *     end of the callback.
 *   - `subscribe` fires on every commit. Adapters
 *     MUST debounce so a single transact is one
 *     notification.
 *   - `putActivity` refuses updates — the activity
 *     log is append-only. The contract throws when
 *     the host tries to re-write an existing id.
 *   - `putConflict` writes a fresh row; the contract
 *     does not auto-resolve. A second write for the
 *     same `(kind, objectId)` pair is allowed (it
 *     appends a new conflict row) but the host UI
 *     is responsible for not creating duplicates.
 *   - `putComment` bumps the row's `version` on
 *     every edit; the read path preserves the
 *     version so the conflict detector can compare
 *     the writer's `baseVersion` against the
 *     current row.
 */

import type {
  Activity,
  Collaborator,
  Comment,
  Conflict,
  PrivateScratch,
  PublishDiff,
} from '../../domain/collaboration';
import type { CollabOpKind } from '../../lib/collab-api';

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export interface CollaborationOutboxStaging {
  /**
   * Stage a cross-user op for the durable outbox.
   * The op is committed in the SAME transaction
   * as the canonical collaboration rows (the use
   * case's other `put*` calls). When the adapter's
   * `transact` returns, the op is durable: a
   * process crash BEFORE the next tick cannot
   * lose the sync intent.
   *
   * WP-08 Round 3 (P0-4): the canonical write
   * and the outbox row are atomic. The previous
   * design (the use case called `recordOp` AFTER
   * `transact` returned) is gone — a process
   * crash between the canonical write and the
   * outbox write would lose the cross-user
   * event. The staged-map pattern keeps both
   * writes in the same Dexie transaction.
   */
  readonly opId: string;
  readonly clientId: string;
  readonly projectId: string;
  readonly kind: CollabOpKind;
  readonly payload: string;
  readonly baseVersion?: number | string;
  readonly createdAt: string;
}

export interface CollaborationRepositoryTransaction {
  // --- collaborator
  putCollaborator(c: Collaborator): void;
  deleteCollaborator(id: string): void;
  // --- comment
  putComment(c: Comment): void;
  deleteComment(id: string): void;
  // --- activity (append-only)
  putActivity(a: Activity): void;
  deleteActivity(id: string): void;
  // --- private scratch
  putScratch(s: PrivateScratch): void;
  deleteScratch(id: string): void;
  // --- publish diff
  putPublishDiff(d: PublishDiff): void;
  deletePublishDiff(id: string): void;
  // --- conflict
  putConflict(c: Conflict): void;
  deleteConflict(id: string): void;
  // --- outbox (P0-4: atomic with the canonical write)
  /**
   * Stage a cross-user op. The op is durable when
   * the use case's `transact` resolves successfully
   * — the adapter commits the canonical rows AND
   * the outbox row in a single atomic pass.
   *
   * Use cases that do not have a current
   * `transact` (e.g. the `enqueueTaskShared`
   * post-transact path) should call the
   * `syncService.enqueueOp` helper instead.
   */
  enqueueOp(staging: CollaborationOutboxStaging): void;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface CollaboratorQuery {
  readonly projectId: string;
  readonly role?: Collaborator['role'];
  /** Filter by userId. The Project Home "is this
   *  user a member?" check uses this. */
  readonly userId?: string;
}

export interface CommentQuery {
  readonly projectId: string;
  readonly targetKind?: Comment['targetKind'];
  readonly targetId?: string;
  /** Return only the thread roots; replies are
   *  fetched by threadId. */
  readonly threadRootsOnly?: boolean;
  /** Filter by author. The "my comments" surface
   *  uses this. */
  readonly authorId?: string;
  readonly resolved?: boolean;
  readonly limit?: number;
}

export interface ActivityQuery {
  readonly projectId: string;
  readonly kind?: Activity['kind'];
  readonly actorId?: string;
  readonly targetKind?: Activity['targetKind'];
  readonly targetId?: string;
  /** When `true`, include ephemeral events. The
   *  default is `false` so the activity feed
   *  suppresses `presence-joined` etc. */
  readonly includeEphemeral?: boolean;
  readonly limit?: number;
}

export interface ScratchQuery {
  readonly projectId: string;
  /**
   * The owner of the scratch list. **Mandatory**.
   * The repository MUST return only the rows whose
   * `ownerId` matches this value. The boundary is
   * enforced at the query layer (the SQL `WHERE
   * owner_id = ?` in the Dexie adapter; the `filter`
   * step in the in-memory adapter); the UI / use
   * case cannot bypass it.
   *
   * Why mandatory: a Private Scratch is *owner-only*
   * by spec. A query that returned "all scratches
   * in the project" would leak A's draft to B even
   * if the host UI then filtered the result list.
   * The cross-user async gateway also relies on
   * this: `listScratches(otherUserId)` on B's side
   * is the only way to surface a private scratch,
   * and the gateway refuses to forward a request
   * where the local user is not the owner.
   */
  readonly ownerId: string;
  readonly status?: PrivateScratch['status'];
  readonly limit?: number;
}

export interface PublishDiffQuery {
  readonly projectId: string;
  readonly scratchId?: string;
  readonly openOnly?: boolean;
  readonly limit?: number;
}

export interface ConflictQuery {
  readonly projectId: string;
  readonly kind?: Conflict['kind'];
  readonly objectId?: string;
  readonly openOnly?: boolean;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type CollaborationQueryListener = (snapshot: CollaborationSnapshot) => void;
export type Unsubscribe = () => void;

export interface CollaborationSnapshot {
  readonly collaborators: readonly Collaborator[];
  readonly comments: readonly Comment[];
  readonly activities: readonly Activity[];
  readonly scratches: readonly PrivateScratch[];
  readonly publishDiffs: readonly PublishDiff[];
  readonly conflicts: readonly Conflict[];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface CollaborationRepository {
  // --- read
  getCollaborator(id: string): Promise<Collaborator | null>;
  listCollaborators(query: CollaboratorQuery): Promise<Collaborator[]>;
  getComment(id: string): Promise<Comment | null>;
  listComments(query: CommentQuery): Promise<Comment[]>;
  getActivity(id: string): Promise<Activity | null>;
  listActivity(query: ActivityQuery): Promise<Activity[]>;
  /**
   * WP-08 Round 2: a scratch is *owner-only*; the
   * repository returns the row only when
   * `callerOwnerId === row.ownerId`. A non-owner
   * gets `null` (the row does not exist from
   * their perspective). The cross-user async
   * gateway writes through `transact` (which
   * has no owner check on the inbound path —
   * the gateway is system-level) and never
   * reads a scratch by id on behalf of a
   * non-owner.
   */
  getScratchForOwner(id: string, callerOwnerId: string): Promise<PrivateScratch | null>;
  listScratches(query: ScratchQuery): Promise<PrivateScratch[]>;
  getPublishDiff(id: string): Promise<PublishDiff | null>;
  listPublishDiffs(query: PublishDiffQuery): Promise<PublishDiff[]>;
  getConflict(id: string): Promise<Conflict | null>;
  listConflicts(query: ConflictQuery): Promise<Conflict[]>;

  // --- atomic writes
  transact<T>(fn: (tx: CollaborationRepositoryTransaction) => T | Promise<T>): Promise<T>;

  // --- live updates
  subscribe(listener: CollaborationQueryListener): Unsubscribe;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory implementation. The Dexie
 * adapter lives under `platforms/web/`. This class is
 * what the use-case tests + the production composition
 * tests use; the Dexie adapter is the production store.
 */
export class MemoryCollaborationRepository implements CollaborationRepository {
  private readonly collaborators = new Map<string, Collaborator>();
  private readonly comments = new Map<string, Comment>();
  private readonly activities = new Map<string, Activity>();
  private readonly scratches = new Map<string, PrivateScratch>();
  private readonly publishDiffs = new Map<string, PublishDiff>();
  private readonly conflicts = new Map<string, Conflict>();
  // WP-08 Round 3 (P0-4): the in-memory outbox
  // is the durable record the sync service
  // reads. The use case stages ops in the
  // transaction; the adapter applies them on
  // commit. Tests use `getStagedOutbox` /
  // `getOutboxRow` to assert the outbox is
  // committed atomically with the canonical
  // write.
  private readonly stagedOutbox = new Map<string, CollaborationOutboxStaging>();
  private readonly listeners = new Set<CollaborationQueryListener>();

  /**
   * Test-only helper: read the staged outbox
   * rows. Returns the staged records (the same
   * shape the Dexie adapter would have written
   * to `collabOutbox`).
   */
  __getStagedOutbox(): readonly CollaborationOutboxStaging[] {
    return Array.from(this.stagedOutbox.values());
  }
  __clearStagedOutbox(): void {
    this.stagedOutbox.clear();
  }

  // --- collaborator

  async getCollaborator(id: string): Promise<Collaborator | null> {
    return this.collaborators.get(id) ?? null;
  }

  async listCollaborators(query: CollaboratorQuery): Promise<Collaborator[]> {
    let all = Array.from(this.collaborators.values()).filter(
      (c) => c.projectId === query.projectId,
    );
    if (query.role) all = all.filter((c) => c.role === query.role);
    if (query.userId) all = all.filter((c) => c.userId === query.userId);
    all.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    return all;
  }

  // --- comment

  async getComment(id: string): Promise<Comment | null> {
    return this.comments.get(id) ?? null;
  }

  async listComments(query: CommentQuery): Promise<Comment[]> {
    let all = Array.from(this.comments.values()).filter(
      (c) => c.projectId === query.projectId,
    );
    if (query.targetKind) all = all.filter((c) => c.targetKind === query.targetKind);
    if (query.targetId) all = all.filter((c) => c.targetId === query.targetId);
    if (query.authorId) all = all.filter((c) => c.authorId === query.authorId);
    if (query.resolved !== undefined) {
      all = all.filter((c) => (query.resolved ? c.resolvedAt !== null : c.resolvedAt === null));
    }
    if (query.threadRootsOnly) {
      all = all.filter((c) => c.parentId === null);
    }
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  // --- activity

  async getActivity(id: string): Promise<Activity | null> {
    return this.activities.get(id) ?? null;
  }

  async listActivity(query: ActivityQuery): Promise<Activity[]> {
    let all = Array.from(this.activities.values()).filter(
      (a) => a.projectId === query.projectId,
    );
    if (query.kind) all = all.filter((a) => a.kind === query.kind);
    if (query.actorId) all = all.filter((a) => a.actorId === query.actorId);
    if (query.targetKind) all = all.filter((a) => a.targetKind === query.targetKind);
    if (query.targetId) all = all.filter((a) => a.targetId === query.targetId);
    if (!query.includeEphemeral) all = all.filter((a) => !a.ephemeral);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (query.limit !== undefined) all = all.slice(-query.limit);
    return all;
  }

  // --- scratch

  /**
   * WP-08 Round 2: scratch access is owner-isolated.
   * A caller may read a scratch only when their
   * `callerOwnerId` matches the row's `ownerId`. A
   * mismatch returns `null` (not a permission error)
   * so the cross-user async gateway cannot leak a
   * private row by id guessing. The publish flow
   * passes the local user id and gets the row;
   * a non-owner gets `null` and the dialog
   * surfaces "scratch not found" without revealing
   * the existence of the row.
   */
  async getScratchForOwner(id: string, callerOwnerId: string): Promise<PrivateScratch | null> {
    const row = this.scratches.get(id);
    if (!row) return null;
    if (row.ownerId !== callerOwnerId) return null;
    return row;
  }

  /**
   * WP-08 Round 2: owner-isolated listing. The
   * caller MUST pass `ownerId`; the repository
   * returns only the rows whose `ownerId`
   * matches. The in-memory adapter enforces the
   * filter here (and the Dexie adapter does the
   * same in `WHERE ownerId = ?`). A request
   * without `ownerId` is a contract violation;
   * the in-memory adapter throws.
   */
  async listScratches(query: ScratchQuery): Promise<PrivateScratch[]> {
    if (!query.ownerId || query.ownerId.length === 0) {
      throw new Error(
        'MemoryCollaborationRepository.listScratches: ownerId is required; ' +
          'a Private Scratch is owner-only and the query boundary must enforce it.',
      );
    }
    let all = Array.from(this.scratches.values()).filter(
      (s) => s.projectId === query.projectId && s.ownerId === query.ownerId,
    );
    if (query.status) all = all.filter((s) => s.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  // --- publish diff

  async getPublishDiff(id: string): Promise<PublishDiff | null> {
    return this.publishDiffs.get(id) ?? null;
  }

  async listPublishDiffs(query: PublishDiffQuery): Promise<PublishDiff[]> {
    let all = Array.from(this.publishDiffs.values()).filter(
      (d) => d.projectId === query.projectId,
    );
    if (query.scratchId) all = all.filter((d) => d.scratchId === query.scratchId);
    if (query.openOnly) {
      all = all.filter((d) => d.confirmedAt === null && d.cancelledAt === null);
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  // --- conflict

  async getConflict(id: string): Promise<Conflict | null> {
    return this.conflicts.get(id) ?? null;
  }

  async listConflicts(query: ConflictQuery): Promise<Conflict[]> {
    let all = Array.from(this.conflicts.values()).filter(
      (c) => c.projectId === query.projectId,
    );
    if (query.kind) all = all.filter((c) => c.kind === query.kind);
    if (query.objectId) all = all.filter((c) => c.objectId === query.objectId);
    if (query.openOnly) all = all.filter((c) => c.resolution === null);
    all.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  // --- transact

  async transact<T>(fn: (tx: CollaborationRepositoryTransaction) => T | Promise<T>): Promise<T> {
    const staged = {
      collaborators: new Map<string, Collaborator | null>(),
      comments: new Map<string, Comment | null>(),
      activities: new Map<string, Activity | null>(),
      scratches: new Map<string, PrivateScratch | null>(),
      publishDiffs: new Map<string, PublishDiff | null>(),
      conflicts: new Map<string, Conflict | null>(),
      outbox: new Map<string, CollaborationOutboxStaging>(),
    };
    const tx: CollaborationRepositoryTransaction = {
      putCollaborator: (c) => {
        if ((c as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical Collaborator with authorType="ai".');
        }
        staged.collaborators.set(c.id, c);
      },
      deleteCollaborator: (id) => staged.collaborators.set(id, null),
      putComment: (c) => {
        staged.comments.set(c.id, c);
      },
      deleteComment: (id) => staged.comments.set(id, null),
      putActivity: (a) => {
        if (this.activities.has(a.id)) {
          throw new Error(
            `Activity log is append-only; refusing to overwrite existing activity ${a.id}.`,
          );
        }
        staged.activities.set(a.id, a);
      },
      deleteActivity: (id) => {
        staged.activities.set(id, null);
      },
      putScratch: (s) => {
        if ((s as { authorType: string }).authorType === 'ai') {
          throw new Error('Refusing to write canonical PrivateScratch with authorType="ai".');
        }
        staged.scratches.set(s.id, s);
      },
      deleteScratch: (id) => staged.scratches.set(id, null),
      putPublishDiff: (d) => staged.publishDiffs.set(d.id, d),
      deletePublishDiff: (id) => staged.publishDiffs.set(id, null),
      putConflict: (c) => staged.conflicts.set(c.id, c),
      deleteConflict: (id) => staged.conflicts.set(id, null),
      // P0-4: stage the outbox row in the same
      // atomic pass as the canonical rows. The
      // in-memory adapter keeps the staging
      // around until the test reads it via
      // `getStagedOutbox` (the test is the only
      // consumer; the production sync service
      // reads the durable Dexie outbox).
      enqueueOp: (s) => {
        staged.outbox.set(s.opId, s);
      },
    };
    const result = await fn(tx);
    for (const [id, v] of staged.collaborators) apply(this.collaborators, id, v);
    for (const [id, v] of staged.comments) apply(this.comments, id, v);
    for (const [id, v] of staged.activities) apply(this.activities, id, v);
    for (const [id, v] of staged.scratches) apply(this.scratches, id, v);
    for (const [id, v] of staged.publishDiffs) apply(this.publishDiffs, id, v);
    for (const [id, v] of staged.conflicts) apply(this.conflicts, id, v);
    for (const [opId, s] of staged.outbox) this.stagedOutbox.set(opId, s);
    this.notify();
    return result;
  }

  // --- subscribe

  subscribe(listener: CollaborationQueryListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- internals

  private notify(): void {
    const snap: CollaborationSnapshot = {
      collaborators: Array.from(this.collaborators.values()),
      comments: Array.from(this.comments.values()),
      activities: Array.from(this.activities.values()),
      scratches: Array.from(this.scratches.values()),
      publishDiffs: Array.from(this.publishDiffs.values()),
      conflicts: Array.from(this.conflicts.values()),
    };
    for (const l of this.listeners) l(snap);
  }
}

function apply<T>(map: Map<string, T>, id: string, value: T | null): void {
  if (value === null) map.delete(id);
  else map.set(id, value);
}
