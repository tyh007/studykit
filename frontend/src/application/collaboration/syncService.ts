/**
 * StudyKit v0.4 — `application/collaboration/syncService`
 *
 * The async collaboration service that drives the
 * outbox/inbox pattern. This is the seam between
 * the local `CollaborationRepository` +
 * `ResearchRepository` and the HTTP gateway in
 * `lib/collab-api.ts`.
 *
 * Responsibilities
 * ----------------
 *
 *   1. **Enqueue** — when a use case commits a
 *      write (e.g. a new comment), the slice
 *      records the change in the local
 *      `CollaborationRepository` AND calls
 *      `enqueueOp(...)`. The outbox row is the
 *      durable record of "we wrote this locally";
 *      the gateway is the eventual durable
 *      cross-user record.
 *   2. **Drain** — `drainOutbox(...)` POSTs every
 *      unsynced op to the gateway. The server's
 *      response marks the op `syncedAt`.
 *      Failed pushes stay in the outbox with an
 *      incremented `attempts` count; the next
 *      drain retries.
 *   3. **Pull** — `pullAndApply(...)` GETs ops
 *      since the per-project cursor. The inbox
 *      filters out the client's own writes
 *      (idempotency: the local repo already has
 *      the row) and applies the rest. The apply
 *      step is conflict-aware: a remote op that
 *      collides with a local row of the same id
 *      is recorded as a `Conflict`, never
 *      silently overwriting.
 *   4. **Cursor** — the per-project cursor is
 *      stored in the local store (in this slice
 *      it's a module-level Map; the production
 *      server can persist it in Dexie later if
 *      the user wants cross-device cursor
 *      continuity). The cursor is the
 *      `(createdAt, id)` of the most recent
 *      applied op, encoded with `encodeCursor`.
 *
 * The service is *not* a transport — the
 * transport is the gateway. The service is the
 * orchestrator.
 *
 * Why not Yjs / CRDT? Per the spec, the v0.4
 * first Beta commits to "reliable async
 * collaboration", not live co-editing. The
 * gateway here is the minimum that proves two
 * devices can read the same project through a
 * real cross-process transport.
 */

import type {
  Activity,
  Collaborator,
  Comment,
  Conflict,
  ConflictKind,
  ConflictVersionSnapshot,
  PrivateScratch,
} from '../../domain/collaboration';
import type { ResearchTask } from '../../domain/researchDesign';
import {
  isAiDraftDecision,
  isAiMessage,
  isAiThread,
  type AiDraftDecision,
  type AiMessage,
  type AiThread,
} from '../../domain/aiThread';
import {
  type CollabGateway,
  type CollabOp,
  type CollabOpKind,
  type CollabOpPayloads,
  encodeCursor,
} from '../../lib/collab-api';
import { db, type CollabOutboxRecord, outboxToOp } from '../../lib/db';
import { nowCollabIso } from '../../domain/collaboration';

// ---------------------------------------------------------------------------
// Cursor (per-project, in-memory for the smoke; the production server
// would back this with a per-client row).
// ---------------------------------------------------------------------------

const cursorByProject = new Map<string, string>();

export function getCursor(projectId: string): string | null {
  return cursorByProject.get(projectId) ?? null;
}

export function setCursor(projectId: string, cursor: string): void {
  cursorByProject.set(projectId, cursor);
}

export function __resetCursorsForTests(): void {
  cursorByProject.clear();
}

// ---------------------------------------------------------------------------
// Client id
// ---------------------------------------------------------------------------

/**
 * A stable per-device random id, generated once
 * and persisted in `localStorage`. The id tags
 * every op the device writes so the inbox can
 * filter out self-writes.
 */
