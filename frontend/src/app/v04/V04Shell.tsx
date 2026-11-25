/**
 * StudyKit v0.4 — `V04Shell` (converged)
 *
 * The single production shell. One header, one mode-aware sidebar,
 * and one active surface selected by AppLocation.
 *
 * Structure:
 *
 *   <V04Shell>
 *     <header>           ← global workspace controls
 *     <aside>            ← Study or Research navigation
 *     <active-surface>   ← exactly one v0.4 router surface
 *   </V04Shell>
 *
 * The v0.3 body is mounted only as a narrow compatibility leaf for
 * Study Lecture Focus. AppLocation remains the production navigation
 * source of truth; legacy `sidebarMode` does not drive this shell.
 *
 * Workspace Entry (`<V04Entry>`) is a sibling component that
 * hosts the no-account / no-signed-in-user path. The top-level
 * `<App>` picks one of the two based on `useWorkspaceFlavour()`
 * and `useAuth()`.
 */

import React from 'react';
import { useAuth } from '../../lib/auth';
import { useStore } from '../../store/useStore';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { LogoMarkWithWordmark } from '../../components/ui/Logo';
import { ModeSwitch } from './ModeSwitch';
import { workspaceFlavour, useWorkspaceFlavour } from '../../application/workspaceFlavour';
import { locationStore, useLocation } from './locationStore';
import { makeAppLocation } from '../../domain/workspace';
import { IntentCapsuleProvider } from '../../features/ai/ui/IntentCapsuleProvider';
import { openCapsule } from '../../features/ai/ui/openCapsule';
import { isFeatureEnabled } from '../feature-flags';
import { StudyWiring } from './studyWiring';
import { CollaborationWiring } from './collaborationWiring';
import { StudyRouter } from './studyRouter';
import { ResearchWiring } from './researchWiring';
import { ResearchRouter } from './researchRouter';
import { CanvasUseCasesProvider } from './canvasWiringContext';
import { useDesktopWorkspace } from './desktopWorkspaceContext';
import { QuickCapturePanel } from './QuickCapturePanel';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { HeaderAskButton } from './HeaderAskButton';
import { HeaderAddMenu } from './HeaderAddMenu';
import { listen } from '@tauri-apps/api/event';
import './v04.css';

// ---------------------------------------------------------------------------
// Workspace Entry (no account)
// ---------------------------------------------------------------------------

export interface V04EntryProps {
  /**
   * The v0.3 login/register hooks. We pass them through so the
   * entry is the *only* place that knows about auth; the
   * sign-in form lives in `WorkspaceEntryAuthForm` below.
   */
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, display_name?: string) => Promise<void>;
  /**
   * Render the legacy v0.3 `<AuthPage>` for users who prefer it.
   * Shown in a collapsed `<details>` so the v04 entry is the
   * default but we don't have to delete the legacy flow.
   * Optional — when omitted the v04 entry is the only sign-in
   * surface.
   */
  renderLegacyAuth?: () => React.ReactNode;
}

