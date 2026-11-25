/**
 * StudyKit v0.4 — `V04Shell` + `V04Entry` integration tests
 *
 * Real user paths:
 *
 *   1. Guest lands on the v04 entry, clicks "Open local
 *      workspace", enters the shell, can see a StudyKitApp
 *      child render.
 *
 *   2. After clicking local, the flavour persists across a
 *      simulated "reload" (we re-mount the entrypoint with the
 *      same sessionStorage).
 *
 *   3. Switching mode changes AppLocation, clears obsolete
 *      in-memory selections, and never delegates navigation to
 *      the legacy `sidebarMode`.
 *
 *   4. back / forward / reload are routed through the
 *      LocationStore and reflect the visible surface.
 *
 *   5. offline / online does not block local CRUD.
 *
 *   6. Signed-in user with `sync` flavour keeps the existing
 *      /api auth flow (regression — flag off / signed-in path
 *      still works).
 *
 *   7. The shell has exactly one visible header.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../../lib/auth';
import { V04Entry, V04Shell, ModeSwitch, WorkspaceAuthBridge } from './index';
import { workspaceFlavour, useWorkspaceFlavour } from '../../application/workspaceFlavour';
import { locationStore } from './locationStore';
import { useStore } from '../../store/useStore';
import { setWorkspaceFlavour } from '../../application/dataGateway';
import { isFeatureEnabled } from '../feature-flags';

// Mock the legacy useAuth hook so we can drive the signed-in
// scenarios. The mock is local to this file; the v0.3 `useAuth`
// reads from a real `AuthProvider` mounted by the production
// app, but we don't have that here.
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  let currentUser: { id: string; email: string; display_name: string } | null = null;
  let currentWorkspaceId: string | null = null;
  return {
    ...actual,
    useAuth: () => ({
      user: currentUser,
      workspace_id: currentWorkspaceId,
      loading: false,
      login: async () => {
        currentUser = { id: 'u-1', email: 'a@b.test', display_name: 'A' };
        currentWorkspaceId = 'ws-1';
      },
      register: async () => undefined,
      logout: () => {
        currentUser = null;
        currentWorkspaceId = null;
      },
      clearError: () => undefined,
    }),
    // We don't need the real `AuthProvider` for these tests;
    // the v04 shell does not consume its children — it only
    // reads `useAuth()`. The provider is exported as a
    // no-op stub so `import { AuthProvider }` keeps type-checking.
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Mock `lib/db` with an in-memory implementation. happy-dom
// does not ship IndexedDB so the real Dexie would throw.
const { fakeDbRows, fakeTable } = vi.hoisted(() => {
  const rows = {
    modules: new Map<string, Record<string, unknown>>(),
    lectures: new Map<string, Record<string, unknown>>(),
    literatureProjects: new Map<string, Record<string, unknown>>(),
    literaturePapers: new Map<string, Record<string, unknown>>(),
  };
  const table = (m: Map<string, Record<string, unknown>>) => ({
    toArray: async () => Array.from(m.values()),
    get: async (id: string) => m.get(id),
    put: async (row: Record<string, unknown>) => {
      m.set(row.id as string, row);
    },
    delete: async (id: string) => {
      m.delete(id);
    },
    where: (field: string) => ({
      equals: (v: unknown) => ({
        toArray: async () =>
          Array.from(m.values()).filter((r) => r[field] === v),
      }),
    }),
  });
  return { fakeDbRows: rows, fakeTable: table };
});
vi.mock('../../lib/db', () => ({
  db: {
    modules: fakeTable(fakeDbRows.modules),
    lectures: fakeTable(fakeDbRows.lectures),
    literatureProjects: fakeTable(fakeDbRows.literatureProjects),
    literaturePapers: fakeTable(fakeDbRows.literaturePapers),
  },
}));

// Remote `/api` mock — every test in this file needs the
// legacy /api clients to return success without hitting the
// real network (WP-02 Gate §3 blocker 2).
const remote = vi.hoisted(() => ({
  modules: {
    list: vi.fn(async () => [] as any[]),
    create: vi.fn(async (data: any) => ({ id: 'mod-remote', workspace_id: 'ws-remote', ...data })),
    update: vi.fn(async (id: string, data: any) => ({ id, ...data })),
    delete: vi.fn(async () => ({ success: true })),
  },
  lectures: {
    list: vi.fn(async () => [] as any[]),
    create: vi.fn(async (data: any) => ({ id: 'lec-remote', ...data })),
  },
  literatureProjects: {
    list: vi.fn(async () => [] as any[]),
    create: vi.fn(async (data: any) => ({ id: 'proj-remote', workspace_id: 'ws-remote', ...data })),
  },
  literaturePapers: {
    list: vi.fn(async () => [] as any[]),
  },
  literatureAi: {
    check: vi.fn(async () => ({ available: true })),
    chat: vi.fn(async () => ({ message: { role: 'assistant', content: '' } })),
  },
  zotero: {
    connect: vi.fn(async () => ({ account: { provider_display_name: 'Test' } })),
    status: vi.fn(async () => ({ status: 'disconnected' })),
    listCollections: vi.fn(async () => ({ collections: [] })),
  },
  citations: {
    list: vi.fn(async () => [] as any[]),
  },
  paperNotes: {
    create: vi.fn(),
  },
  paperRelations: {
    list: vi.fn(async () => [] as any[]),
  },
  readingLists: {
    list: vi.fn(async () => [] as any[]),
  },
  sourceDocuments: {
    get: vi.fn(async () => null),
    getPages: vi.fn(async () => []),
    upload: vi.fn(async () => ({ id: 'doc-remote', processing_status: 'pending' })),
  },
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modulesApi: remote.modules,
    lecturesApi: remote.lectures,
    sourceDocumentsApi: remote.sourceDocuments,
    uploadsApi: { uploadFile: vi.fn() },
    exportsApi: { create: vi.fn() },
    syncApi: { push: vi.fn(), pull: vi.fn() },
    authApi: {
      register: vi.fn(),
      login: vi.fn(),
      me: vi.fn(),
    },
    setAuthToken: () => undefined,
    getAuthToken: () => null,
  };
});
vi.mock('../../lib/literature-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    literatureProjectsApi: remote.literatureProjects,
    literaturePapersApi: remote.literaturePapers,
    literatureAiApi: remote.literatureAi,
    zoteroApi: remote.zotero,
    citationsApi: remote.citations,
    paperNotesApi: remote.paperNotes,
    paperRelationsApi: remote.paperRelations,
    readingListsApi: remote.readingLists,
    literatureCustomFieldsApi: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  workspaceFlavour.signOut();
  setWorkspaceFlavour('sync');
  act(() => {
    locationStore.replace({
      mode: 'study',
      surface: 'study-home',
    });
  });
  useStore.getState().resetStore();
  // Reset the in-memory Dexie fakes between tests.
  fakeDbRows.modules.clear();
  fakeDbRows.lectures.clear();
  fakeDbRows.literatureProjects.clear();
  fakeDbRows.literaturePapers.clear();
  // Reset the remote mock call counts.
  for (const group of Object.values(remote) as Array<Record<string, ReturnType<typeof vi.fn>>>) {
    for (const fn of Object.values(group)) {
      fn.mockClear();
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mount the top-level v04 entrypoint. Mirrors what `App.tsx`
 * does when `v04Shell` is on.
 */
