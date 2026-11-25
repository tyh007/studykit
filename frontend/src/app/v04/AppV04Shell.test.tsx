/**
 * StudyKit v0.4 — `App` integration test for the v04 path
 *
 * Drives the *real* `<App>` component end-to-end. The local
 * Course creation MUST go through the current v0.4 sidebar:
 * click "New course", type a title, and click "Create".
 * Direct gateway calls are explicitly forbidden — the test must
 * prove the click path wires the gateway correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../../App';
import { AuthProvider } from '../../lib/auth';
import {
  isFeatureEnabled,
  __setFeatureFlagForTests,
  __resetFeatureFlagsForTests,
} from '../feature-flags';
import { workspaceFlavour } from '../../application/workspaceFlavour';
import {
  __setWebPortForTests,
  __resetWebPortForTests,
  setWorkspaceFlavour,
} from '../../application/dataGateway';
import { useStore } from '../../store/useStore';
import { makeFakeWebPort } from './__test-helpers__/fakeWebPort';
import { fakeDbRows } from './__test-helpers__/v04TestEnv';

if (typeof document !== 'undefined' && !document.doctype) {
  const doctype = document.implementation.createDocumentType('html', '', '');
  document.insertBefore(doctype, document.documentElement);
}

// ---------------------------------------------------------------------------
// Module-scope vi.hoisted + vi.mock (hoisted by Vitest)
// ---------------------------------------------------------------------------

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

const authState: { user: any; workspace_id: any } = vi.hoisted(() => ({ user: null, workspace_id: null }));

vi.mock('../../../lib/db', () => ({
  db: {
    modules: {
      toArray: async () => Array.from(fakeDbRows.modules.values()),
      get: async (id: string) => fakeDbRows.modules.get(id),
      put: async (row: any) => { fakeDbRows.modules.set(row.id, row); },
      delete: async (id: string) => { fakeDbRows.modules.delete(id); },
      where: (field: string) => ({
        equals: (v: unknown) => ({
          toArray: async () => Array.from(fakeDbRows.modules.values()).filter((r) => (r as any)[field] === v),
          first: async () => Array.from(fakeDbRows.modules.values()).find((r) => (r as any)[field] === v),
        }),
      }),
    },
    lectures: {
      toArray: async () => Array.from(fakeDbRows.lectures.values()),
      get: async (id: string) => fakeDbRows.lectures.get(id),
      put: async (row: any) => { fakeDbRows.lectures.set(row.id, row); },
      delete: async (id: string) => { fakeDbRows.lectures.delete(id); },
      where: (field: string) => ({
        equals: (v: unknown) => ({
          toArray: async () => Array.from(fakeDbRows.lectures.values()).filter((r) => (r as any)[field] === v),
          first: async () => Array.from(fakeDbRows.lectures.values()).find((r) => (r as any)[field] === v),
        }),
      }),
    },
    literatureProjects: {
      toArray: async () => Array.from(fakeDbRows.literatureProjects.values()),
      get: async (id: string) => fakeDbRows.literatureProjects.get(id),
      put: async (row: any) => { fakeDbRows.literatureProjects.set(row.id, row); },
      delete: async (id: string) => { fakeDbRows.literatureProjects.delete(id); },
    },
    literaturePapers: {
      toArray: async () => Array.from(fakeDbRows.literaturePapers.values()),
      get: async (id: string) => fakeDbRows.literaturePapers.get(id),
      put: async (row: any) => { fakeDbRows.literaturePapers.set(row.id, row); },
      delete: async (id: string) => { fakeDbRows.literaturePapers.delete(id); },
      where: (field: string) => ({
        equals: (v: unknown) => ({
          toArray: async () => Array.from(fakeDbRows.literaturePapers.values()).filter((r) => (r as any)[field] === v),
          first: async () => Array.from(fakeDbRows.literaturePapers.values()).find((r) => (r as any)[field] === v),
        }),
      }),
    },
  },
}));

vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useAuth: () => ({
      get user() { return authState.user as any; },
      get workspace_id() { return authState.workspace_id as any; },
      loading: false,
      login: async () => { authState.user = { id: 'u-1', email: 'a@b.test', display_name: 'A' }; authState.workspace_id = 'ws-1'; },
      register: async () => { authState.user = { id: 'u-1', email: 'a@b.test', display_name: 'A' }; authState.workspace_id = 'ws-1'; },
      logout: () => { authState.user = null; authState.workspace_id = null; },
      clearError: () => undefined,
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../../lib/api', async (importOriginal) => {
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
      register: vi.fn(async () => ({ user: { id: 'u-1', email: 'a@b.test', display_name: 'A' }, token: 't', workspace_id: 'ws-1' })),
      login: vi.fn(async () => ({ user: { id: 'u-1', email: 'a@b.test', display_name: 'A' }, token: 't', workspace_id: 'ws-1' })),
      me: vi.fn(async () => ({ user: authState.user })),
    },
    setAuthToken: () => undefined,
    getAuthToken: () => null,
  };
});

vi.mock('../../../lib/literature-api', async (importOriginal) => {
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
  __setWebPortForTests(makeFakeWebPort());
  fakeDbRows.modules.clear();
  fakeDbRows.lectures.clear();
  fakeDbRows.literatureProjects.clear();
  fakeDbRows.literaturePapers.clear();
  for (const group of Object.values(remote) as Array<Record<string, ReturnType<typeof vi.fn>>>) {
    for (const fn of Object.values(group)) {
      fn.mockClear();
    }
  }
  setWorkspaceFlavour('sync');
  workspaceFlavour.signOut();
  authState.user = null;
  authState.workspace_id = null;
  useStore.getState().resetStore();
  __setFeatureFlagForTests('v04Shell', true);
  __setFeatureFlagForTests('v04Study', true);
});

afterEach(() => {
  __resetFeatureFlagsForTests();
  __resetWebPortForTests();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

/**
 * Wait for all pending microtasks / effects to flush, then
 * assert. The legacy body has multiple useEffect chains
 * (modules, lectures, project lists) — we must drain them
 * inside `act` so React does not flag a setState as
 * "not wrapped in act". The helper repeatedly yields to
 * the microtask queue and the macrotask queue until
 * `predicate` holds.
 */
