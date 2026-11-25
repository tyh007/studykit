/**
 * StudyKit v0.4 — `application/study/studyRepository` tests.
 *
 * Locks the contract: round-trip, query filters, atomic
 * transactions, recovery buffer, and live subscription. The
 * same test suite runs against the in-memory adapter and
 * (later, in `platforms/web`) the Dexie adapter to prove they
 * behave identically. The Dexie-specific test file lives next
 * to the adapter.
 */

import { describe, expect, it } from 'vitest';
import {
  MemoryStudyRepository,
  isQuestionQuery,
} from './studyRepository';
import {
  makeLocator,
  makeQuestion,
  makeAttempt,
  makeFeedback,
} from '../../domain/__fixtures__/domain-fixtures';
import type { StudyQuestion, StudyRecoveryEntry } from '../../domain/study';

function newRepo(): MemoryStudyRepository {
  return new MemoryStudyRepository();
}

describe('application/study/studyRepository / isQuestionQuery', () => {
  it('accepts an empty query', () => {
    expect(isQuestionQuery({})).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(isQuestionQuery({ status: 'pending' })).toBe(false);
  });

  it('rejects an unknown review', () => {
    expect(isQuestionQuery({ review: 'mastered' })).toBe(false);
  });

  it('accepts a non-negative limit', () => {
    expect(isQuestionQuery({ limit: 5 })).toBe(true);
  });

  it('rejects a negative limit', () => {
    expect(isQuestionQuery({ limit: -1 })).toBe(false);
  });
});

