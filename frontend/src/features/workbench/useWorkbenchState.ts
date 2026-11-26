/**
 * StudyKit v0.5 — workbench state hook + persistence.
 *
 * Layout is per user, per device, per project and is never synced
 * (ADR-003 §3). P1 persists it through a small `WorkbenchStorage`
 * port backed by `localStorage`; the port keeps the door open for the
 * Workspace-backed store described in the ADR without touching
 * callers.
 */

import React from 'react';
import {
  activateEditor,
  closeEditor,
  openEditor,
  parseWorkbenchState,
  pinEditor,
  revealRegion,
  serializeWorkbenchState,
  setPanelOpen,
  setSideOpen,
  setSideWidth,
  type EditorInput,
  type OpenOptions,
  type WorkbenchRegion,
  type WorkbenchState,
} from './workbenchState';

export interface WorkbenchStorage {
  load(projectId: string): string | null;
  save(projectId: string, raw: string): void;
}

export const WORKBENCH_STORAGE_PREFIX = 'studykit.workbench.v1.';

/** `localStorage`-backed storage. Every access is guarded: layout is never worth an error. */
export const localWorkbenchStorage: WorkbenchStorage = {
  load(projectId) {
    try {
      return globalThis.localStorage?.getItem(WORKBENCH_STORAGE_PREFIX + projectId) ?? null;
    } catch {
      return null;
    }
  },
  save(projectId, raw) {
    try {
      globalThis.localStorage?.setItem(WORKBENCH_STORAGE_PREFIX + projectId, raw);
    } catch {
      // Storage full or unavailable: keep working in memory.
    }
  },
};

export interface WorkbenchController {
  readonly state: WorkbenchState;
  open(input: EditorInput, options?: OpenOptions): void;
  pin(index: number): void;
  activate(index: number): void;
  close(index: number): void;
  setSideOpen(open: boolean): void;
  setSideWidth(width: number): void;
  setPanelOpen(open: boolean): void;
  reveal(region: WorkbenchRegion): void;
}

const SAVE_DELAY_MS = 300;

export interface UseWorkbenchStateOptions {
  readonly storage?: WorkbenchStorage;
  /** One-shot editor params that are not restored after reload. */
  readonly transientParams?: readonly string[];
}

export function useWorkbenchState(projectId: string, options: UseWorkbenchStateOptions = {}): WorkbenchController {
  const storage = options.storage ?? localWorkbenchStorage;
  const transientKey = (options.transientParams ?? []).join(',');
  const [state, setState] = React.useState<WorkbenchState>(() =>
    parseWorkbenchState(storage.load(projectId), projectId),
  );

  // Switching project inside the same mounted workbench reloads state.
  const loadedFor = React.useRef(projectId);
  if (loadedFor.current !== projectId) {
    loadedFor.current = projectId;
    const next = parseWorkbenchState(storage.load(projectId), projectId);
    setState(next);
  }

  // Debounced save; flushed on unmount and when the page is hidden.
  const latest = React.useRef(state);
  latest.current = state;
  const dirty = React.useRef(false);
  const flush = React.useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    storage.save(
      latest.current.projectId,
      serializeWorkbenchState(latest.current, { transientParams: transientKey ? transientKey.split(',') : [] }),
    );
  }, [storage, transientKey]);

  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    dirty.current = true;
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, flush]);

  React.useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return React.useMemo<WorkbenchController>(
    () => ({
      state,
      open: (input, options) => setState((s) => openEditor(s, input, options)),
      pin: (index) => setState((s) => pinEditor(s, index)),
      activate: (index) => setState((s) => activateEditor(s, index)),
      close: (index) => setState((s) => closeEditor(s, index)),
      setSideOpen: (open) => setState((s) => setSideOpen(s, open)),
      setSideWidth: (width) => setState((s) => setSideWidth(s, width)),
      setPanelOpen: (open) => setState((s) => setPanelOpen(s, open)),
      reveal: (region) => setState((s) => revealRegion(s, region)),
    }),
    [state],
  );
}
