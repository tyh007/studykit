/**
 * StudyKit v0.4 — V04Shell + `v04Research` production
 * composition (WP-05 Gate, Round 4)
 *
 * Round 4 fix: the closed loop now drives the *real*
 * UI with `userEvent`. No more direct use-case calls
 * from inside the test body. Every step is the same
 * path a real user walks:
 *
 *   Research Home → create project
 *   → Discovery: type question → Run (fixture)
 *   → Save 3 candidates
 *   → Library: 3 Works
 *   → for each of 3 works:
 *       Open reader
 *       File input change (real) → local PDF imported
 *         via the production use case
 *       Real DOM selection (range) + dispatched `mouseup`
 *         → SelectionActionBar appears
 *       Click "Save as Evidence" → Drawer opens
 *       Type interpretation
 *       Click "Save draft" → status flips to candidate
 *       Click "Verify Evidence" → status flips to verified
 *       Back to library
 *   → Evidence Workspace
 *   → Check 3 evidence
 *   → Per-evidence relation select: supports /
 *     contradicts / qualifies
 *   → Fill Claim title + body
 *   → Click "Create Claim" → links created
 *   → Reload (cleanup + render)
 *   → Open Evidence Workspace again
 *   → Assert: 3 verified evidence, 1 claim, 3 distinct
 *     relations
 *
 * AI-off invariant is tested through the real Suggest
 * UI: a router that throws surfaces the failure card
 * in the workspace, and the user's selection + context
 * text + focus are preserved across Retry.
 *
 * Incomplete-locator invariant is tested through the
 * real Reader / Drawer: a Work with no asset renders
 * `EmptyPdfState` (not the PDF viewer), and the
 * SelectionActionBar cannot appear. The drawer's
 * Verify button is disabled when the user has not
 * yet filled an interpretation (the locator is
 * incomplete); we drive this through the drawer UI.
 *
 * The seam: `createDexieResearchRepository` and the
 * `OpenAlexSearchProvider` class are swapped for
 * production-shape in-memory / fixture equivalents.
 * The `pdfAssetStore` is an in-memory mock because
 * happy-dom has no IndexedDB. The fixtures are
 * formal dependency seams (test-only module-level
 * mocks) — the production wiring still drives every
 * call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { V04Shell } from './index';
import { locationStore } from './locationStore';
import {
  __resetFeatureFlagsForTests,
  __setFeatureFlagForTests,
} from '../feature-flags';
import { workspaceFlavour } from '../../application/workspaceFlavour';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import { draftLayer, __resetAiKernelForTests } from '../../features/ai';
import { makeAppLocation } from '../../domain/workspace';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import type { ResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider, makeFixtureFetch, deterministicOpenAlexResponse } from '../../application/research/openAlexProvider';
import type { OpenAlexSearchProvider as OpenAlexSearchProviderType } from '../../application/research/openAlexProvider';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';

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
    authApi: { register: async () => ({}), login: async () => ({}), me: async () => ({}), logout: async () => ({}) },
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
// IndexedDB. The seam matches the production contract
// (`put` / `get` / `getObjectUrl`).
vi.mock('../../platforms/web/pdfAssetStore', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const blobs = new Map<string, { blob: Blob; contentHash: string; pageCount?: number; storedAt: string }>();
  const urlCache = new Map<string, string>();
  const fakeStore = {
    async put(input: { assetId: string; blob: Blob; contentHash: string; pageCount?: number }) {
      blobs.set(input.assetId, { blob: input.blob, contentHash: input.contentHash, pageCount: input.pageCount, storedAt: new Date().toISOString() });
      const prev = urlCache.get(input.assetId);
      if (prev) {
        try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
        urlCache.delete(input.assetId);
      }
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

// The AI Kernel's `getSharedProviderRouter` is the
// seam the Research slice reads. We mock the entire
// module so:
//   - The `<AiKernelWiring />` component is a no-op
//     (its production effect never runs, so it never
//     overrides the test's router).
//   - `getSharedProviderRouter()` returns the test's
//     `testRouter` (set per test).
//   - `subscribeSharedProviderRouter()` replays the
//     current value so the ResearchWiring's effect
//     picks it up on the first commit.
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

async function makeProvider(seed: string, count = 3): Promise<OpenAlexSearchProviderType> {
  const actual = await vi.importActual<typeof import('../../application/research/openAlexProvider')>(
    '../../application/research/openAlexProvider',
  );
  const RealProvider = actual.OpenAlexSearchProvider;
  return new RealProvider({
    fetchImpl: makeFixtureFetch({
      responses: new Map([
        [`https://api.openalex.org/works`, deterministicOpenAlexResponse({ seed, count })],
      ]),
    }),
    runTimeoutMs: 1000,
  });
}

let sharedProvider: OpenAlexSearchProviderType | null = null;
vi.mock('../../application/research/openAlexProvider', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const ProxyClass: unknown = function () {
    if (!sharedProvider) return sharedProvider;
    const proto = Object.getPrototypeOf(sharedProvider);
    const instance = Object.create(proto) as Record<string, unknown>;
    const ownKeys = Object.getOwnPropertyNames(sharedProvider);
    for (const k of ownKeys) {
      const v = (sharedProvider as unknown as Record<string, unknown>)[k];
      instance[k] = typeof v === 'function' ? v.bind(sharedProvider) : v;
    }
    const protoKeys = Object.getOwnPropertyNames(proto);
    for (const k of protoKeys) {
      if (k === 'constructor') continue;
      const v = (proto as Record<string, unknown>)[k];
      if (typeof v === 'function' && instance[k] === undefined) {
        instance[k] = v.bind(sharedProvider);
      }
    }
    return instance;
  };
  return { ...actual, OpenAlexSearchProvider: ProxyClass };
});

/**
 * Build a router that returns a Claim-shaped response
 * from a configurable `provider` (`ollama` / `cloud`).
 * The model name and content come from the override.
 */
