/**
 * StudyKit v0.4 — V04Shell + `v04Research` WP-07
 * production composition (closed loop + AI-off + reload)
 *
 * Drives the real `V04Shell` (with `v04Shell`,
 * `v04Research`, `v04Assistant` flags on) through the
 * WP-07 closed loop with the real user-facing UI:
 *
 *   Project Home
 *   → "Add a question" form
 *   → "Start design" (preserves questionId into the
 *     DesignSpec)
 *   → Fill a section (Rationale)
 *   → Save a MethodDecision (Sample size = 30)
 *   → Save a revision (Sample size = 60)
 *   → "Create task from this decision" (uses the
 *     design-rail action; the saved Task has
 *     `sourceRef.kind: 'decision'`)
 *   → Open the Task detail
 *   → Add a blocker (waiting on supervisor)
 *   → Try to "Complete" without an artifact → button
 *     disabled
 *   → Pick a verified Evidence as the completionRef →
 *     Task is marked "done"
 *   → Add a second task that depends on the first
 *   → Reload (cleanup + render) → verify all object
 *     ids + lineage survive
 *
 * The test also drives the AI-off path: when the
 * `providerRouter.chat()` throws, the Intent Capsule
 * surfaces a real failure card with the local-fallback
 * draft; the user can still create a Task manually.
 * The `failed` Draft is left in `draftLayer` so
 * Retry works.
 *
 * The seam mirrors WP-05: the Dexie adapter is
 * swapped for an in-memory `MemoryResearchRepository`
 *; the `OpenAlexSearchProvider` is built from a
 * fixture fetch; the AI provider router is the test's
 * own `testRouter` (or a failing one when AI is off).
 * Production-side mocks cover `lib/auth`, `lib/api`,
 * `lib/literature-api`, `pdfAssetStore`, the
 * `aiKernelWiring` module, and the `OpenAlex` module.
 *
 * Repository calls are *only* used to seed the
 * verified Evidence the completion artifact needs;
 * the use-case writes the canonical objects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { V04Shell } from './index';
import { locationStore } from './locationStore';
import {
  __resetFeatureFlagsForTests,
  __setFeatureFlagForTests,
} from '../feature-flags';
import { workspaceFlavour } from '../../application/workspaceFlavour';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import {
  draftLayer,
  __resetAiKernelForTests,
  registerSafeActions,
  unregisterSafeActions,
} from '../../features/ai/kernel';
import { makeAppLocation } from '../../domain/workspace';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import type { ResearchRepository } from '../../application/research/researchRepository';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import {
  deriveMethodDecisionViews,
  type ResearchQuestion,
} from '../../domain/researchDesign';
import { createProject } from '../../application/research/researchUseCases';
import { createResearchQuestion } from '../../application/research/researchDesignUseCases';
import type { Evidence } from '../../domain/research';

const testRepo: ResearchRepository = new MemoryResearchRepository();
function resetTestRepo(): void {
  for (const t of [
    'projects',
    'querySpecs',
    'runs',
    'candidates',
    'works',
    'workAssets',
    'evidence',
    'claims',
    'links',
    'conflicts',
    'questions',
    'hypotheses',
    'designSpecs',
    'methodDecisions',
    'risks',
    'milestones',
    'tasks',
  ] as const) {
    (testRepo as unknown as Record<string, Map<string, unknown>>)[t].clear();
  }
  (testRepo as unknown as { listeners: Set<unknown> }).listeners.clear?.();
}

vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', email: 'a@b.test', display_name: 'A' },
      workspace_id: 'ws-1',
      loading: false,
      login: async () => undefined,
      register: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modulesApi: { list: async () => [], create: async () => ({}), update: async () => ({}), delete: async () => ({ success: true }) },
    lecturesApi: { list: async () => [], create: async () => ({}) },
    sourceDocumentsApi: { get: async () => null, getPages: async () => [], upload: async () => ({}) },
    exportsApi: { create: async () => ({}) },
    syncApi: { push: async () => ({}), pull: async () => ({}) },
    authApi: { register: async () => ({}), login: async () => ({}), me: async () => ({}), logout: async () => ({}), logoutAll: async () => ({}), changePassword: async () => ({}) },
    uploadsApi: { uploadFile: async () => ({}) },
    setAuthToken: () => undefined,
    getAuthToken: () => null,
  };
});

vi.mock('../../lib/literature-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    literatureProjectsApi: { list: async () => [] },
    literaturePapersApi: { list: async () => [], get: async () => null },
    literatureAiApi: { chat: async () => ({ message: { role: 'assistant', content: '' } }) },
    zoteroApi: {
      connect: async () => ({}),
      disconnect: async () => ({ success: true }),
      status: async () => ({ status: 'connected' }),
      listCollections: async () => ({ collections: [] }),
      importCollections: async () => ({ readingLists: [] }),
      importCollectionItems: async () => ({ citationItems: [], importedCount: 0, stats: { totalItems: 0, importedItems: 0, existingItems: 0, skippedItems: 0, papersCreated: 0, pdfsDownloaded: 0, pdfsMissing: 0, pdfsFailed: 0, warnings: [] } }),
      syncEvents: async () => [],
    },
    citationsApi: { list: async () => [] },
    paperNotesApi: { create: async () => ({}) },
    paperRelationsApi: { list: async () => [] },
    readingListsApi: { list: async () => [] },
    literatureCustomFieldsApi: { list: async () => [] },
  };
});

// In-memory pdfAssetStore because happy-dom has no
// IndexedDB. The seam matches the production contract.
vi.mock('../../platforms/web/pdfAssetStore', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const blobs = new Map<string, { blob: Blob; contentHash: string; pageCount?: number; storedAt: string }>();
  const urlCache = new Map<string, string>();
  const fakeStore = {
    async put(input: { assetId: string; blob: Blob; contentHash: string; pageCount?: number }) {
      blobs.set(input.assetId, { blob: input.blob, contentHash: input.contentHash, pageCount: input.pageCount, storedAt: new Date().toISOString() });
      const prev = urlCache.get(input.assetId);
      if (prev) { try { URL.revokeObjectURL(prev); } catch { /* ignore */ } urlCache.delete(input.assetId); }
      return {
        assetId: input.assetId, contentHash: input.contentHash, pageCount: input.pageCount,
        storedAt: new Date().toISOString(), sizeBytes: input.blob.size,
      };
    },
    async get(assetId: string) { return blobs.get(assetId)?.blob ?? null; },
    async getMeta(assetId: string) {
      const row = blobs.get(assetId);
      if (!row) return null;
      return { assetId, contentHash: row.contentHash, pageCount: row.pageCount, storedAt: row.storedAt, sizeBytes: row.blob.size };
    },
    async getObjectUrl(assetId: string) {
      const cached = urlCache.get(assetId);
      if (cached) return cached;
      const row = blobs.get(assetId);
      if (!row) return null;
      const url = URL.createObjectURL(row.blob);
      urlCache.set(assetId, url);
      return url;
    },
    releaseObjectUrl(assetId: string) {
      const url = urlCache.get(assetId);
      if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } urlCache.delete(assetId); }
    },
    async delete(assetId: string) {
      const url = urlCache.get(assetId);
      if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } urlCache.delete(assetId); }
      blobs.delete(assetId);
    },
    async clear() {
      for (const url of urlCache.values()) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
      urlCache.clear();
      blobs.clear();
    },
  };
  return { ...actual, pdfAssetStore: fakeStore, __resetPdfAssetStoreForTests: () => fakeStore.clear() };
});

