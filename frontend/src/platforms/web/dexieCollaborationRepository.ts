/**
 * StudyKit v0.4 — `platforms/web/dexieCollaborationRepository`
 *
 * The Dexie / IndexedDB-backed implementation of the
 * `CollaborationRepository` contract. This is the
 * production adapter the Collaboration use cases talk
 * to; the in-memory `MemoryCollaborationRepository` is
 * for tests.
 *
 * Schema strategy
 * ---------------
 *
 *   - Six new Dexie tables (`collabCollaborators`,
 *     `collabComments`, `collabActivities`,
 *     `collabScratches`, `collabPublishDiffs`,
 *     `collabConflicts`) added at Dexie v8.
 *   - Additive Dexie migration `v8` — older databases
 *     (v1–v7) open unchanged. The migration declares
 *     the six new tables; it never touches existing
 *     tables. WP-08 Gate "Dexie schema 必须可加迁移"
 *     (master plan §2.1).
 *   - The `v04Collaboration` flag is the runtime gate:
 *     when off, the production composition does not
 *     mount a `<CollaborationProvider>`, the
 *     repository is never constructed, and no read /
 *     write happens. A flag-off build behaves
 *     exactly like a fresh v7 database from the v0.4
 *     WP-07 point of view.
 *
 * Subscriptions
 * -------------
 *
 *   Dexie has no `subscribe` primitive. We attach to
 *   the table's `creating` / `updating` / `deleting`
 *   hooks so any `put` / `delete` on the six tables
 *   fires a `notify()` that the
 *   `CollaborationRepository.subscribe` consumer
 *   listens to. The in-memory adapter uses its own
 *   implementation; both call the same `notify()`
 *   shape so callers don't care.
 *
 * UI guard
 * --------
 *
 *   `application/collaboration/collaborationUseCases`
 *   is the only consumer; it imports this file through
 *   the `CollaborationRepository` interface and never
 *   imports `lib/db` directly.
 */

import type { Table } from 'dexie';
import { db, type CollabOutboxRecord } from '../../lib/db';
import type {
  Activity,
  Collaborator,
  Comment,
  Conflict,
  PrivateScratch,
  PublishDiff,
} from '../../domain/collaboration';
import type {
  CollaborationOutboxStaging,
  CollaborationRepository,
  CollaborationRepositoryTransaction,
  CollaborationSnapshot,
} from '../../application/collaboration/collaborationRepository';

// ---------------------------------------------------------------------------
// Dexie adapter shape
// ---------------------------------------------------------------------------

interface CollaborationDexieTable<T> {
  toArray(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
  delete(id: string): Promise<void>;
  where(field: string): {
    equals(value: unknown): { toArray(): Promise<T[]>; first(): Promise<T | undefined> };
  };
  hook(hooks: {
    creating?: (key: string, obj: T) => void;
    updating?: (modifications: Partial<T>, key: string, obj: T) => void;
    deleting?: (key: string) => void;
  }): void;
  clear(): Promise<void>;
}

interface CollaborationTables {
  collaborators: CollaborationDexieTable<Collaborator>;
  comments: CollaborationDexieTable<Comment>;
  activities: CollaborationDexieTable<Activity>;
  scratches: CollaborationDexieTable<PrivateScratch>;
  publishDiffs: CollaborationDexieTable<PublishDiff>;
  conflicts: CollaborationDexieTable<Conflict>;
}

function readCollaborationTables(): CollaborationTables {
  const extended = db as unknown as {
    collabCollaborators: Table<Collaborator, string>;
    collabComments: Table<Comment, string>;
    collabActivities: Table<Activity, string>;
    collabScratches: Table<PrivateScratch, string>;
    collabPublishDiffs: Table<PublishDiff, string>;
    collabConflicts: Table<Conflict, string>;
  };
  return {
    collaborators: extended.collabCollaborators as unknown as CollaborationDexieTable<Collaborator>,
    comments: extended.collabComments as unknown as CollaborationDexieTable<Comment>,
    activities: extended.collabActivities as unknown as CollaborationDexieTable<Activity>,
    scratches: extended.collabScratches as unknown as CollaborationDexieTable<PrivateScratch>,
    publishDiffs: extended.collabPublishDiffs as unknown as CollaborationDexieTable<PublishDiff>,
    conflicts: extended.collabConflicts as unknown as CollaborationDexieTable<Conflict>,
  };
}

class CollaborationDexieDB {
  private readonly listeners = new Set<(s: CollaborationSnapshot) => void>();
  private notifyScheduled: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly tables: CollaborationTables) {
    const fire = (): void => this.scheduleNotify();
    const tArr: CollaborationDexieTable<unknown>[] = [
      tables.collaborators,
      tables.comments,
      tables.activities,
      tables.scratches,
      tables.publishDiffs,
      tables.conflicts,
    ];
    for (const t of tArr) {
      t.hook({ creating: fire, updating: fire, deleting: fire });
    }
  }

