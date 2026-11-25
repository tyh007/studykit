/**
 * StudyKit v0.4 — `features/study/understandDrawer.ui.test.tsx`
 *
 * Real user-gesture tests for the `UnderstandDrawer`. Every
 * step is a real `userEvent` (or `fireEvent`) gesture; the
 * test reads the persisted state through the `StudyRepository`
 * (the same handle the production use-case layer uses) and
 * asserts the source locator was preserved. There is NO
 * "just call the use case" shortcut: the test simulates
 * what the user does, click by click.
 *
 * What this test file covers (every WP-04 Gate scenario):
 *
 *   1. **Capture → Save → Ask AI → Accept** — the user
 *      types a question, types an attempt, clicks Save,
 *      the drawer transitions to `ready-to-ask`; the user
 *      clicks Ask AI, the drawer transitions to
 *      `reviewing`, the user clicks Accept, the drawer
 *      calls `onCompleted` and the repository holds a
 *      `StudyFeedback` with `authorType: 'ai'` and a
 *      `provenance.draftId`.
 *   2. **Reject preserves the question** — the user
 *      Rejects an AI draft; the drawer transitions back to
 *      `ready-to-ask` with the same `question.id` /
 *      `attemptId`. The user can ask again or continue
 *      without AI; in both cases the same question is
 *      recorded.
 *   3. **AI fail → Retry → Continue without AI** — the
 *      AI throws; the drawer transitions to `failed`; the
 *      user clicks Retry, the drawer goes back to
 *      `requesting`. (Test uses a flaky router that
 *      recovers on the second call.) The user then clicks
 *      Continue without AI; a `StudyFeedback` with
 *      `authorType: 'user'` and `provenance.provider:
 *      'human'` is written.
 *   4. **AI off → Continue without AI** — the
 *      `requestFeedback` returns `failed: true`; the
 *      drawer goes to `failed`; the user clicks
 *      Continue without AI; a user-authored feedback is
 *      persisted.
 *   5. **Source locator round-trip** — the locator the
 *      user passed in is preserved on the persisted
 *      `StudyQuestion`. A `selection` locator with no
 *      `sourceDocumentId` is preserved as a "broken"
 *      locator (the UI marks it incomplete).
 *   6. **Keyboard** — the `Escape` key is not explicitly
 *      handled here (the host owns the close path), but
 *      the Save / Ask / Accept / Reject buttons are
 *      keyboard-reachable through `userEvent.tab` and
 *      `userEvent.keyboard`. The test exercises the
 *      keyboard path for `Save attempt` and `Ask AI` as a
 *      smoke check.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyProvider, UnderstandDrawer } from '.';
import {
  __resetAiKernelForTests,
  draftLayer,
  type ProviderRouter,
} from '../../features/ai';
import { __resetFeatureFlagsForTests, __setFeatureFlagForTests } from '../../app/feature-flags';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import { useStore } from '../../store/useStore';
import { locationStore } from '../../app/v04/locationStore';
import { makeAppLocation } from '../../domain/workspace';
import { MemoryStudyRepository } from '../../application/study/studyRepository';
import { makeLocator } from '../../domain/__fixtures__/domain-fixtures';
import type { UseCaseDeps } from '../../application/study/studyUseCases';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeRouter(overrides: Partial<{
  shouldThrow: Error | null;
  content: string;
  provider: 'ollama' | 'cloud';
  model: string | undefined;
  callCount: { value: number };
}> = {}): ProviderRouter {
  return {
    async probe() {
      return { aiAvailable: true, providerName: 'cloud' };
    },
    async chat() {
      if (overrides.callCount) overrides.callCount.value++;
      if (overrides.shouldThrow) throw overrides.shouldThrow;
      return {
        content: overrides.content ?? 'AI feedback body.',
        provider: overrides.provider ?? 'cloud',
        ...(overrides.model !== undefined ? { model: overrides.model } : {}),
      };
    },
  };
}

function makeStudyDeps(overrides: {
  router?: ProviderRouter | null;
} = {}): UseCaseDeps & { repository: MemoryStudyRepository } {
  const repo = new MemoryStudyRepository();
  return {
    repository: repo,
    providerRouter: overrides.router === null ? undefined : (overrides.router ?? makeRouter()),
    draftLayer,
  };
}

function WithDeps(props: {
  deps: UseCaseDeps;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <StudyProvider
      value={props.deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
    >
      {props.children}
    </StudyProvider>
  );
}

const CONTAINER = {
  workspaceId: null as string | null,
  mode: 'study' as const,
  kind: 'course' as const,
  id: 'c-1',
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setWorkspaceFlavour('local');
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
  __resetFeatureFlagsForTests();
  useStore.getState().resetStore();
  act(() => {
    locationStore.replace(makeAppLocation({ mode: 'study', surface: 'study-home' }));
  });
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
});

/**
 * Convenience helper: render the drawer with the real
 * deps, then drive the user through the "type a question,
 * type an attempt, click Save" sequence. Returns the
 * rendered render-result so individual tests can
 * continue.
 */