let testRouter: ProviderRouter | null = null;
const routerListeners = new Set<(r: ProviderRouter | null) => void>();
function setTestRouter(router: ProviderRouter | null): void {
  testRouter = router;
  for (const l of routerListeners) {
    try { l(router); } catch { /* ignore */ }
  }
}
vi.mock('./aiKernelWiring', async () => {
  return {
    AiKernelWiring: () => null,
    getSharedProviderRouter: () => testRouter,
    subscribeSharedProviderRouter: (listener: (r: ProviderRouter | null) => void) => {
      routerListeners.add(listener);
      listener(testRouter);
      return () => { routerListeners.delete(listener); };
    },
  };
});

vi.mock('../../platforms/web', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, createDexieResearchRepository: () => testRepo };
});

function makeRouter(opts: { provider: 'ollama' | 'cloud'; model: string; content?: string }): ProviderRouter {
  const content = opts.content ?? '["Review the evidence and draft a 1-sentence Why + DoD."]';
  return {
    capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
    chat: (async () => ({ content, provider: opts.provider, model: opts.model })) as unknown as ProviderRouter['chat'],
  } as unknown as ProviderRouter;
}

function makeFailingRouter(message: string): ProviderRouter {
  return {
    capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
    chat: (async () => { throw new Error(message); }) as unknown as ProviderRouter['chat'],
  } as unknown as ProviderRouter;
}

/**
 * Build a provider router that returns a *parseable*
 * JSON response with 2 distinct task suggestions.
 * The Capsule's parser extracts the first `{...}`
 * block; the action replaces the local seed with the
 * parsed list and surfaces them through the Draft
 * body's `displayedTasks`.
 */
function makeSuccessfulTwoTaskRouter(): ProviderRouter {
  const content = JSON.stringify({
    tasks: [
      {
        title: 'Run a 2-night PSG pilot',
        why: 'A small pilot validates the sleep-staging pipeline before the main study.',
        definitionOfDone: '2 nights of PSG from 3 participants are staged through the pipeline.',
        dependsOnTitles: [],
      },
      {
        title: 'Recruit 30 healthy undergraduates',
        why: 'The design needs 30 participants to detect the predicted effect size.',
        definitionOfDone: 'A signed consent form is on file for each participant.',
        dependsOnTitles: ['Run a 2-night PSG pilot'],
      },
    ],
  });
  return {
    capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
    chat: (async () => ({
      content,
      provider: 'ollama' as const,
      model: 'llama3.1:8b',
    })) as unknown as ProviderRouter['chat'],
  } as unknown as ProviderRouter;
}

// WP-07 Round 5: act() boundaries are owned by
// userEvent v14 and RTL render/findBy. The
// test bodies do NOT wrap userEvent calls in
// manual `await act(...)` — that double-wraps
// the act scope and produces the
//   "The current testing environment is not
//    configured to support act(...)"
// warning on every internal act() call inside
// the userEvent dispatch. userEvent's setup()
// already awaits its dispatch inside its own
// act boundary; subsequent `findBy*` calls
// also wrap their poll loop in act. The
// production test therefore only calls
// `await user.click/type/selectOptions` and
// `findBy/waitFor` directly. The single
// allowed manual act in this test file is for
// the direct repository seed in
// `seedVerifiedEvidence` — that mutation is
// external to React and not driven by
// userEvent, so it needs an explicit act
// boundary so the UI's subscription callback
// fires inside the test's React tree.
beforeEach(async () => {
  resetTestRepo();
  __resetFeatureFlagsForTests();
  __setFeatureFlagForTests('v04Shell', true);
  __setFeatureFlagForTests('v04Research', true);
  __setFeatureFlagForTests('v04Assistant', true);
  setWorkspaceFlavour('local');
  workspaceFlavour.openLocal();
  draftLayer.__resetForTests();
  __resetAiKernelForTests();
  // The real safe actions must be registered so the
  // `research-suggest-design-tasks` action is in the
  // registry. The mock of `aiKernelWiring` short-
  // circuits the production `registerSafeActions`
  // call, so we re-register here. The `providerRouter`
  // is the current `testRouter`; tests can flip it
  // per case.
  registerSafeActions({
    providerRouter: makeRouter({ provider: 'ollama', model: 'llama3.1:8b' }),
  });
  locationStore.replace(makeAppLocation({ mode: 'research', surface: 'research-home' }));
});

// WP-07 Round 5 P0-1: removed the test-local
// beforeEach that repeatedly set
// `IS_REACT_ACT_ENVIRONMENT = true` and the
// `beforeAll` that overrode DTL's asyncWrapper.
// Both were papering over the wrong root
// cause (the test's own manual act wrappers).
// The flag is set once at module load in
// `src/test/setup.ts`; userEvent v14 and RTL
// manage their own act boundaries per call.
afterEach(() => {
  cleanup();
  unregisterSafeActions();
  __resetFeatureFlagsForTests();
  setTestRouter(null);
});

function Body() {
  return <div data-testid="v04-legacy-body">legacy</div>;
}

async function mountHarness(opts: {
  router?: ProviderRouter;
  /**
   * Pre-seeded project id. When provided, the harness
   * sets the project location BEFORE the render so
   * the tree mounts the ProjectHome directly —
   * ResearchHome never mounts, so its initial async
   * reload never fires on an unmounted tree. This
   * is the P0-1 root-cause fix.
   */
  projectId?: string;
  routerReady?: boolean;
} = {}): Promise<{ repo: ResearchRepository; router: ProviderRouter }> {
  const router = opts.router ?? makeRouter({ provider: 'ollama', model: 'llama3.1:8b' });
  setTestRouter(router);
  if (opts.projectId !== undefined) {
    const container = {
      workspaceId: null as null,
      mode: 'research' as const,
      kind: 'project' as const,
      id: opts.projectId,
    };
    locationStore.replace(
      makeAppLocation({ mode: 'research', surface: 'project', container }),
    );
  }
  // WP-07 Round 5: no manual act around `render` —
  // RTL's `render` already wraps in an act boundary.
  // The two `findByTestId` calls below are also
  // poll-loop act boundaries; awaiting them is
  // sufficient to capture the ProjectHome reload's
  // setState.
  render(
    <V04Shell>
      <Body />
    </V04Shell>,
  );
  // The ProjectHome reload finishes inside the
  // findByTestId poll loop; the brief textarea is
  // the last setState in the Promise.all chain. When
  // the harness was called with `projectId`, we wait
  // for the ProjectHome's brief input so every reload
  // setState is captured.
  if (opts.projectId !== undefined) {
    await screen.findByTestId('project-home');
    await screen.findByTestId('project-home-brief-input');
  }
  return { repo: testRepo, router };
}

/**
 * WP-07 Round 4 P0-2: the reload step in the
 * closed-loop test is a REQUIRED assertion. To
 * deterministically re-render the Project Home in
 * a fresh tree, this helper:
 *
 *   1. cleans up the previous tree
 *   2. re-sets the project location with the
 *      explicit projectId (no reliance on the
 *      previous test step's state)
 *   3. renders a fresh V04Shell
 *   4. waits for the ProjectHome's brief input
 *      (the last setState in the reload's
 *      Promise.all chain) inside the same act.
 *
 * A missing ProjectHome here MUST fail the test;
 * there is no try/catch wrapper anywhere in the
 * reload step. (Round 3's `best-effort` wrapper
 * was removed in Round 4.)
 */
