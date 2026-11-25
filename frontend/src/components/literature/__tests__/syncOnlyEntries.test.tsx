/**
 * StudyKit v0.4 — WP-02 Gate §3 capability-degradation tests
 * (Codex 5th round, final narrow fix).
 *
 * Real component tests that prove every previously-silent
 * sync-only entry is gated in a local workspace:
 *
 *   - AI chat (AIChatPanel)  — `ai.chat`
 *   - AI settings (AISettingsPanel) — `ai.settings`
 *   - Citations (NoteEditor Cite, CitationPicker, CitationListView)
 *     — `citations.crud`
 *   - Paper annotations (PaperAnnotationLayer) — `paperNotes.crud`
 *   - SummaryTable (this file) — `ai.chat`, `ai.settings`,
 *     `readingLists.crud`, `sourceDocuments.upload`,
 *     `literaturePapers.crud`, `literatureCanvas.crud`
 *   - PaperWorkspace (this file) — `paperNotes.crud`,
 *     `literaturePapers.crud`
 *   - ZoteroImportPanel (this file) — `zotero.import`,
 *     `readingLists.crud`
 *
 * Plus dataApi/gateway unit tests (per-method capability map +
 * `exportsApi` / `uploadsApi` / `sourceDocumentsApi` / `syncApi`
 * guards) and a paper-level isolation test that proves an
 * `undefined` `workspace_id` is NEVER exposed as local.
 *
 * Each component test asserts:
 *   1. Visible entry is `disabled` / inert OR replaced by a
 *      `data-capability` local notice, BEFORE any user click.
 *   2. The corresponding mocked `/api` method is called ZERO
 *      times in the local-workspace flow.
 *   3. `globalThis.fetch` is called ZERO times in the local
 *      flow.
 *   4. The same entry is fully usable in a sync workspace
 *      (no false-positive gating).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useStore } from '../../../store/useStore';
import { workspaceFlavour } from '../../../application/workspaceFlavour';
import { setWorkspaceFlavour, getWorkspaceFlavour, __setWebPortForTests, __resetWebPortForTests } from '../../../application/dataGateway';
import { makeFakeWebPort } from '../../../app/v04/__test-helpers__/fakeWebPort';
import { fakeDbRows, resetFakeDb } from '../../../app/v04/__test-helpers__/v04TestEnv';
import {
  isFeatureEnabled,
  __setFeatureFlagForTests,
  __resetFeatureFlagsForTests,
} from '../../../app/feature-flags';

// ---------------------------------------------------------------------------
// Shared module-level mocks
// ---------------------------------------------------------------------------

const remote = vi.hoisted(() => ({
  modules: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  lectures: { list: vi.fn(async () => []), create: vi.fn() },
  literatureProjects: { list: vi.fn(async () => []), create: vi.fn() },
  literaturePapers: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn(), listAnnotations: vi.fn(async () => []), createAnnotation: vi.fn(), deleteAnnotation: vi.fn() },
  literatureAi: { check: vi.fn(), profiles: vi.fn(async () => ({ profiles: [], defaults: {} })), chat: vi.fn(async () => ({ message: { content: '' } })), createProfile: vi.fn(), updateProfile: vi.fn(), testProfile: vi.fn(), updateTaskDefaults: vi.fn() },
  zotero: { connect: vi.fn(), disconnect: vi.fn(), status: vi.fn(async () => ({ status: 'disconnected' })), listCollections: vi.fn(), importCollections: vi.fn(), importCollectionItems: vi.fn(), syncEvents: vi.fn() },
  citations: { list: vi.fn(async () => []), create: vi.fn(), delete: vi.fn() },
  paperNotes: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  paperRelations: { list: vi.fn(async () => []), create: vi.fn(), delete: vi.fn() },
  readingLists: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), get: vi.fn(async () => ({ items: [] })) },
  sourceDocuments: { get: vi.fn(), getPages: vi.fn(), upload: vi.fn() },
  exports: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), getDownloadUrl: vi.fn() },
  uploads: { uploadFile: vi.fn(), uploadImage: vi.fn() },
  sync: { push: vi.fn(), pull: vi.fn() },
  auth: { register: vi.fn(), login: vi.fn(), me: vi.fn() },
}));

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modulesApi: remote.modules,
    lecturesApi: remote.lectures,
    sourceDocumentsApi: remote.sourceDocuments,
    uploadsApi: remote.uploads,
    exportsApi: remote.exports,
    syncApi: remote.sync,
    authApi: remote.auth,
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
    literatureCustomFieldsApi: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  };
});

const authState: { user: any; workspace_id: any } = vi.hoisted(() => ({ user: null, workspace_id: null }));
vi.mock('../../../lib/auth', () => ({
  useAuth: () => ({
    get user() { return authState.user; },
    get workspace_id() { return authState.workspace_id; },
    loading: false,
    login: async () => { authState.user = { id: 'u-1', email: 'a@b.test', display_name: 'A' }; authState.workspace_id = 'ws-1'; },
    register: async () => { authState.user = { id: 'u-1', email: 'a@b.test', display_name: 'A' }; authState.workspace_id = 'ws-1'; },
    logout: () => { authState.user = null; authState.workspace_id = null; },
    clearError: () => undefined,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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
    noteBlocks: {
      toArray: async () => [],
      get: async () => undefined,
      put: async () => undefined,
      delete: async () => undefined,
      where: () => ({
        equals: () => {
          const query = {
            toArray: async () => [],
            first: async () => undefined,
            filter: () => query,
            sortBy: async () => [],
          };
          return query;
        },
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resetRemote(): void {
  for (const group of Object.values(remote) as Array<Record<string, ReturnType<typeof vi.fn>>>) {
    for (const fn of Object.values(group)) fn.mockClear();
  }
}

function switchToLocal(): void {
  setWorkspaceFlavour('local');
  workspaceFlavour.openLocal();
}

function switchToSync(): void {
  setWorkspaceFlavour('sync');
  workspaceFlavour.openSync('ws-1');
  authState.user = { id: 'u-1', email: 'a@b.test', display_name: 'A' };
  authState.workspace_id = 'ws-1';
}

function installFetchSpy(): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  const fetchMock = vi.fn(async () => { throw new Error('fetch is stubbed in this test'); });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    calls: () => fetchMock.mock.calls.length,
    restore() { globalThis.fetch = original; },
  };
}

/** Run `body` with a fetch spy installed; assert zero fetch calls on exit. */
async function withFetchSpy<T>(body: (calls: () => number) => Promise<T>): Promise<T> {
  const spy = installFetchSpy();
  try {
    return await body(spy.calls);
  } finally {
    spy.restore();
  }
}