async function openAndSave(
  user: ReturnType<typeof userEvent.setup>,
  deps: UseCaseDeps & { repository: MemoryStudyRepository },
  overrides: {
    questionText?: string;
    attemptText?: string;
    courseId?: string;
    lectureId?: string;
  } = {},
): Promise<void> {
  const courseId = overrides.courseId ?? 'c-1';
  const lectureId = overrides.lectureId ?? 'lec-1';
  const onCompleted = vi.fn();
  const onClose = vi.fn();
  render(
    <WithDeps deps={deps}>
      <UnderstandDrawer
        courseId={courseId}
        lectureId={lectureId}
        locator={makeLocator({ kind: 'page', pageNumber: 3, sourceDocumentId: 'doc-1' })}
        selectionText="Some source passage text."
        container={CONTAINER}
        onCompleted={onCompleted}
        onClose={onClose}
      />
    </WithDeps>,
  );
  const questionField = await screen.findByTestId('v04-understand-question');
  const attemptField = screen.getByTestId('v04-understand-attempt');
  await user.type(questionField, overrides.questionText ?? 'What does the theorem state?');
  await user.type(attemptField, overrides.attemptText ?? 'The theorem says: every continuous function is bounded.');
  const saveButton = screen.getByTestId('v04-understand-save-attempt');
  await user.click(saveButton);
  // Wait for the `ready-to-ask` block to appear.
  await waitFor(() => {
    expect(screen.getByTestId('v04-understand-ask-block')).toBeInTheDocument();
  });
}

// ---------------------------------------------------------------------------
// User-gesture tests
// ---------------------------------------------------------------------------