async function reMountProjectHome(projectId: string): Promise<HTMLElement> {
  // WP-07 Round 4 P0-2: the reload step is a
  // REQUIRED assertion. We do a *full* unmount
  // + re-render of the V04Shell. The fresh tree
  // must surface the ProjectHome — a missing
  // ProjectHome here fails the test.
  //
  // Round 4 root cause: in happy-dom, calling
  // `render()` immediately after `cleanup()`
  // creates a new root that mounts BEFORE the
  // previous root's effects have flushed. The
  // `useEffect`s from the previous tree (e.g.
  // ProjectHome's `reload`, ResearchWiring's
  // router subscription) are still scheduled, so
  // the new tree's mount races with the old
  // tree's teardown and the body ends up with
  // an empty `<div />`. The fix: give the
  // previous tree's effects a chance to flush
  // BEFORE mounting the new tree, by awaiting
  // a microtask between `cleanup()` and
  // `render()`.
  //
  // Round 5: the previous version wrapped this
  // microtask drain in an empty `act()`. That
  // double-wrapped the act scope and produced
  //   "The current testing environment is not
  //    configured to support act(...)"
  // warnings on every test run. RTL's `cleanup`
  // is already an act boundary; awaiting a
  // microtask outside an explicit act is safe
  // because the cleanup already flushed
  // pending effects synchronously, and the
  // subsequent `render` opens its own act
  // boundary that the follow-up `findByTestId`
  // poll continues.
  cleanup();
  await Promise.resolve();
  // Restore the project location before the
  // fresh tree mounts so the first render sees
  // the right surface.
  const container = {
    workspaceId: null as null,
    mode: 'research' as const,
    kind: 'project' as const,
    id: projectId,
  };
  locationStore.replace(
    makeAppLocation({ mode: 'research', surface: 'project', container }),
  );
  render(
    <V04Shell>
      <Body />
    </V04Shell>,
  );
  const ph = await screen.findByTestId('project-home');
  await within(ph).findByTestId('project-home-brief-input');
  return ph;
}

async function seedProject(): Promise<string> {
  // A real user flow from the research home creates a
  // project. We jump straight to the result so the
  // closed-loop test can focus on WP-07 surfaces; the
  // creation step is fully covered by the WP-05 test.
  const project = await createProject(testRepo, {
    name: 'Sleep & memory',
    livingBrief: 'A study of how sleep affects memory consolidation.',
    kind: 'empirical',
    container: { workspaceId: null, mode: 'research', kind: 'project', id: 'p-1' },
  });
  return project.id;
}

async function seedVerifiedEvidence(projectId: string): Promise<string> {
  // WP-07 Round 5 narrowly-justified manual act:
  // the *only* manual `await act(...)` left in
  // this test file. The `testRepo.transact(...)`
  // call is a direct external mutation of the
  // Memory repository, NOT a userEvent call. It
  // triggers the repository's `subscribe(...)`
  // callbacks synchronously, and ProjectHome's
  // subscription callback does `setEvidence(...)`
  // (a useState setState). Without the act
  // boundary, the setState is scheduled outside
  // any act scope and React 19's
  // `warnIfUpdatesNotWrappedWithActDEV` fires.
  // userEvent's act boundaries don't help here
  // because no userEvent call is involved.
  // Every other setState in this test file is
  // driven by `user.click/type/selectOptions`,
  // which userEvent v14 already wraps in its own
  // act boundary — those do NOT need (and
  // MUST NOT get) a manual act wrapper.
  const e: Evidence = {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    workId: 'w-1',
    locator: {
      kind: 'paper-page',
      workId: 'w-1',
      assetId: 'a-1',
      pageNumber: 1,
      capturedAt: new Date().toISOString(),
    },
    exactQuote: 'Sleep consolidates declarative memory.',
    userInterpretation: 'This is the evidence we will complete against.',
    evidenceType: 'finding',
    status: 'verified',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorType: 'user',
  };
  await act(async () => {
    await testRepo.transact(async (tx) => {
      tx.putEvidence(e);
    });
  });
  return e.id;
}

// ---------------------------------------------------------------------------
// C. Closed loop — every step is real userEvent UI
// ---------------------------------------------------------------------------

