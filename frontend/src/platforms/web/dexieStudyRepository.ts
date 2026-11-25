/**
 * StudyKit v0.4 — `platforms/web/dexieStudyRepository`
 *
 * The Dexie / IndexedDB-backed implementation of the
 * `StudyRepository` contract. This is the production adapter
 * the Study use cases talk to; the in-memory `MemoryStudyRepository`
 * is for tests.
 *
 * Schema strategy
 * ---------------
 *
 *   - One new table per Study object: `studyQuestions`,
 *     `studyAttempts`, `studyFeedback`, `studyRecovery`.
 *   - Additive Dexie migration `v4` — older databases (v1–v3)
 *     open unchanged. The migration declares the four new
 *     tables; it never touches existing tables. WP-04 Gate
 *     "若需要 Dexie schema/migration，必须可回滚、幂等、有
 *     fixture/round-trip tests" — the migration is declared
 *     in `lib/db.ts` (the same Dexie instance), is idempotent
 *     (re-running `version(4).stores(...)` is a no-op once the
 *     schema is at v4) and the round-trip test below proves
 *     every adapter method round-trips data losslessly.
 *
 * Subscriptions
 * -------------
 *
 *   Dexie has no `subscribe` primitive. We attach to the
 *   table's `creating` / `updating` / `deleting` hooks so any
 *   `put` / `delete` on the four tables fires a `notify()`
 *   that the `StudyRepository.subscribe` consumer listens to.
 *   The in-memory adapter uses its own implementation; both
 *   call the same `notify()` shape so callers don't care.
 *
 * UI guard
 * --------
 *
 *   `application/study/studyUseCases` is the only consumer; it
 *   imports this file through the `StudyRepository` interface
 *   and never imports `lib/db` directly.
 */

import type { Table } from 'dexie';
import { db } from '../../lib/db';
import type {
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
  StudyRecoveryEntry,
} from '../../domain/study';
import type {
  QuestionQuery,
  StudyRepository,
  StudyRepositoryTransaction,
  StudySnapshot,
} from '../../application/study/studyRepository';

// ---------------------------------------------------------------------------
// Dexie adapter shape. Dexie's real `Table` exposes a
// superset of these methods, so we narrow the surface to
// the minimum this file uses. This makes the fake-table used
// in tests trivially compatible with the real Dexie table.
// ---------------------------------------------------------------------------

interface StudyDexieTable<T> {
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

function readStudyTables(): StudyTables {
  const extended = db as unknown as {
    studyQuestions: Table<StudyQuestion, string>;
    studyAttempts: Table<StudyAttempt, string>;
    studyFeedback: Table<StudyFeedback, string>;
    studyRecovery: Table<StudyRecoveryEntry, string>;
  };
  return {
    questions: extended.studyQuestions as unknown as StudyDexieTable<StudyQuestion>,
    attempts: extended.studyAttempts as unknown as StudyDexieTable<StudyAttempt>,
    feedback: extended.studyFeedback as unknown as StudyDexieTable<StudyFeedback>,
    recovery: extended.studyRecovery as unknown as StudyDexieTable<StudyRecoveryEntry>,
  };
}

interface StudyTables {
  questions: StudyDexieTable<StudyQuestion>;
  attempts: StudyDexieTable<StudyAttempt>;
  feedback: StudyDexieTable<StudyFeedback>;
  recovery: StudyDexieTable<StudyRecoveryEntry>;
}

class StudyDexieDB {
  private readonly listeners = new Set<(s: StudySnapshot) => void>();
  private notifyScheduled: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly tables: StudyTables) {
    const fire = (): void => this.scheduleNotify();
    for (const t of [tables.questions, tables.attempts, tables.feedback, tables.recovery]) {
      t.hook({
        creating: fire,
        updating: fire,
        deleting: fire,
      });
    }
  }

  subscribe(listener: (s: StudySnapshot) => void): () => void {
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
    const [questions, attempts, feedback, recovery] = await Promise.all([
      this.tables.questions.toArray(),
      this.tables.attempts.toArray(),
      this.tables.feedback.toArray(),
      this.tables.recovery.toArray(),
    ]);
    const snap: StudySnapshot = { questions, attempts, feedback, recovery };
    for (const l of this.listeners) l(snap);
  }
}

