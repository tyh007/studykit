/**
 * StudyKit v0.4 — `platforms/web/dexieCollaborationRepository` tests
 *
 * Round-trip tests for the WP-08 Dexie collaboration
 * adapter. happy-dom does not ship IndexedDB; the
 * test replaces the six v8 tables with in-memory
 * fakes. The v8 Dexie migration is part of
 * `lib/db.ts`'s constructor; the fake tables sit on
 * top of the same `db` instance so the adapter
 * reads them through the public `db.collabX`
 * shape.
 *
 * The tests cover:
 *   - round-trip of every record type
 *   - atomic transact (rollback on throw)
 *   - authorType='ai' refused at the put boundary
 *   - subscribe (notify) fires on commit
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDexieCollaborationRepository,
  getCollaborationDb,
  __resetCollaborationDbForTests,
} from './dexieCollaborationRepository';
import { db as prodDb } from '../../lib/db';
import type {
  Collaborator,
  Comment,
  Activity,
  PrivateScratch,
  PublishDiff,
  Conflict,
} from '../../domain/collaboration';

const NOW = '2026-07-24T12:00:00.000Z';

interface FakeTable<T extends { id: string }> {
  toArray(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
  delete(id: string): Promise<void>;
  hook(hooks: {
    creating?: (key: string, obj: T) => void;
    updating?: (modifications: Partial<T>, key: string, obj: T) => void;
    deleting?: (key: string) => void;
  }): void;
  clear(): Promise<void>;
  __txBegin(): void;
  __txCommit(): void;
  __txRollback(): void;
}

function makeFakeTable<T extends { id: string }>(): FakeTable<T> {
  const rows = new Map<string, T>();
  const hooks: {
    creating?: (key: string, obj: T) => void;
    updating?: (modifications: Partial<T>, key: string, obj: T) => void;
    deleting?: (key: string) => void;
  } = {};
  let txSnapshot: Map<string, T> | null = null;
  const begin = (): void => {
    if (txSnapshot) return;
    txSnapshot = new Map(rows);
  };
  const commit = (): void => {
    txSnapshot = null;
  };
  const rollback = (): void => {
    if (!txSnapshot) return;
    rows.clear();
    for (const [k, v] of txSnapshot) rows.set(k, v);
    txSnapshot = null;
  };
  return {
    toArray: async () => Array.from(rows.values()),
    get: async (id) => rows.get(id),
    put: async (row) => {
      if (txSnapshot) begin();
      rows.set(row.id, row);
      hooks.creating?.(row.id, row);
    },
    delete: async (id) => {
      if (txSnapshot) begin();
      rows.delete(id);
      hooks.deleting?.(id);
    },
    hook: (h) => {
      hooks.creating = h.creating;
      hooks.updating = h.updating;
      hooks.deleting = h.deleting;
    },
    clear: async () => rows.clear(),
    __txBegin: begin,
    __txCommit: commit,
    __txRollback: rollback,
  };
}

function makeMember(over: Partial<Collaborator> = {}): Collaborator {
  return {
    id: 'col_1',
    projectId: 'p_1',
    userId: 'u_1',
    displayName: 'Test',
    role: 'commenter',
    addedAt: NOW,
    addedBy: 'u_owner',
    authorType: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'cmt_1',
    projectId: 'p_1',
    targetKind: 'project',
    targetId: 'p_1',
    threadId: 'cmt_1',
    parentId: null,
    authorId: 'u_1',
    authorDisplayName: 'Test',
    authorType: 'user',
    body: 'Hello',
    mentions: [],
    resolvedAt: null,
    resolvedBy: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeActivity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'act_1',
    projectId: 'p_1',
    actorId: 'u_1',
    actorDisplayName: 'Test',
    actorType: 'user',
    kind: 'comment-posted',
    targetKind: 'project',
    targetId: 'p_1',
    summary: 'Test',
    body: 'Hello',
    scope: 'project',
    ephemeral: false,
    createdAt: NOW,
    ...over,
  };
}

function makeScratch(over: Partial<PrivateScratch> = {}): PrivateScratch {
  return {
    id: 'scr_1',
    projectId: 'p_1',
    ownerId: 'u_1',
    kind: 'note',
    title: 't',
    body: 'b',
    status: 'private',
    publishedRef: null,
    publishedAt: null,
    revertedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    authorType: 'user',
    ...over,
  };
}

function makePublishDiff(over: Partial<PublishDiff> = {}): PublishDiff {
  return {
    id: 'pd_1',
    scratchId: 'scr_1',
    projectId: 'p_1',
    ownerId: 'u_1',
    rows: [{ op: 'added', path: 'title', before: null, after: 't' }],
    targetId: null,
    createdAt: NOW,
    confirmedAt: null,
    cancelledAt: null,
    ...over,
  };
}

function makeConflict(over: Partial<Conflict> = {}): Conflict {
  return {
    id: 'cfl_1',
    projectId: 'p_1',
    kind: 'comment',
    objectId: 'cmt_1',
    local: {
      side: 'local',
      actorId: 'u_local',
      actorDisplayName: 'L',
      baseVersion: 1,
      payload: 'a',
      writtenAt: NOW,
    },
    remote: {
      side: 'remote',
      actorId: 'u_remote',
      actorDisplayName: 'R',
      baseVersion: 1,
      payload: 'b',
      writtenAt: NOW,
    },
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: '',
    detectedAt: NOW,
    ...over,
  };
}

beforeEach(() => {
  const fCollaborators = makeFakeTable<Collaborator>();
  const fComments = makeFakeTable<Comment>();
  const fActivities = makeFakeTable<Activity>();
  const fScratches = makeFakeTable<PrivateScratch>();
  const fPublishDiffs = makeFakeTable<PublishDiff>();
  const fConflicts = makeFakeTable<Conflict>();
  (prodDb as unknown as { collabCollaborators: unknown }).collabCollaborators = fCollaborators;
  (prodDb as unknown as { collabComments: unknown }).collabComments = fComments;
  (prodDb as unknown as { collabActivities: unknown }).collabActivities = fActivities;
  (prodDb as unknown as { collabScratches: unknown }).collabScratches = fScratches;
  (prodDb as unknown as { collabPublishDiffs: unknown }).collabPublishDiffs = fPublishDiffs;
  (prodDb as unknown as { collabConflicts: unknown }).collabConflicts = fConflicts;
  const allTables: FakeTable<{ id: string }>[] = [
    fCollaborators,
    fComments,
    fActivities,
    fScratches,
    fPublishDiffs,
    fConflicts,
  ];
  (prodDb as unknown as { transaction: (...args: unknown[]) => Promise<unknown> }).transaction =
    (async (...args: unknown[]) => {
      for (const t of allTables) t.__txBegin();
      const last = args[args.length - 1];
      if (typeof last !== 'function') return undefined;
      try {
        const out = await (last as () => Promise<unknown> | unknown)();
        for (const t of allTables) t.__txCommit();
        return out;
      } catch (err) {
        for (const t of allTables) t.__txRollback();
        throw err;
      }
    }) as never;
  __resetCollaborationDbForTests();
});

afterEach(() => {
  __resetCollaborationDbForTests();
});

describe('platforms/web/dexieCollaborationRepository / round-trip', () => {
  it('round-trips a Collaborator', async () => {
    const repo = createDexieCollaborationRepository();
    await repo.transact(async (tx) => tx.putCollaborator(makeMember({ id: 'col_x' })));
    expect((await repo.getCollaborator('col_x'))?.userId).toBe('u_1');
    expect((await repo.listCollaborators({ projectId: 'p_1' })).map((c) => c.id)).toEqual(['col_x']);
  });

  it('round-trips a Comment with mentions + threading', async () => {
    const repo = createDexieCollaborationRepository();
    await repo.transact(async (tx) =>
      tx.putComment(
        makeComment({
          id: 'cmt_root',
          body: 'Hi @u_2',
          mentions: [
            { userId: 'u_2', displayName: 'U 2', position: 3, length: 5 },
          ],
        }),
      ),
    );
    await repo.transact(async (tx) =>
      tx.putComment(
        makeComment({
          id: 'cmt_reply',
          parentId: 'cmt_root',
          threadId: 'cmt_root',
        }),
      ),
    );
    const all = await repo.listComments({ projectId: 'p_1' });
    expect(all.length).toBe(2);
    const root = await repo.listComments({ projectId: 'p_1', threadRootsOnly: true });
    expect(root.map((c) => c.id)).toEqual(['cmt_root']);
  });

  it('round-trips Activity + filters by ephemeral', async () => {
    const repo = createDexieCollaborationRepository();
    await repo.transact(async (tx) => tx.putActivity(makeActivity({ id: 'a1' })));
    await repo.transact(async (tx) =>
      tx.putActivity(
        makeActivity({ id: 'a2', kind: 'presence-joined', ephemeral: true }),
      ),
    );
    const all = await repo.listActivity({ projectId: 'p_1' });
    expect(all.length).toBe(1);
    expect(all[0]!.id).toBe('a1');
    const incl = await repo.listActivity({ projectId: 'p_1', includeEphemeral: true });
    expect(incl.length).toBe(2);
  });

  it('round-trips PrivateScratch + open publish diff', async () => {
    const repo = createDexieCollaborationRepository();
    await repo.transact(async (tx) => tx.putScratch(makeScratch({ id: 's1' })));
    await repo.transact(async (tx) => tx.putPublishDiff(makePublishDiff({ id: 'pd1' })));
    const s = await repo.getScratchForOwner('s1', 'u_1');
    expect(s?.status).toBe('private');
    // A non-owner cannot read by id.
    const leaked = await repo.getScratchForOwner('s1', 'u_OTHER');
    expect(leaked).toBeNull();
    const open = await repo.listPublishDiffs({ projectId: 'p_1', openOnly: true });
    expect(open.length).toBe(1);
  });

  it('round-trips Conflict + openOnly filter', async () => {
    const repo = createDexieCollaborationRepository();
    await repo.transact(async (tx) => tx.putConflict(makeConflict({ id: 'cf1' })));
    await repo.transact(async (tx) =>
      tx.putConflict(
        makeConflict({
          id: 'cf2',
          resolution: 'merged',
          resolvedBy: 'u_owner',
          resolvedAt: NOW,
        }),
      ),
    );
    const open = await repo.listConflicts({ projectId: 'p_1', openOnly: true });
    expect(open.map((c) => c.id)).toEqual(['cf1']);
  });
});

describe('platforms/web/dexieCollaborationRepository / invariants', () => {
  it('refuses a Collaborator with authorType="ai" at the put boundary', async () => {
    const repo = createDexieCollaborationRepository();
    // The type system refuses `'ai'` for a
    // Collaborator, so the test forces a cast
    // that mirrors a buggy caller widening the
    // type at runtime. The adapter must throw.
    await expect(
      repo.transact(async (tx) =>
        tx.putCollaborator({
          ...makeMember({ id: 'col_ai' }),
          authorType: 'ai' as unknown as 'user',
        }),
      ),
    ).rejects.toThrowError(/authorType="ai"/);
  });

  it('refuses a PrivateScratch with authorType="ai" at the put boundary', async () => {
    const repo = createDexieCollaborationRepository();
    await expect(
      repo.transact(async (tx) =>
        tx.putScratch({
          ...makeScratch({ id: 'scr_ai' }),
          authorType: 'ai' as unknown as 'user',
        }),
      ),
    ).rejects.toThrowError(/authorType="ai"/);
  });
});

describe('platforms/web/dexieCollaborationRepository / subscribe', () => {
  it('fires the listener after a commit', async () => {
    const repo = createDexieCollaborationRepository();
    let count = 0;
    const off = repo.subscribe(() => {
      count += 1;
    });
    await repo.transact(async (tx) => tx.putCollaborator(makeMember({ id: 'col_sub' })));
    // The Dexie adapter debounces notifications
    // with setTimeout(0); wait one microtask +
    // one macrotask before asserting.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(count).toBeGreaterThanOrEqual(1);
    off();
  });

  it('does not fire the listener after unsubscribe', async () => {
    const repo = createDexieCollaborationRepository();
    let count = 0;
    const off = repo.subscribe(() => {
      count += 1;
    });
    off();
    await repo.transact(async (tx) => tx.putCollaborator(makeMember({ id: 'col_x' })));
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(count).toBe(0);
  });
});

describe('platforms/web/dexieCollaborationRepository / atomic transact', () => {
  it('rolls back when the callback throws', async () => {
    const repo = createDexieCollaborationRepository();
    await expect(
      repo.transact(async (tx) => {
        tx.putCollaborator(makeMember({ id: 'col_rollback' }));
        throw new Error('boom');
      }),
    ).rejects.toThrowError(/boom/);
    // The collaborator was rolled back.
    expect(await repo.getCollaborator('col_rollback')).toBeNull();
  });
});