function makeRouter(opts: {
  readonly provider: 'ollama' | 'cloud';
  readonly model: string;
  readonly content?: string;
}): ProviderRouter {
  const content = opts.content ?? 'Sleep consolidates memory.\nAcross three studies, the effect is consistent.';
  return {
    capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
    chat: (async () => ({ content, provider: opts.provider, model: opts.model })) as unknown as ProviderRouter['chat'],
  } as unknown as ProviderRouter;
}

/**
 * Router whose `chat()` always throws. The Suggest
 * UI must show a real failure card without losing
 * the user's input.
 */
function makeFailingRouter(message: string): ProviderRouter {
  return {
    capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
    chat: (async () => {
      throw new Error(message);
    }) as unknown as ProviderRouter['chat'],
  } as unknown as ProviderRouter;
}

beforeEach(async () => {
  resetTestRepo();
  sharedProvider = await makeProvider('memory', 3);
  __resetFeatureFlagsForTests();
  __setFeatureFlagForTests('v04Shell', true);
  __setFeatureFlagForTests('v04Research', true);
  __setFeatureFlagForTests('v04Assistant', true);
  setWorkspaceFlavour('local');
  workspaceFlavour.openLocal();
  draftLayer.__resetForTests();
  __resetAiKernelForTests();
  locationStore.replace(makeAppLocation({ mode: 'research', surface: 'research-home' }));
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
});

function Body() {
  return <div data-testid="v04-legacy-body">legacy</div>;
}

function mountHarness(opts: { router?: ProviderRouter; routerReady?: boolean } = {}) {
  // Default router: a working ollama response. The
  // test can override per case.
  const router = opts.router ?? makeRouter({ provider: 'ollama', model: 'llama3.1:8b' });
  // Set the test router BEFORE rendering. The
  // ResearchWiring subscribes to the router and
  // bakes it into the ResearchProvider's value.
  setTestRouter(router);
  render(
    <V04Shell>
      <Body />
    </V04Shell>,
  );
  return { repo: testRepo, provider: sharedProvider!, router };
}

/**
 * Helper: set up a real DOM selection on a target
 * element and dispatch the `mouseup` event the
 * Reader's selection listener watches. Returns the
 * text the selection represents.
 */