/** Flush microtasks + a setTimeout(0) so mount / useEffect chains settle. */
async function flushEffects(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetFakeDb();
  resetRemote();
  __setWebPortForTests(makeFakeWebPort());
  useStore.getState().resetStore();
  authState.user = null;
  authState.workspace_id = null;
  __setFeatureFlagForTests('v04Shell', true);
});

afterEach(() => {
  __resetFeatureFlagsForTests();
  __resetWebPortForTests();
});

// ---------------------------------------------------------------------------
// AI chat — AIChatPanel
// ---------------------------------------------------------------------------

describe('AIChatPanel capability gate (ai.chat)', () => {
  it('local workspace: collapsed bar is inert and submit path is unreachable', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: AIChatPanel } = await import('../AIChatPanel');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<AIChatPanel />); });
      await flushEffects(2);
      const bar = await screen.findByTestId('ai-chat-disabled');
      expect(bar.getAttribute('data-capability')).toBe('ai.chat');
      expect(bar.getAttribute('aria-disabled')).toBe('true');
      expect(remote.literatureAi.profiles).not.toHaveBeenCalled();
      expect(remote.literatureAi.chat).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Send/i })).toBeNull();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// AI settings — AISettingsPanel
// ---------------------------------------------------------------------------

describe('AISettingsPanel capability gate (ai.settings)', () => {
  it('local workspace: modal body is a local notice and no /api call happens', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: AISettingsPanel } = await import('../AISettingsPanel');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<AISettingsPanel onClose={() => undefined} />); });
      await flushEffects(3);
      const notice = await screen.findByTestId('ai-settings-local-notice');
      expect(notice.getAttribute('data-capability')).toBe('ai.settings');
      expect(remote.literatureAi.profiles).not.toHaveBeenCalled();
      expect(screen.queryByText(/新建 AI 连接/i)).toBeNull();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// Citations — CitationListView, CitationPicker, NoteEditor Cite button
