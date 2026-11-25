/**
 * StudyKit v0.4 — Shared test helpers for the v04 shell suite.
 *
 * Centralises the in-memory Dexie fake, the signed-in auth
 * state, the remote `/api` call record, and the per-test
 * setup so the individual test files do not duplicate wiring
 * (WP-02 Gate §3 blocker 10).
 *
 * Note: `vi.hoisted` and `vi.mock` cannot be exported from
 * this module — Vitest only hoists them when they appear at
 * the top of the *test file*. The test files therefore call
 * `installRemoteApiMock()` at module scope; the underlying
 * `remoteApiCalls` record is hoisted there.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import React from 'react';
import { workspaceFlavour } from '../../../application/workspaceFlavour';
import { setWorkspaceFlavour, __resetWebPortForTests } from '../../../application/dataGateway';
import { locationStore } from '../locationStore';
import { useStore } from '../../../store/useStore';
import { __setFeatureFlagForTests, __resetFeatureFlagsForTests } from '../../feature-flags';

// ---------------------------------------------------------------------------
// Fake Dexie tables (in-memory)
// ---------------------------------------------------------------------------

export interface FakeTable<T> {
  toArray: () => Promise<T[]>;
  get: (id: string) => Promise<T | undefined>;
  put: (row: T) => Promise<void>;
  delete: (id: string) => Promise<void>;
  where: (field: string) => { equals: (v: unknown) => { toArray: () => Promise<T[]>; first: () => Promise<T | undefined> } };
}

export function makeFakeTable<T extends { id: string }>(initial?: Map<string, T>): FakeTable<T> {
  const rows = initial ?? new Map<string, T>();
  return {
    toArray: async () => Array.from(rows.values()),
    get: async (id) => rows.get(id),
    put: async (row) => {
      rows.set(row.id, row);
    },
    delete: async (id) => {
      rows.delete(id);
    },
    where: (field: string) => ({
      equals: (v: unknown) => ({
        toArray: async () =>
          Array.from(rows.values()).filter(
            (r) => (r as unknown as Record<string, unknown>)[field] === v,
          ),
        first: async () =>
          Array.from(rows.values()).find(
            (r) => (r as unknown as Record<string, unknown>)[field] === v,
          ),
      }),
    }),
  };
}

export interface FakeDbRows {
  modules: Map<string, Record<string, unknown>>;
  lectures: Map<string, Record<string, unknown>>;
  literatureProjects: Map<string, Record<string, unknown>>;
  literaturePapers: Map<string, Record<string, unknown>>;
}

export const fakeDbRows: FakeDbRows = {
  modules: new Map<string, Record<string, unknown>>(),
  lectures: new Map<string, Record<string, unknown>>(),
  literatureProjects: new Map<string, Record<string, unknown>>(),
  literaturePapers: new Map<string, Record<string, unknown>>(),
};

export function resetFakeDb(): void {
  fakeDbRows.modules.clear();
  fakeDbRows.lectures.clear();
  fakeDbRows.literatureProjects.clear();
  fakeDbRows.literaturePapers.clear();
}

// ---------------------------------------------------------------------------
// Switchable auth state
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
}

export interface AuthState {
  user: AuthUser | null;
  workspace_id: string | null;
}

export const authState: AuthState = { user: null, workspace_id: null };

export function signIn(user: Partial<AuthUser> = {}): void {
  authState.user = {
    id: user.id ?? 'u-1',
    email: user.email ?? 'a@b.test',
    display_name: user.display_name ?? 'A',
  };
  authState.workspace_id = 'ws-1';
}

export function signOut(): void {
  authState.user = null;
  authState.workspace_id = null;
}

/**
 * Factory for the `vi.mock('../../../lib/auth', ...)` call.
 * The test file calls `vi.mock` directly at the top of the
 * file so Vitest can hoist it; this helper just produces the
 * factory closure.
 */
export function authMockFactory() {
  return async (importOriginal: () => Promise<unknown>) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      useAuth: () => ({
        get user() {
          return authState.user;
        },
        get workspace_id() {
          return authState.workspace_id;
        },
        loading: false,
        login: async (_email: string, _password: string) => {
          signIn();
        },
        register: async () => {
          signIn();
        },
        logout: () => {
          signOut();
        },
        clearError: () => undefined,
      }),
      AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
  };
}

/**
 * Factory for the `vi.mock('../../../lib/db', ...)` call.
 * Returns the in-memory fake tables that share the test
 * env's `fakeDbRows` Maps.
 */
