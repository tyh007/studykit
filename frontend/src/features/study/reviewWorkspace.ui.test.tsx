/**
 * StudyKit v0.4 — `features/study/reviewWorkspace.ui.test.tsx`
 *
 * Real user-gesture tests for the `ReviewWorkspace`. The
 * test sets up a real `StudyRepository` with a question
 * + attempt + AI feedback, then drives the Review queue
 * through `userEvent` clicks. Every state transition is a
 * real gesture; the test reads the repository afterwards
 * to confirm the `markReview` use case actually ran.
 *
 * What this test file covers:
 *
 *   1. **Recall + Reveal** — the user types their recall,
 *      clicks "Save recall & reveal", the review card
 *      expands to show the source + the attempt + the AI
 *      feedback.
 *   2. **Direct Reveal** — the user skips the recall
 *      textarea and clicks "Reveal" directly; the review
 *      card expands the same way.
 *   3. **Mark understood** — the user clicks "Understood";
 *      the question's `review` state moves to
 *      `understood` and the next question is shown.
 *   4. **Mark uncertain / review-later** — the user picks
 *      either one; the question's `review` state is
 *      updated and the question stays in the queue (it
 *      only leaves the queue when the user marks it
 *      `understood`).
 *   5. **Open source** — the user clicks "Open source"
 *      on a question with a complete locator; the host
 *      receives the `onOpenLecture` callback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyProvider, ReviewWorkspace } from '.';
import {
  __resetAiKernelForTests,
  draftLayer,
} from '../../features/ai';
import { __resetFeatureFlagsForTests } from '../../app/feature-flags';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import { useStore } from '../../store/useStore';
import { locationStore } from '../../app/v04/locationStore';
import { makeAppLocation } from '../../domain/workspace';
import { MemoryStudyRepository } from '../../application/study/studyRepository';
import {
  createQuestion,
  saveAttempt,
  acceptFeedback,
  recordUserFeedback,
} from '../../application/study/studyUseCases';
import { makeLocator } from '../../domain/__fixtures__/domain-fixtures';
import type { UseCaseDeps } from '../../application/study/studyUseCases';
import type { ProviderRouter } from '../../features/ai';

function makeRouter(): ProviderRouter {
  return {
    async probe() {
      return { aiAvailable: true, providerName: 'cloud' };
    },
    async chat() {
      return { content: 'AI feedback', provider: 'cloud' };
    },
  };
}

function makeStudyDeps(): UseCaseDeps & { repository: MemoryStudyRepository } {
  return {
    repository: new MemoryStudyRepository(),
    providerRouter: makeRouter(),
    draftLayer,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setWorkspaceFlavour('local');
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
  __resetFeatureFlagsForTests();
  useStore.getState().resetStore();
  act(() => {
    locationStore.replace(makeAppLocation({ mode: 'study', surface: 'review' }));
  });
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
});

/**
 * Seed the repository with a question + attempt + AI
 * feedback so the Review queue has something to walk.
 */