export function V04Entry(props: V04EntryProps): React.ReactElement {
  const { login, register, renderLegacyAuth } = props;
  const desktopWorkspace = useDesktopWorkspace();
  const [workspaceName, setWorkspaceName] = React.useState('My StudyKit Workspace');
  const handleOpenLocal = (): void => {
    workspaceFlavour.openLocal();
    locationStore.replace(
      makeAppLocation({ mode: 'study', surface: 'study-home' }),
    );
  };
  if (desktopWorkspace.enabled) {
    const { state } = desktopWorkspace;
    const busy = state.kind === 'restoring' || state.kind === 'choosing';
    const error =
      state.kind === 'error'
        ? state.message
        : state.kind === 'needs_workspace'
          ? state.message
          : undefined;
    return (
      <div className="auth-container v04-entry" data-testid="v04-entry">
        <div className="v04-entry-card glass-dialog">
          <header className="v04-entry-header">
            <LogoMarkWithWordmark size="md" />
            <ThemeSwitcher size="compact" />
          </header>
          <h1>Choose a workspace</h1>
          <p className="v04-entry-lede">
            Create a new StudyKit workspace folder or open one you already use.
          </p>
          <label className="v04-native-workspace-name" htmlFor="native-workspace-name">
            Workspace name
            <input
              id="native-workspace-name"
              value={workspaceName}
              onChange={(event) => {
                setWorkspaceName(event.target.value);
                desktopWorkspace.clearError();
              }}
              disabled={busy}
            />
          </label>
          <div className="v04-entry-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || workspaceName.trim().length === 0}
              onClick={() => void desktopWorkspace.createWorkspace(workspaceName)}
              data-testid="v04-entry-create-native"
            >
              {state.kind === 'choosing' && state.operation === 'create'
                ? 'Choosing folder…'
                : 'Create workspace'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void desktopWorkspace.openWorkspace()}
              data-testid="v04-entry-open-native"
            >
              {state.kind === 'choosing' && state.operation === 'open'
                ? 'Choosing folder…'
                : 'Open existing'}
            </button>
          </div>
          {state.kind === 'restoring' ? (
            <p role="status" className="v04-entry-status">
              Restoring your last workspace…
            </p>
          ) : null}
          {error ? (
            <div className="v04-entry-error" role="alert" aria-live="polite">
              <p>{error}</p>
              {state.kind === 'error' ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void desktopWorkspace.retryRestore()}
                >
                  Try restore again
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="v04-native-alpha-note">
            New Study, Research, and Canvas work is stored in the selected
            workspace. Existing browser-era library data stays untouched until
            you run the reviewed migration.
          </p>
          <WorkspaceFacts storage="A folder you choose on this device" />
        </div>
      </div>
    );
  }
  return (
    <div className="auth-container v04-entry" data-testid="v04-entry">
      <div className="v04-entry-card glass-dialog">
        <header className="v04-entry-header">
          <LogoMarkWithWordmark size="md" />
          <ThemeSwitcher size="compact" />
        </header>
        <h1>Choose a workspace</h1>
        <p className="v04-entry-lede">
          You can start working immediately in a local workspace. A sync
          workspace is optional and lets you share Research projects with
          collaborators.
        </p>
        <div className="v04-entry-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenLocal}
            data-testid="v04-entry-open-local"
          >
            Open local workspace
          </button>
        </div>
        <WorkspaceFacts storage="This browser on this device; sync is optional" />
        <details className="v04-entry-legacy">
          <summary>Sign in to sync workspace</summary>
          <WorkspaceEntryAuthForm login={login} register={register} />
          {renderLegacyAuth ? renderLegacyAuth() : null}
        </details>
      </div>
    </div>
  );
}

function WorkspaceFacts({ storage }: { storage: string }): React.ReactElement {
  return (
    <section className="v04-workspace-facts" aria-labelledby="workspace-facts-title">
      <h2 id="workspace-facts-title">Your workspace, your control</h2>
      <dl>
        <div><dt>Stored in</dt><dd>{storage}</dd></div>
        <div><dt>AI scope</dt><dd>Optional; the assistant shows the active scope and provider</dd></div>
        <div><dt>AI changes</dt><dd>Suggestions stay drafts until you accept them</dd></div>
      </dl>
    </section>
  );
}

function WorkspaceEntryAuthForm(props: V04EntryProps): React.ReactElement {
  const { login, register } = props;
  const [isLogin, setIsLogin] = React.useState(true);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, displayName || undefined);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={handleSubmit} data-testid="v04-entry-auth-form">
      <label>
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {!isLogin && (
        <label>
          Display name (optional)
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="v04-entry-error">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {isLogin ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setIsLogin(!isLogin)}
        disabled={busy}
      >
        {isLogin ? 'Need an account?' : 'Have an account?'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The actual shell — one header, one body.
// ---------------------------------------------------------------------------

export interface V04ShellProps {
  /**
   * Optional narrow compatibility leaf. Production supplies the
   * legacy Study body only for `study/lecture`; all other surfaces
   * are owned by the v0.4 routers.
   */
  children: React.ReactNode;
}

export function V04Shell(props: V04ShellProps): React.ReactElement {
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const flavour = useWorkspaceFlavour();
  const desktopWorkspace = useDesktopWorkspace();
  React.useEffect(() => {
    if (!desktopWorkspace.enabled) return;
    let unlisten: (() => void) | undefined;
    void listen('studykit://quick-capture', () => setCaptureOpen(true)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [desktopWorkspace.enabled]);
  const auth = useAuth();
  const location = useLocation();
  const syncStatus = useStore((s) => s.syncStatus);

  return (
    <div className="app-layout v04-shell" data-testid="v04-shell" data-mode={location.mode} data-flavour={flavour}>
      <a href="#main-content" className="skip-to-content">
        Skip to content
      </a>
      <header className="app-header glass-header v04-header" data-testid="v04-header">
        <div className="logo">
          <LogoMarkWithWordmark size="md" />
        </div>
        <ModeSwitch />
        <div className="spacer" />
        <div className="header-right">
          <span
            className={`v04-flavour-pill flavour-${flavour}`}
            data-testid="v04-flavour-pill"
            title={desktopWorkspace.enabled && desktopWorkspace.state.kind === 'ready'
              ? `Stored in ${desktopWorkspace.state.summary.root}`
              : undefined}
          >
            {desktopWorkspace.enabled && desktopWorkspace.state.kind === 'ready'
              ? `${desktopWorkspace.state.summary.manifest.displayName} · Native`
              : flavour === 'local'
                ? 'Local'
                : 'Sync'}
          </span>
          <span
            className="sync-indicator"
            role="status"
            aria-label={`Save status: ${syncStatus}`}
            data-testid="v04-sync-status"
          >
            <span className={`dot ${syncStatus}`} />
            {syncStatus === 'synced'
              ? 'Saved'
              : syncStatus === 'pending'
                ? 'Saving…'
                : syncStatus === 'error'
                  ? 'Error'
                  : flavour === 'local'
                    ? 'Local only'
                    : 'Offline'}
          </span>
          <ThemeSwitcher size="compact" />
          <HeaderAddMenu />
          {desktopWorkspace.enabled && desktopWorkspace.state.kind === 'ready' ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title={
                desktopWorkspace.system.shortcut?.available
                  ? `Quick Capture · ${desktopWorkspace.system.shortcut.shortcut}`
                  : desktopWorkspace.system.shortcut?.error ?? 'Quick Capture'
              }
              onClick={() => setCaptureOpen(true)}
            >
              Capture
            </button>
          ) : null}
          <HeaderAskButton container={location.container ?? null} />
          {desktopWorkspace.enabled && desktopWorkspace.state.kind === 'ready' ? (
            <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void desktopWorkspace.createBackup()}>
              Backup
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void desktopWorkspace.switchWorkspace()}
              data-testid="v04-switch-workspace"
            >
              Switch workspace
            </button>
            </>
          ) : flavour === 'sync' && auth.user ? (
            <>
              <span className="text-sm text-muted">
                {auth.user.display_name || auth.user.email}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  auth.logout();
                  workspaceFlavour.signOut();
                }}
                data-testid="v04-signout"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                workspaceFlavour.signOut();
                auth.logout();
              }}
              data-testid="v04-switch-workspace"
            >
              Switch workspace
            </button>
          )}
          {desktopWorkspace.state.kind === 'ready' &&
          desktopWorkspace.state.actionError ? (
            <span role="alert" className="v04-header-error">
              {desktopWorkspace.state.actionError}
            </span>
          ) : null}
        </div>
      </header>
      <main id="main-content" className="v04-body" data-testid="v04-body">
        {desktopWorkspace.enabled &&
        desktopWorkspace.system.legacy &&
        desktopWorkspace.system.legacy.count > 0 &&
        !desktopWorkspace.system.migration ? (
          <section className="v04-migration-banner" aria-label="Existing data found">
            <div>
              <strong>Bring your existing StudyKit work into this workspace?</strong>
              <span>{desktopWorkspace.system.legacy.count} local records found. A verified backup is created first, and the import can be rolled back.</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void desktopWorkspace.migrateLegacyData()}>
              Review and import
            </button>
          </section>
        ) : null}
        {/* The wiring providers are shared by the single active router
            surface and the optional Study Lecture compatibility leaf. */}
        <StudyWiring>
          <ResearchWiring>
            <CollaborationWiring>
              <CanvasUseCasesProvider>
                <div className="v04-workspace-layout">
                  <WorkspaceSidebar />
                  <div className="v04-active-surface" data-testid="v04-active-surface">
                    <React.Suspense fallback={<p className="v04-route-loading" role="status">Loading workspace…</p>}>
                      <StudyRouter />
                      <ResearchRouter />
                    </React.Suspense>
                    {props.children ? <div className="v04-legacy-leaf">{props.children}</div> : null}
                  </div>
                </div>
              </CanvasUseCasesProvider>
            </CollaborationWiring>
          </ResearchWiring>
        </StudyWiring>
      </main>
      {/* Mount-once Universal Intent Capsule (WP-03). The provider
          returns `null` when the `v04Assistant` flag is off, so the
          v0.3 / WP-02 surface tree is byte-for-byte identical with
          the flag off. */}
      <IntentCapsuleProvider />
      <QuickCapturePanel open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  );
}