export function dbMockFactory() {
  return () => ({
    db: {
      modules: makeFakeTable(fakeDbRows.modules as unknown as Map<string, { id: string }>),
      lectures: makeFakeTable(fakeDbRows.lectures as unknown as Map<string, { id: string }>),
      literatureProjects: makeFakeTable(fakeDbRows.literatureProjects as unknown as Map<string, { id: string }>),
      literaturePapers: makeFakeTable(fakeDbRows.literaturePapers as unknown as Map<string, { id: string }>),
    },
  });
}

// ---------------------------------------------------------------------------
// Remote `/api` mock — call record for assertions
// ---------------------------------------------------------------------------

export interface RemoteApiCalls {
  modules: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  lectures: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  literatureProjects: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  literaturePapers: { list: ReturnType<typeof vi.fn> };
  literatureAi: { check: ReturnType<typeof vi.fn>; chat: ReturnType<typeof vi.fn> };
  zotero: { connect: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; listCollections: ReturnType<typeof vi.fn> };
  citations: { list: ReturnType<typeof vi.fn> };
  paperNotes: { create: ReturnType<typeof vi.fn> };
  paperRelations: { list: ReturnType<typeof vi.fn> };
  readingLists: { list: ReturnType<typeof vi.fn> };
  sourceDocuments: { get: ReturnType<typeof vi.fn>; getPages: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> };
}

export function makeRemoteApiCalls(): RemoteApiCalls {
  return {
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
  };
}

export function resetRemoteApiCalls(calls: RemoteApiCalls): void {
  for (const group of Object.values(calls) as Array<Record<string, ReturnType<typeof vi.fn>>>) {
    for (const fn of Object.values(group)) {
      fn.mockClear();
    }
  }
}

export function totalRemoteApiCalls(calls: RemoteApiCalls): number {
  let n = 0;
  for (const group of Object.values(calls) as Array<Record<string, ReturnType<typeof vi.fn>>>) {
    for (const fn of Object.values(group)) {
      n += fn.mock.calls.length;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// vi.mock factories (called at top of test files)
// ---------------------------------------------------------------------------

export function apiModulesFactory(calls: RemoteApiCalls) {
  return async (importOriginal: () => Promise<unknown>) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      modulesApi: calls.modules,
      lecturesApi: calls.lectures,
      sourceDocumentsApi: calls.sourceDocuments,
      uploadsApi: { uploadFile: vi.fn() },
      exportsApi: { create: vi.fn() },
      syncApi: { push: vi.fn(), pull: vi.fn() },
      authApi: {
        register: vi.fn(async () => ({ user: { id: 'u-1', email: 'a@b.test', display_name: 'A' }, token: 't', workspace_id: 'ws-1' })),
        login: vi.fn(async () => ({ user: { id: 'u-1', email: 'a@b.test', display_name: 'A' }, token: 't', workspace_id: 'ws-1' })),
        me: vi.fn(async () => ({ user: authState.user })),
      },
      setAuthToken: (_token: string | null) => undefined,
      getAuthToken: () => null,
    };
  };
}

export function literatureApiFactory(calls: RemoteApiCalls) {
  return async (importOriginal: () => Promise<unknown>) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      literatureProjectsApi: calls.literatureProjects,
      literaturePapersApi: calls.literaturePapers,
      literatureAiApi: calls.literatureAi,
      zoteroApi: calls.zotero,
      citationsApi: calls.citations,
      paperNotesApi: calls.paperNotes,
      paperRelationsApi: calls.paperRelations,
      readingListsApi: calls.readingLists,
      literatureCustomFieldsApi: {
        list: vi.fn(async () => []),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Standard per-test setup / teardown
// ---------------------------------------------------------------------------

export interface StandardSetupOptions {
  flagV04Shell?: boolean;
}

export function useStandardSetup(opts: StandardSetupOptions = {}): void {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetFakeDb();
    setWorkspaceFlavour('sync');
    workspaceFlavour.signOut();
    signOut();
    useStore.getState().resetStore();
    act(() => {
      locationStore.replace({
        mode: 'study',
        surface: 'study-home',
      });
    });
    __setFeatureFlagForTests('v04Shell', opts.flagV04Shell ?? false);
  });
  afterEach(() => {
    __resetFeatureFlagsForTests();
    __resetWebPortForTests();
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });
}

export async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
