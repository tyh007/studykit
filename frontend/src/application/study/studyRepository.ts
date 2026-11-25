/**
 * StudyKit v0.4 — `application/study/studyRepository`
 *
 * The minimum persistence contract for the Study Vertical Slice
 * (WP-04). It deliberately mirrors the shape of
 * `domain/repository.StudyKitRepository` (one `transact` for
 * atomic writes, one `subscribe` for live updates, one
 * `exportSnapshot` for the future backup) but is a *separate*
 * contract:
 *
 *   - It is narrower: it only carries the four Study objects
 *     (Question, Attempt, Feedback) plus a tiny per-container
 *     "last confirmed input" buffer used for reload recovery.
 *   - It has no `kind` filter / `text` search — those are
 *     application-layer concerns the Study Home / Course Home
 *     surfaces do in memory. Keeping the contract narrow makes
 *     the in-memory and Dexie adapters tiny and unambiguous.
 *
 * The contract is satisfied by two adapters:
 *
 *   - `MemoryStudyRepository`     — in-memory, used by tests.
 *   - `DexieStudyRepository`      — IndexedDB-backed, used by
 *                                  production. Lives next to the
 *                                  `WebPort` adapter under
 *                                  `platforms/web`.
 *
 * Per WP-04 Gate: "若需要 Dexie schema/migration，必须可回滚、
 * 幂等、有 fixture/round-trip tests；UI 禁止直连 Dexie".
 * The Dexie adapter therefore lives under `platforms/web/` and
 * is wrapped in a `StudyRepository` interface here, so callers
 * (use cases) never import Dexie tables.
 */

import type {
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
  ReviewState,
  StudyRecoveryEntry,
} from '../../domain/study';

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

/**
 * Atomic write handle. A `transact` callback receives a fresh
 * transaction; every `put` / `delete` is staged and applied
 * together at the end of the callback. This is the only way to
 * modify Study objects — there is no "put one question without
 * putting the matching attempt" path.
 */
