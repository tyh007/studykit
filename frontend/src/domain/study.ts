/**
 * StudyKit v0.4 — `domain/study`
 *
 * Minimal v0.4 contracts for the **Study Vertical Slice** (WP-04).
 *
 *   - `SourceLocator`     — a stable pointer back to where the
 *                           passage came from (slide / page / note
 *                           block / selection). Per PRD §5.2
 *                           "Lecture Focus", every Study object
 *                           keeps a locator so the user can jump
 *                           back to the source material.
 *   - `StudyQuestion`     — a question the user wants to
 *                           understand / recall / review. It is
 *                           *not* a Note; it has a body, a
 *                           `status` and a `locator` so the
 *                           Review queue can re-open the lecture.
 *   - `Attempt`           — the user's own explanation / answer
 *                           to a question, *before* any AI
 *                           feedback. `authorType === 'user'` is
 *                           the only value an Attempt can carry.
 *   - `Feedback`          — feedback on a Question / Attempt.
 *                           `authorType` distinguishes
 *                           user-typed feedback from AI drafts.
 *                           AI feedback lives in the same shape
 *                           as a Draft Layer record (per
 *                           `features/ai/kernel/draftLayer.ts`)
 *                           so a single Accept/Reject path works
 *                           for both.
 *   - `ReviewState`       — the per-question review status:
 *                           `unreviewed | understood | uncertain |
 *                           review-later`. Simple, no spaced
 *                           repetition, no streak (per WP-04
 *                           scope: "不做完整 spaced repetition").
 *
 * Design rules (enforced by type guards):
 *
 *   1. **One concept, one truth.** SourceLocator is referenced,
 *      not copied, by Question / Attempt / Feedback. A Question
 *      is NOT a Note; an Attempt is NOT a Note.
 *   2. **Author type is explicit.** `authorType: 'user' | 'ai' |
 *      'imported'` is the only way to distinguish user content
 *      from AI content. There is no "draft but not sure who
 *      wrote it" state.
 *   3. **No fake locators.** A `SourceLocator` is either a
 *      complete `slide|page|note` triple, or a paragraph
 *      `blockId` reference; `isCompleteSourceLocator` returns
 *      false on partial data so a broken locator can never
 *      pretend to be a real one. UI must show "no source" when
 *      the locator is incomplete.
 *   4. **Timestamps are mandatory.** Every persisted Study
 *      object has `createdAt` and `updatedAt`. The Draft Layer
 *      adds its own `generatedAt` / `resolvedAt` on top.
 *   5. **Feedback authoring is opt-in.** `Feedback` can carry
 *      `authorType: 'user'` (a human correction / clarification)
 *      or `authorType: 'ai'` (an AI draft that lives in the
 *      Draft Layer first; only the *accepted* record lands in
 *      the repository).
 */

import type { ContainerRef } from './workspace';

// ---------------------------------------------------------------------------
// SourceLocator
// ---------------------------------------------------------------------------

/**
 * The kind of object the locator points at. Kept tiny on purpose:
 * the locator is a *reference*, not a copy. The actual record lives
 * elsewhere (a `Lecture` + `SourceDocument` + `SourcePage`, or a
 * `NoteBlock`).
 */
export type SourceKind = 'slide' | 'page' | 'note-block' | 'selection' | 'paragraph';

export const SOURCE_KINDS: readonly SourceKind[] = [
  'slide',
  'page',
  'note-block',
  'selection',
  'paragraph',
] as const;

export function isSourceKind(value: unknown): value is SourceKind {
  return (
    value === 'slide' ||
    value === 'page' ||
    value === 'note-block' ||
    value === 'selection' ||
    value === 'paragraph'
  );
}

/**
 * Pointer back to the source material. Optional fields are
 * conditional on `kind`:
 *
 *   - `slide`   → `lectureId` (+ optional `slideIndex`)
 *   - `page`    → `lectureId` + `sourceDocumentId` + `pageNumber`
 *   - `note-block` → `lectureId` + `noteBlockId`
 *   - `paragraph` → `lectureId` + `paragraphIndex` (paragraph
 *                    index in the active note, not a stable id;
 *                    the locator stays a pointer, the text
 *                    content of the paragraph lives in the
 *                    NoteEditor)
 *   - `selection` → `lectureId` (+ optional text excerpt the
 *                    UI shows; a *broken* locator is one with
 *                    no `lectureId`).
 */