function setupSelection(target: Element, text: string): void {
  const sel = window.getSelection();
  if (!sel) throw new Error('window.getSelection not available');
  const range = document.createRange();
  range.selectNodeContents(target);
  sel.removeAllRanges();
  sel.addRange(range);
  // happy-dom doesn't populate toString() from a
  // range the way real browsers do. Set a stable
  // `data-` attribute the test can read, and inject
  // a custom `toString` shim if needed. The Reader
  // reads `sel.toString().trim()`; in happy-dom the
  // range's text is exposed as `range.toString()`.
  // We force the global Selection's `toString` to
  // return the desired text so the Reader picks it
  // up.
  const original = sel.toString.bind(sel);
  sel.toString = () => {
    const fromRange = original();
    return fromRange && fromRange.length > 0 ? fromRange : text;
  };
  // Use Testing Library's `fireEvent` so the
  // dispatch lands inside the test's act boundary.
  // A raw `document.dispatchEvent(new MouseEvent(...))`
  // fires synchronously outside any act, which
  // makes the Reader's `mouseup` listener call
  // `setSelection` without an act wrapper — React
  // 19 reports "An update to ResearchReader inside
  // a test was not wrapped in act(...)" for every
  // call (one per seed × 3 works per seed × 3 seed
  // tests = 9, plus 1 in the incomplete-locator test
  // = 10 — exactly the count we've been chasing).
  fireEvent.mouseUp(document);
}

// Note: do NOT wrap `user.click` / `user.upload` /
// `user.type` / `user.selectOptions` in an outer
// `act()`. userEvent v14 manages its own act
// boundary internally via its `asyncWrapper`
// (RTL `pure.js` ~L83), which temporarily
// toggles `IS_REACT_ACT_ENVIRONMENT` to `false`
// while the synthetic event is dispatching. If
// an outer `act` is open at the same time, the
// outer actQueue is still active but the flag
// is `false`, producing a flood of
// "The current testing environment is not
// configured to support act(...)" warnings. The
// fix is to call `await user.click(...)` (and
// friends) directly — userEvent's internal
// wrapper handles the act boundary for each
// dispatched event.

describe('V04Shell + v04Research production composition', () => {
  it('mounts the v04 shell with the Research flag on', async () => {
    mountHarness();
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    expect(await screen.findByTestId('research-home')).toBeInTheDocument();
  });

  it('flag-off: no Research surface is rendered', async () => {
    __setFeatureFlagForTests('v04Research', false);
    render(
      <V04Shell>
        <Body />
      </V04Shell>,
    );
    expect(screen.queryByTestId('research-home')).toBeNull();
    expect(screen.getByTestId('v04-legacy-body')).toBeInTheDocument();
  });
});

/**
 * Real-UI seed helper.
 *
 * Drives the *full* production UI from the
 * `research-home` screen all the way through to a
 * verified Evidence × 3 in the Evidence Workspace.
 * Every step is the same path a real user walks:
 *
 *   1. create a project (real submit)
 *   2. run Discovery (real Run button) + Save 3
 *      (real Save button × 3)
 *   3. open each Work in the Reader
 *   4. import a real local PDF via the Reader's
 *      `<input type="file">` (real `user.upload`)
 *   5. trigger a real DOM selection on a fixture
 *      `<span>` and dispatch `mouseup` so the
 *      Reader's selection listener picks it up
 *   6. click "Save as Evidence" → Drawer
 *   7. type interpretation (real `fireEvent.change`)
 *   8. click "Save draft" (real `user.click`)
 *   9. click "Verify Evidence" (real `user.click`)
 *   10. back to library, repeat for the next Work
 *   11. open the Evidence Workspace from the project
 *      home
 *   12. assert 3 verified Evidence rows are present
 *
 * The helper is shared by the closed loop, the
 * AI-off invariant, and the AI provenance tests so
 * every test that needs 3 verified Evidence goes
 * through the *same* real UI. The `pdfAssetStore`
 * is mocked to in-memory (production seam; happy-dom
 * has no IndexedDB) but the production code path —
 * `importLocalPdf` → `WorkRepository.putWorkAsset` →
 * Dexie subscribe — runs end-to-end.
 *
 * Async-handler note: the Reader's file-import +
 * verify paths are async; userEvent v14 + React 19
 * do not always extend `act` boundaries across
 * those async consequences. We wrap every user
 * event in `act(async ...)` to keep the boundary
 * open through the microtask queue — this fixes
 * the root cause of the act warnings instead of
 * filtering them.
 */