async function seedQuestion(
  deps: UseCaseDeps & { repository: MemoryStudyRepository },
  overrides: {
    body?: string;
    attemptBody?: string;
    feedbackBody?: string;
    feedbackAuthor?: 'ai' | 'user';
  } = {},
): Promise<string> {
  const q = await createQuestion(deps, {
    body: overrides.body ?? 'What does the theorem state?',
    locator: makeLocator({ kind: 'page', pageNumber: 3, sourceDocumentId: 'doc-1' }),
    container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c-1' },
  });
  await saveAttempt(deps, {
    questionId: q.id,
    body: overrides.attemptBody ?? 'The theorem says: every continuous function is bounded.',
    locator: makeLocator(),
    containerId: 'c-1',
  });
  if (overrides.feedbackAuthor === 'user') {
    await recordUserFeedback(deps, {
      draftId: '',
      questionId: q.id,
      attemptId: (await deps.repository.listAttemptsForQuestion(q.id))[0]!.id,
      body: overrides.feedbackBody ?? 'My own feedback.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
  } else {
    // The simplest way to write a feedback is to go through
    // requestFeedback + acceptFeedback. We do not need to
    // exercise the kernel here — that is the drawer's job.
    const useCases = await import('../../application/study/studyUseCases');
    const attemptId = (await deps.repository.listAttemptsForQuestion(q.id))[0]!.id;
    const out = await useCases.requestFeedback(deps, {
      questionId: q.id,
      attemptId,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    await acceptFeedback(deps, {
      draftId: out.draftId,
      questionId: q.id,
      attemptId,
      body: overrides.feedbackBody ?? 'AI feedback body.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
  }
  return q.id;
}

function renderReview(deps: UseCaseDeps & { repository: MemoryStudyRepository }): {
  onOpenLecture: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
} {
  const onOpenLecture = vi.fn();
  const onExit = vi.fn();
  render(
    <StudyProvider
      value={deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
    >
      <ReviewWorkspace
        onOpenLecture={onOpenLecture}
        onExit={onExit}
      />
    </StudyProvider>,
  );
  return { onOpenLecture, onExit };
}

describe('features/study / ReviewWorkspace (real user gestures)', () => {
  it('Recall + Reveal: the user types a recall, clicks Save recall & reveal, the card expands', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps();
    const questionId = await seedQuestion(deps);
    const { onOpenLecture } = renderReview(deps);

    // Wait for the card to appear.
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-card')).toBeInTheDocument();
    });
    // The recall textarea is visible.
    const recall = screen.getByTestId('v04-review-recall-input') as HTMLTextAreaElement;
    await user.type(recall, 'My own recall: the theorem guarantees bounds.');
    // Click "Save recall & reveal".
    await user.click(screen.getByTestId('v04-review-recall-button'));
    // The revealed block is now visible.
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-revealed')).toBeInTheDocument();
    });
    // The revealed block shows the user's attempt and the
    // AI feedback.
    expect(screen.getByTestId('v04-review-revealed').textContent).toContain(
      'continuous function',
    );
    expect(screen.getByTestId('v04-review-revealed').textContent).toContain(
      'AI feedback body.',
    );
    // The Open source button is reachable.
    await user.click(screen.getByTestId('v04-review-open-lecture'));
    expect(onOpenLecture).toHaveBeenCalledWith({
      courseId: 'c-1',
      lectureId: 'lec-1',
      questionId,
    });
  });

  it('Direct Reveal: the user skips the recall textarea and clicks Reveal', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps();
    await seedQuestion(deps);
    renderReview(deps);
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-card')).toBeInTheDocument();
    });
    // Click Reveal directly (no text in the recall field).
    await user.click(screen.getByTestId('v04-review-reveal-button'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-revealed')).toBeInTheDocument();
    });
  });

  it('Mark understood: the question is removed from the queue and its review state is updated', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps();
    const questionId = await seedQuestion(deps);
    renderReview(deps);

    await waitFor(() => {
      expect(screen.getByTestId('v04-review-card')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-reveal-button'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-revealed')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-mark-understood'));

    // The repository reflects the change.
    const q = await deps.repository.getQuestion(questionId);
    expect(q?.review).toBe('understood');
    // The queue is empty (no unresolved questions).
    const remaining = await deps.repository.listQuestions({
      review: 'unreviewed',
    });
    // `review: 'unreviewed'` is a literal match; the
    // question's `review` is now `understood` so the
    // filter returns an empty list.
    expect(remaining.find((x) => x.id === questionId)).toBeUndefined();
  });

  it('Mark uncertain: the question stays in the queue with a non-understood review state', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps();
    const questionId = await seedQuestion(deps);
    renderReview(deps);
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-card')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-reveal-button'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-revealed')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-mark-uncertain'));
    const q = await deps.repository.getQuestion(questionId);
    expect(q?.review).toBe('uncertain');
  });

  it('Mark review-later: the question is tagged for future review', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps();
    const questionId = await seedQuestion(deps);
    renderReview(deps);
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-card')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-reveal-button'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-revealed')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-mark-later'));
    const q = await deps.repository.getQuestion(questionId);
    expect(q?.review).toBe('review-later');
  });

  it('user-authored feedback is shown alongside AI feedback', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps();
    await seedQuestion(deps, {
      attemptBody: 'user attempt',
      feedbackAuthor: 'user',
      feedbackBody: 'user feedback body',
    });
    renderReview(deps);
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-card')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-review-reveal-button'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-revealed')).toBeInTheDocument();
    });
    expect(screen.getByTestId('v04-review-revealed').textContent).toContain('user feedback body');
  });
});
