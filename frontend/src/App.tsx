import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './lib/auth';
import { useStore } from './store/useStore';
import { modulesApi, lecturesApi, sourceDocumentsApi } from './lib/api';
import { db } from './lib/db';
import PDFViewer from './components/PDFViewer';
import NoteEditor from './components/NoteEditor';
import AnnotationLayer from './components/AnnotationLayer';
import AnnotationPanel from './components/CornellPanel';
import ExportDialog from './components/ExportDialog';
import SidebarContent from './components/SidebarContent';
import type { Module, Lecture, SourceDocument, SourcePage, NoteBlock } from './types';

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
      <div className="auth-card">
        <h1>StudyKit</h1>
        <p>{isLogin ? 'Welcome back' : 'Create your account'}</p>

        {displayError && <div className="error-message">{displayError}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
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
            <input
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
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setIsLogin(!isLogin); setLocalError(null); clearError(); }}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

// ===== Main App =====
export default function App() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="auth-container">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return <StudyKitApp />;
}

function StudyKitApp() {
  const {
    modules, setModules, addModule, selectedModuleId, selectModule,
    lectures, setLectures, addLecture, selectedLectureId, selectLecture,
    sidebarOpen, toggleSidebar, currentLayout, syncStatus, cornellMode,
    currentDocument, setCurrentDocument, currentPages, setCurrentPages,
    selectedPageIndex, selectPage,
  } = useStore();

  const { user, workspace_id: authWorkspaceId, logout } = useAuth();
  const setWorkspaceId = useStore((s) => s.setWorkspaceId);
  const [showNewModule, setShowNewModule] = useState(false);
  const [showNewLecture, setShowNewLecture] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newLectureTitle, setNewLectureTitle] = useState('');
  const [showExport, setShowExport] = useState(false);

  // Sync workspace_id from auth context to Zustand store
  useEffect(() => {
    if (authWorkspaceId) {
      setWorkspaceId(authWorkspaceId);
    }
  }, [authWorkspaceId, setWorkspaceId]);

  // Load modules on mount
  useEffect(() => {
    modulesApi.list().then(setModules).catch(console.error);
  }, []);

  // Load lectures when module selected
  useEffect(() => {
    if (selectedModuleId) {
      lecturesApi.list(selectedModuleId).then(setLectures).catch(console.error);
      // Also try from Dexie
      db.lectures.where('module_id').equals(selectedModuleId).toArray()
        .then((cached) => { if (cached.length > 0) setLectures(cached); })
        .catch(() => {});
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
        .then(setCurrentDocument)
        .catch(() => {});
      sourceDocumentsApi.getPages(lecture.active_source_document_id)
        .then(setCurrentPages)
        .catch(() => {});
    }
  }, [selectedLectureId, lectures]);

  const handleCreateModule = async () => {
    if (!newModuleTitle.trim()) return;
    try {
      const mod = await modulesApi.create({ title: newModuleTitle.trim() });
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
      const lecture = await lecturesApi.create({
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
      await modulesApi.delete(id);
      // Reload modules
      modulesApi.list().then(setModules).catch(console.error);
    } catch (err) {
      console.error('Failed to delete module', err);
    }
  };

  const selectedModule = modules.find((m) => m.id === selectedModuleId);
  const selectedLecture = lectures.find((l) => l.id === selectedLectureId);

  return (
    <div className="app-layout">
      {/* Skip-to-content link for keyboard users */}
      <a href="#main-content" className="skip-to-content">
        Skip to content
      </a>

      {/* Live region for screen reader status announcements */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
        {syncStatus === 'synced' ? 'Notes saved' : syncStatus === 'error' ? 'Save error' : ''}
      </div>

      {/* Header */}
      <header className="app-header">
        <button className="btn btn-ghost btn-icon" onClick={toggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar">
          ☰
        </button>
        <div className="logo">StudyKit</div>
        <div className="spacer" />
        <div className="header-right">
          <div className="sync-indicator" role="status" aria-label={`Save status: ${syncStatus}`}>
            <span className={`dot ${syncStatus}`} />
            <span>{syncStatus === 'synced' ? 'Saved' : syncStatus === 'pending' ? 'Saving...' : syncStatus === 'error' ? 'Error' : 'Offline'}</span>
          </div>
          <button className="btn btn-sm" onClick={() => setShowExport(true)} disabled={!selectedLecture}>
            Export
          </button>
          <span className="text-sm text-muted">{user?.display_name || user?.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        <aside className={`sidebar ${sidebarOpen ? '' : 'closed'}`} aria-label="Module navigation">
          <SidebarContent
            onShowNewModule={() => setShowNewModule(true)}
            onShowNewLecture={() => setShowNewLecture(true)}
          />

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

        {/* Main content */}
        <main id="main-content" className={`main-content ${!selectedLecture ? 'empty' : ''}`}>
          {!selectedLecture ? (
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
          ) : (
            <LectureView
              lecture={selectedLecture}
              document={currentDocument}
              pages={currentPages}
              currentPageIndex={selectedPageIndex}
            />
          )}
        </main>
      </div>

      {/* Export dialog */}
      {showExport && selectedLecture && (
        <ExportDialog
          lecture={selectedLecture}
          module={selectedModule}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
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
}: {
  lecture: Lecture;
  document: SourceDocument | null;
  pages: SourcePage[];
  currentPageIndex: number;
}) {
  const { currentLayout, cornellMode, selectPage, setCurrentPages, setCurrentDocument } = useStore();
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
        />
      </div>

      {/* Resize handle: slide ↔ notes */}
      <ResizeHandle onResize={handleSlideResize} />

      {/* Note panel - continuous per lecture */}
      <div className="note-panel">
        <div className="note-panel-header">
          <h3>Notes</h3>
          <div className="flex gap-1">
            <button
              className={`btn btn-ghost btn-sm ${cornellMode ? 'active' : ''}`}
              onClick={() => useStore.getState().setCornellMode(!cornellMode)}
              style={cornellMode ? { color: 'var(--color-primary)', fontWeight: 600 } : {}}
            >
              Annotation
            </button>
          </div>
        </div>
        <div className="note-editor-container">
          <NoteEditor lectureId={lecture.id} />
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
    </div>
  );
}