async function seedThreeVerifiedEvidenceViaUI(
  user: ReturnType<typeof userEvent.setup>,
  projectName: string,
): Promise<{ projectId: string }> {
  await screen.findByTestId('research-home');
  // 1. Create project. WP-11R2 collapsed the new
  //    project form behind a button; the helper
  //    opens the inline form first.
  await user.click(await screen.findByTestId('research-new-project-toggle'));
  await user.type(await screen.findByTestId('research-new-project-name'), projectName);
  await user.type(screen.getByTestId('research-new-project-brief'), `${projectName} brief`);
  await user.click(screen.getByTestId('research-new-project-submit'));
  await screen.findByTestId('project-home');
  // 2. Discovery → Run + Save 3.
  await user.click(screen.getByTestId('project-home-add'));
  await user.click(screen.getByTestId('project-home-action-discovery'));
  await screen.findByTestId('discovery');
  const question = screen.getByTestId('discovery-question');
  await user.clear(question);
  await user.type(question, 'sleep memory consolidation');
  await user.click(screen.getByTestId('discovery-run'));
  const candidateRows = await screen.findAllByTestId('discovery-candidate-row');
  if (candidateRows.length !== 3) {
    throw new Error(`Expected 3 candidates, got ${candidateRows.length}`);
  }
  for (const btn of screen.getAllByTestId('discovery-candidate-save')) {
    await user.click(btn);
  }
  // 3. Library.
  await user.click(screen.getByTestId('discovery-open-library'));
  await screen.findByTestId('research-library');
  // 4-10. For each of 3 works: Reader + import +
  //       select + Save draft + Verify.
  const tinyPdfBytes = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
    0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
    0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x0a, 0x3e, 0x3e, 0x0a,
    0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
    0x78, 0x72, 0x65, 0x66, 0x0a, 0x30, 0x20, 0x31, 0x0a,
    0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a,
  ]);
  for (let i = 0; i < 3; i += 1) {
    const row = (await screen.findAllByTestId('research-library-row'))[i]!;
    const workId = row.getAttribute('data-work-id')!;
    await user.click(within(row).getByTestId('research-library-open-reader'));
    const reader = await screen.findByTestId('research-reader');
    const fileInput = within(reader).getByTestId('research-reader-file-input') as HTMLInputElement;
    const file = new File([tinyPdfBytes], `work-${i}.pdf`, { type: 'application/pdf' });
    // Direct call to `user.upload` — no outer
    // act wrapper (which would collide with
    // userEvent's internal act management and
    // flood "The current testing environment...").
    // The production code's onChange is an async
    // function that returns the promise from
    // `handleFileChosen`; userEvent v14 awaits
    // the onChange's return value inside its own
    // act boundary, so every `setState` inside
    // `handleFileChosen` lands inside act.
    await user.upload(fileInput, file);
    // The EmptyPdfState is replaced after the
    // import settles; the asset round-trip is the
    // canonical signal. `waitFor` re-runs the
    // callback until the assertion passes; we
    // throw (not return a boolean) so a real
    // regression surfaces as a test failure.
    // The earlier `return !empty; .catch(() => undefined)`
    // form silently succeeded on the first tick
    // and hid real failures.
    await waitFor(() => {
      expect(within(reader).queryByTestId('research-reader-empty')).not.toBeInTheDocument();
    });
    const fixture = document.createElement('span');
    fixture.setAttribute('data-testid', `reader-fixture-${i}-${projectName.replace(/\s+/g, '-')}`);
    fixture.textContent = `quote number ${i}`;
    reader.appendChild(fixture);
    setupSelection(fixture, `quote number ${i}`);
    await screen.findByTestId('selection-action-bar');
    await user.click(screen.getByTestId('selection-action-evidence'));
    const drawer = await screen.findByTestId('evidence-draft-drawer');
    const interp = within(drawer).getByTestId('evidence-draft-interpretation') as HTMLTextAreaElement;
    fireEvent.change(interp, { target: { value: `interpretation ${i}` } });
    // Save draft + Verify both have async
    // production handlers.
    await user.click(within(drawer).getByTestId('evidence-draft-save'));
    const verifyBtn = await within(drawer).findByTestId('evidence-draft-verify');
    await waitFor(() => expect(verifyBtn).not.toBeDisabled());
    await user.click(verifyBtn);
    await user.click(within(reader).getByTestId('research-reader-back'));
    await screen.findByTestId('research-library');
  }
  // 11. Open Evidence Workspace.
  await user.click(screen.getByTestId('research-sources-back'));
  await screen.findByTestId('project-home');
  await user.click(screen.getByTestId('project-home-add'));
  await user.click(screen.getByTestId('project-home-action-evidence'));
  const ws = await screen.findByTestId('evidence-workspace');
  const evidenceRows = await screen.findAllByTestId('evidence-row');
  if (evidenceRows.length !== 3) {
    throw new Error(`Expected 3 verified evidence rows, got ${evidenceRows.length}`);
  }
  // The project id is read from the workspace's
  // project name pill so the test can assert on
  // the repository's claim list later.
  const projects = await testRepo.listProjects();
  const project = projects.find((p) => p.name === projectName);
  if (!project) throw new Error(`Project ${projectName} not found`);
  void ws;
  return { projectId: project.id };
}

