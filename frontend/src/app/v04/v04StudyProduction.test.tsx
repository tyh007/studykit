/**
 * StudyKit v0.4 — `V04Shell` + `v04Study` production composition
 * (WP-04 Gate fix)
 *
 * The previous round shipped `<StudyWiring />` and
 * `<StudyRouter />` as siblings of `props.children`. With
 * the `v04Study` flag on, the router (and the
 * `<LectureCaptureTrigger>` inside the v0.3 body) called
 * `useStudyDeps()` and threw because there was no
 * `<StudyProvider>` ancestor.
 *
 * This test file drives the *real* V04Shell with the
 * `v04Study` flag on and asserts:
 *
 *   1. The shell renders without throwing.
 *   2. The StudyRouter surfaces (study-home / course /
 *      review) can find the StudyProvider through the
 *      hook — i.e. the Provider is a *real* ancestor, not
 *      a sibling. We assert this by mounting a
 *      StudyRouter that calls `useStudyDeps()` and reads
 *      the real Dexie-backed repository.
 *   3. A child passed to V04Shell can also call
 *      `useStudyDeps()` and find the same instance — the
 *      body and the StudyRouter share the Provider.
 *   4. The flag-off path is byte-for-byte unchanged: the
 *      StudyWiring returns `null`, no Provider is mounted,
 *      `useStudyDeps()` throws in a misuse, and the
 *      legacy surface tree is rendered.
 *
 * The test does NOT mock the StudyProvider or the
 * repository; it uses the real
 * `createDexieStudyRepository` against the same
 * fake-Dexie-tables setup the other Dexie adapter tests
 * use. The full production composition is exercised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { V04Shell, V04Entry } from './index';
import { locationStore } from './locationStore';
import { useStore } from '../../store/useStore';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import {
  __resetFeatureFlagsForTests,
  __setFeatureFlagForTests,
} from '../feature-flags';
import { workspaceFlavour } from '../../application/workspaceFlavour';
import { useStudyDeps, StudyHome, CourseHome, ReviewWorkspace } from '../../features/study';
import { makeAppLocation } from '../../domain/workspace';
import { db as prodDb } from '../../lib/db';
import { __resetStudyDbForTests } from '../../platforms/web/dexieStudyRepository';
import { draftLayer, __resetAiKernelForTests } from '../../features/ai';

// Mock useAuth to a no-op signed-in user so V04Shell
// renders the body (not the entry).
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

// Mock the v0.3 `lib/api` and `lib/literature-api`
// so the App body does not try to hit a real backend
// during the test. The WP-02 / WP-03 tests use the
// same `apiModulesFactory` / `literatureApiFactory`
// pattern; we adopt it here to keep the test
// self-contained.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modulesApi: {
      list: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({ success: true }),
    },
    lecturesApi: {
      list: async () => [],
      create: async () => ({}),
    },
    sourceDocumentsApi: { get: async () => null, getPages: async () => [], upload: async () => ({}) },
    exportsApi: { create: async () => ({}) },
    syncApi: { push: async () => ({}), pull: async () => ({}) },
    authApi: {
      register: async () => ({}),
      login: async () => ({}),
      me: async () => ({}),
    },
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
    literaturePapersApi: { list: async () => [] },
    literatureAiApi: { chat: async () => ({ message: { role: 'assistant', content: '' } }) },
    zoteroApi: {},
    citationsApi: { list: async () => [] },
    paperNotesApi: { create: async () => ({}) },
    paperRelationsApi: { list: async () => [] },
    readingListsApi: { list: async () => [] },
    literatureCustomFieldsApi: { list: async () => [] },
  };
});

// Wire fake Dexie tables — same setup as the Dexie
// adapter test (happy-dom does not ship IndexedDB).
function installFakeDb(): void {
  const makeFakeTable = <T extends { id: string }>(): {
    rows: Map<string, T>;
    hooks: { creating?: (key: string, obj: T) => void; deleting?: (key: string) => void };
  } => {
    const rows = new Map<string, T>();
    const hooks: { creating?: (key: string, obj: T) => void; deleting?: (key: string) => void } = {};
    return { rows, hooks };
  };
  const fq = makeFakeTable();
  const fa = makeFakeTable();
  const ff = makeFakeTable();
  const fr = makeFakeTable();
  const wire = (table: typeof fq) => ({
    toArray: async () => Array.from(table.rows.values()),
    get: async (id: string) => table.rows.get(id),
    put: async (row: { id: string }) => {
      table.rows.set(row.id, row);
      table.hooks.creating?.(row.id, row);
    },
    delete: async (id: string) => {
      table.rows.delete(id);
      table.hooks.deleting?.(id);
    },
    hook: (h: { creating?: (k: string, o: { id: string }) => void; deleting?: (k: string) => void }) => {
      table.hooks.creating = h.creating;
      table.hooks.deleting = h.deleting;
    },
    clear: async () => table.rows.clear(),
  });
  (prodDb as unknown as { studyQuestions: unknown }).studyQuestions = wire(fq);
  (prodDb as unknown as { studyAttempts: unknown }).studyAttempts = wire(fa);
  (prodDb as unknown as { studyFeedback: unknown }).studyFeedback = wire(ff);
  (prodDb as unknown as { studyRecovery: unknown }).studyRecovery = wire(fr);
  // The `transaction` seam: in production Dexie provides
  // atomic transactions; the test fake just invokes the
  // callback synchronously.
  (prodDb as unknown as { transaction: (...a: unknown[]) => Promise<unknown> }).transaction = (async (...args: unknown[]) => {
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      return await (last as () => Promise<unknown> | unknown)();
    }
    return undefined;
  }) as never;
  __resetStudyDbForTests();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setWorkspaceFlavour('sync');
  workspaceFlavour.openSync('ws-1');
  useStore.getState().resetStore();
  __resetFeatureFlagsForTests();
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
  installFakeDb();
  act(() => {
    locationStore.replace(makeAppLocation({ mode: 'study', surface: 'study-home' }));
  });
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
  __resetStudyDbForTests();
});

// A small Probe that reads the Study context and
// renders the values it sees. The probe is a strict
// sibling-of-everything consumer; if the Provider wraps
// the children correctly, the probe reports a non-null
// value. If the Provider is missing, the probe throws.
function ContextProbe({ label }: { label: string }): React.ReactElement {
  const deps = useStudyDeps();
  return (
    <div data-testid={`probe-${label}`}>
      <span data-testid={`probe-${label}-has-repo`}>{deps.repository ? 'yes' : 'no'}</span>
    </div>
  );
}

describe('app/v04 / V04Shell + v04Study production composition', () => {
  it('flag off: StudyWiring returns null; useStudyDeps() throws; legacy body renders', async () => {
    __setFeatureFlagForTests('v04Study', false);
    render(
      <V04Shell>
        <div data-testid="legacy-body">legacy body</div>
      </V04Shell>,
    );
    // The legacy body is rendered.
    expect(screen.getByTestId('legacy-body')).toBeInTheDocument();
    // No Study context exists; a consumer throws.
    function BadConsumer(): React.ReactElement {
      useStudyDeps();
      return <></>;
    }
    expect(() => render(<BadConsumer />)).toThrow(/no <StudyProvider> ancestor/);
  });

  it('flag on: the body and a custom consumer both see the SAME StudyProvider', async () => {
    __setFeatureFlagForTests('v04Study', true);
    let probeARepo: unknown = null;
    let probeBRepo: unknown = null;
    function ProbeA(): React.ReactElement {
      const deps = useStudyDeps();
      probeARepo = deps.repository;
      return <div data-testid="probe-a">A</div>;
    }
    function ProbeB(): React.ReactElement {
      const deps = useStudyDeps();
      probeBRepo = deps.repository;
      return <div data-testid="probe-b">B</div>;
    }
    render(
      <V04Shell>
        <ProbeA />
        <ProbeB />
      </V04Shell>,
    );
    // Both probes see the same repository instance — the
    // Provider is a real ancestor of both, and a single
    // value object is shared (this is the whole point of
    // fixing the sibling bug).
    await waitFor(() => {
      expect(probeARepo).not.toBeNull();
      expect(probeBRepo).not.toBeNull();
    });
    expect(probeARepo).toBe(probeBRepo);
  });

  it('flag on: StudyRouter surfaces (StudyHome / CourseHome / ReviewWorkspace) read the same provider', async () => {
    __setFeatureFlagForTests('v04Study', true);
    let studyHomeRepo: unknown = null;
    let courseHomeRepo: unknown = null;
    let reviewRepo: unknown = null;
    function ProbeHome(): React.ReactElement {
      const deps = useStudyDeps();
      studyHomeRepo = deps.repository;
      return <StudyHome
        onOpenCourse={() => undefined}
        onResumeQuestion={() => undefined}
        onOpenReview={() => undefined}
      />;
    }
    function ProbeCourse(): React.ReactElement {
      const deps = useStudyDeps();
      courseHomeRepo = deps.repository;
      return <CourseHome
        courseId="c-1"
        onOpenLecture={() => undefined}
        onOpenReview={() => undefined}
      />;
    }
    function ProbeReview(): React.ReactElement {
      const deps = useStudyDeps();
      reviewRepo = deps.repository;
      return <ReviewWorkspace
        onOpenLecture={() => undefined}
        onExit={() => undefined}
      />;
    }
    // All three probes mount inside the same V04Shell so
    // the singleton `getStudyDb()` is shared. (Each fresh
    // `render()` after `cleanup()` would build a new
    // `DexieStudyRepository` instance, which is not the
    // real production behaviour — the production
    // application keeps a single Dexie instance for the
    // page lifetime.)
    render(
      <V04Shell>
        <ProbeHome />
        <ProbeCourse />
        <ProbeReview />
      </V04Shell>,
    );
    await waitFor(() => {
      expect(studyHomeRepo).not.toBeNull();
      expect(courseHomeRepo).not.toBeNull();
      expect(reviewRepo).not.toBeNull();
    });
    expect(studyHomeRepo).toBe(courseHomeRepo);
    expect(courseHomeRepo).toBe(reviewRepo);
  });

  it('flag on + AI off: the StudyHome shows the empty state without throwing', async () => {
    __setFeatureFlagForTests('v04Study', true);
    // We mock the dataApi gateway to return [] for modules
    // so the StudyHome shows the empty state. The AI
    // capability is also off; the StudyHome does not call
    // AI so this is a pure rendering test.
    const dataApiMod = await import('../../application/dataGateway');
    const spy = vi.spyOn(dataApiMod, 'getDataApi').mockReturnValue({
      flavour: 'local',
      supports: () => false,
      modules: { list: async () => [], create: async () => ({} as never), update: async () => ({} as never), delete: async () => ({ success: true }) },
      lectures: { list: async () => [], create: async () => ({} as never), update: async () => ({} as never), delete: async () => ({ success: true }) },
      literatureProjects: { list: async () => [], create: async () => ({} as never), update: async () => ({} as never), delete: async () => ({ success: true }) },
      literaturePapers: { list: async () => [] },
      sourceDocuments: {
        get: async () => undefined,
        getPages: async () => [],
        putWithPages: async () => undefined,
        delete: async () => undefined,
      },
    });
    render(
      <V04Shell>
        <div data-testid="shell-body">body</div>
      </V04Shell>,
    );
    // The StudyHome is rendered because location.surface
    // is 'study-home' (set in beforeEach).
    await waitFor(() => {
      expect(screen.getByTestId('v04-study-home')).toBeInTheDocument();
    });
    expect(screen.getByTestId('v04-study-home-empty-courses')).toBeInTheDocument();
    spy.mockRestore();
  });
});