export interface SourceLocator {
  readonly kind: SourceKind;
  /** Lecture the source belongs to. Required for every kind. */
  readonly lectureId: string;
  /** Optional source document id (slides / PDF pages). */
  readonly sourceDocumentId?: string;
  /** 1-based page number for `kind === 'page'`. */
  readonly pageNumber?: number;
  /** 1-based slide index for `kind === 'slide'`. */
  readonly slideIndex?: number;
  /** NoteBlock id for `kind === 'note-block'`. */
  readonly noteBlockId?: string;
  /** 0-based paragraph index for `kind === 'paragraph'`. */
  readonly paragraphIndex?: number;
  /** Truncated excerpt (≤ 240 chars). UI only. */
  readonly excerpt?: string;
  /** Optional container the locator lives in (course). */
  readonly container?: ContainerRef;
  /** When the locator was first captured. */
  readonly capturedAt: string;
}

export function isSourceLocator(value: unknown): value is SourceLocator {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isSourceKind(v.kind)) return false;
  if (typeof v.lectureId !== 'string' || v.lectureId.length === 0) return false;
  if (v.sourceDocumentId !== undefined && typeof v.sourceDocumentId !== 'string') return false;
  if (v.pageNumber !== undefined && (typeof v.pageNumber !== 'number' || v.pageNumber < 1)) return false;
  if (v.slideIndex !== undefined && (typeof v.slideIndex !== 'number' || v.slideIndex < 1)) return false;
  if (v.noteBlockId !== undefined && typeof v.noteBlockId !== 'string') return false;
  if (v.paragraphIndex !== undefined && (typeof v.paragraphIndex !== 'number' || v.paragraphIndex < 0)) return false;
  if (v.excerpt !== undefined && (typeof v.excerpt !== 'string' || v.excerpt.length > 240)) return false;
  if (v.container !== undefined && typeof v.container !== 'object') return false;
  if (typeof v.capturedAt !== 'string' || v.capturedAt.length === 0) return false;
  return true;
}

/**
 * True when the locator carries *enough* information to
 * round-trip back to the source. A `selection` locator without
 * any `sourceDocumentId` is incomplete (the UI cannot jump
 * anywhere); a `page` locator without `pageNumber` is
 * incomplete. Used by the UI to decide whether to render
 * "Jump to source" vs "Source: not available".
 */
export function isCompleteSourceLocator(loc: SourceLocator | null | undefined): boolean {
  if (!loc) return false;
  switch (loc.kind) {
    case 'page':
      return Boolean(loc.sourceDocumentId && loc.pageNumber !== undefined);
    case 'slide':
      return loc.slideIndex !== undefined;
    case 'note-block':
      return Boolean(loc.noteBlockId);
    case 'paragraph':
      return loc.paragraphIndex !== undefined;
    case 'selection':
      // A `selection` locator is complete when it has a
      // document id; without one the user can't jump back.
      return Boolean(loc.sourceDocumentId);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// StudyQuestion
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a question. The `open` state is the default
 * (newly created / unresolved); `answered` means the user typed
 * at least one Attempt; `reviewed` is the final state reached
 * through the Review workspace. `archived` is a soft delete.
 */
export type StudyQuestionStatus = 'open' | 'answered' | 'reviewed' | 'archived';

export const STUDY_QUESTION_STATUSES: readonly StudyQuestionStatus[] = [
  'open',
  'answered',
  'reviewed',
  'archived',
] as const;

export function isStudyQuestionStatus(value: unknown): value is StudyQuestionStatus {
  return (
    value === 'open' ||
    value === 'answered' ||
    value === 'reviewed' ||
    value === 'archived'
  );
}

export interface StudyQuestion {
  readonly id: string;
  /** The question text the user wants to understand. */
  readonly body: string;
  /** Source pointer. Optional: a free-standing question has no source. */
  readonly locator: SourceLocator | null;
  /** Optional parent course container. */
  readonly container?: ContainerRef;
  readonly status: StudyQuestionStatus;
  /** The most recent review state (see `ReviewState`). */
  readonly review: ReviewState;
  /** When the question was first created (ISO). */
  readonly createdAt: string;
  /** When the question was last updated (ISO). */
  readonly updatedAt: string;
  /** Author who created the question. */
  readonly authorType: 'user' | 'imported';
}

export function isStudyQuestion(value: unknown): value is StudyQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.body !== 'string' || v.body.length === 0) return false;
  if (v.locator !== null && !isSourceLocator(v.locator)) return false;
  if (v.container !== undefined && typeof v.container !== 'object') return false;
  if (!isStudyQuestionStatus(v.status)) return false;
  if (!isReviewState(v.review)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Attempt — the user's own explanation / answer
// ---------------------------------------------------------------------------

export interface StudyAttempt {
  readonly id: string;
  /** Question this attempt answers. */
  readonly questionId: string;
  /** The text the user typed. */
  readonly body: string;
  /**
   * The source the user was looking at when they wrote the
   * attempt. Optional: an attempt can be a "blank page" recall
   * with no source. The Review view shows the source alongside
   * the attempt so the user can compare.
   */
  readonly locator: SourceLocator | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Per the design rules, an Attempt is ALWAYS user-authored. */
  readonly authorType: 'user';
}

export function isStudyAttempt(value: unknown): value is StudyAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.questionId !== 'string' || v.questionId.length === 0) return false;
  if (typeof v.body !== 'string' || v.body.length === 0) return false;
  if (v.locator !== null && !isSourceLocator(v.locator)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Feedback — user or AI
// ---------------------------------------------------------------------------

/**
 * The provenance stamp for a feedback record. AI feedback MUST
 * carry a `provider` and (when known) a `model`. User feedback
 * has `provider: 'human'`. The set of values is intentionally
 * small — the Draft Layer is the *source* of rich provenance
 * (scope, source tokens, snapshot hash). The Feedback record
 * stores the minimum needed to distinguish a model answer from
 * a user answer.
 */
export interface FeedbackProvenance {
  readonly provider: 'human' | 'ollama' | 'cloud' | 'pending';
  readonly model?: string;
  readonly generatedAt: string;
  /**
   * Optional id of the Draft Layer record the feedback came
   * from. Only present for AI feedback. Lets the Review view
   * jump back to the original Draft (full scope, snapshot hash,
   * source tokens).
   */
  readonly draftId?: string;
}

export function isFeedbackProvenance(value: unknown): value is FeedbackProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    v.provider !== 'human' &&
    v.provider !== 'ollama' &&
    v.provider !== 'cloud' &&
    v.provider !== 'pending'
  ) {
    return false;
  }
  if (v.model !== undefined && typeof v.model !== 'string') return false;
  if (typeof v.generatedAt !== 'string' || v.generatedAt.length === 0) return false;
  if (v.draftId !== undefined && typeof v.draftId !== 'string') return false;
  return true;
}