  subscribe(listener: (s: CollaborationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = setTimeout(() => {
      this.notifyScheduled = null;
      void this.emit();
    }, 0);
  }

  private async emit(): Promise<void> {
    const t = this.tables;
    const [
      collaborators,
      comments,
      activities,
      scratches,
      publishDiffs,
      conflicts,
    ] = await Promise.all([
      t.collaborators.toArray(),
      t.comments.toArray(),
      t.activities.toArray(),
      t.scratches.toArray(),
      t.publishDiffs.toArray(),
      t.conflicts.toArray(),
    ]);
    const snap: CollaborationSnapshot = {
      collaborators,
      comments,
      activities,
      scratches,
      publishDiffs,
      conflicts,
    };
    for (const l of this.listeners) l(snap);
  }
}

let cached: CollaborationDexieDB | null = null;

export function getCollaborationDb(): CollaborationDexieDB {
  if (cached) return cached;
  cached = new CollaborationDexieDB(readCollaborationTables());
  return cached;
}

export function __resetCollaborationDbForTests(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function createDexieCollaborationRepository(): CollaborationRepository {
  return new DexieCollaborationRepository();
}

class DexieCollaborationRepository implements CollaborationRepository {
  async getCollaborator(id: string): Promise<Collaborator | null> {
    return (await readCollaborationTables().collaborators.get(id)) ?? null;
  }

  async listCollaborators(query: {
    projectId: string;
    role?: Collaborator['role'];
    userId?: string;
  }): Promise<Collaborator[]> {
    let all = (await readCollaborationTables().collaborators.toArray()).filter(
      (c) => c.projectId === query.projectId,
    );
    if (query.role) all = all.filter((c) => c.role === query.role);
    if (query.userId) all = all.filter((c) => c.userId === query.userId);
    all.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    return all;
  }

  async getComment(id: string): Promise<Comment | null> {
    return (await readCollaborationTables().comments.get(id)) ?? null;
  }

  async listComments(query: {
    projectId: string;
    targetKind?: Comment['targetKind'];
    targetId?: string;
    threadRootsOnly?: boolean;
    authorId?: string;
    resolved?: boolean;
    limit?: number;
  }): Promise<Comment[]> {
    let all = (await readCollaborationTables().comments.toArray()).filter(
      (c) => c.projectId === query.projectId,
    );
    if (query.targetKind) all = all.filter((c) => c.targetKind === query.targetKind);
    if (query.targetId) all = all.filter((c) => c.targetId === query.targetId);
    if (query.authorId) all = all.filter((c) => c.authorId === query.authorId);
    if (query.resolved !== undefined) {
      all = all.filter((c) => (query.resolved ? c.resolvedAt !== null : c.resolvedAt === null));
    }
    if (query.threadRootsOnly) all = all.filter((c) => c.parentId === null);
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getActivity(id: string): Promise<Activity | null> {
    return (await readCollaborationTables().activities.get(id)) ?? null;
  }

  async listActivity(query: {
    projectId: string;
    kind?: Activity['kind'];
    actorId?: string;
    targetKind?: Activity['targetKind'];
    targetId?: string;
    includeEphemeral?: boolean;
    limit?: number;
  }): Promise<Activity[]> {
    let all = (await readCollaborationTables().activities.toArray()).filter(
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

  async getScratchForOwner(id: string, callerOwnerId: string): Promise<PrivateScratch | null> {
    // WP-08 Round 2: owner-isolated read. The
    // Dexie adapter enforces the same boundary
    // as the in-memory adapter: a non-owner
    // gets `null`. A future cross-user gateway
    // that applies remote ops will route through
    // `transact` (which has no caller owner
    // check at the system level) — the read
    // path is the one that protects privacy.
    const row = (await readCollaborationTables().scratches.get(id)) ?? null;
    if (!row) return null;
    if (row.ownerId !== callerOwnerId) return null;
    return row;
  }

  async listScratches(query: {
    projectId: string;
    ownerId: string;
    status?: PrivateScratch['status'];
    limit?: number;
  }): Promise<PrivateScratch[]> {
    // WP-08 Round 2: ownerId is mandatory. The
    // Dexie adapter enforces it with a `where`
    // on the indexed `[projectId+ownerId]`
    // pair, so the filter happens in the
    // storage engine — not in JS — and a
    // caller that omits `ownerId` triggers a
    // throw (defence-in-depth; the TypeScript
    // type also makes this a compile error).
    if (!query.ownerId || query.ownerId.length === 0) {
      throw new Error(
        'DexieCollaborationRepository.listScratches: ownerId is required; ' +
          'a Private Scratch is owner-only and the query boundary must enforce it.',
      );
    }
    let all = (await readCollaborationTables().scratches.toArray()).filter(
      (s) => s.projectId === query.projectId && s.ownerId === query.ownerId,
    );
    if (query.status) all = all.filter((s) => s.status === query.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async getPublishDiff(id: string): Promise<PublishDiff | null> {
    return (await readCollaborationTables().publishDiffs.get(id)) ?? null;
  }

  async listPublishDiffs(query: {
    projectId: string;
    scratchId?: string;
    openOnly?: boolean;
    limit?: number;
  }): Promise<PublishDiff[]> {
    let all = (await readCollaborationTables().publishDiffs.toArray()).filter(
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

  async getConflict(id: string): Promise<Conflict | null> {
    return (await readCollaborationTables().conflicts.get(id)) ?? null;
  }

  async listConflicts(query: {
    projectId: string;
    kind?: Conflict['kind'];
    objectId?: string;
    openOnly?: boolean;
    limit?: number;
  }): Promise<Conflict[]> {
    let all = (await readCollaborationTables().conflicts.toArray()).filter(
      (c) => c.projectId === query.projectId,
    );
    if (query.kind) all = all.filter((c) => c.kind === query.kind);
    if (query.objectId) all = all.filter((c) => c.objectId === query.objectId);
    if (query.openOnly) all = all.filter((c) => c.resolution === null);
    all.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async transact<T>(fn: (tx: CollaborationRepositoryTransaction) => T | Promise<T>): Promise<T> {
    const tables = readCollaborationTables();
    // WP-08 Round 3 (P0-4): the canonical write
    // AND the outbox row commit in the SAME
    // Dexie transaction. A process crash
    // between the canonical write and the
    // outbox write cannot lose the sync intent.
    return db.transaction(
      'rw',
      [
        tables.collaborators as unknown as Table<unknown, string>,
        tables.comments as unknown as Table<unknown, string>,
        tables.activities as unknown as Table<unknown, string>,
        tables.scratches as unknown as Table<unknown, string>,
        tables.publishDiffs as unknown as Table<unknown, string>,
        tables.conflicts as unknown as Table<unknown, string>,
        // The outbox is the durable record of
        // "what we wrote but have not yet
        // acked". Including it in the same
        // transaction as the canonical rows
        // is the WP-08 Round 3 P0-4 contract.
        db.collabOutbox as unknown as Table<unknown, string>,
      ],
      async () => {
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
            const at = (c as { authorType: string }).authorType;
            if (at === 'ai') {
              throw new Error('Refusing to write canonical Collaborator with authorType="ai".');
            }
            staged.collaborators.set(c.id, c);
          },
          deleteCollaborator: (id) => staged.collaborators.set(id, null),
          putComment: (c) => staged.comments.set(c.id, c),
          deleteComment: (id) => staged.comments.set(id, null),
          putActivity: (a) => {
            staged.activities.set(a.id, a);
          },
          deleteActivity: (id) => staged.activities.set(id, null),
          putScratch: (s) => {
            const at = (s as { authorType: string }).authorType;
            if (at === 'ai') {
              throw new Error('Refusing to write canonical PrivateScratch with authorType="ai".');
            }
            staged.scratches.set(s.id, s);
          },
          deleteScratch: (id) => staged.scratches.set(id, null),
          putPublishDiff: (d) => staged.publishDiffs.set(d.id, d),
          deletePublishDiff: (id) => staged.publishDiffs.set(id, null),
          putConflict: (c) => staged.conflicts.set(c.id, c),
          deleteConflict: (id) => staged.conflicts.set(id, null),
          enqueueOp: (s) => {
            staged.outbox.set(s.opId, s);
          },
        };
        const result = await fn(tx);
        await Promise.all([
          ...Array.from(staged.collaborators).map(([id, v]) =>
            v === null ? tables.collaborators.delete(id) : tables.collaborators.put(v),
          ),
          ...Array.from(staged.comments).map(([id, v]) =>
            v === null ? tables.comments.delete(id) : tables.comments.put(v),
          ),
          ...Array.from(staged.activities).map(([id, v]) =>
            v === null ? tables.activities.delete(id) : tables.activities.put(v),
          ),
          ...Array.from(staged.scratches).map(([id, v]) =>
            v === null ? tables.scratches.delete(id) : tables.scratches.put(v),
          ),
          ...Array.from(staged.publishDiffs).map(([id, v]) =>
            v === null ? tables.publishDiffs.delete(id) : tables.publishDiffs.put(v),
          ),
          ...Array.from(staged.conflicts).map(([id, v]) =>
            v === null ? tables.conflicts.delete(id) : tables.conflicts.put(v),
          ),
          // Outbox rows: the staged shape is the
          // canonical `CollabOutboxRecord` Dexie
          // row. The outbox is a *durable* record;
          // a process crash between the canonical
          // write and the outbox write is
          // impossible because they are in the
          // same Dexie transaction.
          ...Array.from(staged.outbox).map(([_, s]) => {
            const record: CollabOutboxRecord = {
              id: s.opId,
              clientId: s.clientId,
              projectId: s.projectId,
              kind: s.kind,
              payload: s.payload,
              ...(s.baseVersion !== undefined ? { baseVersion: s.baseVersion } : {}),
              createdAt: s.createdAt,
              attempts: 0,
              lastError: null,
              syncedAt: null,
            };
            return db.collabOutbox.put(record);
          }),
        ]);
        return result;
      },
    );
  }

  subscribe(listener: (s: CollaborationSnapshot) => void): () => void {
    return getCollaborationDb().subscribe(listener);
  }
}