/**
 * Round 4 fix: the closed loop now drives the *real*
 * UI with `userEvent`. Selection is a real DOM
 * range + dispatched `mouseup`; the Drawer is opened
 * by clicking the SelectionActionBar; the Evidence is
 * saved and verified through the Drawer buttons. The
 * Claim is created through the Evidence Workspace
 * form with the per-evidence relation picker.
 */
describe('WP-05 closed loop: real userEvent flow', () => {
  it('drives project → search → save → reader → evidence ×3 → claim + 3 relations → reload', async () => {
    const { repo } = mountHarness();
    const user = userEvent.setup();

    // Steps 1-5: real UI from `research-home` to a
    // verified Evidence × 3 in the Evidence
    // Workspace.
    const { projectId } = await seedThreeVerifiedEvidenceViaUI(user, 'Sleep & memory');

    // Each Evidence carries the *real* assetId from
    // the imported local-pdf WorkAsset (the locator
    // is complete; the next test step depends on it).
    const evidence = await repo.listEvidence({ projectId, status: 'verified' });
    expect(evidence).toHaveLength(3);
    const workIds = (await repo.listWorks({ projectId })).map((w) => w.id);
    const locatorAssetIds = evidence.map((e) => e.locator.assetId);
    for (const a of locatorAssetIds) {
      expect(a).toBeTruthy();
      expect(a).not.toBe(workIds[0]);
    }

    // 7. Check 3 evidence + set 3 distinct relations.
    const selects = screen.getAllByTestId('evidence-select');
    for (const cb of selects) await user.click(cb);
    const relations: Array<'supports' | 'contradicts' | 'qualifies'> = ['supports', 'contradicts', 'qualifies'];
    const relationSelects = screen.getAllByTestId('evidence-relation');
    for (let i = 0; i < 3; i += 1) {
      await user.selectOptions(relationSelects[i] as HTMLSelectElement, relations[i]!);
    }

    // 8. Fill Claim.
    await user.type(screen.getByTestId('claim-title'), 'Sleep supports memory consolidation');
    await user.type(screen.getByTestId('claim-body'), 'Across three studies.');
    // 9. Click Create.
    await user.click(screen.getByTestId('claim-create'));

    // 10. The claim + 3 distinct relations are in
    //     the repository.
    const claims = await repo.listClaims({ projectId });
    expect(claims).toHaveLength(1);
    const links = (await repo.listLinks({ projectId })).filter((l) => l.claimId === claims[0]!.id);
    expect(links).toHaveLength(3);
    const gotRels = new Set(links.map((l) => l.relation));
    expect(gotRels).toEqual(new Set(relations));

    // 11. Reload.
    await act(async () => {
      cleanup();
      locationStore.replace(makeAppLocation({ mode: 'research', surface: 'research-home' }));
      render(
        <V04Shell>
          <Body />
        </V04Shell>,
      );
    });
    await screen.findByTestId('research-home');
    const projectRow = await screen.findByTestId('research-project-row');
    await user.click(projectRow);
    await screen.findByTestId('project-home');
    await user.click(screen.getByTestId('project-home-add'));
    await user.click(screen.getByTestId('project-home-action-evidence'));
    const ws2 = await screen.findByTestId('evidence-workspace');
    expect(ws2).toBeInTheDocument();
    expect(await screen.findAllByTestId('evidence-row')).toHaveLength(3);
    expect(await screen.findByTestId('claim-row')).toBeInTheDocument();
    const persistedRels = new Set(
      (await repo.listLinks({ projectId }))
        .filter((l) => l.claimId === claims[0]!.id)
        .map((l) => l.relation),
    );
    expect(persistedRels).toEqual(new Set(relations));
  }, 60000);
});