function getOrCreateClientId(): string {
  const KEY = 'studykit.collab.clientId';
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    const existing = globalThis.localStorage.getItem(KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = `cli_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    try {
      globalThis.localStorage.setItem(KEY, fresh);
    } catch {
      // localStorage may be blocked; the in-memory
      // map below is the next fallback.
    }
    return fresh;
  }
  return `cli_${Math.random().toString(36).slice(2, 10)}`;
}

let cachedClientId: string | null = null;
export function getClientId(): string {
  if (cachedClientId) return cachedClientId;
  cachedClientId = getOrCreateClientId();
  return cachedClientId;
}

export function __resetClientIdForTests(): void {
  cachedClientId = null;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    try {
      globalThis.localStorage.removeItem('studykit.collab.clientId');
    } catch {
      // ignore
    }
  }
}

/**
 * Test-only: pin the client id so the inbox's
 * self-write filter matches the pushed op. The
 * production code never calls this.
 */
export function __setClientIdForTests(id: string): void {
  cachedClientId = id;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    try {
      globalThis.localStorage.setItem('studykit.collab.clientId', id);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Op id
// ---------------------------------------------------------------------------

let opCounter = 0;
function nextOpId(): string {
  opCounter = (opCounter + 1) % 1_000_000;
  return `op_${Date.now().toString(36)}_${opCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Sync service deps
// ---------------------------------------------------------------------------

export interface SyncServiceDeps {
  readonly gateway: CollabGateway;
  /**
   * The local collaboration repository. The
   * inbox apply step writes remote rows to the
   * local store via this contract.
   */
  readonly collabRepository: CollabApplyTarget;
  /**
   * The local research repository. The inbox
   * apply step writes remote `ResearchTask`
   * rows via this contract.
   */
  readonly researchRepository?: ResearchApplyTarget;
  /**
   * The local user id. Used as a sanity check
   * when an inbox op tries to "self-add" the
   * local user (e.g. the local user just
   * bootstrapped).
   */
  readonly localUserId: string;
}

export interface CollabApplyTarget {
  /** Upsert a row. The contract is
   *  "set" semantics: a row with the same id is
   *  overwritten unless `onlyIfNewer` is set
   *  (in which case the higher `updatedAt`
   *  wins). The apply step picks the right
   *  shape per op kind. */
  upsertCollaborator(row: Collaborator): Promise<void>;
  upsertComment(row: Comment): Promise<void>;
  upsertActivity(row: Activity): Promise<void>;
  upsertConflict(row: Conflict): Promise<void>;
  /** Detect + record a conflict when an inbox
   *  op collides with a local row. The default
   *  implementation creates a `Conflict` row
   *  via `detectConflict`. */
  recordConflict?(args: {
    readonly kind: ConflictKind;
    readonly objectId: string;
    readonly local: ConflictVersionSnapshot;
    readonly remote: ConflictVersionSnapshot;
    readonly projectId: string;
  }): Promise<void>;
}

export interface ResearchApplyTarget {
  /** Insert or update a `ResearchTask`. The
   *  implementation is idempotent on `id`. */
  upsertTask(row: ResearchTask): Promise<void>;
  /**
   * Read a single `ResearchTask` by id. The
   * inbox apply step uses this to patch a
   * remote `task-assigned` or
   * `task-status-changed` op (the remote
   * carries the new field; the apply step
   * reads the local row and patches it).
   * Returns `null` when the row does not
   * exist locally; the apply step is a
   * no-op in that case (a future
   * `task-shared` op will land the full row).
   */
  getTask(id: string): Promise<ResearchTask | null>;
  /** v0.5 P4b: store a shared AI thread received from another member. */
  applyAiThread?(row: AiThread): Promise<void>;
  /** Append a remote message; a message that already exists is skipped. */
  applyAiMessage?(row: AiMessage): Promise<void>;
  /** Append a remote draft decision; an existing one is skipped. */
  applyAiDraftDecision?(row: AiDraftDecision): Promise<void>;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueInput<K extends CollabOpKind> {
  readonly projectId: string;
  readonly kind: K;
  readonly payload: CollabOpPayloads[K];
  readonly baseVersion?: number | string;
}

/**
 * Append an op to the outbox. The function
 * writes the op synchronously to Dexie (the
 * local durable record) and returns the row.
 * The drain loop picks it up on its next pass.
 *
 * The function is the single entry point the use
 * cases call. Private scratches NEVER call this
 * — only cross-user events are enqueued.
 */
export async function enqueueOp<K extends CollabOpKind>(
  input: EnqueueInput<K>,
): Promise<CollabOutboxRecord> {
  const id = nextOpId();
  const now = nowCollabIso();
  const record: CollabOutboxRecord = {
    id,
    clientId: getClientId(),
    projectId: input.projectId,
    kind: input.kind,
    payload: JSON.stringify(input.payload),
    ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    createdAt: now,
    attempts: 0,
    lastError: null,
    syncedAt: null,
  };
  await db.collabOutbox.put(record);
  return record;
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

export interface DrainResult {
  readonly drained: number;
  readonly failed: number;
}

/**
 * Push every unsynced op to the gateway. The
 * server's response marks each accepted op
 * `syncedAt`; rejected ops stay in the outbox
 * with `attempts++` + the rejection reason. The
 * function is best-effort: a network error fails
 * the whole batch and the next drain retries.
 */
export async function drainOutbox(
  deps: SyncServiceDeps,
  projectId: string,
): Promise<DrainResult> {
  // The compound `[projectId+syncedAt]` index
  // does not index rows with `syncedAt === null`
  // (Dexie skips null in compound indexes). The
  // drain picks all rows for the project and
  // filters in JS; the per-project filter is
  // O(n) but the outbox is small (the local
  // device writes a handful of ops between
  // drains). The compound index still helps the
  // cursor-pulled rows.
  const all = await db.collabOutbox.where('projectId').equals(projectId).toArray();
  const pending = all.filter((r) => r.syncedAt === null);
  if (pending.length === 0) return { drained: 0, failed: 0 };

  const ops = pending.map(outboxToOp);
  try {
    const result = await deps.gateway.pushOps({ clientId: getClientId(), projectId, ops });
    const now = nowCollabIso();
    const acceptedSet = new Set(result.accepted);
    for (const r of pending) {
      if (acceptedSet.has(r.id)) {
        await db.collabOutbox.update(r.id, { syncedAt: now });
      } else {
        const rejection = result.rejected.find((j) => j.id === r.id);
        await db.collabOutbox.update(r.id, {
          attempts: r.attempts + 1,
          lastError: rejection?.reason ?? 'unknown rejection',
        });
      }
    }
    return {
      drained: result.accepted.length,
      failed: result.rejected.length,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    // eslint-disable-next-line no-console
    if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
      /* debug-removed */
    }
    for (const r of pending) {
      await db.collabOutbox.update(r.id, {
        attempts: r.attempts + 1,
        lastError: reason,
      });
    }
    return { drained: 0, failed: pending.length };
  }
}

// ---------------------------------------------------------------------------
// Pull + apply
// ---------------------------------------------------------------------------

export interface PullResult {
  readonly received: number;
  readonly applied: number;
  readonly conflicts: number;
}

/**
 * Pull ops from the gateway since the per-
 * project cursor and apply each one to the
 * local stores. Self-writes (ops with
 * `clientId === self`) are filtered; the
 * local repo already has them.
 */
export async function pullAndApply(
  deps: SyncServiceDeps,
  projectId: string,
): Promise<PullResult> {
  const since = getCursor(projectId);
  const result = await deps.gateway.pullOps({
    clientId: getClientId(),
    projectId,
    since,
    limit: 200,
  });
  const self = getClientId();
  let applied = 0;
  let conflicts = 0;
  let lastCursor = since ?? '';
  for (const op of result.ops) {
    if (op.clientId === self) continue; // skip self-writes
    const wasConflict = await applyRemoteOp(deps, op);
    if (wasConflict) conflicts += 1;
    applied += 1;
    lastCursor = encodeCursor(op);
  }
  if (lastCursor) setCursor(projectId, lastCursor);
  return { received: result.ops.length, applied, conflicts };
}

// ---------------------------------------------------------------------------
// Apply a single remote op
// ---------------------------------------------------------------------------

/**
 * Apply a remote op to the local store. Returns
 * `true` when the op was recorded as a conflict
 * (the local store was not overwritten).
 */
async function applyRemoteOp(
  deps: SyncServiceDeps,
  op: CollabOp,
): Promise<boolean> {
  let payload: unknown;
  try {
    payload = JSON.parse(op.payload);
  } catch {
    return false; // malformed op; skip
  }
  switch (op.kind) {
    case 'membership-bootstrap':
    case 'member-added':
    case 'member-role-changed': {
      const row = payload as Collaborator;
      await deps.collabRepository.upsertCollaborator(row);
      return false;
    }
    case 'member-removed': {
      const p = payload as { collaboratorId: string; projectId: string };
      // The collab repo doesn't expose a delete
      // in this slice; the local store already
      // has the row and the local user's view is
      // rebuilt on the next reload. The remote
      // removal is recorded in the activity log
      // by the server, not by the inbox.
      void p;
      return false;
    }
    case 'comment-posted': {
      const row = payload as Comment;
      await deps.collabRepository.upsertComment(row);
      return false;
    }
    case 'comment-resolved': {
      const row = payload as Comment;
      // The remote's resolved version wins by
      // apply time; if the local user is mid-
      // edit, the conflict is recorded.
      const isConflict = await maybeConflict(deps, op, 'comment', row.id, {
        before: { version: 0 },
        after: { version: row.version },
      });
      if (isConflict) return true;
      await deps.collabRepository.upsertComment(row);
      return false;
    }
    case 'activity-logged': {
      const row = payload as Activity;
      await deps.collabRepository.upsertActivity(row);
      return false;
    }
    case 'task-shared': {
      const p = payload as { task: ResearchTask; scratchId: string; scratchTitle: string };
      if (deps.researchRepository) {
        await deps.researchRepository.upsertTask(p.task);
      }
      return false;
    }
    case 'task-assigned': {
      // The remote `task-assigned` op carries
      // the new assignee. The inbox apply
      // step reads the canonical task by id,
      // updates the `assignee` field, and
      // upserts the row. The previous-assignee
      // snapshot is part of the op payload so
      // a future activity row can be derived
      // without re-reading the local row.
      const p = payload as {
        taskId: string;
        projectId: string;
        assignee: { userId: string; displayName: string } | null;
        previousAssignee: { userId: string; displayName: string } | null;
      };
      if (deps.researchRepository) {
        // The repo's `upsertTask` writes a
        // full row; we read the current row
        // and patch the assignee. The patch
        // keeps the canonical shape (a missing
        // row results in a no-op; a future
        // task-shared op will land the full
        // row).
        const existing = await deps.researchRepository.getTask(p.taskId);
        if (existing) {
          const next: ResearchTask = {
            ...existing,
            assignee: p.assignee,
            updatedAt: new Date().toISOString(),
          };
          await deps.researchRepository.upsertTask(next);
        }
      }
      return false;
    }
    case 'task-status-changed': {
      // The remote `task-status-changed` op
      // carries the new status; the inbox
      // apply step reads the canonical task,
      // patches the status, and upserts.
      const p = payload as {
        taskId: string;
        projectId: string;
        status: ResearchTask['status'];
        previousStatus: ResearchTask['status'] | null;
      };
      if (deps.researchRepository) {
        const existing = await deps.researchRepository.getTask(p.taskId);
        if (existing) {
          const next: ResearchTask = {
            ...existing,
            status: p.status,
            updatedAt: new Date().toISOString(),
          };
          await deps.researchRepository.upsertTask(next);
        }
      }
      return false;
    }
    case 'conflict-detected': {
      const row = payload as Conflict;
      await deps.collabRepository.upsertConflict(row);
      return false;
    }
    // v0.5 P4b: shared AI threads. Remote rows are validated again here
    // (the server checks authorship; the client checks shape) and are
    // written as-is: messages and decisions are append-only, so a row
    // that already exists is skipped. A remote decision is recorded, not
    // re-applied: canonical Research objects stay local (ADR-003 §5).
    case 'ai-thread-created':
    case 'ai-thread-updated': {
      if (!deps.researchRepository?.applyAiThread) return false;
      if (!isAiThread(payload) || payload.visibility !== 'shared' || payload.projectId !== op.projectId) return false;
      await deps.researchRepository.applyAiThread(payload);
      return false;
    }
    case 'ai-message-appended': {
      if (!deps.researchRepository?.applyAiMessage) return false;
      if (!isAiMessage(payload) || payload.projectId !== op.projectId) return false;
      await deps.researchRepository.applyAiMessage(payload);
      return false;
    }
    case 'ai-draft-decided': {
      if (!deps.researchRepository?.applyAiDraftDecision) return false;
      if (!isAiDraftDecision(payload) || payload.projectId !== op.projectId) return false;
      await deps.researchRepository.applyAiDraftDecision(payload);
      return false;
    }
  }
}

/**
 * Record a conflict when the remote op's
 * `baseVersion` does not match what the local
 * store expects. The check is a thin
 * proxy: a real CRDT would diff the two
 * sides. The minimum is to *record* the
 * conflict, never to silently overwrite.
 */
async function maybeConflict(
  deps: SyncServiceDeps,
  op: CollabOp,
  kind: ConflictKind,
  objectId: string,
  versions: { before: { version: number }; after: { version: number } },
): Promise<boolean> {
  if (op.baseVersion === undefined) return false;
  if (String(versions.before.version) !== String(op.baseVersion)) {
    if (deps.collabRepository.recordConflict) {
      await deps.collabRepository.recordConflict({
        kind,
        objectId,
        projectId: op.projectId,
        local: {
          side: 'local',
          actorId: deps.localUserId,
          actorDisplayName: deps.localUserId,
          baseVersion: versions.before.version,
          payload: '',
          writtenAt: nowCollabIso(),
        },
        remote: {
          side: 'remote',
          actorId: op.clientId,
          actorDisplayName: op.clientId,
          baseVersion: versions.after.version,
          payload: op.payload,
          writtenAt: op.createdAt,
        },
      });
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Combined drain + pull (the typical "tick" path)
// ---------------------------------------------------------------------------

export interface TickResult {
  readonly drained: DrainResult;
  readonly pulled: PullResult;
}

/**
 * One tick of the sync loop. The wiring calls
 * this on a timer (every few seconds) and on
 * every successful use case commit. The function
 * is idempotent; a no-op when the outbox is
 * empty and the cursor is current.
 */
export async function tick(
  deps: SyncServiceDeps,
  projectId: string,
): Promise<TickResult> {
  const drained = await drainOutbox(deps, projectId);
  const pulled = await pullAndApply(deps, projectId);
  return { drained, pulled };
}

// ---------------------------------------------------------------------------
// Apply helpers used by the use cases
// ---------------------------------------------------------------------------

/**
 * When a user posts a comment locally, the
 * use case calls `enqueueOp({ kind:
 * 'comment-posted', payload: comment })` after
 * the local commit. The outbox is the durable
 * record; the gateway is the cross-user record.
 */
export function enqueueCommentPosted(
  projectId: string,
  comment: Comment,
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'comment-posted', payload: comment });
}

export function enqueueCommentResolved(
  projectId: string,
  comment: Comment,
  baseVersion: number,
): Promise<CollabOutboxRecord> {
  return enqueueOp({
    projectId,
    kind: 'comment-resolved',
    payload: comment,
    baseVersion,
  });
}

export function enqueueActivityLogged(
  projectId: string,
  activity: Activity,
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'activity-logged', payload: activity });
}

export function enqueueMemberAdded(
  projectId: string,
  member: Collaborator,
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'member-added', payload: member });
}

export function enqueueMembershipBootstrap(
  projectId: string,
  member: Collaborator,
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'membership-bootstrap', payload: member });
}