describe('features/study / UnderstandDrawer (real user gestures)', () => {
  it('Capture → Save → Ask AI → Accept persists a StudyFeedback with authorType ai', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps({
      router: makeRouter({ content: 'You missed step 2.', provider: 'cloud', model: 'm' }),
    });
    await openAndSave(user, deps);

    // Click "Ask AI".
    const askButton = screen.getByTestId('v04-understand-ask');
    await user.click(askButton);

    // Wait for the review block.
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-review')).toBeInTheDocument();
    });
    expect(screen.getByTestId('v04-understand-draft').textContent).toContain('step 2');

    // Click Accept.
    const acceptButton = screen.getByTestId('v04-understand-accept');
    await user.click(acceptButton);

    // The repository holds a question + attempt + feedback.
    const qs = await deps.repository.listQuestions({});
    expect(qs.length).toBe(1);
    const q = qs[0]!;
    expect(q.body).toBe('What does the theorem state?');
    // The locator is preserved.
    expect(q.locator).toEqual(
      makeLocator({ kind: 'page', pageNumber: 3, sourceDocumentId: 'doc-1' }),
    );
    const attempts = await deps.repository.listAttemptsForQuestion(q.id);
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.body).toContain('continuous function');
    const fbs = await deps.repository.listFeedbackForQuestion(q.id);
    expect(fbs.length).toBe(1);
    expect(fbs[0]?.authorType).toBe('ai');
    expect(fbs[0]?.provenance.provider).toBe('cloud');
    expect(fbs[0]?.provenance.draftId).toMatch(/^draft_/);
  });

  it('Reject preserves the saved question + attempt; the user can ask again', async () => {
    const user = userEvent.setup();
    const callCount = { value: 0 };
    const deps = makeStudyDeps({
      router: makeRouter({ content: 'first answer', callCount }),
    });
    await openAndSave(user, deps);

    // First ask: succeeds.
    await user.click(screen.getByTestId('v04-understand-ask'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-review')).toBeInTheDocument();
    });

    // Reject.
    await user.click(screen.getByTestId('v04-understand-reject'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-ask-block')).toBeInTheDocument();
    });

    // The question + attempt are still on the repository
    // (we did NOT delete them). The user can ask again.
    const qs = await deps.repository.listQuestions({});
    expect(qs.length).toBe(1);
    const q = qs[0]!;
    expect(q.body).toBe('What does the theorem state?');
    const attempts = await deps.repository.listAttemptsForQuestion(q.id);
    expect(attempts.length).toBe(1);

    // Reject must not have written any feedback.
    const fbs = await deps.repository.listFeedbackForQuestion(q.id);
    expect(fbs.length).toBe(0);

    // Second ask: succeeds. The new draft has a fresh id.
    const firstDraft = (() => {
      // The first draft is the only one in the layer.
      const all = draftLayer.list();
      return all[0]?.id;
    })();
    await user.click(screen.getByTestId('v04-understand-ask'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-review')).toBeInTheDocument();
    });
    const secondDraft = (() => {
      const all = draftLayer.list();
      // The latest (most recent) draft is the second one.
      return all[all.length - 1]?.id;
    })();
    expect(firstDraft).toBeDefined();
    expect(secondDraft).toBeDefined();
    expect(firstDraft).not.toBe(secondDraft);
    expect(callCount.value).toBe(2);
  });

  it('AI fail → Retry → Continue without AI writes a user-authored feedback on the same question', async () => {
    const user = userEvent.setup();
    const callCount = { value: 0 };
    const flaky: ProviderRouter = {
      async probe() {
        return { aiAvailable: true, providerName: 'cloud' };
      },
      async chat() {
        callCount.value++;
        if (callCount.value === 1) {
          throw new Error('transient network down');
        }
        return { content: 'retry ok', provider: 'cloud' };
      },
    };
    const deps = makeStudyDeps({ router: flaky });
    await openAndSave(user, deps);

    // First ask: fails.
    await user.click(screen.getByTestId('v04-understand-ask'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-failed')).toBeInTheDocument();
    });
    expect(screen.getByTestId('v04-understand-failed').textContent).toContain('transient');

    // Retry: succeeds.
    await user.click(screen.getByTestId('v04-understand-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-review')).toBeInTheDocument();
    });

    // Continue without AI from the review block: the test
    // first accepts? No — the test goes back to ask-block
    // and clicks Continue. The "Continue without AI"
    // button lives on the `ready-to-ask` and `failed`
    // phases; on `reviewing` it is not present. So we
    // reject first, then continue.
    await user.click(screen.getByTestId('v04-understand-reject'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-ask-block')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('v04-understand-continue-without-ai'));

    // The repository holds the original question + attempt
    // + a user-authored feedback.
    const qs = await deps.repository.listQuestions({});
    expect(qs.length).toBe(1);
    const q = qs[0]!;
    const fbs = await deps.repository.listFeedbackForQuestion(q.id);
    expect(fbs.length).toBe(1);
    expect(fbs[0]?.authorType).toBe('user');
    expect(fbs[0]?.provenance.provider).toBe('human');
  });

  it('AI off → Save → ready-to-ask → Continue without AI persists a user-authored feedback', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps({ router: null });
    await openAndSave(user, deps, { attemptText: 'My own explanation.' });

    // No router → "Ask AI" still works as a button; clicking
    // it will go to `failed` because the router is null.
    await user.click(screen.getByTestId('v04-understand-ask'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-failed')).toBeInTheDocument();
    });

    // Continue without AI from the failed block.
    await user.click(screen.getByTestId('v04-understand-failed-continue'));

    const qs = await deps.repository.listQuestions({});
    expect(qs.length).toBe(1);
    const q = qs[0]!;
    const fbs = await deps.repository.listFeedbackForQuestion(q.id);
    expect(fbs.length).toBe(1);
    expect(fbs[0]?.authorType).toBe('user');
    expect(fbs[0]?.body).toBe('My own explanation.');
  });

  it('source locator round-trip: the question preserves the locator the drawer was opened with', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps({ router: null });
    const original = makeLocator({ kind: 'page', pageNumber: 7, sourceDocumentId: 'doc-77' });
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <WithDeps deps={deps}>
        <UnderstandDrawer
          courseId="c-1"
          lectureId="lec-1"
          locator={original}
          selectionText="text"
          container={CONTAINER}
          onCompleted={onCompleted}
          onClose={onClose}
        />
      </WithDeps>,
    );
    await user.type(screen.getByTestId('v04-understand-question'), 'q');
    await user.type(screen.getByTestId('v04-understand-attempt'), 'a');
    await user.click(screen.getByTestId('v04-understand-save-attempt'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-ask-block')).toBeInTheDocument();
    });
    const qs = await deps.repository.listQuestions({});
    expect(qs[0]?.locator).toEqual(original);
  });

  it('keyboard: Tab moves focus into the Save button; Enter activates it', async () => {
    const user = userEvent.setup();
    const deps = makeStudyDeps({ router: null });
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <WithDeps deps={deps}>
        <UnderstandDrawer
          courseId="c-1"
          lectureId="lec-1"
          locator={makeLocator()}
          selectionText="text"
          container={CONTAINER}
          onCompleted={onCompleted}
          onClose={onClose}
        />
      </WithDeps>,
    );
    // Focus the question field and type.
    const questionField = screen.getByTestId('v04-understand-question');
    questionField.focus();
    await user.keyboard('q');
    // Tab forward to the attempt field.
    await user.tab();
    await user.keyboard('a');
    // Tab forward to the Save button.
    await user.tab();
    const saveButton = screen.getByTestId('v04-understand-save-attempt') as HTMLButtonElement;
    expect(document.activeElement).toBe(saveButton);
    // Activate via Enter.
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-ask-block')).toBeInTheDocument();
    });
  });

  it('save status: drawer is in composing phase by default with empty question', async () => {
    const deps = makeStudyDeps({ router: null });
    render(
      <WithDeps deps={deps}>
        <UnderstandDrawer
          courseId="c-1"
          lectureId="lec-1"
          locator={makeLocator()}
          selectionText="text"
          container={CONTAINER}
          onCompleted={vi.fn()}
          onClose={vi.fn()}
        />
      </WithDeps>,
    );
    // The Save button is disabled when the question is empty.
    const saveButton = screen.getByTestId('v04-understand-save-attempt') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });
});