export interface StudyFeedback {
  readonly id: string;
  /** The question being commented on. */
  readonly questionId: string;
  /** Optional: the attempt this feedback reacts to. */
  readonly attemptId?: string;
  /** The feedback body. Markdown. */
  readonly body: string;
  /** Source the feedback was generated against. Optional. */
  readonly locator: SourceLocator | null;
  readonly authorType: 'user' | 'ai';
  readonly provenance: FeedbackProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isStudyFeedback(value: unknown): value is StudyFeedback {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.questionId !== 'string' || v.questionId.length === 0) return false;
  if (v.attemptId !== undefined && typeof v.attemptId !== 'string') return false;
  if (typeof v.body !== 'string' || v.body.length === 0) return false;
  if (v.locator !== null && !isSourceLocator(v.locator)) return false;
  if (v.authorType !== 'user' && v.authorType !== 'ai') return false;
  if (!isFeedbackProvenance(v.provenance)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ReviewState
// ---------------------------------------------------------------------------

/**
 * Per-question review state. The user picks this on the Review
 * workspace; the system never forces a transition. The four
 * values are intentionally simple — no streak, no scoring.
 */
export type ReviewState = 'unreviewed' | 'understood' | 'uncertain' | 'review-later';

export const REVIEW_STATES: readonly ReviewState[] = [
  'unreviewed',
  'understood',
  'uncertain',
  'review-later',
] as const;

export function isReviewState(value: unknown): value is ReviewState {
  return (
    value === 'unreviewed' ||
    value === 'understood' ||
    value === 'uncertain' ||
    value === 'review-later'
  );
}

/**
 * A tiny per-container "last confirmed input" buffer. Used by
 * the UI to restore the user's most recent confirmed question /
 * attempt / feedback after a reload, an offline session, or an
 * AI failure. Not part of the v0.4 spec's "export" path — this
 * is an internal Study-only mechanism so the Verified Thought
 * Loop's "最近确认输入可恢复" gate is testable.
 *
 * `key` is the *kind* of recovery entry
 * (e.g. `'last-attempt'`, `'last-feedback'`, `'draft-input'`).
 * `value` is the rendered text the user was last working on.
 */
export interface StudyRecoveryEntry {
  readonly id: string;
  readonly containerId: string;
  readonly lectureId: string;
  readonly key: 'last-attempt' | 'last-feedback' | 'draft-input';
  readonly questionId: string;
  readonly value: string;
  readonly locator: SourceLocator | null;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

/** ISO timestamp at call time. Pure helper; tests freeze `Date.now`. */
export function nowIso(): string {
  return new Date().toISOString();
}