/**
 * The incomplete-locator invariant, tested through
 * the *real* UI:
 *
 *   1. A Work with no local-pdf asset renders the
 *      Reader's `EmptyPdfState`. There is no
 *      `selection-action-bar`; the Evidence Drawer
 *      cannot be opened from this surface.
 *   2. The Evidence Drawer's Verify button is
 *      disabled when the user has not yet typed an
 *      interpretation (the locator is incomplete).
 *      We open the Drawer via a real selection on a
 *      work *with* a local-pdf asset and check the
 *      Verify button's `disabled` state at the
 *      `candidate` phase (before interpretation is
 *      filled).
 */
describe('WP-05 invariant: incomplete locator in real UI', () => {
  it('a Work with no asset renders EmptyPdfState and no SelectionActionBar', async () => {
    const { repo } = mountHarness();
    const user = userEvent.setup();
    await screen.findByTestId('research-home');
    // WP-11R2: the new project form is collapsed
    // behind a button. The helper opens it first.
    await user.click(screen.getByTestId('research-new-project-toggle'));
    await user.type(await screen.findByTestId('research-new-project-name'), 'No PDF project');
    await user.click(screen.getByTestId('research-new-project-submit'));
    const projectId = (await repo.listProjects())[0]!.id;
    // Manually create a Work with no asset. The
    // `repo.transact` is sync but fires a notify
    // that React picks up; wrap in act to keep the
    // boundary open through the notify chain.
    await act(async () => {
      await repo.transact(async (tx) => {
        tx.putWork({
          id: 'work_no_asset',
          identifiers: { doi: '10.0000/no-asset' },
          title: 'No asset paper',
          authors: ['A'],
          metadataProvenance: {
            title: { providerId: 'openalex', at: new Date().toISOString() },
            authors: { providerId: 'openalex', at: new Date().toISOString() },
          },
          integrity: 'unknown',
          assetIds: [],
          projectIds: [projectId],
          readingStatus: 'unread',
          importance: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          authorType: 'imported',
        });
      });
    });
    // Navigate to the library.
    await act(async () => {
      locationStore.push(
        makeAppLocation({
          mode: 'research',
          surface: 'library',
          container: { workspaceId: 'ws-local', mode: 'research', kind: 'project', id: projectId },
        }),
      );
    });
    await screen.findByTestId('research-library');
    const row = await screen.findByTestId('research-library-row');
    await user.click(within(row).getByTestId('research-library-open-reader'));
    const reader = await screen.findByTestId('research-reader');
    // The empty state is shown.
    expect(within(reader).getByTestId('research-reader-empty')).toBeInTheDocument();
    // The SelectionActionBar is *not* shown — the
    // user has no selectable text and no resolved
    // source. (The Drawer cannot be opened from this
    // surface.)
    expect(within(reader).queryByTestId('selection-action-bar')).toBeNull();
    // The Evidence Drawer is not on screen.
    expect(screen.queryByTestId('evidence-draft-drawer')).toBeNull();
  });

  it('the Evidence Drawer Verify button is disabled when the interpretation is empty', async () => {
    const { repo } = mountHarness();
    const user = userEvent.setup();
    await screen.findByTestId('research-home');
    // WP-11R2: the new project form is collapsed
    // behind a button. Open it first.
    await user.click(screen.getByTestId('research-new-project-toggle'));
    await user.type(await screen.findByTestId('research-new-project-name'), 'Drawer disable test');
    await user.click(screen.getByTestId('research-new-project-submit'));
    const projectId = (await repo.listProjects())[0]!.id;
    // Manually seed a work + linked-file asset. Wrap
    // the `repo.transact` in act to keep the boundary
    // open through the notify chain.
    await act(async () => {
      await repo.transact(async (tx) => {
        tx.putWork({
          id: 'work_drawer',
          identifiers: {},
          title: 'Drawer test',
          authors: ['A'],
          metadataProvenance: {
            title: { providerId: 'openalex', at: new Date().toISOString() },
            authors: { providerId: 'openalex', at: new Date().toISOString() },
          },
          integrity: 'unknown',
          assetIds: ['asset_drawer_1'],
          projectIds: [projectId],
          readingStatus: 'unread',
          importance: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          authorType: 'imported',
        });
        tx.putWorkAsset({
          id: 'asset_drawer_1',
          workId: 'work_drawer',
          kind: 'linked-file',
          ref: 'legacy_drawer',
          createdAt: new Date().toISOString(),
        });
      });
    });
    await act(async () => {
      locationStore.push(
        makeAppLocation({
          mode: 'research',
          surface: 'library',
          container: { workspaceId: 'ws-local', mode: 'research', kind: 'project', id: projectId },
        }),
      );
    });
    await screen.findByTestId('research-library');
    const row = await screen.findByTestId('research-library-row');
    await user.click(within(row).getByTestId('research-library-open-reader'));
    const reader = await screen.findByTestId('research-reader');
    // Open the Drawer via a real DOM selection.
    const selectable = reader.querySelector('div');
    if (!selectable) throw new Error('No selectable element in reader');
    selectable.textContent = 'test quote for drawer';
    setupSelection(selectable, 'test quote for drawer');
    await screen.findByTestId('selection-action-bar');
    await user.click(screen.getByTestId('selection-action-evidence'));
    const drawer = await screen.findByTestId('evidence-draft-drawer');
    // Save draft (the Drawer is in `candidate` state).
    // The save handler is async (writes to Dexie +
    // sets state); no outer `act` — `userEvent`
    // manages its own act boundary, and a nested
    // outer `act` collides with the `asyncWrapper`
    // that toggles `IS_REACT_ACT_ENVIRONMENT` to
    // `false` during dispatch.
    await user.click(within(drawer).getByTestId('evidence-draft-save'));
    // The Verify button is now visible but disabled:
    // the locator lacks a user interpretation.
    const verifyBtn = await within(drawer).findByTestId('evidence-draft-verify');
    expect(verifyBtn).toBeDisabled();
    // Filling the interpretation flips the button
    // to enabled (the locator is now complete). We
    // use `fireEvent.change` because `user.type`
    // simulates a keyboard sequence that can be
    // swallowed by happy-dom's text-input handling;
    // the Drawer is a *consumer* of the change event
    // (controlled textarea), so `change` is what
    // the production code reacts to.
    const interp = within(drawer).getByTestId('evidence-draft-interpretation') as HTMLTextAreaElement;
    fireEvent.change(interp, { target: { value: 'my reading' } });
    await waitFor(() => expect(verifyBtn).not.toBeDisabled());
  });
});