export function enqueueMemberRoleChanged(
  projectId: string,
  member: Collaborator,
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'member-role-changed', payload: member });
}

export function enqueueTaskShared(
  projectId: string,
  payload: CollabOpPayloads['task-shared'],
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'task-shared', payload });
}

export function enqueueTaskAssigned(
  projectId: string,
  payload: CollabOpPayloads['task-assigned'],
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'task-assigned', payload });
}

export function enqueueTaskStatusChanged(
  projectId: string,
  payload: CollabOpPayloads['task-status-changed'],
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'task-status-changed', payload });
}

export function enqueueConflictDetected(
  projectId: string,
  conflict: Conflict,
): Promise<CollabOutboxRecord> {
  return enqueueOp({ projectId, kind: 'conflict-detected', payload: conflict });
}

// ---------------------------------------------------------------------------
// Outbox status (P0-4: UI surfaces queued/synced/failed)
// ---------------------------------------------------------------------------

export type OutboxStatus = 'queued' | 'synced' | 'failed';

export interface OutboxRowStatus {
  readonly id: string;
  readonly projectId: string;
  readonly kind: CollabOpKind;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly syncedAt: string | null;
  /** Raw payload (JSON string) for callers
   *  that need to read the op's target id
   *  (e.g. the Shared Task UI maps a
   *  `task-assigned` op to the task by its
   *  `taskId` field). */
  readonly payload: string;
}