describe('application/study/studyRepository / MemoryStudyRepository', () => {
  it('round-trips a question through put/get/list', async () => {
    const repo = newRepo();
    const q = makeQuestion({ id: 'q-1' });
    await repo.transact(async (tx) => {
      tx.putQuestion(q);
    });
    expect((await repo.getQuestion('q-1'))?.id).toBe('q-1');
    expect((await repo.listQuestions({})).map((x) => x.id)).toEqual(['q-1']);
  });

  it('lists questions filtered by container / lecture / status / review', async () => {
    const repo = newRepo();
    const a = makeQuestion({ id: 'a', container: undefined, locator: makeLocator({ lectureId: 'L1' }), status: 'open', review: 'unreviewed' });
    const b = makeQuestion({ id: 'b', locator: makeLocator({ lectureId: 'L2' }), status: 'reviewed', review: 'understood' });
    const c = makeQuestion({ id: 'c', locator: makeLocator({ lectureId: 'L1' }), status: 'open', review: 'uncertain' });
    await repo.transact(async (tx) => {
      tx.putQuestion(a);
      tx.putQuestion(b);
      tx.putQuestion(c);
    });
    expect((await repo.listQuestions({ lectureId: 'L1' })).map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect((await repo.listQuestions({ status: 'reviewed' })).map((x) => x.id)).toEqual(['b']);
    expect((await repo.listQuestions({ review: 'uncertain' })).map((x) => x.id)).toEqual(['c']);
    expect((await repo.listQuestions({ lectureId: 'L1', status: 'open' })).map((x) => x.id).sort()).toEqual(['a', 'c']);
  });

  it('limits the result count', async () => {
    const repo = newRepo();
    for (let i = 0; i < 5; i++) {
      await repo.transact(async (tx) => {
        tx.putQuestion(makeQuestion({ id: `q-${i}`, updatedAt: `2026-07-20T00:00:0${i}.000Z` }));
      });
    }
    expect((await repo.listQuestions({ limit: 3 })).length).toBe(3);
  });

  it('orders by updatedAt desc (most recent first)', async () => {
    const repo = newRepo();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }));
      tx.putQuestion(makeQuestion({ id: 'mid', updatedAt: '2026-06-01T00:00:00.000Z' }));
      tx.putQuestion(makeQuestion({ id: 'new', updatedAt: '2026-12-01T00:00:00.000Z' }));
    });
    const ids = (await repo.listQuestions({})).map((x) => x.id);
    expect(ids).toEqual(['new', 'mid', 'old']);
  });

  it('attempts are listed per question, in createdAt order', async () => {
    const repo = newRepo();
    const q = makeQuestion({ id: 'q' });
    await repo.transact(async (tx) => {
      tx.putQuestion(q);
      tx.putAttempt(makeAttempt({ id: 'a2', questionId: 'q', createdAt: '2026-03-01T00:00:00.000Z' }));
      tx.putAttempt(makeAttempt({ id: 'a1', questionId: 'q', createdAt: '2026-01-01T00:00:00.000Z' }));
    });
    expect((await repo.listAttemptsForQuestion('q')).map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('feedback is listed per question, in createdAt order', async () => {
    const repo = newRepo();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q' }));
      tx.putFeedback(makeFeedback({ id: 'f2', questionId: 'q', createdAt: '2026-04-01T00:00:00.000Z' }));
      tx.putFeedback(makeFeedback({ id: 'f1', questionId: 'q', createdAt: '2026-02-01T00:00:00.000Z' }));
    });
    expect((await repo.listFeedbackForQuestion('q')).map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('transact applies all puts atomically; nothing leaks on throw', async () => {
    const repo = newRepo();
    await expect(
      repo.transact(async (tx) => {
        tx.putQuestion(makeQuestion({ id: 'q1' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Question must NOT have leaked into the store.
    expect(await repo.getQuestion('q1')).toBeNull();
  });

  it('transact applies deletes in the same atomic step', async () => {
    const repo = newRepo();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q' }));
    });
    await repo.transact(async (tx) => {
      tx.deleteQuestion('q');
    });
    expect(await repo.getQuestion('q')).toBeNull();
  });

  it('subscribe fires on every transact and putRecovery', async () => {
    const repo = newRepo();
    const seen: number[] = [];
    const unsub = repo.subscribe(() => seen.push(seen.length));
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q' }));
    });
    expect(seen.length).toBe(1);
    await repo.putRecovery({
      id: 'rec-1',
      containerId: 'c1',
      lectureId: 'L1',
      key: 'last-attempt',
      questionId: 'q',
      value: 'a',
      locator: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    } satisfies StudyRecoveryEntry);
    expect(seen.length).toBe(2);
    unsub();
  });

  it('listRecentRecovery is filtered by container and lecture, ordered desc', async () => {
    const repo = newRepo();
    const make = (overrides: Partial<StudyRecoveryEntry>): StudyRecoveryEntry => ({
      id: `rec-${overrides.questionId ?? 'q'}-${overrides.key ?? 'last-attempt'}-${overrides.updatedAt ?? '0'}`,
      containerId: 'c1',
      lectureId: 'L1',
      key: 'last-attempt',
      questionId: 'q',
      value: 'v',
      locator: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
      ...overrides,
    });
    await repo.putRecovery(make({ lectureId: 'L2', updatedAt: '2026-12-01T00:00:00.000Z' }));
    await repo.putRecovery(make({ key: 'last-feedback', updatedAt: '2026-10-01T00:00:00.000Z' }));
    await repo.putRecovery(make({ key: 'draft-input', updatedAt: '2026-11-01T00:00:00.000Z' }));
    const recent = await repo.listRecentRecovery('c1', 'L1');
    expect(recent.map((r) => `${r.key}@${r.updatedAt}`)).toEqual([
      'draft-input@2026-11-01T00:00:00.000Z',
      'last-feedback@2026-10-01T00:00:00.000Z',
    ]);
  });

  it('overwrites a recovery entry with the same id', async () => {
    const repo = newRepo();
    const base: StudyRecoveryEntry = {
      id: 'rec-overwrite',
      containerId: 'c1',
      lectureId: 'L1',
      key: 'last-attempt',
      questionId: 'q',
      value: 'first',
      locator: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    };
    await repo.putRecovery(base);
    await repo.putRecovery({ ...base, value: 'second' });
    const recent = await repo.listRecentRecovery('c1', 'L1');
    expect(recent.length).toBe(1);
    expect(recent[0]?.value).toBe('second');
  });

  it('subscribe can be unsubscribed and stops receiving updates', async () => {
    const repo = newRepo();
    let count = 0;
    const unsub = repo.subscribe(() => count++);
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q' }));
    });
    expect(count).toBe(1);
    unsub();
    await repo.transact(async (tx) => {
      tx.putQuestion(makeQuestion({ id: 'q2' }));
    });
    expect(count).toBe(1);
  });

  it('unsubscribe is idempotent', () => {
    const repo = newRepo();
    const unsub = repo.subscribe(() => undefined);
    unsub();
    unsub();
    // No throw; the set is just a no-op.
  });

  it('transact with no mutations still notifies (caller-side hook for live queries)', async () => {
    const repo = newRepo();
    let count = 0;
    repo.subscribe(() => count++);
    await repo.transact(async () => undefined);
    expect(count).toBe(1);
  });

  it('questions with the same updatedAt keep insertion order (stable sort)', async () => {
    const repo = newRepo();
    const ts = '2026-07-20T00:00:00.000Z';
    for (const id of ['a', 'b', 'c']) {
      await repo.transact(async (tx) => {
        tx.putQuestion(makeQuestion({ id, updatedAt: ts }));
      });
    }
    // Stable: same `localeCompare` returns 0, so the original
    // (insertion) order is preserved by Array.prototype.sort.
    expect((await repo.listQuestions({})).map((q: StudyQuestion) => q.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
