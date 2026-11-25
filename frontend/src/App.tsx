import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './lib/auth';
import { useStore } from './store/useStore';
import { isFeatureEnabled } from './app/feature-flags';
import { useDataApi } from './application/useDataApi';
import { sourceDocumentsApi } from './application/dataApi';
import { workspaceFlavour } from './application/workspaceFlavour';
import { V04Shell, V04Entry } from './app/v04/V04Shell';
import { WorkspaceAuthBridge } from './app/v04/workspaceStore';
import { useWorkspaceFlavour } from './application/workspaceFlavour';
import { useDesktopWorkspace } from './app/v04/desktopWorkspaceContext';
import { useLocation } from './app/v04/locationStore';
import { AiKernelWiring } from './app/v04/aiKernelWiring';
import { isDesktopRuntime } from './platforms/runtime';
import { SidebarIcon, LiteratureIcon, ReadingListIcon } from './components/ui/Icons';
import { LogoMarkWithWordmark } from './components/ui/Logo';
import { ThemeSwitcher } from './app/ThemeSwitcher';
import SidebarContent from './components/SidebarContent';
import { Button } from './shared/ui/Button';
import { Input } from './shared/ui/Input';
import type { Module, Lecture, SourceDocument, SourcePage, NoteBlock } from './types';
import { useStudyDepsOptional } from './features/study/studyContext';

// WP-11: feature code is loaded only when its surface is visible. This keeps
// PDF, rich-text, literature, canvas, and export dependencies off startup.
const LectureCaptureTrigger = React.lazy(() =>
  import('./components/LectureCaptureTrigger').then((module) => ({
    default: module.LectureCaptureTrigger,
  })),
);
const LiteratureCanvas = React.lazy(() => import('./components/literature/canvas/LiteratureCanvas'));
const PDFViewer = React.lazy(() => import('./components/PDFViewer'));
const NoteEditor = React.lazy(() => import('./components/NoteEditor'));
const AnnotationLayer = React.lazy(() => import('./components/AnnotationLayer'));
const AnnotationPanel = React.lazy(() => import('./components/CornellPanel'));
const ExportDialog = React.lazy(() => import('./components/ExportDialog'));
const SummaryTable = React.lazy(() => import('./components/literature/SummaryTable'));
const ReadingListsView = React.lazy(() => import('./components/literature/ReadingListsView'));
const PaperWorkspace = React.lazy(() => import('./components/literature/PaperWorkspace'));

const SURFACE_LOADING_FALLBACK = (
  <div className="empty-state" role="status" aria-live="polite">
    Loading workspace…
  </div>
);

// ===== Auth Page =====
function AuthPage() {
  const { login, register, loading, error, clearError } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, displayName || undefined);
      }
    } catch (err: any) {
      setLocalError(err.message);
    }
  };

  const displayError = localError || error;

  return (
    <div className="auth-container">
      <div className="auth-card glass-dialog">
        <div className="auth-card-header">
          <h1>StudyKit</h1>
          <ThemeSwitcher size="compact" />
        </div>
        <p>{isLogin ? 'Welcome back' : 'Create your account'}</p>

        {displayError && <div className="error-message">{displayError}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.ac.uk"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
            />
          </div>
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="displayName">Display Name (optional)</label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
              />
            </div>
          )}
          <Button type="submit" variant="primary" fullWidth disabled={loading} style={{ marginTop: '0.5rem' }}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </Button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setIsLogin(!isLogin); setLocalError(null); clearError(); }}
            style={{ fontSize: '0.85rem', textDecoration: 'underline' }}
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </Button>
        </p>
      </div>
    </div>
  );
}