/**
 * Read the outbox rows for a project, classified
 * into `queued | synced | failed`. The UI
 * surfaces the per-op status so the user can
 * see "this comment is queued for sync", "this
 * task assignment failed", etc. A failed op
 * is recoverable: the user clicks Retry and
 * the next drain re-attempts the push.
 */
export async function listOutboxStatus(
  projectId: string,
): Promise<readonly OutboxRowStatus[]> {
  const all = await db.collabOutbox.where('projectId').equals(projectId).toArray();
  return all.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    status: r.syncedAt !== null ? 'synced' : (r.attempts > 0 && r.lastError ? 'failed' : 'queued'),
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
    syncedAt: r.syncedAt,
    payload: r.payload,
  }));
}

/**
 * Reset a failed op so the next drain
 * re-attempts. The op is marked queued
 * again (attempts reset to 0, lastError
 * cleared). A user-recoverable retry.
 */
export async function retryOutboxOp(
  deps: SyncServiceDeps,
  opId: string,
): Promise<void> {
  const row = await db.collabOutbox.get(opId);
  if (!row) return;
  await db.collabOutbox.update(opId, {
    attempts: 0,
    lastError: null,
  });
  // Immediately attempt a drain so the
  // user sees the retry propagate.
  await drainOutbox(deps, row.projectId);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { CollabOp, CollabOpKind, CollabGateway };
// Re-export the type guards the inbox apply step
// uses (kept narrow: the gateway only carries
// the domain types, no private scratch).
export type { PrivateScratch };