/**
 * The AI-off / fail-preserves-input invariant,
 * tested through the *real* Suggest UI. A router
 * that throws surfaces the failure card. The
 * selection, context text, and focus must survive
 * Retry; manual Claim creation must still work.
 *
 * The seed (3 verified Evidence) is created
 * through the *real* production UI — same path a
 * user walks: project → Discovery → Save × 3 →
 * Library → Reader × 3 (import PDF + select + Save
 * Evidence + Verify) → Evidence Workspace. The
 * only non-UI surface is the test's
 * `setTestRouter(makeFailingRouter(...))`, which is
 * the dependency seam the AI Kernel exposes for
 * tests / smoke runs.
 */
describe('WP-05 invariant: AI-off through real Suggest UI', () => {
  it('shows the failure card, preserves selection + context, and Retry still fails', async () => {
    const { repo } = mountHarness({ router: makeFailingRouter('upstream timeout') });
    const user = userEvent.setup();
    // Seed via the real UI; the helper walks the
    // full Research → Discovery → Save × 3 → Library
    // → Reader × 3 → Evidence flow. No direct use-case
    // calls.
    const { projectId } = await seedThreeVerifiedEvidenceViaUI(user, 'AI fail project');

    // We are now on the Evidence Workspace with 3
    // verified rows. Check all 3 via real userEvent.
    for (const cb of screen.getAllByTestId('evidence-select')) {
      await user.click(cb);
    }
    // Fill the AI context.
    const contextTextarea = screen.getByTestId('claim-ai-context') as HTMLTextAreaElement;
    fireEvent.change(contextTextarea, { target: { value: 'my context that must survive failure' } });
    // Click Suggest Claim — router throws. No outer
    // `act` (see the note on the seed helper for
    // why a nested outer act collides with
    // userEvent's internal act boundary).
    await user.click(screen.getByTestId('claim-ai-suggest'));
    // The failure card shows.
    const failure = await screen.findByTestId('claim-ai-failure');
    expect(failure.textContent).toContain('upstream timeout');
    // Selection is preserved: all 3 checkboxes are
    // still checked.
    for (const cb of screen.getAllByTestId('evidence-select')) {
      expect(cb).toBeChecked();
    }
    // Context text is preserved.
    expect((screen.getByTestId('claim-ai-context') as HTMLTextAreaElement).value).toBe('my context that must survive failure');
    // Click Retry — still fails. No outer `act`.
    await user.click(screen.getByTestId('claim-ai-retry'));
    // The failure card is still there (with the
    // same message).
    expect(await screen.findByTestId('claim-ai-failure')).toBeInTheDocument();
    // Manual Claim still works.
    fireEvent.change(screen.getByTestId('claim-title') as HTMLInputElement, { target: { value: 'Manual claim' } });
    fireEvent.change(screen.getByTestId('claim-body') as HTMLTextAreaElement, { target: { value: 'Body' } });
    await user.click(screen.getByTestId('claim-create'));
    const claims = await repo.listClaims({ projectId });
    expect(claims).toHaveLength(1);
    // No Draft Layer record was written (the
    // failure path must not persist a draft).
    expect(draftLayer.list().length).toBe(0);
  }, 60000);
});

