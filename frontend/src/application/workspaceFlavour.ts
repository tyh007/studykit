/**
 * StudyKit v0.4 — `workspaceFlavour` (converged)
 *
 * Pure JS store for the current workspace flavour:
 *   - `'local'`  → local-first, IndexedDB only
 *   - `'sync'`   → authenticated, v0.3 `/api` backend
 *
 * No React in this file. The auth bridge in `app/v04/` calls
 * `reconcileAuth()` from a `useEffect`; React components read
 * the value via the `useWorkspaceFlavour()` hook.
 *
 * **Bootstrap behaviour (WP-02 Gate §1)**: the module's
 * default flavour is `sync`. The localStorage-backed
 * `rehydrate()` method exists but is ONLY called by the
 * `<App>` component when the `v04Shell` flag is on. This
 * guarantees that when the flag is off, the legacy code path
 * (`<AuthPage>` / `<StudyKitApp>`) goes through the v0.3
 * `/api` backend even if a stale `local` flag is present in
 * localStorage from a previous v04-shell-on session.
 */

import { useSyncExternalStore } from 'react';
import { setWorkspaceFlavour, type WorkspaceFlavour } from './dataGateway';

const LOCAL_FLAG_KEY = 'studykit.v04.localWorkspace';
const SYNC_FLAG_KEY = 'studykit.v04.syncWorkspaceId';

let flavour: WorkspaceFlavour = 'sync';
let lastSyncWorkspaceId: string | null = null;
const listeners = new Set<() => void>();

function readLocalFlag(): boolean {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(LOCAL_FLAG_KEY) === '1'
      : false;
  } catch {
    return false;
  }
}

function writeLocalFlag(on: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (on) window.localStorage.setItem(LOCAL_FLAG_KEY, '1');
    else window.localStorage.removeItem(LOCAL_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

function readSyncWorkspaceId(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(SYNC_FLAG_KEY) : null;
  } catch {
    return null;
  }
}

function writeSyncWorkspaceId(id: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (id) window.localStorage.setItem(SYNC_FLAG_KEY, id);
    else window.localStorage.removeItem(SYNC_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

function emit(): void {
  for (const l of listeners) l();
}

export const workspaceFlavour = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): WorkspaceFlavour {
    return flavour;
  },
  /**
   * Read the localStorage flags and update the in-memory
   * flavour. Called by the `<App>` component on mount ONLY
   * when the `v04Shell` flag is on, so a stale `local` flag
   * never leaks into the flag-off legacy path.
   *
   * Returns the resolved flavour.
   */
  rehydrate(): WorkspaceFlavour {
    if (readLocalFlag()) {
      flavour = 'local';
      lastSyncWorkspaceId = null;
    } else {
      flavour = 'sync';
      lastSyncWorkspaceId = readSyncWorkspaceId();
    }
    setWorkspaceFlavour(flavour);
    emit();
    return flavour;
  },
  /** Open a local workspace. Persists across reload. */
  openLocal(): void {
    flavour = 'local';
    lastSyncWorkspaceId = null;
    writeLocalFlag(true);
    writeSyncWorkspaceId(null);
    setWorkspaceFlavour('local');
    emit();
  },
  /** Open / re-select a sync workspace. Persists the id. */
  openSync(workspaceId: string): void {
    flavour = 'sync';
    lastSyncWorkspaceId = workspaceId;
    writeLocalFlag(false);
    writeSyncWorkspaceId(workspaceId);
    setWorkspaceFlavour('sync');
    emit();
  },
  /** Drop the current workspace; return to the entry screen. */
  signOut(): void {
    flavour = 'sync';
    lastSyncWorkspaceId = null;
    writeLocalFlag(false);
    writeSyncWorkspaceId(null);
    setWorkspaceFlavour('sync');
    emit();
  },
  /**
   * Idempotent reconciliation with the v0.3 auth state.
   * Called from the React auth bridge in `app/v04/`.
   */
  reconcileAuth(auth: { user: unknown; workspace_id: string | null }): void {
    const hasUser = Boolean(auth.user && auth.workspace_id);
    if (hasUser) {
      if (flavour !== 'sync' || lastSyncWorkspaceId !== auth.workspace_id) {
        flavour = 'sync';
        lastSyncWorkspaceId = auth.workspace_id;
        writeLocalFlag(false);
        writeSyncWorkspaceId(auth.workspace_id);
        setWorkspaceFlavour('sync');
        emit();
      }
    } else if (flavour === 'sync' && lastSyncWorkspaceId) {
      flavour = 'sync';
      lastSyncWorkspaceId = null;
      writeSyncWorkspaceId(null);
      setWorkspaceFlavour('sync');
      emit();
    }
  },
};

/**
 * Pure `useSyncExternalStore` hook. No try/catch, no Hook rules
 * violations.
 */
export function useWorkspaceFlavour(): WorkspaceFlavour {
  return useSyncExternalStore(
    workspaceFlavour.subscribe,
    workspaceFlavour.getSnapshot,
    workspaceFlavour.getSnapshot,
  );
}