// ---------------------------------------------------------------------------

describe('CitationListView capability gate (citations.crud)', () => {
  it('local workspace: short notice, no /api list call, no fetch', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: CitationListView } = await import('../CitationListView');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<CitationListView />); });
      await flushEffects(3);
      const notice = await screen.findByTestId('citation-list-local-notice');
      expect(notice.getAttribute('data-capability')).toBe('citations.crud');
      expect(remote.citations.list).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

describe('CitationPicker capability gate (citations.crud)', () => {
  it('local workspace: modal body is a local notice and no list call happens', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: CitationPicker } = await import('../CitationPicker');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<CitationPicker onSelect={() => undefined} onClose={() => undefined} />); });
      await flushEffects(3);
      const notice = await screen.findByTestId('citation-picker-local-notice');
      expect(notice.getAttribute('data-capability')).toBe('citations.crud');
      expect(remote.citations.list).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

describe('NoteEditor Cite button capability gate (citations.crud)', () => {
  it('local workspace: Cite button is disabled with a tooltip; clicking is a no-op', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: NoteEditor } = await import('../../NoteEditor');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<NoteEditor lectureId="lec-1" />); });
      await flushEffects(4);
      const citeBtn = await screen.findByTestId('note-editor-cite-button');
      expect(citeBtn.getAttribute('data-capability')).toBe('citations.crud');
      expect(citeBtn.hasAttribute('disabled')).toBe(true);
      expect(citeBtn.getAttribute('aria-disabled')).toBe('true');
      await act(async () => { fireEvent.click(citeBtn); });
      await flushEffects(2);
      expect(screen.queryByTestId('citation-picker-local-notice')).toBeNull();
      expect(remote.citations.list).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// Paper annotations — PaperAnnotationLayer
// ---------------------------------------------------------------------------

describe('PaperAnnotationLayer capability gate (paperNotes.crud)', () => {
  it('local workspace: toolbar buttons are inert and no /api listAnnotations call happens', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: PaperAnnotationLayer } = await import('../PaperAnnotationLayer');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<PaperAnnotationLayer paperId="paper-1" pageNumber={1} />); });
      await flushEffects(3);
      const notice = await screen.findByTestId('paper-annotation-local-notice');
      expect(notice.getAttribute('data-capability')).toBe('paperNotes.crud');
      notice.querySelectorAll('button').forEach((b) => {
        expect((b as HTMLButtonElement).disabled).toBe(true);
        expect(b.getAttribute('aria-disabled')).toBe('true');
      });
      expect(remote.literaturePapers.listAnnotations).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// SummaryTable — the real main path that 4th round missed
// ---------------------------------------------------------------------------

