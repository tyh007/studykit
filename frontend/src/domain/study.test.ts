/**
 * StudyKit v0.4 — Domain contract tests for `domain/study`.
 *
 * Pure type-guard tests. No React, no Dexie, no fetch. Locks the
 * invariants of `SourceLocator`, `StudyQuestion`, `StudyAttempt`,
 * `StudyFeedback`, and `ReviewState` so the application /
 * repository / UI layers can rely on them.
 */

import { describe, expect, it } from 'vitest';
import {
  isSourceKind,
  isSourceLocator,
  isCompleteSourceLocator,
  isStudyAttempt,
  isStudyFeedback,
  isStudyQuestion,
  isStudyQuestionStatus,
  isFeedbackProvenance,
  isReviewState,
  REVIEW_STATES,
  SOURCE_KINDS,
  STUDY_QUESTION_STATUSES,
  type SourceLocator,
  type StudyAttempt,
  type StudyFeedback,
  type StudyQuestion,
  type ReviewState,
} from './study';
import {
  makeContainerRef,
  makeLocator,
  makeQuestion,
  makeAttempt,
  makeFeedback,
} from './__fixtures__/domain-fixtures';

const FIXED_TS = '2026-07-20T04:00:00.000Z';

describe('domain/study / SourceLocator', () => {
  it('accepts a complete page locator', () => {
    expect(isSourceLocator(makeLocator())).toBe(true);
  });

  it('rejects a locator without a lectureId', () => {
    expect(isSourceLocator({ ...makeLocator(), lectureId: '' })).toBe(false);
  });

  it('rejects a locator with a non-string sourceDocumentId', () => {
    expect(isSourceLocator({ ...makeLocator(), sourceDocumentId: 42 })).toBe(false);
  });

  it('rejects a locator with a zero pageNumber', () => {
    expect(isSourceLocator({ ...makeLocator(), pageNumber: 0 })).toBe(false);
  });

  it('rejects a locator with a negative slideIndex', () => {
    expect(isSourceLocator({ ...makeLocator(), kind: 'slide', slideIndex: -1 })).toBe(false);
  });

  it('rejects a locator with a too-long excerpt', () => {
    expect(
      isSourceLocator({ ...makeLocator(), excerpt: 'x'.repeat(241) }),
    ).toBe(false);
  });

  it('accepts a locator with a container (course ref)', () => {
    const loc = makeLocator({ container: makeContainerRef() });
    expect(isSourceLocator(loc)).toBe(true);
    expect(isCompleteSourceLocator(loc)).toBe(true);
  });

  it('exposes a frozen SOURCE_KINDS list', () => {
    expect(SOURCE_KINDS).toEqual(['slide', 'page', 'note-block', 'selection', 'paragraph']);
  });

  it('isSourceKind accepts every SOURCE_KINDS value and rejects others', () => {
    for (const k of SOURCE_KINDS) expect(isSourceKind(k)).toBe(true);
    expect(isSourceKind('bogus')).toBe(false);
    expect(isSourceKind(123)).toBe(false);
    expect(isSourceKind(null)).toBe(false);
  });

  it('isCompleteSourceLocator requires sourceDocumentId + pageNumber for page locators', () => {
    expect(isCompleteSourceLocator(makeLocator({ kind: 'page', pageNumber: 3 }))).toBe(true);
    expect(isCompleteSourceLocator(makeLocator({ kind: 'page', pageNumber: undefined }))).toBe(false);
    expect(isCompleteSourceLocator(makeLocator({ kind: 'page', sourceDocumentId: undefined }))).toBe(false);
  });

  it('isCompleteSourceLocator requires slideIndex for slide locators', () => {
    expect(isCompleteSourceLocator(makeLocator({ kind: 'slide', slideIndex: 2 }))).toBe(true);
    expect(isCompleteSourceLocator(makeLocator({ kind: 'slide', slideIndex: undefined }))).toBe(false);
  });

  it('isCompleteSourceLocator requires noteBlockId for note-block locators', () => {
    expect(isCompleteSourceLocator(makeLocator({ kind: 'note-block', noteBlockId: 'b-1' }))).toBe(true);
    expect(isCompleteSourceLocator(makeLocator({ kind: 'note-block', noteBlockId: undefined }))).toBe(false);
  });

  it('isCompleteSourceLocator requires paragraphIndex for paragraph locators', () => {
    expect(isCompleteSourceLocator(makeLocator({ kind: 'paragraph', paragraphIndex: 0 }))).toBe(true);
    expect(isCompleteSourceLocator(makeLocator({ kind: 'paragraph', paragraphIndex: undefined }))).toBe(false);
  });

  it('isCompleteSourceLocator requires sourceDocumentId for selection locators', () => {
    expect(isCompleteSourceLocator(makeLocator({ kind: 'selection', sourceDocumentId: 'd' }))).toBe(true);
    expect(isCompleteSourceLocator(makeLocator({ kind: 'selection', sourceDocumentId: undefined }))).toBe(false);
  });

  it('isCompleteSourceLocator returns false for null / undefined input', () => {
    expect(isCompleteSourceLocator(null)).toBe(false);
    expect(isCompleteSourceLocator(undefined)).toBe(false);
  });
});

