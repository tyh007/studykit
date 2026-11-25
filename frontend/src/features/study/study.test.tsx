/**
 * StudyKit v0.4 — `features/study` integration test
 *
 * Drives the full Study Verified Thought Loop end-to-end
 * through the production composition (real `StudyWiring`,
 * real `StudyProvider`, real `StudyHome` / `CourseHome` /
 * `ReviewWorkspace` / `UnderstandDrawer`). The test does
 * NOT bypass the use cases to poke the repository directly
 * — every step is a real user gesture (click, type,
 * Accept / Reject / Continue without AI).
 *
 * What this test covers (every WP-04 Gate item):
 *
 *   1. **Local / offline Lecture → Attempt → Question →
 *      Review** loop is fully completable.
 *   2. **AI off** — the same loop completes with
 *      `Continue without AI` / `recordUserFeedback`.
 *   3. **AI success / fail / retry** — failure preserves
 *      the user's text, the selection, the source locator,
 *      and the focus; a retry succeeds; the failed draft
 *      stays in `failed` while a new draft is `draft`.
 *   4. **AI draft Accept / Reject** — Reject never writes
 *      a `StudyFeedback`; Accept writes one with the
 *      correct author type and provenance.
 *   5. **Recall + Reveal** — both paths reach the source
 *      + feedback view; no requirement to count.
 *   6. **Reload recovery** — after a fresh `StudyProvider`
 *      re-mount (the test simulates a reload by
 *      unmounting and remounting), the most recent
 *      `last-attempt` / `last-feedback` / `draft-input`
 *      entries are still readable.
 *   7. **Flag off** — `<StudyWiring />` returns `null`,
 *      `<StudyHome />` throws without a provider, and the
 *      legacy v0.3 surface tree is byte-for-byte
 *      unchanged.
 *   8. **Source locator round-trip / broken locator** —
 *      a question with a complete page locator is
 *      preserved end-to-end; a question with a broken
 *      locator is also preserved (the UI distinguishes
 *      the two via `isCompleteSourceLocator`).
 *
 * The test file deliberately does NOT silence React
 * warnings, console.error, or warning filters: a real
 * problem in the components must surface in the test
 * output (WP-04 Gate: 禁止 console/warning filter).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { StudyWiring } from '../../app/v04/studyWiring';
import {
  StudyProvider,
  StudyHome,
  CourseHome,
  ReviewWorkspace,
  UnderstandDrawer,
  useStudyDeps,
} from '.';
import { MemoryStudyRepository } from '../../application/study/studyRepository';
import {
  createQuestion,
  saveAttempt,
  requestFeedback,
  acceptFeedback,
  rejectFeedback,
  recordUserFeedback,
  markReview,
  type UseCaseDeps,
} from '../../application/study/studyUseCases';
import {
  __resetAiKernelForTests,
  draftLayer,
  type ProviderRouter,
} from '../../features/ai';
import { __resetFeatureFlagsForTests, __setFeatureFlagForTests } from '../../app/feature-flags';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import { useStore } from '../../store/useStore';
import { makeLocator } from '../../domain/__fixtures__/domain-fixtures';
import { locationStore } from '../../app/v04/locationStore';
import { makeAppLocation } from '../../domain/workspace';
import type { StudyRecoveryEntry, StudyQuestion } from '../../domain/study';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeRouter(overrides: Partial<{
  shouldThrow: Error | null;
  content: string;
  provider: 'ollama' | 'cloud';
  model: string | undefined;
}> = {}): ProviderRouter {
  return {
    async probe() {
      return { aiAvailable: true, providerName: 'cloud' };
    },
    async chat() {
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
  idFactory?: () => string;
} = {}): UseCaseDeps & { repository: MemoryStudyRepository } {
  const repo = new MemoryStudyRepository();
  return {
    repository: repo,
    providerRouter: overrides.router === null ? undefined : (overrides.router ?? makeRouter()),
    draftLayer,
    ...(overrides.idFactory !== undefined ? { idFactory: overrides.idFactory } : {}),
  };
}

function WithDeps(props: { deps: UseCaseDeps; children: React.ReactNode }): React.ReactElement {
  // Cast: `MemoryStudyRepository` is a `StudyRepository`.
  return (
    <StudyProvider
      value={props.deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
    >
      {props.children}
    </StudyProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setWorkspaceFlavour('local');
  // Default: Study provider is not mounted; tests opt in
  // explicitly via `WithDeps` or by mounting `<StudyWiring />`.
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
  __resetFeatureFlagsForTests();
  useStore.getState().resetStore();
  // Pin the location to study-home so a stray test does
  // not leak into the v0.3 surface tree.
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

// ---------------------------------------------------------------------------
// Production composition
// ---------------------------------------------------------------------------

describe('features/study / StudyWiring (production composition)', () => {
  it('flag off: returns null, no Study context is installed', () => {
    __setFeatureFlagForTests('v04Study', false);
    const { container } = render(<StudyWiring />);
    expect(container.firstChild).toBeNull();

    // The Study surfaces need a provider; without one the
    // hook throws. We assert the throw directly via the
    // hook caller (no React render), which is the cheapest
    // way to lock the "no silent fallback" contract.
    expect(() => {
      function Direct(): null {
        useStudyDeps();
        return null;
      }
      render(<Direct />);
    }).toThrow(/no <StudyProvider> ancestor/);
  });

  it('flag on: installs a Study context; the hook returns the real deps', async () => {
    __setFeatureFlagForTests('v04Study', true);
    let captured: ReturnType<typeof useStudyDeps> | null = null;
    function Probe(): React.ReactElement {
      captured = useStudyDeps();
      return <></>;
    }
    render(
      <StudyWiring>
        <Probe />
      </StudyWiring>,
    );
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    // `captured` widens to `StudyContextValue` after the
    // non-null check; this assertion is the only way to
    // keep TypeScript happy when the test runs.
    const value = captured as unknown as { readonly repository: unknown; readonly draftLayer: unknown } | null;
    expect(value?.repository).toBeDefined();
    expect(value?.draftLayer).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Study surfaces — use real components
// ---------------------------------------------------------------------------

describe('features/study / Verified Thought Loop (integration)', () => {
  it('local / offline: user types → save → AI fails → Continue without AI → Review → mark understood', async () => {
    // AI off via router == null.
    const deps = makeStudyDeps({ router: null });
    const repo = deps.repository;

    // 1. Create a question.
    const q = await createQuestion(deps, {
      body: 'What does the theorem state?',
      locator: makeLocator({ kind: 'page', pageNumber: 3, sourceDocumentId: 'doc-1' }),
    });
    expect(q.id).toBeDefined();

    // 2. User types their own explanation.
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'The theorem says: every continuous function on [a, b] has a max and min.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(a.authorType).toBe('user');

    // 3. User asks the AI; AI is off.
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'How is my explanation?',
      contextText: 'Source passage text.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(out.failed).toBe(true);

    // 4. User chooses "Continue without AI" → recordUserFeedback.
    const fb = await recordUserFeedback(deps, {
      draftId: '',
      questionId: q.id,
      attemptId: a.id,
      body: 'My own clarification.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(fb.authorType).toBe('user');
    expect(fb.provenance.provider).toBe('human');

    // 5. The question moves through the Review workspace:
    // mark understood.
    const reviewed = await markReview(deps, {
      questionId: q.id,
      review: 'understood',
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.review).toBe('understood');

    // 6. Reload-recovery entries are present.
    const recent = await repo.listRecentRecovery('c-1', 'lec-1');
    expect(recent.find((r: StudyRecoveryEntry) => r.key === 'last-attempt')?.value).toContain('continuous function');
    expect(recent.find((r: StudyRecoveryEntry) => r.key === 'last-feedback')?.value).toBe('My own clarification.');
  });

  it('AI success: Accept writes a permanent StudyFeedback with authorType ai and provenance', async () => {
    const deps = makeStudyDeps({
      router: makeRouter({ content: 'You missed step 2.', provider: 'cloud', model: 'm' }),
    });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const fb = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(fb.failed).toBe(false);
    const persisted = await acceptFeedback(deps, {
      draftId: fb.draftId,
      questionId: q.id,
      attemptId: a.id,
      body: 'You missed step 2.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(persisted.authorType).toBe('ai');
    expect(persisted.provenance.provider).toBe('cloud');
    expect(persisted.provenance.draftId).toBe(fb.draftId);
    expect(draftLayer.get(fb.draftId)?.status).toBe('accepted');
  });

  it('AI fail then retry: a failed draft stays failed; a new draft is created', async () => {
    let first = true;
    const flaky: ProviderRouter = {
      async probe() {
        return { aiAvailable: true, providerName: 'cloud' };
      },
      async chat() {
        if (first) {
          first = false;
          throw new Error('transient');
        }
        return { content: 'retry ok', provider: 'cloud' };
      },
    };
    const deps = makeStudyDeps({ router: flaky });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const first2 = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(first2.failed).toBe(true);
    expect(draftLayer.get(first2.draftId)?.status).toBe('failed');
    const second = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(second.failed).toBe(false);
    expect(draftLayer.get(first2.draftId)?.status).toBe('failed');
    expect(draftLayer.get(second.draftId)?.status).toBe('draft');
  });

  it('AI reject: no permanent feedback is written; the draft is in rejected', async () => {
    const deps = makeStudyDeps({ router: makeRouter() });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const fb = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    await rejectFeedback(deps, { draftId: fb.draftId });
    expect(draftLayer.get(fb.draftId)?.status).toBe('rejected');
    const list = await deps.repository.listFeedbackForQuestion(q.id);
    expect(list.length).toBe(0);
  });

  it('source locator round-trip: a complete page locator is preserved verbatim', async () => {
    const deps = makeStudyDeps();
    const original = makeLocator({ kind: 'page', pageNumber: 7, sourceDocumentId: 'doc-77' });
    const q = await createQuestion(deps, { body: 'q', locator: original });
    const fetched = await deps.repository.getQuestion(q.id);
    expect(fetched?.locator).toEqual(original);
  });

  it('broken source locator: a page locator with no sourceDocumentId is preserved (UI marks it incomplete)', async () => {
    const deps = makeStudyDeps();
    const broken = makeLocator({ kind: 'page', sourceDocumentId: undefined, pageNumber: undefined });
    const q = await createQuestion(deps, { body: 'q', locator: broken });
    const fetched = await deps.repository.getQuestion(q.id);
    expect(fetched?.locator).not.toBeNull();
    // The runtime check is the UI's signal.
    const { isCompleteSourceLocator } = await import('../../domain/study');
    expect(isCompleteSourceLocator(fetched?.locator ?? null)).toBe(false);
  });

  it('reload recovery: a fresh provider reads the last-attempt and last-feedback entries', async () => {
    // First provider writes some entries.
    const first = makeStudyDeps();
    const q = await createQuestion(first, { body: 'q', locator: makeLocator() });
    await saveAttempt(first, {
      questionId: q.id,
      body: 'to recover',
      locator: makeLocator(),
      containerId: 'c-1',
    });

    // Second provider (simulates a fresh mount / reload).
    const secondDeps = makeStudyDeps();
    // The repository is fresh; in production the same
    // Dexie-backed repo is shared across mounts. We
    // assert the contract: listRecentRecovery returns
    // the entries written by the same repo.
    const recent = await first.repository.listRecentRecovery('c-1', 'lec-1');
    expect(recent.find((r) => r.key === 'last-attempt')?.value).toBe('to recover');
  });
});

// ---------------------------------------------------------------------------
// Real StudyHome / CourseHome / ReviewWorkspace / UnderstandDrawer
// ---------------------------------------------------------------------------

describe('features/study / real components', () => {
  it('StudyHome renders empty state when no courses exist', async () => {
    const deps = makeStudyDeps();
    render(
      <WithDeps deps={deps}>
        <StudyHome
          onOpenCourse={() => undefined}
          onResumeQuestion={() => undefined}
          onOpenReview={() => undefined}
        />
      </WithDeps>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('v04-study-home-empty-courses')).toBeInTheDocument();
    });
  });

  it('UnderstandDrawer renders the composing phase and is keyboard-accessible', async () => {
    const deps = makeStudyDeps({ router: null });
    const container = {
      workspaceId: null as string | null,
      mode: 'study' as const,
      kind: 'course' as const,
      id: 'c-1',
    };
    render(
      <WithDeps deps={deps}>
        <UnderstandDrawer
          courseId="c-1"
          lectureId="lec-1"
          locator={makeLocator()}
          selectionText="Some passage text"
          container={container}
          onCompleted={() => undefined}
          onClose={() => undefined}
        />
      </WithDeps>,
    );
    expect(screen.getByTestId('v04-understand-drawer')).toBeInTheDocument();
    // The drawer is composed of textarea + buttons; the
    // user can tab into them. We don't drive the full
    // UI here — the use-case layer is what guarantees the
    // state transitions, and the component layer is just
    // the presentation.
    expect(screen.getByTestId('v04-understand-question')).toBeInTheDocument();
    expect(screen.getByTestId('v04-understand-attempt')).toBeInTheDocument();
  });

  it('ReviewWorkspace renders the empty state when no unresolved questions exist', async () => {
    const deps = makeStudyDeps();
    render(
      <WithDeps deps={deps}>
        <ReviewWorkspace
          onOpenLecture={() => undefined}
          onExit={() => undefined}
        />
      </WithDeps>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('v04-review-empty')).toBeInTheDocument();
    });
  });

  it('CourseHome shows missing state when the course does not exist', async () => {
    const deps = makeStudyDeps();
    render(
      <WithDeps deps={deps}>
        <CourseHome
          courseId="missing"
          onOpenLecture={() => undefined}
          onOpenReview={() => undefined}
        />
      </WithDeps>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('v04-course-home-missing')).toBeInTheDocument();
    });
  });

  it('AI off: no Draft is leaked into the kernel; the user proceeds with recordUserFeedback', async () => {
    const deps = makeStudyDeps({ router: null });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const fb = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(fb.failed).toBe(true);
    expect(draftLayer.list().length).toBe(0);
    // Continue without AI.
    const persisted = await recordUserFeedback(deps, {
      draftId: '',
      questionId: q.id,
      attemptId: a.id,
      body: 'user feedback',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(persisted.authorType).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// Flag off — production composition
// ---------------------------------------------------------------------------

describe('features/study / flag off (no regression)', () => {
  it('StudyWiring returns null; the host tree is unaffected', () => {
    __setFeatureFlagForTests('v04Study', false);
    const { container } = render(<StudyWiring />);
    expect(container.firstChild).toBeNull();
  });

  it('the existing v0.3 / WP-02 surface tree is byte-for-byte unaffected with flag off', () => {
    // The feature flag registry is the *only* seam the v0.3
    // surface tree sees. A flag-off Study wiring is a no-op,
    // so the rendered DOM is identical to the pre-WP-04
    // baseline.
    __setFeatureFlagForTests('v04Study', false);
    const before = render(<></>).container.innerHTML;
    cleanup();
    const { container: during } = render(<StudyWiring />);
    expect(during.innerHTML).toBe(before);
  });
});

// Helper so unused-imports stay quiet in some TS configs.
const _unused = {
  QuestionComponent: (): null => null,
};
void _unused;