// ===== Main App =====
export default function App() {
  const { user, loading: authLoading, login, register } = useAuth();
  const v04 = isFeatureEnabled('v04Shell');

  // Rehydrate the persisted workspace flavour from localStorage
  // when the v04 shell is on. When the flag is off, the
  // workspace flavour stays at its default ('sync') so a stale
  // `local` flag from a previous v04-on session cannot leak
  // into the legacy path (WP-02 Gate §1).
  React.useEffect(() => {
    if (v04 && !isDesktopRuntime()) {
      workspaceFlavour.rehydrate();
    }
  }, [v04]);

  if (authLoading) {
    return (
      <div className="auth-container">
        <p>Loading...</p>
      </div>
    );
  }

  // v0.4 Local-first App Shell (flag on): the workspace flavour
  // decides which surface the user sees. The `<WorkspaceAuthBridge>`
  // keeps the flavour in sync with the v0.3 `useAuth()` snapshot.
  // `<AiKernelWiring>` registers the four WP-03 safe actions
  // (navigate / search-local / create-free-note-draft /
  // explain-selected-text) exactly when the `v04Assistant`
  // feature flag is on; when the flag is off the effect is a
  // no-op and the kernel is fully torn down, so the v0.3 /
  // WP-02 surface tree is byte-for-byte unaffected.
  if (v04) {
    return (
      <>
        <WorkspaceAuthBridge />
        <AiKernelWiring />
        <V04EntryOrShell hasUser={Boolean(user)} login={login} register={register} renderLegacyAuth={() => <AuthPage />} />
      </>
    );
  }

  // Legacy v0.3 path. Identical to the pre-WP-02 behaviour: a
  // sign-in wall for guests, the legacy `<StudyKitApp>` for
  // signed-in users.
  if (!user) {
    return <AuthPage />;
  }
  return <StudyKitApp />;
}

/**
 * Tiny router that picks between the v0.4 workspace entry and
 * the v0.4 shell based on the *current* workspace flavour. The
 * flavour is the result of: the `WorkspaceAuthBridge` having
 * reconciled against `useAuth()`; any prior `openLocal()` call
 * having persisted the `local` flag in sessionStorage.
 */
function V04EntryOrShell(props: {
  hasUser: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, display_name?: string) => Promise<void>;
  renderLegacyAuth: () => React.ReactNode;
}): React.ReactElement {
  const flavour = useWorkspaceFlavour();
  const desktopWorkspace = useDesktopWorkspace();
  const location = useLocation();
  if (desktopWorkspace.enabled && desktopWorkspace.state.kind !== 'ready') {
    return (
      <V04Entry
        login={props.login}
        register={props.register}
        renderLegacyAuth={props.renderLegacyAuth}
      />
    );
  }
  // No user AND no local-entered flag → show the entry. With
  // user OR with local flag → show the shell.
  if (!props.hasUser && flavour !== 'local') {
    return (
      <V04Entry
        login={props.login}
        register={props.register}
        renderLegacyAuth={props.renderLegacyAuth}
      />
    );
  }
  return (
    <V04Shell>
      {location.mode === 'study' && location.surface === 'lecture'
        ? <StudyKitAppContent mode="embedded" />
        : null}
    </V04Shell>
  );
}

function StudyKitApp() {
  return <StudyKitAppContent mode="standalone" />;
}

export type StudyKitAppMode = 'standalone' | 'embedded';