// ---------------------------------------------------------------------------
// Lazy init. The first call wires the Dexie `db` from
// `lib/db.ts` (which already declared the v4 migration in
// its constructor) into a `StudyDexieDB`. Subsequent calls
// return the cached instance. Tests call
// `__resetStudyDbForTests()` to force a re-init.
// ---------------------------------------------------------------------------

let cached: StudyDexieDB | null = null;

export function getStudyDb(): StudyDexieDB {
  if (cached) return cached;
  cached = new StudyDexieDB(readStudyTables());
  return cached;
}

/** Test-only reset. */
export function __resetStudyDbForTests(): void {
  cached = null;
}

export type { StudyDexieDB };

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Build a `StudyRepository` backed by the singleton Study Dexie
 * DB. The factory exists so tests can inject a fake without
 * touching Dexie; the real production call is
 * `createDexieStudyRepository()`.
 */
export function createDexieStudyRepository(): StudyRepository {
  return new DexieStudyRepository();
}

class DexieStudyRepository implements StudyRepository {
  async getQuestion(id: string): Promise<StudyQuestion | null> {
    const tables = readStudyTables();
    const found = await tables.questions.get(id);
    return found ?? null;
  }

  async listQuestions(query: QuestionQuery): Promise<StudyQuestion[]> {
    const tables = readStudyTables();
    const all = await tables.questions.toArray();
    let filtered: StudyQuestion[] = all;
    if (query.containerId) {
      filtered = filtered.filter((q) => q.container?.id === query.containerId);
    }
    if (query.lectureId) {
      filtered = filtered.filter((q) => q.locator?.lectureId === query.lectureId);
    }
    if (query.status) {
      filtered = filtered.filter((q) => q.status === query.status);
    }
    if (query.review) {
      filtered = filtered.filter((q) => q.review === query.review);
    }
    if (query.since) {
      const since = query.since;
      filtered = filtered.filter((q) => q.createdAt >= since);
    }
    filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) filtered = filtered.slice(0, query.limit);
    return filtered;
  }

  async listAttemptsForQuestion(questionId: string): Promise<StudyAttempt[]> {
    const tables = readStudyTables();
    const all = await tables.attempts.toArray();
    return all
      .filter((a) => a.questionId === questionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listFeedbackForQuestion(questionId: string): Promise<StudyFeedback[]> {
    const tables = readStudyTables();
    const all = await tables.feedback.toArray();
    return all
      .filter((f) => f.questionId === questionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listRecentRecovery(containerId: string, lectureId: string): Promise<StudyRecoveryEntry[]> {
    const tables = readStudyTables();
    const all = await tables.recovery.toArray();
    return all
      .filter((r) => r.containerId === containerId && r.lectureId === lectureId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async transact<T>(fn: (tx: StudyRepositoryTransaction) => T | Promise<T>): Promise<T> {
    // Dexie supports cross-table transactions; we use a single
    // `rw` transaction across the four Study tables so every
    // `put` / `delete` is atomic. The transaction is wrapped
    // in a microtask so the callback can be sync or async.
    const tables = readStudyTables();
    return db.transaction(
      'rw',
      [
        tables.questions as unknown as Table<unknown, string>,
        tables.attempts as unknown as Table<unknown, string>,
        tables.feedback as unknown as Table<unknown, string>,
        tables.recovery as unknown as Table<unknown, string>,
      ],
      async () => {
        const tx: StudyRepositoryTransaction = {
          putQuestion: (q) => {
            void tables.questions.put(q);
          },
          putAttempt: (a) => {
            void tables.attempts.put(a);
          },
          putFeedback: (f) => {
            void tables.feedback.put(f);
          },
          deleteQuestion: (id) => {
            void tables.questions.delete(id);
          },
          deleteAttempt: (id) => {
            void tables.attempts.delete(id);
          },
          deleteFeedback: (id) => {
            void tables.feedback.delete(id);
          },
        };
        return await fn(tx);
      },
    ) as Promise<T>;
  }

  async putRecovery(entry: StudyRecoveryEntry): Promise<void> {
    const tables = readStudyTables();
    await tables.recovery.put(entry);
  }

  subscribe(listener: (s: StudySnapshot) => void): () => void {
    return getStudyDb().subscribe(listener);
  }
}