describe('domain/study / StudyQuestion', () => {
  it('accepts a complete question with a locator and a review state', () => {
    expect(isStudyQuestion(makeQuestion())).toBe(true);
  });

  it('accepts a question with a null locator (free-standing question)', () => {
    expect(isStudyQuestion(makeQuestion({ locator: null }))).toBe(true);
  });

  it('rejects a question with an empty body', () => {
    expect(isStudyQuestion(makeQuestion({ body: '' }))).toBe(false);
  });

  it('rejects a question with a non-string id', () => {
    expect(isStudyQuestion(makeQuestion({ id: 42 as unknown as string }))).toBe(false);
  });

  it('rejects a question with an invalid status', () => {
    expect(isStudyQuestion(makeQuestion({ status: 'unknown' as StudyQuestion['status'] }))).toBe(false);
  });

  it('rejects a question with an invalid review state', () => {
    expect(isStudyQuestion(makeQuestion({ review: 'unsure' as ReviewState }))).toBe(false);
  });

  it('rejects a question with authorType ai (questions are user/imported only)', () => {
    expect(
      isStudyQuestion(makeQuestion({ authorType: 'ai' as StudyQuestion['authorType'] })),
    ).toBe(false);
  });

  it('isStudyQuestionStatus accepts every status in STUDY_QUESTION_STATUSES', () => {
    for (const s of STUDY_QUESTION_STATUSES) {
      expect(isStudyQuestionStatus(s)).toBe(true);
    }
    expect(isStudyQuestionStatus('pending')).toBe(false);
  });

  it('isReviewState accepts every REVIEW_STATES value', () => {
    for (const s of REVIEW_STATES) expect(isReviewState(s)).toBe(true);
    expect(isReviewState('mastered')).toBe(false);
    expect(isReviewState(null)).toBe(false);
  });
});

describe('domain/study / StudyAttempt', () => {
  it('accepts a complete attempt', () => {
    expect(isStudyAttempt(makeAttempt())).toBe(true);
  });

  it('accepts a recall-only attempt (no locator)', () => {
    // Per WP-04: recall without source is allowed. An Attempt
    // may have locator=null as long as the body is present.
    expect(isStudyAttempt(makeAttempt({ locator: null }))).toBe(true);
  });

  it('rejects an attempt with authorType ai (attempts are always user)', () => {
    expect(
      isStudyAttempt(makeAttempt({ authorType: 'ai' as StudyAttempt['authorType'] })),
    ).toBe(false);
  });

  it('rejects an attempt with empty body', () => {
    expect(isStudyAttempt(makeAttempt({ body: '' }))).toBe(false);
  });

  it('rejects an attempt with a malformed locator', () => {
    expect(
      isStudyAttempt(makeAttempt({ locator: { kind: 'page' } as unknown as SourceLocator })),
    ).toBe(false);
  });
});

describe('domain/study / StudyFeedback', () => {
  it('accepts a user-authored feedback record', () => {
    const f = makeFeedback({
      authorType: 'user',
      provenance: { provider: 'human', generatedAt: FIXED_TS },
    });
    expect(isStudyFeedback(f)).toBe(true);
  });

  it('accepts an AI feedback record (provider ollama)', () => {
    expect(isStudyFeedback(makeFeedback())).toBe(true);
  });

  it('rejects feedback with authorType imported (not a valid value)', () => {
    expect(
      isStudyFeedback(
        makeFeedback({ authorType: 'imported' as StudyFeedback['authorType'] }),
      ),
    ).toBe(false);
  });

  it('rejects feedback without a valid provenance', () => {
    expect(
      isStudyFeedback(
        makeFeedback({
          provenance: { provider: 'bogus', generatedAt: FIXED_TS } as never,
        }),
      ),
    ).toBe(false);
  });

  it('rejects feedback with a missing generatedAt', () => {
    expect(
      isStudyFeedback(
        makeFeedback({
          provenance: { provider: 'ollama' } as never,
        }),
      ),
    ).toBe(false);
  });

  it('isFeedbackProvenance accepts every provider value', () => {
    expect(
      isFeedbackProvenance({ provider: 'human', generatedAt: FIXED_TS }),
    ).toBe(true);
    expect(
      isFeedbackProvenance({ provider: 'ollama', model: 'x', generatedAt: FIXED_TS }),
    ).toBe(true);
    expect(
      isFeedbackProvenance({ provider: 'cloud', generatedAt: FIXED_TS }),
    ).toBe(true);
    expect(
      isFeedbackProvenance({ provider: 'pending', generatedAt: FIXED_TS }),
    ).toBe(true);
    expect(
      isFeedbackProvenance({ provider: 'bogus', generatedAt: FIXED_TS }),
    ).toBe(false);
  });

  it('isFeedbackProvenance rejects unknown model types', () => {
    expect(
      isFeedbackProvenance({ provider: 'ollama', model: 42, generatedAt: FIXED_TS }),
    ).toBe(false);
  });
});