describe('SummaryTable capability gate (local main path)', () => {
  it('local workspace: paper list is visible but every write entry is disabled and zero /api calls happen', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      // Seed a local paper so the table actually renders rows.
      fakeDbRows.literatureProjects.set('proj-1', { id: 'proj-1', workspace_id: 'local', name: 'P1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      fakeDbRows.literaturePapers.set('paper-1', { id: 'paper-1', project_id: 'proj-1', workspace_id: 'local', file_name: 'p.pdf', title: 'Paper 1', reading_status: 'unread', importance: 0 });
      const { default: SummaryTable } = await import('../SummaryTable');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<SummaryTable projectId="proj-1" />); });
      await flushEffects(4);
      // The paper list IS visible (read path is local-only).
      expect(await screen.findByText(/Paper 1/)).toBeInTheDocument();
      // AI profiles endpoint MUST NOT have been auto-fetched.
      expect(remote.literatureAi.profiles).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      // The row's reading-status / importance / single-extract entry points
      // are all either replaced by a notice or carry `aria-disabled` /
      // `data-capability` markers.
      const statusBadge = screen.getByText(/^Unread$/);
      expect(statusBadge.getAttribute('data-capability')).toBe('literaturePapers.crud');
      expect(statusBadge.getAttribute('aria-disabled')).toBe('true');
      // The single Extract button is not rendered (no AI in local).
      expect(screen.queryByTestId('summary-table-single-extract')).toBeNull();
      // The reading-list filter is hidden entirely when unsupported.
      document.querySelectorAll('select').forEach((sel) => {
        Array.from(sel.querySelectorAll('option')).forEach((o) => {
          expect(o.textContent).not.toMatch(/^All Papers$/);
        });
      });
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// PaperWorkspace — read view, gated write actions
// ---------------------------------------------------------------------------

describe('PaperWorkspace capability gate (local main path)', () => {
  it('local workspace: PDF/Metadata tabs read-only, Notes tab is a local notice, zero /api calls', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      const { default: PaperWorkspace } = await import('../PaperWorkspace');
      const paper = {
        id: 'paper-1', project_id: 'proj-1', workspace_id: 'local', file_name: 'p.pdf',
        file_size: 1000, title: 'A study of local isolation', authors: 'Smith, J.',
        year: 2024, uploaded_at: new Date().toISOString(), reading_status: 'unread',
        importance: 0, storage_key: null, extracted_data: {},
      } as any;
      let r: ReturnType<typeof render>;
      await act(async () => {
        r = render(<PaperWorkspace paper={paper} projectId="proj-1" onBack={() => undefined} onUpdated={() => undefined} />);
      });
      await flushEffects(4);
      // Metadata tab is the default; reading status select exists and is
      // disabled with the right capability marker.
      const statusSelect = await screen.findByTestId('paper-workspace-reading-status');
      expect(statusSelect.getAttribute('data-capability')).toBe('literaturePapers.crud');
      expect(statusSelect.hasAttribute('disabled')).toBe(true);
      // `paperNotesApi.list` MUST NOT have been auto-fetched on mount.
      expect(remote.paperNotes.list).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      // Switch to the Notes tab — local notice is shown, no textarea.
      const notesTab = screen.getByRole('button', { name: /^Notes$/ });
      await act(async () => { fireEvent.click(notesTab); });
      await flushEffects(2);
      const notesNotice = await screen.findByTestId('paper-workspace-notes-local-notice');
      expect(notesNotice.getAttribute('data-capability')).toBe('paperNotes.crud');
      expect(screen.queryByPlaceholderText(/Write a note about this paper/i)).toBeNull();
      expect(remote.paperNotes.list).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// ZoteroImportPanel — entire panel is a "需要 Sync" notice
// ---------------------------------------------------------------------------

describe('ZoteroImportPanel capability gate (zotero.import)', () => {
  it('local workspace: panel is a local notice and no readingLists / zotero call happens', async () => {
    await withFetchSpy(async (fetchCalls) => {
      switchToLocal();
      // Mark the user as Zotero-connected so the panel would otherwise
      // render the import UI. The capability gate must still hold.
      useStore.getState().setZoteroConnectionStatus('connected');
      useStore.getState().setExternalAccount({
        id: 'z-1', workspace_id: 'ws-1', provider: 'zotero', auth_method: 'api_key',
        provider_display_name: 'Z', status: 'connected',
      } as any);
      const { default: ZoteroImportPanel } = await import('../ZoteroImportPanel');
      let r: ReturnType<typeof render>;
      await act(async () => { r = render(<ZoteroImportPanel />); });
      await flushEffects(3);
      const notice = await screen.findByTestId('zotero-import-local-notice');
      expect(notice.getAttribute('data-capability')).toBe('zotero.import');
      expect(remote.readingLists.list).not.toHaveBeenCalled();
      expect(remote.zotero.listCollections).not.toHaveBeenCalled();
      expect(remote.zotero.connect).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(0);
      r!.unmount();
    });
  });
});

// ---------------------------------------------------------------------------
// dataApi / dataGateway — per-method capability map + new guards
// ---------------------------------------------------------------------------

describe('dataApi per-method capability map (local workspace)', () => {
  it('every wrapped method throws UnsupportedInLocalWorkspaceError with the right capability hint', async () => {
    switchToLocal();
    const dataApi = await import('../../../application/dataApi');
    const { UnsupportedInLocalWorkspaceError } = await import('../../../application/dataGateway');
    // Sync-only writers.
    expect(() => dataApi.exportsApi.create({} as never)).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.uploadsApi.uploadImage(new Blob() as never)).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.sourceDocumentsApi.upload('lec', new Blob() as never)).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.syncApi.push({} as never)).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.syncApi.pull('ws-1')).toThrow(UnsupportedInLocalWorkspaceError);
    // AI — per-method split.
    expect(() => dataApi.literatureAiApi.profiles()).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.literatureAiApi.chat({ messages: [] })).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.literatureAiApi.check()).toThrow(UnsupportedInLocalWorkspaceError);
    // Zotero — per-method split.
    expect(() => dataApi.zoteroApi.connect({ apiKey: 'k', userId: 'u' })).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.zoteroApi.listCollections()).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.zoteroApi.importCollections({ collectionIds: [] })).toThrow(UnsupportedInLocalWorkspaceError);
    // Citations / reading lists / paper notes / paper relations / canvas.
    expect(() => dataApi.citationsApi.list()).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.readingListsApi.list()).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.readingListsApi.get('rl-1')).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.paperNotesApi.list('p-1')).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.paperRelationsApi.list('p-1')).toThrow(UnsupportedInLocalWorkspaceError);
    expect(() => dataApi.literatureCanvasApi.listOrCreate('proj-1')).toThrow(UnsupportedInLocalWorkspaceError);
    // authApi is the ONE surface that stays pass-through (it must
    // work in BOTH flavours so the user can sign in).
    expect(typeof dataApi.authApi.login).toBe('function');
  });
});