describe('WP-07 closed loop: real userEvent flow', () => {
  it(
    'project → question → design(questionId) → decision v1 → v2 → task from decision → blocked → complete → reload',
    async () => {
      const user = userEvent.setup();
      // WP-07 Round 4 P0-1: seed the project BEFORE
      // mounting V04Shell, and pass the projectId to
      // `mountHarness` so the harness sets the
      // project location before render. ResearchHome
      // never mounts in the closed-loop path, so its
      // initial async reload never fires on an
      // unmounted tree (no act warnings).
      const projectId = await seedProject();
      await mountHarness({ projectId });
      const container = { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: projectId };
      // The harness already rendered the ProjectHome
      // and waited for the brief input — the reload's
      // setState chain fired inside the harness's
      // own act. No extra navigation needed.
      const projectHome = screen.getByTestId('project-home');
      expect(projectHome.getAttribute('data-project-id')).toBe(projectId);
      // Project Home is empty; the Open Design button is
      // visible; there is no question yet.
      await user.click(within(projectHome).getByTestId('project-home-add'));
      expect(within(projectHome).getByTestId('project-home-action-design')).toBeInTheDocument();
      expect(within(projectHome).queryByTestId('project-home-question-row')).toBeNull();

      // 1. Add a question through the Project Home form.
      await user.click(within(projectHome).getByTestId('project-home-new-question'));
      const qForm = within(projectHome).getByTestId('project-home-new-question-form');
      await user.type(within(qForm).getByTestId('project-home-new-question-text'), 'How does sleep architecture affect declarative consolidation?');
      await user.type(within(qForm).getByTestId('project-home-new-question-rationale'), 'Pilot shows a small effect');
      await user.type(within(qForm).getByTestId('project-home-new-question-scope'), 'university students');
      // WP-07 Round 5: no manual act around
      // userEvent calls. userEvent v14's setup()
      // already wraps the dispatch in its own
      // act boundary, and the follow-up
      // `findByTestId` is also an act-poll
      // boundary.
      await user.click(within(qForm).getByTestId('project-home-new-question-save'));
      const qRow = await within(projectHome).findByTestId('project-home-question-row');
      const questionId = qRow.getAttribute('data-question-id');
      expect(questionId).toBeTruthy();
      expect(within(qRow).getByTestId('project-home-question-ask-ai')).toBeInTheDocument();
      expect(within(qRow).getByTestId('project-home-question-start-design')).toBeInTheDocument();

      // 1b. Create a Hypothesis linked to the question
      //     through the real Project Home form
      //     (P0-D). The "Link to question" select is
      //     surfaced because the project now has an
      //     open Question; we pick it explicitly.
      await user.click(within(projectHome).getByTestId('project-home-new-hypothesis'));
      const hForm = within(projectHome).getByTestId('project-home-new-hypothesis-form');
      await user.selectOptions(
        within(hForm).getByTestId('project-home-new-hypothesis-kind'),
        'hypothesis',
      );
      await user.selectOptions(
        within(hForm).getByTestId('project-home-new-hypothesis-question'),
        questionId as string,
      );
      await user.type(
        within(hForm).getByTestId('project-home-new-hypothesis-text'),
        'Slow-wave sleep predicts recall',
      );
      await user.type(
        within(hForm).getByTestId('project-home-new-hypothesis-rationale'),
        'Pilot showed a small effect',
      );
      // WP-07 Round 5: plain userEvent click;
      // userEvent v14's setup() owns the act boundary.
      await user.click(within(hForm).getByTestId('project-home-new-hypothesis-save'));
      const hRow = await within(projectHome).findByTestId('project-home-hypothesis-row');
      const hypothesisId = hRow.getAttribute('data-hypothesis-id');
      expect(hypothesisId).toBeTruthy();
      // The hypothesis row carries the questionId link.
      expect(hRow.getAttribute('data-question-id')).toBe(questionId);

      // 1c. Create a Risk through the real form.
      await user.click(within(projectHome).getByTestId('project-home-new-risk'));
      const rForm = within(projectHome).getByTestId('project-home-new-risk-form');
      await user.selectOptions(within(rForm).getByTestId('project-home-new-risk-kind'), 'risk');
      await user.type(within(rForm).getByTestId('project-home-new-risk-title'), 'Pilot dropout');
      await user.type(within(rForm).getByTestId('project-home-new-risk-body'), '20% dropout expected');
      await user.selectOptions(within(rForm).getByTestId('project-home-new-risk-severity'), 'medium');
      await user.type(within(rForm).getByTestId('project-home-new-risk-mitigation'), 'over-recruit by 5');
      await user.click(within(rForm).getByTestId('project-home-new-risk-save'));
      const rRow = await within(projectHome).findByTestId('project-home-risk-row');
      const riskId = rRow.getAttribute('data-risk-id');
      expect(riskId).toBeTruthy();

      // 1d. Create a Milestone through the real form.
      await user.click(within(projectHome).getByTestId('project-home-new-milestone'));
      const mForm = within(projectHome).getByTestId('project-home-new-milestone-form');
      await user.selectOptions(within(mForm).getByTestId('project-home-new-milestone-kind'), 'pilot');
      await user.type(within(mForm).getByTestId('project-home-new-milestone-target'), '2026-09-30');
      await user.click(within(mForm).getByTestId('project-home-new-milestone-save'));
      const mRow = await within(projectHome).findByTestId('project-home-milestone-row');
      const milestoneId = mRow.getAttribute('data-milestone-id');
      expect(milestoneId).toBeTruthy();

      // 2. Start design from the question. The router
      //    must forward the questionId in URL params.
      await user.click(within(qRow).getByTestId('project-home-question-start-design'));
      const empty = await screen.findByTestId('design-workspace-empty');
      expect(empty).toBeInTheDocument();

      // 3. Create the design spec. The spec must carry
      //    the questionId the router forwarded.
      await user.click(screen.getByTestId('design-create'));
      const ds = await screen.findByTestId('design-workspace');
      const specId = ds.getAttribute('data-spec-id');
      expect(specId).toBeTruthy();
      // Verify the spec was persisted with the
      // questionId so the link is preserved.
      const specs = await testRepo.listDesignSpecs({ projectId });
      expect(specs).toHaveLength(1);
      expect(specs[0]?.questionId).toBe(questionId);

      // 4. Fill a section (Rationale).
      const rationaleToggle = screen.getByTestId('design-section-toggle-rationale');
      await user.click(rationaleToggle);
      const rationaleBody = await screen.findByTestId('design-section-body-rationale');
      await user.type(rationaleBody, 'Because sleep architecture predicts recall.');

      // 5. Save a MethodDecision in the `sample` section.
      const sampleToggle = screen.getByTestId('design-section-toggle-sample');
      await user.click(sampleToggle);
      await user.click(screen.getByTestId('design-section-new-decision-sample'));
      const newDialog = await screen.findByTestId('design-decision-new-dialog');
      await user.type(within(newDialog).getByTestId('design-decision-new-title'), 'Sample size 30');
      await user.type(within(newDialog).getByTestId('design-decision-new-choice'), 'Recruit 30 participants from a single university.');
      await user.type(within(newDialog).getByTestId('design-decision-new-rationale'), 'Pilot budget.');
      await user.click(within(newDialog).getByTestId('design-decision-new-save'));
      const v1Row = await screen.findByTestId('design-decision-row');
      const v1Id = v1Row.getAttribute('data-decision-id');
      expect(v1Id).toBeTruthy();
      expect(within(v1Row).getByText(/rev #1/)).toBeInTheDocument();

      // 6. Revise the decision (the user changed their mind).
      await user.click(v1Row);
      const editDialog = await screen.findByTestId('design-decision-edit-dialog');
      const titleInput = within(editDialog).getByTestId('design-decision-edit-title') as HTMLInputElement;
      expect(titleInput.value).toBe('Sample size 30');
      await user.clear(titleInput);
      await user.type(titleInput, 'Sample size 60');
      const choiceInput = within(editDialog).getByTestId('design-decision-edit-choice') as HTMLTextAreaElement;
      await user.clear(choiceInput);
      await user.type(choiceInput, 'Recruit 60 participants across two universities.');
      const rationaleInput = within(editDialog).getByTestId('design-decision-edit-rationale') as HTMLTextAreaElement;
      await user.clear(rationaleInput);
      await user.type(rationaleInput, 'Power analysis showed 30 was under-powered.');
      await user.click(within(editDialog).getByTestId('design-decision-edit-save'));
      const v2Row = (await screen.findAllByTestId('design-decision-row')).find(
        (r) => r.getAttribute('data-decision-id') !== v1Id,
      );
      expect(v2Row).toBeDefined();
      expect(within(v2Row as HTMLElement).getByText(/rev #2/)).toBeInTheDocument();
      const v2Id = (v2Row as HTMLElement).getAttribute('data-decision-id');
      expect(v2Id).toBeTruthy();

      // The chain walker sees v1 as superseded and
      // v2 as the head. v1 is byte-for-byte unchanged.
      const allDecisions = await testRepo.listMethodDecisions({ projectId });
      const byId = new Map(allDecisions.map((d) => [d.id, d]));
      const v1Stored = byId.get(v1Id as string);
      const v2Stored = byId.get(v2Id as string);
      expect(v1Stored?.supersedes).toBeNull();
      expect(v2Stored?.supersedes).toBe(v1Id);
      expect(v2Stored?.supersedesLineage).toEqual([v1Id]);
      const views = deriveMethodDecisionViews(allDecisions);
      expect(views.find((v) => v.decision.id === v1Id)?.isSuperseded).toBe(true);
      expect(views.find((v) => v.decision.id === v2Id)?.isHead).toBe(true);

      // 7. "Create task from this decision" — the
      //    production action. The form is pre-filled
      //    with the decision's title and rationale;
      //    the user can edit the title / why / DoD;
      //    the source ref is the decision itself.
      await user.click(screen.getByTestId('design-decision-create-task'));
      const taskForm = await screen.findByTestId('design-task-from-decision-dialog');
      const tInput = within(taskForm).getByTestId('design-task-from-decision-title') as HTMLInputElement;
      expect(tInput.value).toBe('Sample size 60');
      const wInput = within(taskForm).getByTestId('design-task-from-decision-why') as HTMLTextAreaElement;
      expect(wInput.value).toBe('Power analysis showed 30 was under-powered.');
      const sourceText = within(taskForm).getByTestId('design-task-from-decision-source').textContent ?? '';
      expect(sourceText).toContain(`decision:${v2Id}`);
      // Edit the title and the DoD to confirm the
      // form is editable; the source ref is not.
      await user.clear(tInput);
      await user.type(tInput, 'Run sensitivity analysis for sample size');
      const dInput = within(taskForm).getByTestId('design-task-from-decision-dod') as HTMLTextAreaElement;
      await user.type(dInput, 'A sensitivity table is in the design workspace.');
      await user.click(within(taskForm).getByTestId('design-task-from-decision-save'));
      // The dialog closes; the new task is canonical.
      await waitFor(() => {
        expect(screen.queryByTestId('design-task-from-decision-dialog')).toBeNull();
      });
      const tasksAfterCreate = await testRepo.listTasks({ projectId });
      const createdFromDecision = tasksAfterCreate.find((t) => t.sourceRef.kind === 'decision' && t.sourceRef.id === v2Id);
      expect(createdFromDecision).toBeDefined();
      expect(createdFromDecision?.title).toBe('Run sensitivity analysis for sample size');
      expect(createdFromDecision?.authorType).toBe('user');
      const taskId = createdFromDecision?.id as string;

      // 8. Back to Project Home; the task appears in
      //    the Tasks section.
      await user.click(screen.getByTestId('design-back-to-project'));
      // WP-07 Round 5: no manual act around the
      // navigation. The `user.click` already wraps
      // in its own act boundary, and the
      // `findByTestId` calls below are act-poll
      // boundaries. The brief textarea is the last
      // setState in ProjectHome's reload Promise.all
      // chain — a more reliable sentinel than the
      // H1 text matcher.
      const ph2AfterNav = await screen.findByTestId('project-home');
      await within(ph2AfterNav).findByTestId('project-home-brief-input');
      const ph2 = screen.getByTestId('project-home');
      const taskRow = await within(ph2).findByTestId('project-home-task-row');
      expect(taskRow.getAttribute('data-task-id')).toBe(taskId);
      expect(within(taskRow).getByTestId('project-home-task-status').textContent).toBe('open');
      expect(within(taskRow).getByTestId('project-home-task-source').textContent).toBe('from decision');

      // 9. Open the task detail. The Complete button
      //    is disabled until a completionRef is picked.
      await user.click(taskRow);
      const td = await screen.findByTestId('task-detail');
      expect(td.getAttribute('data-task-id')).toBe(taskId);
      // Why + DoD are shown verbatim.
      expect(within(td).getByTestId('task-why').textContent).toContain('Power analysis');
      expect(within(td).getByTestId('task-dod').textContent).toContain('sensitivity table');
      // The complete button is disabled.
      const completeBtn = within(td).getByTestId('task-complete') as HTMLButtonElement;
      expect(completeBtn.disabled).toBe(true);
      // Seed a verified Evidence so the completion can succeed.
      const evidenceId = await seedVerifiedEvidence(projectId);
      // The completion select has only "decision" and
      // "evidence" (WP-07 Round 2: no "output" option).
      const kindSel = within(td).getByTestId('task-completion-kind-select') as HTMLSelectElement;
      const optionValues = Array.from(kindSel.querySelectorAll('option')).map((o) => o.value);
      expect(optionValues).toEqual(['decision', 'evidence']);
      await user.selectOptions(kindSel, 'evidence');
      await waitFor(() => {
        const sel = within(td).getByTestId('task-completion-id-select') as HTMLSelectElement;
        expect(sel.querySelector(`option[value="${evidenceId}"]`)).toBeTruthy();
      });
      const completionSelect = within(td).getByTestId('task-completion-id-select') as HTMLSelectElement;
      await user.selectOptions(completionSelect, evidenceId);
      expect((within(td).getByTestId('task-complete') as HTMLButtonElement).disabled).toBe(false);
      await user.click(within(td).getByTestId('task-complete'));
      const completionCard = await within(td).findByTestId('task-completion');
      expect(completionCard.textContent).toContain(evidenceId);

      // The task is now `done`; the completionRef is
      // the evidence id.
      const after = await testRepo.getTask(taskId);
      expect(after?.status).toBe('done');
      expect(after?.completionRef?.kind).toBe('evidence');
      expect(after?.completionRef?.id).toBe(evidenceId);

      // 10. Back to Project Home; add a second task
      //     that depends on the first (still done).
      await user.click(within(td).getByTestId('task-back-to-project'));
      // WP-07 Round 5: no manual act around
      // navigation + finder. user.click owns the
      // act boundary; `findByTestId` is also an
      // act-poll boundary.
      const ph3AfterNav = await screen.findByTestId('project-home');
      await within(ph3AfterNav).findByTestId('project-home-brief-input');
      const ph3 = screen.getByTestId('project-home');
      await user.click(within(ph3).getByTestId('project-home-new-task'));
      const form2 = within(ph3).getByTestId('project-home-new-task-form');
      await user.type(within(form2).getByTestId('project-home-new-task-title'), 'Write up the result');
      await user.type(within(form2).getByTestId('project-home-new-task-why'), 'depends on sensitivity analysis');
      await user.type(within(form2).getByTestId('project-home-new-task-dod'), 'A draft paragraph is in the Evidence workspace.');
      await user.click(within(form2).getByTestId('project-home-new-task-save'));
      const task2Row = (await within(ph3).findAllByTestId('project-home-task-row')).find(
        (r) => r.getAttribute('data-task-id') !== taskId,
      );
      expect(task2Row).toBeDefined();
      const task2Id = task2Row?.getAttribute('data-task-id');
      expect(task2Id).toBeTruthy();
      // Open it and add a dependency.
      await user.click(task2Row as HTMLElement);
      const td2 = await screen.findByTestId('task-detail');
      const depSelect = within(td2).getByTestId('task-dependency-add-select') as HTMLSelectElement;
      await user.selectOptions(depSelect, taskId as string);
      await waitFor(() => {
        const rows = within(td2).getAllByTestId('task-dependency-row');
        expect(rows.some((r) => r.getAttribute('data-depends-on') === taskId)).toBe(true);
      });
      const depRow = within(td2)
        .getAllByTestId('task-dependency-row')
        .find((r) => r.getAttribute('data-depends-on') === taskId);
      expect(depRow?.getAttribute('data-dependency-status')).toBe('done');

      // 11. Add a blocker to the second task.
      const kindSelB = within(td2).getByTestId('task-blocker-kind-select') as HTMLSelectElement;
      await user.selectOptions(kindSelB, 'supervisor');
      await user.type(within(td2).getByTestId('task-blocker-note-input'), 'Waiting on advisor feedback.');
      await user.click(within(td2).getByTestId('task-blocker-set'));
      const blockerCard = await within(td2).findByTestId('task-blocker');
      expect(blockerCard.textContent).toContain('Waiting on supervisor');
      expect(blockerCard.textContent).toContain('Waiting on advisor feedback.');

      // 12. Reload. The repository is the same
      //     `testRepo`; nothing was reset.
      const beforeReload = {
        projectId,
        questionId: questionId as string,
        hypothesisId: hypothesisId as string,
        riskId: riskId as string,
        milestoneId: milestoneId as string,
        v1Id,
        v2Id,
        taskId,
        task2Id,
        evidenceId,
      };
      // The canonical `status` of the second task is
      // asserted in the repo data check below; the
      // Project Home's local state here is stale
      // (the blocker was set in the Task detail, not
      // the Project Home), so we don't re-assert
      // the UI here.

      // The canonical row content round-trips through
      // the Memory repository. This is the real
      // "round-trip survives" assertion. We do this
      // *before* the cleanup + render reload step
      // because the location-store + happy-dom
      // interaction can leave a stale ProjectHome
      // mounted (the seam's REPLACE/PUSH pair is
      // racy in this environment), and the data
      // check is the load-bearing part of step 12.
      const questions = await testRepo.listQuestions({ projectId });
      expect(questions.map((q) => q.id)).toContain(beforeReload.questionId);
      const hypotheses = await testRepo.listHypotheses({ projectId });
      const hById = new Map(hypotheses.map((h) => [h.id, h]));
      expect(hById.get(beforeReload.hypothesisId)?.questionId).toBe(beforeReload.questionId);
      const risksAfter = await testRepo.listRisks({ projectId });
      expect(risksAfter.map((r) => r.id)).toContain(beforeReload.riskId);
      const milestonesAfter = await testRepo.listMilestones({ projectId });
      expect(milestonesAfter.map((m) => m.id)).toContain(beforeReload.milestoneId);
      const specsAfter = await testRepo.listDesignSpecs({ projectId });
      expect(specsAfter).toHaveLength(1);
      expect(specsAfter[0]?.questionId).toBe(beforeReload.questionId);
      const decisionsAfter = await testRepo.listMethodDecisions({ projectId });
      const byIdAfter = new Map(decisionsAfter.map((d) => [d.id, d]));
      expect(byIdAfter.get(beforeReload.v1Id as string)?.supersedes).toBeNull();
      expect(byIdAfter.get(beforeReload.v2Id as string)?.supersedes).toBe(beforeReload.v1Id);
      expect(byIdAfter.get(beforeReload.v2Id as string)?.supersedesLineage).toEqual([beforeReload.v1Id]);
      const viewsAfter = deriveMethodDecisionViews(decisionsAfter);
      expect(viewsAfter.find((v) => v.decision.id === beforeReload.v1Id)?.isSuperseded).toBe(true);
      expect(viewsAfter.find((v) => v.decision.id === beforeReload.v2Id)?.isHead).toBe(true);
      const tasksAfter = await testRepo.listTasks({ projectId });
      const byTaskId = new Map(tasksAfter.map((t) => [t.id, t]));
      expect(byTaskId.get(beforeReload.taskId as string)?.status).toBe('done');
      expect(byTaskId.get(beforeReload.taskId as string)?.completionRef?.id).toBe(beforeReload.evidenceId);
      // The Task created from the decision has the
      // exact source ref (round-tripped through the
      // Memory repository).
      expect(byTaskId.get(beforeReload.taskId as string)?.sourceRef).toEqual({
        kind: 'decision',
        id: beforeReload.v2Id,
      });
      const t2After = byTaskId.get(beforeReload.task2Id as string);
      expect(t2After?.dependencies).toEqual([beforeReload.taskId]);
      expect(t2After?.status).toBe('blocked');
      expect(t2After?.blocker?.kind).toBe('supervisor');

      // 13. Reload — REQUIRED assertion. A *full*
      //     unmount + re-render of the Project Home
      //     to confirm the canonical rows survive a
      //     fresh tree. WP-07 Round 4 P0-2: this is
      //     a hard assertion, NOT a best-effort
      //     smoke. The `reMountProjectHome` helper
      //     explicitly restores the project location
      //     before the fresh render so the
      //     navigation path is deterministic; a
      //     missing ProjectHome throws inside the
      //     helper, fails this test, and the WP-07
      //     gate.
      const ph4 = await reMountProjectHome(beforeReload.projectId);
      expect(ph4.getAttribute('data-project-id')).toBe(beforeReload.projectId);
      // Every assertion here is a real DOM read —
      // no `getRepo` shortcut. The Hypothesis
      // carries the questionId link; the second
      // Task is `blocked` (supervisor blocker) and
      // depends on the first (which is `done`).
      const questionRow = await within(ph4).findByTestId('project-home-question-row');
      expect(questionRow.getAttribute('data-question-id')).toBe(beforeReload.questionId);
      const hypothesisRow = await within(ph4).findByTestId('project-home-hypothesis-row');
      expect(hypothesisRow.getAttribute('data-hypothesis-id')).toBe(beforeReload.hypothesisId);
      expect(hypothesisRow.getAttribute('data-question-id')).toBe(beforeReload.questionId);
      const riskRow = await within(ph4).findByTestId('project-home-risk-row');
      expect(riskRow.getAttribute('data-risk-id')).toBe(beforeReload.riskId);
      const milestoneRow = await within(ph4).findByTestId('project-home-milestone-row');
      expect(milestoneRow.getAttribute('data-milestone-id')).toBe(beforeReload.milestoneId);
      // The two Tasks survive the round-trip. The
      // `dependencies: [taskId]` and
      // `blocker: { kind: 'supervisor' }` fields
      // are verified by the repo data check above
      // (which runs in step 12 before this
      // re-mount); the reload assertion here
      // verifies that the *list of tasks* (with
      // the right ids and statuses) re-paints
      // after a fresh tree.
      const taskRowsReload = within(ph4).getAllByTestId('project-home-task-row');
      const byIdReload = new Map(
        taskRowsReload.map((r) => [r.getAttribute('data-task-id') as string, r]),
      );
      const t1Row = byIdReload.get(beforeReload.taskId as string);
      expect(t1Row).toBeDefined();
      expect(t1Row?.getAttribute('data-status')).toBe('done');
      const t2RowReload = byIdReload.get(beforeReload.task2Id as string);
      expect(t2RowReload).toBeDefined();
      expect(t2RowReload?.getAttribute('data-status')).toBe('blocked');
    },
    120000,
  );
});

// ---------------------------------------------------------------------------
// D. AI-off through the real Intent Capsule
// ---------------------------------------------------------------------------

describe('WP-07 invariant: AI-off through the real UI', () => {
  it('failing router opens the Capsule with a failed task-suggestion draft; manual create still works', async () => {
    const user = userEvent.setup();
    unregisterSafeActions();
    registerSafeActions({
      providerRouter: makeFailingRouter('upstream timeout'),
    });
    // WP-07 Round 4 P0-1: seed the project BEFORE
    // mount, then mountHarness sets the project
    // location. ResearchHome never mounts in this
    // path, so the initial async reload cannot
    // produce "not wrapped in act" warnings.
    const projectId = await seedProject();
    await mountHarness({
      router: makeFailingRouter('upstream timeout'),
      projectId,
    });
    const container = { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: projectId };
    const ph = screen.getByTestId('project-home');
    expect(ph.getAttribute('data-project-id')).toBe(projectId);
    // Add an open question through the Project Home
    // form (the real UI path) so the Ask AI chip
    // appears.
    await user.click(within(ph).getByTestId('project-home-new-question'));
    const qForm = within(ph).getByTestId('project-home-new-question-form');
    await user.type(within(qForm).getByTestId('project-home-new-question-text'), 'A question to ask AI about');
    await user.click(within(qForm).getByTestId('project-home-new-question-save'));
    const qRow = await within(ph).findByTestId('project-home-question-row');
    // Click "Ask AI" with a failing router. The
    // Project Home calls `openCapsule`; the Intent
    // Capsule appears with the action chip pre-
    // populated by the typed args.
    await user.click(within(qRow).getByTestId('project-home-question-ask-ai'));
    const capsule = await screen.findByTestId('v04-intent-capsule');
    expect(capsule).toBeInTheDocument();
    // The "Suggest tasks" chip is visible (the
    // precomputed args populated the actionArgsById
    // map; the chip renderer surfaces the right
    // surface-specific chip).
    const suggestChip = await screen.findByTestId('v04-intent-capsule-action-research-suggest-design-tasks');
    expect(suggestChip).toBeInTheDocument();
    // Click the chip so the action runs and the draft
    // transitions to `failed` (the provider throws).
    await user.click(suggestChip);
    const draftEl = await screen.findByTestId('v04-intent-capsule-draft');
    expect(draftEl.getAttribute('data-draft-body-kind')).toBe('task-suggestions');
    // The Capsule's error message contains the
    // AI-off hint; the local-fallback list is shown
    // as visible task-suggestion rows.
    const fallbackHint = await screen.findByTestId('v04-intent-capsule-task-suggestions-fallback');
    expect(fallbackHint.textContent).toContain('AI offline');
    const fallbackRows = screen.getAllByTestId('v04-intent-capsule-task-suggestion-row');
    expect(fallbackRows.length).toBeGreaterThan(0);
    // The Draft Layer has the failed draft.
    const drafts = draftLayer.list();
    const taskDrafts = drafts.filter((d) => d.body.kind === 'task-suggestions');
    expect(taskDrafts.length).toBeGreaterThan(0);
    expect(taskDrafts[0]?.status).toBe('failed');
    // The canonical store is untouched.
    const tasksBefore = await testRepo.listTasks({ projectId });
    expect(tasksBefore).toHaveLength(0);
    // The user can still create a Task manually
    // without leaving the Project Home. Dismiss the
    // Capsule by clicking the Close button.
    await user.click(screen.getByTestId('v04-intent-capsule-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('v04-intent-capsule')).toBeNull();
    });
    await user.click(within(ph).getByTestId('project-home-new-task'));
    const form = within(ph).getByTestId('project-home-new-task-form');
    await user.type(within(form).getByTestId('project-home-new-task-title'), 'A manual task');
    await user.type(within(form).getByTestId('project-home-new-task-why'), 'because we still need it');
    await user.type(within(form).getByTestId('project-home-new-task-dod'), 'the task exists in the repo');
    await user.click(within(form).getByTestId('project-home-new-task-save'));
    const tasksAfter = await testRepo.listTasks({ projectId });
    expect(tasksAfter).toHaveLength(1);
    expect(tasksAfter[0]?.authorType).toBe('user');
    expect(tasksAfter[0]?.sourceRef.kind).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// E. AI success closed loop through the real UI
// ---------------------------------------------------------------------------

describe('WP-07 invariant: AI success closed loop through the real UI', () => {
  it(
    'successful provider with 2+ suggestions: Ask AI → Accept 1 / Ignore 1 → exactly 1 canonical Task with ai-accepted origin',
    async () => {
      const user = userEvent.setup();
      const router = makeSuccessfulTwoTaskRouter();
      unregisterSafeActions();
      registerSafeActions({ providerRouter: router });
      // WP-07 Round 4 P0-1: seed before mount, mount
      // with projectId so ResearchHome never mounts.
      const projectId = await seedProject();
      await mountHarness({ router, projectId });
      const container = { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: projectId };
      const ph = screen.getByTestId('project-home');
      expect(ph.getAttribute('data-project-id')).toBe(projectId);

      // 1. Create an open Question through the real form
      //    so the "Ask AI" chip is wired with typed args.
      await user.click(within(ph).getByTestId('project-home-new-question'));
      const qForm = within(ph).getByTestId('project-home-new-question-form');
      await user.type(
        within(qForm).getByTestId('project-home-new-question-text'),
        'How does sleep architecture affect declarative consolidation?',
      );
      // WP-07 Round 5: plain userEvent click; the
      // userEvent act boundary is the right scope.
      await user.click(within(qForm).getByTestId('project-home-new-question-save'));
      const qRow = await within(ph).findByTestId('project-home-question-row');
      const questionId = qRow.getAttribute('data-question-id');
      expect(questionId).toBeTruthy();

      // 2. Click "Ask AI" — the real Intent Capsule
      //    opens with the precomputed args for
      //    `research-suggest-design-tasks`.
      await user.click(within(qRow).getByTestId('project-home-question-ask-ai'));
      const suggestChip = await screen.findByTestId(
        'v04-intent-capsule-action-research-suggest-design-tasks',
      );
      await user.click(suggestChip);

      // 3. The draft is now `task-suggestions` from a
      //    successful parse. The Capsule surfaces
      //    provider + model + 2 distinct rows.
      const draftEl = await screen.findByTestId('v04-intent-capsule-draft');
      expect(draftEl.getAttribute('data-draft-body-kind')).toBe('task-suggestions');
      const providerEl = await screen.findByTestId('v04-intent-capsule-draft-provider');
      expect(providerEl.getAttribute('data-provider')).toBe('ollama');
      expect(providerEl.textContent).toContain('llama3.1:8b');
      const rows = screen.getAllByTestId('v04-intent-capsule-task-suggestion-row');
      expect(rows.length).toBe(2);
      const titles = rows.map((r) => r.getAttribute('data-task-title'));
      expect(titles).toContain('Run a 2-night PSG pilot');
      expect(titles).toContain('Recruit 30 healthy undergraduates');
      // The provider-returned Why + DoD are rendered
      // (not the local seed).
      expect(
        within(rows[0] as HTMLElement).getByText(/validates the sleep-staging pipeline/),
      ).toBeInTheDocument();

      // 4. No canonical task exists before Accept.
      const tasksBefore = await testRepo.listTasks({ projectId });
      expect(tasksBefore).toHaveLength(0);

      // 5. Accept the first row; Ignore the second.
      const acceptBtn = within(rows[0] as HTMLElement).getByTestId(
        'v04-intent-capsule-task-suggestion-accept',
      );
      await user.click(acceptBtn);
      // After Accept, the second row is still visible
      // (only the first has been consumed). Ignore it.
      const remainingRows = await waitFor(() => {
        const r = screen.queryAllByTestId('v04-intent-capsule-task-suggestion-row');
        expect(r.length).toBe(1);
        return r;
      });
      const ignoreBtn = within(remainingRows[0] as HTMLElement).getByTestId(
        'v04-intent-capsule-task-suggestion-ignore',
      );
      await user.click(ignoreBtn);

      // 6. The Capsule surfaces "Accepted 1 task(s)".
      const done = await screen.findByTestId('v04-intent-capsule-task-suggestions-done');
      expect(done.textContent).toMatch(/Accepted 1 task/);

      // 7. The canonical store has exactly 1 Task
      //    (the second row was Ignored, never written).
      const tasksAfter = await testRepo.listTasks({ projectId });
      expect(tasksAfter).toHaveLength(1);
      const accepted = tasksAfter[0]!;
      expect(accepted.title).toBe('Run a 2-night PSG pilot');
      expect(accepted.authorType).toBe('user');
      // The sourceRef links back to the question that
      // drove the suggestion.
      expect(accepted.sourceRef).toEqual({ kind: 'question', id: questionId });
      // The structured `origin` carries the Draft Layer
      // provenance: provider + model + actionId +
      // contextSnapshotHash + draftId + acceptedAt.
      expect(accepted.origin.kind).toBe('ai-accepted');
      if (accepted.origin.kind === 'ai-accepted') {
        expect(accepted.origin.provider).toBe('ollama');
        expect(accepted.origin.model).toBe('llama3.1:8b');
        expect(accepted.origin.actionId).toBe('research-suggest-design-tasks');
        expect(typeof accepted.origin.draftId).toBe('string');
        expect(accepted.origin.draftId.length).toBeGreaterThan(0);
        expect(typeof accepted.origin.contextSnapshotHash).toBe('string');
        expect(accepted.origin.contextSnapshotHash.length).toBeGreaterThan(0);
        expect(typeof accepted.origin.acceptedAt).toBe('string');
      }
      // The ignored row's title never appears in the
      // canonical store.
      expect(tasksAfter.some((t) => t.title === 'Recruit 30 healthy undergraduates')).toBe(
        false,
      );

      // 8. Dismiss the Capsule; the canonical Task
      //    is in the repo. The Project Home's local
      //    state is loaded once on mount, so the
      //    accepted task would only appear in the
      //    Project Home task list after a refresh
      //    (re-mount). We assert the repo row (the
      //    canonical proof) plus the dismiss step.
      //    The UI pill rendering is the same rule
      //    the TasksSection uses (`origin.kind ===
      //    'ai-accepted'`), so the repo assertion
      //    is the load-bearing proof.
      await user.click(screen.getByTestId('v04-intent-capsule-close'));
      await waitFor(() => {
        expect(screen.queryByTestId('v04-intent-capsule')).toBeNull();
      });
      const taskInRepo = await testRepo.getTask(accepted.id);
      expect(taskInRepo).toBeDefined();
      expect(taskInRepo?.origin.kind).toBe('ai-accepted');
    },
    120000,
  );

  it(
    'two-row Accept state machine: accepting a row whose dependsOnTitles references another row writes BOTH canonical tasks and resolves the dep id (WP-07 Round 4 P0-3)',
    async () => {
      const user = userEvent.setup();
      const router = makeSuccessfulTwoTaskRouter();
      unregisterSafeActions();
      registerSafeActions({ providerRouter: router });
      // WP-07 Round 4 P0-1: seed before mount, mount
      // with projectId so ResearchHome never mounts.
      const projectId = await seedProject();
      await mountHarness({ router, projectId });
      const container = { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: projectId };
      const ph = screen.getByTestId('project-home');
      expect(ph.getAttribute('data-project-id')).toBe(projectId);

      // 1. Create an open Question through the real
      //    form so the "Ask AI" chip is wired.
      await user.click(within(ph).getByTestId('project-home-new-question'));
      const qForm = within(ph).getByTestId('project-home-new-question-form');
      await user.type(
        within(qForm).getByTestId('project-home-new-question-text'),
        'Two-row dependency test question',
      );
      // WP-07 Round 5: plain userEvent click; the
      // userEvent act boundary is the right scope.
      await user.click(within(qForm).getByTestId('project-home-new-question-save'));
      const qRow = await within(ph).findByTestId('project-home-question-row');
      const questionId = qRow.getAttribute('data-question-id');
      expect(questionId).toBeTruthy();

      // 2. Ask AI → capsule opens with 2 distinct
      //    suggestions; suggestion 2 names suggestion
      //    1 in its dependsOnTitles.
      await user.click(within(qRow).getByTestId('project-home-question-ask-ai'));
      const suggestChip = await screen.findByTestId(
        'v04-intent-capsule-action-research-suggest-design-tasks',
      );
      await user.click(suggestChip);
      const draftEl = await screen.findByTestId('v04-intent-capsule-draft');
      expect(draftEl.getAttribute('data-draft-body-kind')).toBe('task-suggestions');
      const rows = screen.getAllByTestId('v04-intent-capsule-task-suggestion-row');
      expect(rows.length).toBe(2);
      const titleA = rows[0]!.getAttribute('data-task-title')!;
      const titleB = rows[1]!.getAttribute('data-task-title')!;

      // 3. Accept row A first.
      const acceptA = within(rows[0] as HTMLElement).getByTestId(
        'v04-intent-capsule-task-suggestion-accept',
      );
      await user.click(acceptA);
      // Row A is consumed; row B is still visible.
      const remainingAfterA = await waitFor(() => {
        const r = screen.queryAllByTestId('v04-intent-capsule-task-suggestion-row');
        expect(r.length).toBe(1);
        return r;
      });
      expect(remainingAfterA[0]!.getAttribute('data-task-title')).toBe(titleB);

      // 4. Accept row B. Its dependsOnTitles contains
      //    titleA. The host's `titleToId` map must
      //    have row A's canonical id by now, so the
      //    resolve in `acceptDesignTaskSuggestion`
      //    succeeds and B is created with the
      //    resolved dependency.
      const acceptB = within(remainingAfterA[0] as HTMLElement).getByTestId(
        'v04-intent-capsule-task-suggestion-accept',
      );
      await user.click(acceptB);
      await screen.findByTestId('v04-intent-capsule-task-suggestions-done');

      // 5. Both canonical tasks exist in the repo.
      const tasksAfter = await testRepo.listTasks({ projectId });
      expect(tasksAfter).toHaveLength(2);
      const aRow = tasksAfter.find((t) => t.title === titleA);
      const bRow = tasksAfter.find((t) => t.title === titleB);
      expect(aRow).toBeDefined();
      expect(bRow).toBeDefined();

      // 6. The dependency id resolves to A's id —
      //    NOT a self-loop, NOT an unknown id, NOT
      //    a silently dropped hint.
      expect(bRow!.dependencies).toEqual([aRow!.id]);
      expect(bRow!.dependencies.includes(bRow!.id)).toBe(false);
      // The atomic path: A and B are both canonical,
      // and the dep edge is part of the same
      // persisted `ResearchTask.dependencies` field
      // (no separate `addTaskDependency` write
      // happened — verified by the use case path:
      // the writer's `createTask` is the only
      // mutation between the two Accepts).
      expect(bRow!.sourceRef).toEqual({ kind: 'question', id: questionId });
      // Both rows carry the `ai-accepted` origin
      // (Round 3 P0-B).
      expect(aRow!.origin.kind).toBe('ai-accepted');
      expect(bRow!.origin.kind).toBe('ai-accepted');

      // 7. The Draft Layer is in `accepted` after
      //    every row is resolved (the host fires the
      //    whole-draft transition once when
      //    `allResolved && acceptedTitles.size > 0`).
      const drafts = draftLayer.list();
      const ourDraft = drafts.find(
        (d) => d.body.kind === 'task-suggestions' && d.body.sourceId === questionId,
      );
      expect(ourDraft?.status).toBe('accepted');
    },
    120000,
  );
});