export interface StudyRepositoryTransaction {
  putQuestion(q: StudyQuestion): void;
  putAttempt(a: StudyAttempt): void;
  putFeedback(f: StudyFeedback): void;
  deleteQuestion(id: string): void;
  deleteAttempt(id: string): void;
  deleteFeedback(id: string): void;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Restrict a `listQuestions` call. Empty filters mean "all
 * questions in scope". A `status` filter is a strict equality
 * match (no `IN`); a `review` filter accepts a single
 * `ReviewState`. A `lectureId` filter restricts to questions
 * whose locator points at a specific lecture.
 */
export interface QuestionQuery {
  readonly containerId?: string;
  readonly lectureId?: string;
  readonly status?: StudyQuestion['status'];
  readonly review?: ReviewState;
  /** When set, limit the result count (for the Review queue). */
  readonly limit?: number;
  /** When set, only return questions created at-or-after this ISO ts. */
  readonly since?: string;
}

export function isQuestionQuery(value: unknown): value is QuestionQuery {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.containerId !== undefined && typeof v.containerId !== 'string') return false;
  if (v.lectureId !== undefined && typeof v.lectureId !== 'string') return false;
  if (v.status !== undefined) {
    if (v.status !== 'open' && v.status !== 'answered' && v.status !== 'reviewed' && v.status !== 'archived') {
      return false;
    }
  }
  if (v.review !== undefined) {
    if (
      v.review !== 'unreviewed' &&
      v.review !== 'understood' &&
      v.review !== 'uncertain' &&
      v.review !== 'review-later'
    ) {
      return false;
    }
  }
  if (v.limit !== undefined && (typeof v.limit !== 'number' || v.limit < 0)) return false;
  if (v.since !== undefined && typeof v.since !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reload recovery
// ---------------------------------------------------------------------------

// `StudyRecoveryEntry` lives in `domain/study` so it can be
// shared across the use-case layer, the Dexie schema, and the
// UI without circular imports. The repository just stores
// and reads it.

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type StudyQueryListener = (snapshot: StudySnapshot) => void;
export type Unsubscribe = () => void;

export interface StudySnapshot {
  readonly questions: readonly StudyQuestion[];
  readonly attempts: readonly StudyAttempt[];
  readonly feedback: readonly StudyFeedback[];
  readonly recovery: readonly StudyRecoveryEntry[];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * The contract every Study persistence adapter must implement.
 * The Dexie adapter and the in-memory test adapter both
 * satisfy this shape.
 */
export interface StudyRepository {
  // CRUD
  getQuestion(id: string): Promise<StudyQuestion | null>;
  listQuestions(query: QuestionQuery): Promise<StudyQuestion[]>;
  listAttemptsForQuestion(questionId: string): Promise<StudyAttempt[]>;
  listFeedbackForQuestion(questionId: string): Promise<StudyFeedback[]>;
  listRecentRecovery(containerId: string, lectureId: string): Promise<StudyRecoveryEntry[]>;

  // Atomic writes
  transact<T>(fn: (tx: StudyRepositoryTransaction) => T | Promise<T>): Promise<T>;

  // Reload-recovery: small per-(container, lecture) key/value
  // buffer used to restore the user's last confirmed input on
  // reload, offline, or AI failure. The repository is
  // authoritative: UI never persists these in localStorage.
  putRecovery(entry: StudyRecoveryEntry): Promise<void>;

  // Live updates
  subscribe(listener: StudyQueryListener): Unsubscribe;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory implementation. Lives in the application
 * layer because both the Study tests AND the use cases'
 * deterministic tests need a no-network, no-Dexie implementation
 * to drive. The Dexie adapter lives under `platforms/web/`.
 */
export class MemoryStudyRepository implements StudyRepository {
  private readonly questions = new Map<string, StudyQuestion>();
  private readonly attempts = new Map<string, StudyAttempt>();
  private readonly feedback = new Map<string, StudyFeedback>();
  private readonly recovery = new Map<string, StudyRecoveryEntry>();
  private readonly listeners = new Set<StudyQueryListener>();

  async getQuestion(id: string): Promise<StudyQuestion | null> {
    return this.questions.get(id) ?? null;
  }

  async listQuestions(query: QuestionQuery): Promise<StudyQuestion[]> {
    let all: StudyQuestion[] = Array.from(this.questions.values());
    if (query.containerId) {
      all = all.filter((q) => q.container?.id === query.containerId);
    }
    if (query.lectureId) {
      all = all.filter((q) => q.locator?.lectureId === query.lectureId);
    }
    if (query.status) {
      all = all.filter((q) => q.status === query.status);
    }
    if (query.review) {
      all = all.filter((q) => q.review === query.review);
    }
    if (query.since) {
      all = all.filter((q) => q.createdAt >= (query.since as string));
    }
    // Stable order: most recent first.
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined) all = all.slice(0, query.limit);
    return all;
  }

  async listAttemptsForQuestion(questionId: string): Promise<StudyAttempt[]> {
    return Array.from(this.attempts.values())
      .filter((a) => a.questionId === questionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listFeedbackForQuestion(questionId: string): Promise<StudyFeedback[]> {
    return Array.from(this.feedback.values())
      .filter((f) => f.questionId === questionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listRecentRecovery(containerId: string, lectureId: string): Promise<StudyRecoveryEntry[]> {
    return Array.from(this.recovery.values())
      .filter((r) => r.containerId === containerId && r.lectureId === lectureId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async transact<T>(fn: (tx: StudyRepositoryTransaction) => T | Promise<T>): Promise<T> {
    const stagedQuestions = new Map<string, StudyQuestion | null>();
    const stagedAttempts = new Map<string, StudyAttempt | null>();
    const stagedFeedback = new Map<string, StudyFeedback | null>();
    const tx: StudyRepositoryTransaction = {
      putQuestion: (q) => stagedQuestions.set(q.id, q),
      putAttempt: (a) => stagedAttempts.set(a.id, a),
      putFeedback: (f) => stagedFeedback.set(f.id, f),
      deleteQuestion: (id) => stagedQuestions.set(id, null),
      deleteAttempt: (id) => stagedAttempts.set(id, null),
      deleteFeedback: (id) => stagedFeedback.set(id, null),
    };
    const result = await fn(tx);
    for (const [id, value] of stagedQuestions) {
      if (value === null) this.questions.delete(id);
      else this.questions.set(id, value);
    }
    for (const [id, value] of stagedAttempts) {
      if (value === null) this.attempts.delete(id);
      else this.attempts.set(id, value);
    }
    for (const [id, value] of stagedFeedback) {
      if (value === null) this.feedback.delete(id);
      else this.feedback.set(id, value);
    }
    this.notify();
    return result;
  }

  async putRecovery(entry: StudyRecoveryEntry): Promise<void> {
    const key = `${entry.containerId}::${entry.lectureId}::${entry.key}::${entry.questionId}`;
    this.recovery.set(key, entry);
    this.notify();
  }

  subscribe(listener: StudyQueryListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap: StudySnapshot = {
      questions: Array.from(this.questions.values()),
      attempts: Array.from(this.attempts.values()),
      feedback: Array.from(this.feedback.values()),
      recovery: Array.from(this.recovery.values()),
    };
    for (const l of this.listeners) l(snap);
  }
}