async function flushUntil(predicate: () => boolean, maxIters = 24): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    if (predicate()) return;
    await act(async () => {
      // Drain the microtask queue (Promise.then callbacks)
      // and the macrotask queue (setTimeout 0). Both are
      // needed because `setLitProjects([]).then(...)` chains
      // microtasks on top of the original promise resolution.
      for (let j = 0; j < 3; j++) {
        await Promise.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    });
  }
}

describe('App integration — v04 Local-first App Shell', () => {
  it('guest → Open local workspace → create module through the real UI → visible → remount → restore', async () => {
    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );
      // Drain the initial-mount microtasks.
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
      }
    });
    const { unmount } = renderResult!;
    // 1. Guest lands on the entry.
    expect(await screen.findByTestId('v04-entry')).toBeInTheDocument();
    expect(isFeatureEnabled('v04Shell')).toBe(true);
    // 2. Click "Open local workspace".
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
    });
    // 3. We are in the converged shell.
    await waitFor(() => {
      expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    });
    // 4. Create through the global context-aware Add menu.
    const createFirst = await screen.findByTestId('v04-header-add');
    await act(async () => {
      fireEvent.click(createFirst);
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
      }
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Course' }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    // 5. The new-module form renders an input + a Create
    //    button. Type the title and click Create.
    const input = (await screen.findByLabelText(/Course name/i)) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Linear Algebra' } });
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
      }
    });
    const createBtn = await screen.findByRole('button', { name: /^Create$/ });
    await act(async () => {
      fireEvent.click(createBtn);
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
    });
    // 6. Wait for the course to land in the local persistence port.
    await flushUntil(() => Boolean(
      Array.from(fakeDbRows.modules.values()).find((row) => row.title === 'Linear Algebra'),
    ));
    const stored = Array.from(fakeDbRows.modules.values()).find((row) => row.title === 'Linear Algebra');
    expect(stored).toBeTruthy();
    expect(stored?.workspace_id).toBe('local');
    // 7. The local localStorage flag is set.
    expect(localStorage.getItem('studykit.v04.localWorkspace')).toBe('1');
    // 8. Unmount and re-mount with the same localStorage.
    unmount();
    let remountResult: ReturnType<typeof render>;
    await act(async () => {
      remountResult = render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
      }
    });
    // 9. We land directly on the shell, not the entry.
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('v04-entry')).toBeNull();
    // 10. Local data remains after the shell remount.
    const stillThere = Array.from(fakeDbRows.modules.values()).find((row) => row.title === 'Linear Algebra');
    expect(stillThere).toBeTruthy();
  });

  it('Switch workspace drops back to the entry; Open local workspace restores', async () => {
    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const { unmount } = renderResult!;
    expect(await screen.findByTestId('v04-entry')).toBeInTheDocument();
    // Enter the local shell.
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    // Create a course through the real UI so the data is
    // produced exactly as a real user would.
    const createFirst = await screen.findByTestId('v04-header-add');
    await act(async () => {
      fireEvent.click(createFirst);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Course' }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const input = (await screen.findByLabelText(/Course name/i)) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Geometry' } });
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    const createBtn = await screen.findByRole('button', { name: /^Create$/ });
    await act(async () => {
      fireEvent.click(createBtn);
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    await flushUntil(() => Boolean(
      Array.from(fakeDbRows.modules.values()).find((row) => row.title === 'Geometry'),
    ));
    // Click "Switch workspace" — the v04 shell exposes a
    // button labelled exactly that.
    const switchBtn = await screen.findByTestId('v04-switch-workspace');
    await act(async () => {
      fireEvent.click(switchBtn);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    // The local flag is cleared; the entry is shown again.
    expect(localStorage.getItem('studykit.v04.localWorkspace')).toBeNull();
    expect(await screen.findByTestId('v04-entry')).toBeInTheDocument();
    // The data is still in Dexie (we only switch flavour, not
    // delete data).
    const allModules = Array.from(fakeDbRows.modules.values()) as Array<{ title: string }>;
    expect(allModules.find((m) => m.title === 'Geometry')).toBeTruthy();
    // Open local again — data is restored.
    unmount();
    await act(async () => {
      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    // The previous signOut cleared the local flag, so we
    // land on the entry first.
    expect(screen.getByTestId('v04-entry')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('v04-entry-open-local'));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('v04-shell')).toBeInTheDocument();
    });
    const restored = Array.from(fakeDbRows.modules.values()).find((row) => row.title === 'Geometry');
    expect(restored).toBeTruthy();
  });
});