/**
 * The Ollama vs cloud provenance assertion: the
 * real Suggest UI must surface the *real* provider
 * name in the draft card, not a hardcoded `cloud`.
 * The seed (3 verified Evidence) is created
 * through the *real* production UI — same path
 * the closed loop and AI-off tests use.
 */
describe('WP-05 invariant: AI provenance surfaces the real provider', () => {
  it('Ollama response shows ollama in the draft card provenance', async () => {
    mountHarness({ router: makeRouter({ provider: 'ollama', model: 'llama3.1:8b' }) });
    const user = userEvent.setup();
    // Seed via the real UI. The Ollama router
    // returns a Claim-shaped response; the helper
    // walks the same flow the closed loop uses.
    await seedThreeVerifiedEvidenceViaUI(user, 'Ollama project');
    // Check all 3 evidence.
    for (const cb of screen.getAllByTestId('evidence-select')) {
      await user.click(cb);
    }
    // `handleSuggestClaim` is async; no outer
    // `act` (see the note on the seed helper).
    await user.click(screen.getByTestId('claim-ai-suggest'));
    // The draft card shows the *real* provider.
    const provenance = await screen.findByTestId('claim-ai-draft-provenance');
    expect(provenance.getAttribute('data-provider')).toBe('ollama');
    expect(provenance.getAttribute('data-model')).toBe('llama3.1:8b');
    expect(provenance.textContent).toContain('ollama');
    expect(provenance.textContent).toContain('llama3.1:8b');
  }, 60000);
});

/**
 * The OpenAlex internal timeout invariant. We
 * drive the OpenAlex provider directly with a
 * controllable fetch; the wired-in TestProvider
 * doesn't expose the timeout dep, so this test
 * uses `vi.importActual` to grab the real class.
 */
describe('WP-05 invariant: OpenAlex internal timeout', () => {
  it('runSearch returns timeout status when fetch never resolves', async () => {
    const actual = await vi.importActual<typeof import('../../application/research/openAlexProvider')>(
      '../../application/research/openAlexProvider',
    );
    const RealProvider = actual.OpenAlexSearchProvider;
    const slowFetch = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      return await new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const p = new RealProvider({ fetchImpl: slowFetch, runTimeoutMs: 50 });
    const ctl = new AbortController();
    const res = await p.runSearch({
      querySpec: {
        id: 'qs', projectId: 'p', question: 'q', concepts: [],
        includeTerms: ['x'], excludeTerms: [], languages: ['en'],
        seedWorkIds: [], strategy: 'explore', aiAssisted: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      signal: ctl.signal,
    });
    expect(res.status).toBe('failed');
    expect(res.errors[0]?.code).toBe('timeout');
  });
});