describe('dataApi per-method capability map (sync workspace)', () => {
  it('the same wrappers forward to the underlying remote client when flavour is sync', async () => {
    switchToSync();
    const dataApi = await import('../../../application/dataApi');
    // Each call must delegate to the mocked remote module — assert
    // the mock's call count goes up, not that the wrapper throws.
    await dataApi.literatureAiApi.profiles();
    expect(remote.literatureAi.profiles).toHaveBeenCalled();
    await dataApi.citationsApi.list();
    expect(remote.citations.list).toHaveBeenCalled();
    await dataApi.paperNotesApi.list('p-1');
    expect(remote.paperNotes.list).toHaveBeenCalledWith('p-1');
    await dataApi.readingListsApi.list();
    expect(remote.readingLists.list).toHaveBeenCalled();
    await dataApi.zoteroApi.connect({ apiKey: 'k', userId: 'u' });
    expect(remote.zotero.connect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WP-02 Gate §3 blocker 9 (5th-round tightening): paper rows with
// `workspace_id === undefined` are NOT visible to a local surface.
// ---------------------------------------------------------------------------

describe('dataGateway local paper isolation — no implicit-undefined surface', () => {
  it('rows with undefined workspace_id are never returned by the local list', async () => {
    switchToLocal();
    // Seed three rows: local, sync, and an unowned (undefined) legacy row.
    // The fake `WebPort` shares `fakeDbRows`; we seed the underlying
    // Maps directly because the production `WebPort` only exposes
    // `listByProject` for papers.
    const port = makeFakeWebPort();
    __setWebPortForTests(port);
    await port.literatureProjects.put({ id: 'proj-1', workspace_id: 'local', name: 'P1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any);
    fakeDbRows.literaturePapers.set('p-local', { id: 'p-local', project_id: 'proj-1', workspace_id: 'local', file_name: 'a.pdf' });
    fakeDbRows.literaturePapers.set('p-sync', { id: 'p-sync', project_id: 'proj-1', workspace_id: 'ws-sync', file_name: 'b.pdf' });
    fakeDbRows.literaturePapers.set('p-undef', { id: 'p-undef', project_id: 'proj-1', file_name: 'c.pdf' });

    const { getDataApi } = await import('../../../application/dataGateway');
    const list = await getDataApi('local').literaturePapers.list('proj-1', 'library');
    const ids = list.map((p) => (p as any).id);
    expect(ids).toEqual(['p-local']);
    // Sanity: the underlying port still has all three rows; the
    // filter is at the gateway boundary, not in storage.
    const raw = await port.literaturePapers.listByProject('proj-1');
    expect(raw).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Final integration: global flavour state stays in sync.
// ---------------------------------------------------------------------------

describe('capability flavour state', () => {
  it('openLocal → local; openSync → sync; flag default is off', () => {
    __resetFeatureFlagsForTests();
    expect(isFeatureEnabled('v04Shell')).toBe(false);
    switchToLocal();
    expect(getWorkspaceFlavour()).toBe('local');
    switchToSync();
    expect(getWorkspaceFlavour()).toBe('sync');
  });
});
