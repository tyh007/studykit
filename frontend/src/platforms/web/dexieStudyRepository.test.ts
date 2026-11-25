/**
 * StudyKit v0.4 — `platforms/web/dexieStudyRepository` tests
 *
 * Round-trip tests that prove the Dexie adapter behaves
 * identically to the in-memory adapter. We can't open a real
 * IndexedDB inside happy-dom, so the test replaces the four
 * Dexie tables with in-memory fakes (the same shape the
 * production `db.studyQuestions` / `db.studyAttempts` /
 * `db.studyFeedback` / `db.studyRecovery` tables have, but
 * backed by a `Map`). The v4 Dexie migration is part of
 * `lib/db.ts`'s constructor; the fake tables sit on top of
 * the same `db` instance so `createDexieStudyRepository()`
 * reads them through the public `db.studyQuestions` shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDexieStudyRepository,
  getStudyDb,
  __resetStudyDbForTests,
} from './dexieStudyRepository';
import { db as prodDb } from '../../lib/db';
import {
  makeLocator,
  makeQuestion,
  makeAttempt,
  makeFeedback,
} from '../../domain/__fixtures__/domain-fixtures';
import type { StudyRecoveryEntry } from '../../domain/study';

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
  const hooks: { creating?: (key: string, obj: T) => void; deleting?: (key: string) => void } = {};
  // Staging map used by the in-progress fake transaction.
  // When the callback throws, we restore `rows` from
  // `txSnapshot`; on success we let the staged writes
  // stand. This mirrors Dexie's "all-or-nothing"
  // transactional semantics.
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
      hooks.deleting = h.deleting;
    },
    clear: async () => rows.clear(),
    __txBegin: begin,
    __txCommit: commit,
    __txRollback: rollback,
  };
}

beforeEach(() => {
  // Replace the four study tables on the production `db`
  // instance with in-memory fakes. happy-dom does not ship
  // IndexedDB, so the real Dexie tables cannot be exercised
  // here. The same `db` instance is used by the adapter, so
  // the round-trip exercises the real `createDexieStudyRepository`
  // code path.
  const fq = makeFakeTable();
  const fa = makeFakeTable();
  const ff = makeFakeTable();
  const fr = makeFakeTable();
  (prodDb as unknown as { studyQuestions: unknown }).studyQuestions = fq;
  (prodDb as unknown as { studyAttempts: unknown }).studyAttempts = fa;
  (prodDb as unknown as { studyFeedback: unknown }).studyFeedback = ff;
  (prodDb as unknown as { studyRecovery: unknown }).studyRecovery = fr;
  // The transaction() call on Dexie doesn't work in happy-dom
  // either; we monkey-patch the production `db.transaction` so
  // the adapter's `transact(...)` path runs the callback
  // atomically against the in-memory tables: a thrown callback
  // rolls back every staged put/delete.
  (prodDb as unknown as {
    transaction: (...args: unknown[]) => Promise<unknown>;
  }).transaction = (async (..._args: unknown[]) => {
    const tables: FakeTable<{ id: string }>[] = [fq, fa, ff, fr];
    for (const t of tables) t.__txBegin();
    const last = _args[_args.length - 1];
    if (typeof last !== 'function') return undefined;
    try {
      const out = await (last as () => Promise<unknown> | unknown)();
      for (const t of tables) t.__txCommit();
      return out;
    } catch (err) {
      for (const t of tables) t.__txRollback();
      throw err;
    }
  }) as never;
  __resetStudyDbForTests();
});

afterEach(() => {
  __resetStudyDbForTests();
});

describe('platforms/web/dexieStudyRepository / round-trip', () => {
  it('round-trips a question through put/get/list', async () => {
    const repo = createDexieStudyRepository();
    const q = makeQuestion({ id: 'q-1' });
    await repo.transact(async (tx) => {
      tx.putQuestion(q);
    });
    expect((await repo.getQuestion('q-1'))?.id).toBe('q-1');
    expect((await repo.listQuestions({})).map((x) => x.id)).toEqual(['q-1']);
  });

  it('round-trips a question with a complete source locator (page)', async () => {
    const repo = createDexieStudyRepository();
    const q = makeQuestion({
      id: 'q-page',
      locator: makeLocator({ kind: 'page', pageNumber: 7, sourceDocumentId: 'doc-77' }),
    });
    await repo.transact(async (tx) => {
      tx.putQuestion(q);
    });
    const fetched = await repo.getQuestion('q-page');
    expect(fetched?.locator).toEqual(makeLocator({ kind: 'page', pageNumber: 7, sourceDocumentId: 'doc-77' }));
    expect((await repo.listQuestions({ lectureId: 'lec-1' })).map((x) => x.id)).toEqual(['q-page']);
  });

  it('round-trips a broken source locator (no sourceDocumentId)', async () => {
    const repo = createDexieStudyRepository();
    const q = makeQuestion({
      id: 'q-broken',
      locator: makeLocator({ kind: 'page', sourceDocumentId: undefined, pageNumber: undefined }),
    });
    await repo.transact(async (tx) => {
      tx.putQuestion(q);
    });
    const fetched = await repo.getQuestion('q-broken');
    expect(fetched).not.toBeNull();
    // The locator IS persisted (a broken locator is still
    // round-trippable); `isCompleteSourceLocator` is the
    // runtime signal the UI uses to decide whether to show
    // "Jump to source" or "Source: not available".
    expect(fetched?.locator).not.toBeNull();
  });

  it('round-trips attempts and feedback linked to a question', async () => {
    const repo = createDexieStudyRepository();
    const q = makeQuestion({ id: 'q' });
    const a = makeAttempt({ id: 'a', questionId: 'q' });
    const f = makeFeedback({ id: 'f', questionId: 'q' });
    await repo.transact(async (tx) => {
      tx.putQuestion(q);
      tx.putAttempt(a);
      tx.putFeedback(f);
    });
    expect((await repo.listAttemptsForQuestion('q')).map((x) => x.id)).toEqual(['a']);
    expect((await repo.listFeedbackForQuestion('q')).map((x) => x.id)).toEqual(['f']);
  });

  it('atomic transact: a thrown callback does not leak any puts', async () => {
    const repo = createDexieStudyRepository();
    await expect(
      repo.transact(async (tx) => {
        tx.putQuestion(makeQuestion({ id: 'q1' }));
        tx.putAttempt(makeAttempt({ id: 'a1', questionId: 'q1' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repo.getQuestion('q1')).toBeNull();
    expect((await repo.listAttemptsForQuestion('q1')).length).toBe(0);
  });

  it('putRecovery overwrites by id and listRecentRecovery is filtered + ordered', async () => {
    const repo = createDexieStudyRepository();
    const base: StudyRecoveryEntry = {
      id: 'rec-1',
      containerId: 'c1',
      lectureId: 'L1',
      key: 'last-attempt',
      questionId: 'q',
      value: 'first',
      locator: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    };
    await repo.putRecovery(base);
    await repo.putRecovery({ ...base, value: 'second', updatedAt: '2026-07-21T00:00:00.000Z' });
    const recent = await repo.listRecentRecovery('c1', 'L1');
    expect(recent.length).toBe(1);
    expect(recent[0]?.value).toBe('second');
  });

  it('subscribe fires when a question is put', async () => {
    const repo = createDexieStudyRepository();
    const seen: number[] = [];
    const unsub = repo.subscribe(() => seen.push(seen.length));
    // The hook is invoked on `put`; the notify is debounced
    // via setTimeout, so we wait a tick.
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q' }));
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen.length).toBeGreaterThan(0);
    unsub();
  });

  it('listQuestions is filtered by status and review', async () => {
    const repo = createDexieStudyRepository();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'open-unreviewed', status: 'open', review: 'unreviewed' }));
      tx.putQuestion(makeQuestion({ id: 'reviewed-understood', status: 'reviewed', review: 'understood' }));
      tx.putQuestion(makeQuestion({ id: 'reviewed-uncertain', status: 'reviewed', review: 'uncertain' }));
    });
    expect((await repo.listQuestions({ status: 'open' })).map((x) => x.id)).toEqual(['open-unreviewed']);
    expect((await repo.listQuestions({ review: 'uncertain' })).map((x) => x.id)).toEqual(['reviewed-uncertain']);
  });

  it('listQuestions orders by updatedAt desc and respects limit', async () => {
    const repo = createDexieStudyRepository();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }));
      tx.putQuestion(makeQuestion({ id: 'b', updatedAt: '2026-06-01T00:00:00.000Z' }));
      tx.putQuestion(makeQuestion({ id: 'c', updatedAt: '2026-12-01T00:00:00.000Z' }));
    });
    expect((await repo.listQuestions({})).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect((await repo.listQuestions({ limit: 2 })).map((x) => x.id)).toEqual(['c', 'b']);
  });

  it('listQuestions filters by containerId (Course Home)', async () => {
    const repo = createDexieStudyRepository();
    await repo.transact(async (tx) => {
      tx.putQuestion({
        ...makeQuestion({ id: 'in-c1' }),
        container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c1' },
      });
      tx.putQuestion({
        ...makeQuestion({ id: 'in-c2' }),
        container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c2' },
      });
    });
    expect((await repo.listQuestions({ containerId: 'c1' })).map((x) => x.id)).toEqual(['in-c1']);
  });

  it('deleteQuestion removes the question; attempts are not cascade-deleted (policy)', async () => {
    const repo = createDexieStudyRepository();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q' }));
      tx.putAttempt(makeAttempt({ id: 'a', questionId: 'q' }));
    });
    await repo.transact(async (tx) => {
      tx.deleteQuestion('q');
    });
    expect(await repo.getQuestion('q')).toBeNull();
    // The adapter does NOT cascade-delete. The application
    // layer is responsible; this test pins the policy so a
    // future change is intentional.
    expect((await repo.listAttemptsForQuestion('q')).length).toBe(1);
  });

  it('getStudyDb returns the same singleton across calls', () => {
    const a = getStudyDb();
    const b = getStudyDb();
    expect(a).toBe(b);
  });

  it('__resetStudyDbForTests clears the singleton', () => {
    const a = getStudyDb();
    __resetStudyDbForTests();
    const b = getStudyDb();
    expect(a).not.toBe(b);
  });
});