export function StudyKitAppContent(props: { mode: StudyKitAppMode }) {
  const studyDeps = useStudyDepsOptional();
  const isEmbedded = props.mode === 'embedded';

  const STORAGE_KEY = 'studykit-sidebar-width';
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved ? Math.max(180, Math.min(600, parseInt(saved, 10))) : 280;
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const sidebarResizeStart = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setSidebarResizing(true);
    sidebarResizeStart.current = { startX: e.clientX, startWidth: sidebarWidthRef.current };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!sidebarResizeStart.current) return;
      const diff = ev.clientX - sidebarResizeStart.current.startX;
      const newWidth = Math.max(180, Math.min(600, sidebarResizeStart.current.startWidth + diff));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setSidebarResizing(false);
      sidebarResizeStart.current = null;
      localStorage.setItem(STORAGE_KEY, String(sidebarWidthRef.current));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const {
    modules, setModules, addModule, selectedModuleId, selectModule,
    lectures, setLectures, addLecture, selectedLectureId, selectLecture,
    sidebarOpen, toggleSidebar, currentLayout, syncStatus, cornellMode,
    currentDocument, setCurrentDocument, currentPages, setCurrentPages,
    selectedPageIndex, selectPage,
    sidebarMode, litProjects, selectedLitProjectId, selectedLitPaperId, selectLitPaper, litPapers, setLitPapers,
    activeLiteratureTab, setActiveLiteratureTab,
  } = useStore();

  const { user, workspace_id: authWorkspaceId, logout } = useAuth();
  const setWorkspaceId = useStore((s) => s.setWorkspaceId);
  const dataApi = useDataApi();
  const [showNewModule, setShowNewModule] = useState(false);
  const [showNewLecture, setShowNewLecture] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newLectureTitle, setNewLectureTitle] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [nativeSourceBlob, setNativeSourceBlob] = useState<Blob | null>(null);

  useEffect(() => {
    const bridge = studyDeps?.sourceAssets;
    const assetId = currentDocument?.storage_key;
    let cancelled = false;
    if (!bridge || !assetId) {
      setNativeSourceBlob(null);
      return;
    }
    void bridge.getBlob(assetId).then((blob) => {
      if (!cancelled) setNativeSourceBlob(blob);
    }).catch(() => {
      if (!cancelled) setNativeSourceBlob(null);
    });
    return () => {
      cancelled = true;
    };
  }, [studyDeps?.sourceAssets, currentDocument?.storage_key]);

  // Sync workspace_id from auth context to Zustand store
  useEffect(() => {
    if (authWorkspaceId) {
      setWorkspaceId(authWorkspaceId);
    }
  }, [authWorkspaceId, setWorkspaceId]);

  // Load modules on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dataApi.modules.list().then(setModules).catch(console.error);
  }, []);

  // Load lectures when module selected. All reads go through
  // the dataApi gateway (WP-02 Gate §3 blocker 8). There is no
  // Dexie fallback here: in `local` flavour the gateway *is* the
  // local port, and in `sync` flavour the gateway hits the v0.3
  // `/api` backend. The previous double-read (gateway + raw
  // `db.lectures.where(...)`) could leak non-local rows into a
  // local context and silently bypass the flag-off legacy path.
  useEffect(() => {
    if (selectedModuleId) {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      dataApi.lectures.list(selectedModuleId).then(setLectures).catch(console.error);
    } else {
      setLectures([]);
    }
  }, [selectedModuleId]);

  // Load document + pages when lecture selected
  useEffect(() => {
    if (!selectedLectureId) {
      setCurrentDocument(null);
      setCurrentPages([]);
      return;
    }
    const lecture = lectures.find((l) => l.id === selectedLectureId);
    if (lecture?.active_source_document_id) {
      sourceDocumentsApi.get(lecture.active_source_document_id)
        .then((document) => setCurrentDocument(document ?? null))
        .catch(() => {});
      sourceDocumentsApi.getPages(lecture.active_source_document_id)
        .then(setCurrentPages)
        .catch(() => {});
    }
  }, [selectedLectureId, lectures]);

  const handleCreateModule = async () => {
    if (!newModuleTitle.trim()) return;
    try {
      const mod = await dataApi.modules.create({ title: newModuleTitle.trim() });
      addModule(mod);
      setNewModuleTitle('');
      setShowNewModule(false);
      selectModule(mod.id);
    } catch (err) {
      console.error('Failed to create module', err);
    }
  };

  const handleCreateLecture = async () => {
    if (!newLectureTitle.trim() || !selectedModuleId) return;
    try {
      const lecture = await dataApi.lectures.create({
        module_id: selectedModuleId,
        title: newLectureTitle.trim(),
      });
      addLecture(lecture);
      setNewLectureTitle('');
      setShowNewLecture(false);
      selectLecture(lecture.id);
    } catch (err) {
      console.error('Failed to create lecture', err);
    }
  };

  const handleDeleteModule = async (id: string) => {
    try {
      await dataApi.modules.delete(id);
      // Reload modules
      dataApi.modules.list().then(setModules).catch(console.error);
    } catch (err) {
      console.error('Failed to delete module', err);
    }
  };

  const selectedModule = modules.find((m) => m.id === selectedModuleId);
  const selectedLecture = lectures.find((l) => l.id === selectedLectureId);

  // The chrome (header / skip link / outer `.app-layout`) only
  // exists in standalone mode. In `embedded` mode the v04 shell
  // owns the chrome, so we render only the body (sidebar + main).
  // The inner `<main id="main-content">` is also gone in embedded
  // mode — the v04 `<main id="main-content">` is the only one in
  // the DOM, so there is exactly one `#main-content` and exactly
  // one `.app-layout` regardless of mode.
  const chromeNode = !isEmbedded ? (
    <>
      {/* Skip-to-content link for keyboard users */}
      <a href="#main-content" className="skip-to-content">
        Skip to content
      </a>

      {/* Live region for screen reader status announcements */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
        {syncStatus === 'synced' ? 'Notes saved' : syncStatus === 'error' ? 'Save error' : ''}
      </div>

      {/* Header (standalone mode only) */}
      <header className="app-header glass-header">
        <button className="btn btn-ghost btn-icon" onClick={toggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar">
          <SidebarIcon size="lg" />
        </button>
        <div className="logo"><LogoMarkWithWordmark size="md" /></div>
        <div className="spacer" />
        <div className="header-right">
          <ThemeSwitcher size="compact" />
          <div className="sync-indicator" role="status" aria-label={`Save status: ${syncStatus}`}>
            <span className={`dot ${syncStatus}`} />
            <span>{syncStatus === 'synced' ? 'Saved' : syncStatus === 'pending' ? 'Saving...' : syncStatus === 'error' ? 'Error' : 'Offline'}</span>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => setShowExport(true)}
            disabled={sidebarMode !== 'modules' || !selectedLecture}
            title={sidebarMode !== 'modules'
              ? 'Switch to Modules and pick a lecture to export'
              : !selectedLecture
                ? 'Select a lecture to export'
                : 'Export this lecture'}
          >
            Export
          </button>
          <span className="text-sm text-muted">{user?.display_name || user?.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>
    </>
  ) : null;

  const bodyNode = (
    <div className="app-body">
      {/* Sidebar */}
      <aside className={`sidebar glass-sidebar ${sidebarOpen ? '' : 'closed'} ${sidebarResizing ? 'resizing' : ''}`} aria-label="Module navigation" style={{ width: sidebarOpen ? sidebarWidth : 0 }}>
        <SidebarContent
          onShowNewModule={() => setShowNewModule(true)}
          onShowNewLecture={() => setShowNewLecture(true)}
        />
        {sidebarOpen && (
          <div
            className={`sidebar-resize-handle ${sidebarResizing ? 'active' : ''}`}
            onMouseDown={handleSidebarResizeStart}
          />
        )}

        {/* New module form (outside SidebarContent for simplicity) */}
        {showNewModule && (
          <div style={{ padding: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
            <input
              autoFocus
              placeholder="Module name"
              value={newModuleTitle}
              onChange={(e) => setNewModuleTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateModule()}
              style={{ width: '100%', padding: '0.375rem 0.5rem', fontSize: '0.85rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)', marginBottom: '0.375rem' }}
            />
            <div className="flex gap-1">
              <button className="btn btn-primary btn-sm" onClick={handleCreateModule}>Create</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewModule(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* New lecture form */}
        {showNewLecture && selectedModuleId && (
          <div className="lecture-list" style={{ padding: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
            <input
              autoFocus
              placeholder="Lecture title"
              value={newLectureTitle}
              onChange={(e) => setNewLectureTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateLecture()}
              style={{ width: '100%', padding: '0.375rem 0.5rem', fontSize: '0.85rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)', marginBottom: '0.375rem' }}
            />
            <div className="flex gap-1">
              <button className="btn btn-primary btn-sm" onClick={handleCreateLecture}>Create</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewLecture(false)}>Cancel</button>
            </div>
          </div>
        )}
      </aside>

      {/* Main content — fully branched on sidebarMode so each mode only
          ever shows its own content, never stale lecture context.
          In `embedded` mode the v04 shell owns `#main-content`; the
          legacy body uses `<section>` so the DOM has exactly one
          `<main id="main-content">` and zero `display: contents` /
          hidden-header hacks. */}
      {isEmbedded ? (
        <section
          className={`main-content main-content-embedded ${sidebarMode}`}
          data-testid="legacy-main"
          data-mode={sidebarMode}
        >
          <React.Suspense fallback={SURFACE_LOADING_FALLBACK}>{renderMainBody()}</React.Suspense>
        </section>
      ) : (
        <main id="main-content" className={`main-content ${sidebarMode}`} data-testid="legacy-main" data-mode={sidebarMode}>
          <React.Suspense fallback={SURFACE_LOADING_FALLBACK}>{renderMainBody()}</React.Suspense>
        </main>
      )}
    </div>
  );

  // Standalone mode wraps the chrome + body in the legacy
  // `.app-layout` div. Embedded mode renders *only* the body
  // (the v04 shell wraps it in its own `.app-layout v04-shell`).
  const mainContent = isEmbedded ? (
    <>{bodyNode}</>
  ) : (
    <div className="app-layout" data-testid="legacy-app-layout">
      {chromeNode}
      {bodyNode}
      {showExport && selectedLecture && (
        <React.Suspense fallback={null}>
          <ExportDialog
            lecture={selectedLecture}
            module={selectedModule}
            onClose={() => setShowExport(false)}
          />
        </React.Suspense>
      )}
    </div>
  );

  return (
    <>
      {mainContent}
      {isEmbedded && showExport && selectedLecture && (
        <React.Suspense fallback={null}>
          <ExportDialog
            lecture={selectedLecture}
            module={selectedModule}
            onClose={() => setShowExport(false)}
          />
        </React.Suspense>
      )}
    </>
  );

  // ---- renderMainBody: extracted so both the `<main>` (standalone)
  // and the `<section>` (embedded) variants share the same content
  // tree. The function is defined inline at the end of the component
  // via a closure over the local hooks state.
  function renderMainBody(): React.ReactElement {
    if (sidebarMode === 'canvas') {
      if (selectedLitProjectId) {
        return (
          <div className="literature-canvas-host">
            <LiteratureCanvas projectId={selectedLitProjectId} />
          </div>
        );
      }
      return (
        <div className="empty-state">
          <h2>Research Canvas</h2>
          <p>
            Pick or create a literature project in the sidebar to start a
            freeform AI research canvas for its papers.
          </p>
        </div>
      );
    }
    if (sidebarMode === 'literature') {
      if (selectedLitProjectId) {
        return (
          <div className="literature-shell">
            {/* Literature tab bar */}
            <div className="literature-top-tabs">
              {(['papers', 'readingLists'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveLiteratureTab(tab)}
                  style={{
                    padding: '0.6rem 1rem',
                    border: 'none',
                    borderBottom: activeLiteratureTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
                    marginBottom: -2,
                    background: 'transparent',
                    color: activeLiteratureTab === tab ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontWeight: activeLiteratureTab === tab ? 600 : 400,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {tab === 'papers' ? <><LiteratureIcon size="sm" /> Papers</> : <><ReadingListIcon size="sm" /> Reading Lists</>}
                </button>
              ))}
            </div>
            {selectedLitPaperId ? (
              (() => {
                const paper = litPapers.find(p => p.id === selectedLitPaperId);
                return paper ? (
                  <PaperWorkspace
                    paper={paper}
                    projectId={selectedLitProjectId}
                    onBack={() => selectLitPaper(null)}
                    onUpdated={() => dataApi.literaturePapers.list(selectedLitProjectId, 'library').then(setLitPapers)}
                  />
                ) : null;
              })()
            ) : (
              <>
                {activeLiteratureTab === 'papers' && <SummaryTable projectId={selectedLitProjectId} />}
                {activeLiteratureTab === 'readingLists' && <ReadingListsView />}
              </>
            )}
          </div>
        );
      }
      return (
        <div className="empty-state">
          <h2>Literature Library</h2>
          <p>
            Create a literature project to collect papers, build reading lists,
            and visualize how they reference each other.
          </p>
          <p className="text-sm text-muted" style={{ marginTop: '0.5rem' }}>
            Use <strong>New Project</strong> in the sidebar to get started,
            or import from Zotero on the left.
          </p>
        </div>
      );
    }
    // modules / default
    if (selectedLecture) {
      return (
        <LectureView
          lecture={selectedLecture}
          document={currentDocument}
          pages={currentPages}
          currentPageIndex={selectedPageIndex}
          courseId={selectedModuleId ?? ''}
          sourceBlob={nativeSourceBlob}
        />
      );
    }
    return (
      <div className="empty-state">
        <h2>Welcome to StudyKit</h2>
        <p>
          Create a module and lecture to get started. Upload your lecture slides,
          then take structured notes beside them.
        </p>
        {modules.length === 0 && (
          <button className="btn btn-primary" onClick={() => setShowNewModule(true)}>
            Create your first module
          </button>
        )}
      </div>
    );
  }
}

// ===== Resize Handle Component =====
function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      if (Math.abs(delta) < 1) return;
      startX.current = e.clientX;
      onResize(delta);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    const onMouseDown = (e: Event) => {
      const me = e as MouseEvent;
      me.preventDefault();
      isDragging.current = true;
      startX.current = me.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
    return () => el.removeEventListener('mousedown', onMouseDown);
  }, [onResize]);

  return <div ref={handleRef} className="resize-handle" />;
}

// ===== Lecture View =====
function LectureView({
  lecture,
  document: doc,
  pages,
  currentPageIndex,
  courseId,
  sourceBlob,
}: {
  lecture: Lecture;
  document: SourceDocument | null;
  pages: SourcePage[];
  currentPageIndex: number;
  courseId: string;
  sourceBlob?: Blob | null;
}) {
  const { currentLayout, cornellMode, selectPage, setCurrentPages, setCurrentDocument,
    activeLectureTab, setActiveLectureTab, selectedLitProjectId } = useStore();
  const [uploading, setUploading] = useState(false);
  const [slidePanelWidth, setSlidePanelWidth] = useState<number | null>(null);
  const [annotationPanelWidth, setAnnotationPanelWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSlideResize = useCallback((delta: number) => {
    setSlidePanelWidth((prev) => {
      const current = prev ?? 50;
      return Math.max(20, Math.min(80, current + delta * 0.15));
    });
  }, []);

  const handleAnnotationResize = useCallback((delta: number) => {
    setAnnotationPanelWidth((prev) => {
      const current = prev ?? 260;
      return Math.max(160, current - delta);
    });
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await sourceDocumentsApi.upload(lecture.id, file);
      setCurrentDocument(result);
      // Poll for processing to complete
      const poll = setInterval(async () => {
        try {
          const updated = await sourceDocumentsApi.get(result.id);
          if (!updated) return;
          if (updated.processing_status === 'ready' || updated.processing_status === 'failed') {
            clearInterval(poll);
            setCurrentDocument(updated);
            const pgs = await sourceDocumentsApi.getPages(result.id);
            setCurrentPages(pgs);
          }
        } catch {}
      }, 1000);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  // No slides uploaded yet, or processing failed
  if (!doc || doc.processing_status === 'pending' || doc.processing_status === 'processing' || doc.processing_status === 'failed') {
    return (
      <div className="empty-state">
        <h2>{lecture.title}</h2>
        <p>
          {doc?.processing_status === 'failed'
            ? 'Failed to process slides. The PDF file may be corrupt or unreadable. Try uploading again.'
            : doc?.processing_status === 'processing'
              ? 'Processing slides...'
              : 'Upload a PDF of your lecture slides to get started.'}
        </p>
        <div style={{ marginTop: '1rem' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            {uploading ? 'Uploading...' : doc ? 'Re-upload PDF' : 'Upload PDF Slides'}
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
              disabled={uploading}
            />
          </label>
        </div>
      </div>
    );
  }

  const currentPage = pages[currentPageIndex];

  const slideStyle = currentLayout === 'slide_left_notes_right' && slidePanelWidth
    ? { flex: `0 0 ${slidePanelWidth}%`, maxWidth: `${slidePanelWidth}%` }
    : {};

  const annotationStyle = annotationPanelWidth
    ? { width: annotationPanelWidth }
    : {};

  return (
    <div
      ref={containerRef}
      className={`lecture-view slide-${currentLayout === 'slide_left_notes_right' ? 'left-notes-right' : 'top-notes-below'}${cornellMode ? ' with-cornell' : ''}`}
    >
      {/* Slide panel */}
      <div className="slide-panel" style={slideStyle}>
        <PDFViewer
          document={doc}
          pages={pages}
          currentPageIndex={currentPageIndex}
          onPageChange={(index) => {
            const page = pages[index];
            if (page) selectPage(page.id, index);
          }}
          annotationOverlay={currentPage ? <AnnotationLayer page={currentPage} /> : undefined}
          sourceBlob={sourceBlob}
        />
      </div>

      {/* Resize handle: slide ↔ notes */}
      <ResizeHandle onResize={handleSlideResize} />

      {/* Note panel - continuous per lecture */}
      <div className="note-panel">
        <div className="note-panel-header">
          <div className="note-panel-tabs">
            <div
              className={`note-panel-tab glass-tab ${activeLectureTab === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveLectureTab('notes')}
            >Notes</div>
            <div
              className={`note-panel-tab glass-tab ${activeLectureTab === 'citations' ? 'active' : ''}`}
              onClick={() => setActiveLectureTab('citations')}
            >Citations</div>
          </div>
          {activeLectureTab === 'notes' && (
          <div className="flex gap-1">
            <button
              className={`btn btn-ghost btn-sm ${currentLayout === 'slide_top_notes_below' ? 'active' : ''}`}
              onClick={() => useStore.getState().setCurrentLayout(
                currentLayout === 'slide_left_notes_right'
                  ? 'slide_top_notes_below'
                  : 'slide_left_notes_right',
              )}
              title={currentLayout === 'slide_left_notes_right'
                ? 'Switch to slides on top, notes below'
                : 'Switch to slides on left, notes on right'}
              aria-pressed={currentLayout === 'slide_top_notes_below'}
              style={currentLayout === 'slide_top_notes_below' ? { color: 'var(--color-primary)', fontWeight: 600 } : {}}
            >
              {currentLayout === 'slide_left_notes_right' ? '⬆ Stacked' : '⬅ Side-by-side'}
            </button>
            <button
              className={`btn btn-ghost btn-sm ${cornellMode ? 'active' : ''}`}
              onClick={() => useStore.getState().setCornellMode(!cornellMode)}
              style={cornellMode ? { color: 'var(--color-primary)', fontWeight: 600 } : {}}
            >
              Annotation
            </button>
          </div>
          )}
        </div>
        <div className="note-editor-container">
          {activeLectureTab === 'notes' ? (
            <NoteEditor lectureId={lecture.id} />
          ) : (
            selectedLitProjectId ? (
              <SummaryTable projectId={selectedLitProjectId} />
            ) : (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <p>Select a literature project from the sidebar to view papers.</p>
              </div>
            )
          )}
        </div>
      </div>

      {/* Resize handle: notes ↔ annotation */}
      {cornellMode && <ResizeHandle onResize={handleAnnotationResize} />}

      {/* Annotation panel - margin annotations linked to note positions */}
      {cornellMode && (
        <div style={annotationStyle}>
          <AnnotationPanel lectureId={lecture.id} />
        </div>
      )}

      {/* WP-04 Study capture trigger: a single floating
          "Capture / Understand" button that opens the
          UnderstandDrawer. The trigger returns `null` when
          the `v04Study` flag is off, so the v0.3 lecture
          surface is byte-for-byte unchanged on the default
          build. The trigger is the *only* place the WP-04
          Study slice touches the v0.3 main body. */}
      <LectureCaptureTrigger
        courseId={courseId}
        lectureId={lecture.id}
      />
    </div>
  );
}