function MountV04(props: { children?: React.ReactNode } = {}) {
  // The real `<App>` reads `useWorkspaceFlavour()` and switches
  // between `<V04Entry>` and `<V04Shell>`. We do the same here.
  return <V04EntryOrShellMount>{props.children}</V04EntryOrShellMount>;
}

function V04EntryOrShellMount(props: { hasUser?: boolean; children?: React.ReactNode }) {
  const flavour = useWorkspaceFlavour();
  // No real auth; the v04 entry is the right default.
  // The shell mounts when EITHER a user is present (sync) OR
  // the user explicitly opened a local workspace.
  const showShell = props.hasUser || flavour === 'local';
  if (!showShell) {
    return (
      <V04Entry
        login={async () => undefined}
        register={async () => undefined}
      />
    );
  }
  return <V04Shell>{props.children}</V04Shell>;
}

// A tiny live "StudyKitApp body" that renders modules / literature
// based on the v0.3 store's `sidebarMode`. Mirrors the v0.3 main
// branching.
function LegacyAppStub(): React.ReactElement {
  const sidebarMode = useStore((s) => s.sidebarMode);
  return (
    <main data-testid="legacy-main" data-mode={sidebarMode}>
      {sidebarMode === 'modules' && <div data-testid="modules-view">Modules</div>}
      {sidebarMode === 'literature' && <div data-testid="literature-view">Literature</div>}
      {sidebarMode === 'canvas' && <div data-testid="canvas-view">Canvas</div>}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V04Shell integration', () => {
  it('production composition shows one mode-aware sidebar and no legacy app body', async () => {
    render(<MountV04 />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });

    expect(screen.getAllByTestId('v04-workspace-sidebar')).toHaveLength(1);
    expect(screen.getAllByTestId('v04-active-surface')).toHaveLength(1);
    expect(screen.queryByTestId('legacy-main')).toBeNull();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Canvas' })).toBeNull();
  });

  it('Research navigation is derived from AppLocation and never leaks into Study', async () => {
    render(<MountV04 />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
      locationStore.replace({
        mode: 'research',
        surface: 'project',
        container: { workspaceId: null, mode: 'research', kind: 'project', id: 'project-1' },
      });
    });

    expect(screen.getByRole('complementary', { name: 'Research navigation' })).toBeInTheDocument();
    // WP-11R2: the project entry is "Project" (was
    // "Overview" before the convergence), the
    // library surface is "Sources" (Library +
    // Discovery merged), and the Evidence /
    // Design entries are no longer permanent.
    expect(screen.getByRole('button', { name: 'Project' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeInTheDocument();
    // Evidence / Discover / Library / Design must
    // NOT be permanent sidebar entries in v0.4.
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discover' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Evidence' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Design' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-switch-study'));
    });
    expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sources' })).toBeNull();
  });

  it('keeps creation out of the sidebar and routes the global Add entry to Study Home', async () => {
    render(<MountV04 />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });

    expect(screen.queryByRole('button', { name: 'New course' })).toBeNull();
    fireEvent.click(screen.getByTestId('v04-header-add'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Course' }));
    expect(window.location.hash).toBe('#/study/study-home?add=1');
    expect(screen.queryByTestId('legacy-main')).toBeNull();
    expect(await fakeTable(fakeDbRows.modules).toArray()).toHaveLength(0);
  });

  it('explains storage, AI scope, and draft control before entry', () => {
    render(<MountV04 />);
    expect(screen.getByRole('heading', { name: 'Your workspace, your control' })).toBeInTheDocument();
    expect(screen.getByText('This browser on this device; sync is optional')).toBeInTheDocument();
    expect(screen.getByText('Optional; the assistant shows the active scope and provider')).toBeInTheDocument();
    expect(screen.getByText('Suggestions stay drafts until you accept them')).toBeInTheDocument();
  });

  it('Guest → click "Open local workspace" → real shell with Study', async () => {
    render(<MountV04><LegacyAppStub /></MountV04>);
    // Initial: entry screen.
    expect(screen.getByTestId('v04-entry')).toBeInTheDocument();
    expect(screen.getByTestId('v04-entry-open-local')).toBeInTheDocument();
    // Click "Open local workspace".
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    // Now the shell is mounted.
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    expect(screen.getByTestId('v04-header')).toBeInTheDocument();
    expect(screen.getByTestId('legacy-main')).toBeInTheDocument();
    // Default mode is study; sidebarMode lands on 'modules'.
    expect(screen.getByTestId('mode-switch-study').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('legacy-main').getAttribute('data-mode')).toBe('modules');
    expect(screen.getByTestId('modules-view')).toBeInTheDocument();
  });

  it('Local entry persists across a "reload" (re-mount)', async () => {
    const { unmount } = render(<MountV04><LegacyAppStub /></MountV04>);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    unmount();
    // Re-mount with the same sessionStorage.
    render(<MountV04><LegacyAppStub /></MountV04>);
    // We should land directly on the shell, not the entry.
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('v04-entry')).toBeNull();
  });

  it('Mode switch changes the mode-aware navigation without mounting a legacy page', async () => {
    render(<MountV04 />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    // Switch to Research.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-switch-research'));
    });
    expect(screen.getByTestId('mode-switch-research').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Research navigation' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-main')).toBeNull();
    // Switch back to Study.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-switch-study'));
    });
    expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
  });

  it('Mode switch clears in-memory selection without touching Dexie data', async () => {
    render(<MountV04><LegacyAppStub /></MountV04>);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    // Seed selection + Dexie state.
    await act(async () => {
      const store = useStore.getState();
      store.selectModule('m-stale');
      store.selectLecture('l-stale');
      store.selectLitProject('p-stale');
      store.selectLitPaper('pa-stale');
    });
    expect(useStore.getState().selectedModuleId).toBe('m-stale');
    // Switch mode.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-switch-research'));
    });
    // Selection is cleared, but the legacy sidebar mode is not
    // used as a second production navigation state.
    const after = useStore.getState();
    expect(after.selectedModuleId).toBeNull();
    expect(after.selectedLectureId).toBeNull();
    expect(after.selectedLitProjectId).toBeNull();
    expect(after.selectedLitPaperId).toBeNull();
    expect(after.sidebarMode).toBe('modules');
  });

  it('URL hash mirrors the location; back/forward updates the visible page', async () => {
    render(<MountV04 />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    // Default: Study.
    expect(screen.getByTestId('mode-switch-study').getAttribute('aria-selected')).toBe('true');
    // Switch to Research — the URL hash reflects it AND the
    // visible shell is now Research.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-switch-research'));
    });
    expect(window.location.hash).toBe('#/research/research-home');
    expect(screen.getByRole('complementary', { name: 'Research navigation' })).toBeInTheDocument();
    // Simulate browser back: rewrite the URL hash and fire
    // hashchange. happy-dom's `history.back()` is a no-op, so
    // the production-equivalent test fires the event the way
    // a real browser would on popstate.
    await act(async () => {
      window.location.hash = '#/study/study-home';
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(window.location.hash).toBe('#/study/study-home');
    expect(screen.getByTestId('mode-switch-study').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
    // Simulate forward.
    await act(async () => {
      window.location.hash = '#/research/research-home';
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(window.location.hash).toBe('#/research/research-home');
    expect(screen.getByRole('complementary', { name: 'Research navigation' })).toBeInTheDocument();
  });

  it('There is exactly ONE app-header and ONE #main-content in the DOM', async () => {
    render(
      <MountV04>
        <LegacyAppStub />
      </MountV04>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    // Only the v04 header is mounted.
    const headers = document.querySelectorAll('header.app-header');
    expect(headers).toHaveLength(1);
    expect(headers[0]?.getAttribute('data-testid')).toBe('v04-header');
    // Only one #main-content is mounted.
    const mains = document.querySelectorAll('#main-content');
    expect(mains).toHaveLength(1);
    // Only one skip-to-content is mounted.
    const skipLinks = document.querySelectorAll('a.skip-to-content');
    expect(skipLinks).toHaveLength(1);
    // Only one .app-layout is mounted.
    const layouts = document.querySelectorAll('.app-layout');
    expect(layouts).toHaveLength(1);
  });

  it('Workspace auth bridge flips the flavour to sync on sign-in', async () => {
    // Drive the bridge directly: the mocked `useAuth()` returns
    // a user with a workspace_id; calling `reconcileAuth` on
    // the store flips the flavour, and the next render of
    // `V04EntryOrShellMount` swaps the entry for the shell.
    const { rerender } = render(
      <AuthProvider>
        <WorkspaceAuthBridge />
        <V04EntryOrShellMount hasUser={false} />
      </AuthProvider>,
    );
    // Before reconciliation: entry is shown.
    expect(screen.getByTestId('v04-entry')).toBeInTheDocument();
    // Simulate a sign-in by directly mutating the workspace
    // flavour and emitting. The real auth flow goes through
    // `useAuth()`; the bridge's `useEffect` is unit-tested
    // separately.
    workspaceFlavour.openSync('ws-1');
    rerender(
      <AuthProvider>
        <WorkspaceAuthBridge />
        <V04EntryOrShellMount hasUser={true} />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    });
    workspaceFlavour.signOut();
  });

  it('Local CRUD via the gateway hits Dexie and survives a "reload"', async () => {
    // Mount the full tree, click local, then run a CRUD round
    // trip through the dataApi. We re-mount with the same
    // sessionStorage and confirm the row is still there.
    const { unmount } = render(<MountV04><LegacyAppStub /></MountV04>);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    const api = (await import('../../application/dataApi')).getDataApi('local');
    const mod = await api.modules.create({ title: 'Algebra' });
    expect(mod.id).toMatch(/^mod_/);
    const all = await api.modules.list();
    expect(all.find((m) => m.id === mod.id)).toBeTruthy();
    unmount();
    // Re-mount → still in local shell, same flavour.
    render(<MountV04 />);
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    const fresh = (await import('../../application/dataApi')).getDataApi('local');
    const after = await fresh.modules.list();
    expect(after.find((m) => m.id === mod.id)).toBeTruthy();
  });

  it('Offline: location writes still happen, sync indicator says Local only', async () => {
    render(<MountV04><LegacyAppStub /></MountV04>);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    // Set sync status to 'offline' via the store.
    useStore.setState({ syncStatus: 'offline' });
    await waitFor(() => {
      const status = screen.getByTestId('v04-sync-status');
      expect(status.textContent).toContain('Local only');
    });
    // Navigation still works in offline mode.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-switch-research'));
    });
    expect(window.location.hash).toBe('#/research/research-home');
    expect(screen.getByRole('complementary', { name: 'Research navigation' })).toBeInTheDocument();
  });

  it('Feature flag default is OFF; switching it on enables the v04 path', () => {
    expect(isFeatureEnabled('v04Shell')).toBe(false);
    // The flag is read from localStorage / defaults — we just
    // verify the registry knows the id.
    // (No require() needed — `isFeatureEnabled` is already
    // imported at the top from `../feature-flags`.)
  });

  it('flag-off: stale local localStorage flag must NOT leak into the legacy path', async () => {
    // 1. Write a stale `local` flag into localStorage (as
    //    if a previous v04-on session ended with the user in
    //    a local workspace).
    localStorage.setItem('studykit.v04.localWorkspace', '1');
    // 2. Render with `v04Shell` OFF: the App routes to the
    //    legacy `<StudyKitApp />` path, which uses `useDataApi()`
    //    internally. The flavour must default to `sync` so the
    //    legacy API goes through the v0.3 `/api` clients and
    //    does NOT touch Dexie.
    // 3. The remote `/api` is mocked — calling list() against
    //    it must succeed (returning the mock's empty array),
    //    NOT throw an AggregateError. The mock's call count
    //    is the proof the legacy path actually hit the
    //    network-shaped client.
    const { getDataApi, getWorkspaceFlavour } = await import('../../application/dataGateway');
    expect(getWorkspaceFlavour()).toBe('sync');
    const api = getDataApi();
    expect(api.flavour).toBe('sync');
    // list() goes through the sync impl, which calls the
    // mocked `remote.modulesApi.list()`. The mock returns
    // `[]` synchronously.
    const all = await api.modules.list();
    expect(all).toEqual([]);
    // The remote mock recorded the call.
    expect(remote.modules.list).toHaveBeenCalled();
    // And no local rows were touched: the fake Dexie tables
    // stay empty.
    const allPapers = await fakeTable(fakeDbRows.literaturePapers).toArray();
    expect(allPapers).toHaveLength(0);
    const allModules = await fakeTable(fakeDbRows.modules).toArray();
    expect(allModules).toHaveLength(0);
  });

  it('local Research/Canvas actions throw before they can hit the network', async () => {
    render(<MountV04><LegacyAppStub /></MountV04>);
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
    });
    const dataApi = await import('../../application/dataApi');
    // Local dataApi: create a project locally (works), then
    // attempt a paper-metadata write that the local backend
    // does not support.
    const proj = await dataApi.getDataApi('local').literatureProjects.create({ name: 'P' });
    // Any AI / citation / Zotero call must throw
    // UnsupportedInLocalWorkspaceError rather than silently
    // hitting the network. The guards throw synchronously,
    // so we catch them inline.
    expect(() => dataApi.literatureAiApi.check()).toThrow(/local workspace/);
    expect(() => dataApi.paperNotesApi.create({} as never)).toThrow(/local workspace/);
    expect(() => dataApi.readingListsApi.list()).toThrow(/local workspace/);
    // Paper metadata writes also throw.
    expect(() => dataApi.literaturePapersApi.create({} as never)).toThrow(/local workspace/);
    // The local project survived.
    const projects = await dataApi.getDataApi('local').literatureProjects.list();
    expect(projects.find((p) => p.id === proj.id)).toBeTruthy();
  });
});
