/**
 * StudyKit v0.5 — workbench state (ADR-003 §1–§3).
 *
 * Pure, mode-agnostic model of a project workbench: which editors are
 * open as tabs, which one is active, and which optional regions the
 * user has grown into. Research registers its editor kinds on top of
 * this; Study can do the same later without touching this module.
 *
 * Every function here is pure and returns a new frozen state, so the
 * store, persistence and tests all share one implementation.
 */

/** An editor kind. Opaque to the workbench; owned by the host mode. */
export type EditorKind = string;

export interface EditorInput {
  readonly kind: EditorKind;
  /** Object id. For project-wide editors this is the project id. */
  readonly id: string;
  /**
   * Optional string parameters (e.g. a question id a design editor
   * should anchor to). Not part of the tab identity.
   */
  readonly params?: Readonly<Record<string, string>>;
}

export interface WorkbenchTab {
  readonly input: EditorInput;
  /** A preview tab is replaced by the next preview open (VS Code). */
  readonly preview: boolean;
}

/**
 * Optional regions that appear only once used (progressive
 * disclosure, ADR-003 §1). The explorer and editor area are always
 * present and therefore not listed.
 */
export type WorkbenchRegion = 'ai' | 'panel' | 'design' | 'tasks' | 'collaboration' | 'canvas';

export interface WorkbenchState {
  readonly projectId: string;
  readonly tabs: readonly WorkbenchTab[];
  /** Index into `tabs`, or -1 when no tab is open. */
  readonly active: number;
  readonly sideOpen: boolean;
  readonly sideWidth: number;
  /** Bottom panel expanded (only shown when the host provides one). */
  readonly panelOpen: boolean;
  readonly revealed: readonly WorkbenchRegion[];
}

export const SIDE_WIDTH_DEFAULT = 260;
export const SIDE_WIDTH_MIN = 180;
export const SIDE_WIDTH_MAX = 480;

const REGIONS: readonly WorkbenchRegion[] = ['ai', 'panel', 'design', 'tasks', 'collaboration', 'canvas'];

export function inputKey(input: EditorInput): string {
  return `${input.kind}:${input.id}`;
}

export function sameInput(a: EditorInput, b: EditorInput): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function createWorkbenchState(projectId: string): WorkbenchState {
  return Object.freeze({
    projectId,
    tabs: Object.freeze([]),
    active: -1,
    sideOpen: true,
    sideWidth: SIDE_WIDTH_DEFAULT,
    panelOpen: true,
    revealed: Object.freeze([]),
  });
}

function freeze(state: WorkbenchState): WorkbenchState {
  return Object.freeze({
    ...state,
    tabs: Object.freeze(state.tabs.map((t) => Object.freeze({ ...t }))),
    revealed: Object.freeze([...state.revealed]),
  });
}

export interface OpenOptions {
  /** Open as a preview tab (single click in the explorer). */
  readonly preview?: boolean;
}

/**
 * Open (or focus) an editor.
 *
 * - An input that is already open is focused. Opening it non-preview
 *   pins it; params are refreshed so deep links can re-anchor it.
 * - A preview open replaces the existing preview tab, if any, in place.
 * - Otherwise the tab is inserted right after the active tab.
 */
export function openEditor(
  state: WorkbenchState,
  input: EditorInput,
  options: OpenOptions = {},
): WorkbenchState {
  const preview = options.preview === true;
  const existing = state.tabs.findIndex((t) => sameInput(t.input, input));
  if (existing >= 0) {
    const tabs = state.tabs.map((t, i) =>
      i === existing
        ? { input: { ...t.input, ...(input.params ? { params: input.params } : {}) }, preview: t.preview && preview }
        : t,
    );
    return freeze({ ...state, tabs, active: existing });
  }
  const tab: WorkbenchTab = { input, preview };
  if (preview) {
    const previewIndex = state.tabs.findIndex((t) => t.preview);
    if (previewIndex >= 0) {
      const tabs = state.tabs.map((t, i) => (i === previewIndex ? tab : t));
      return freeze({ ...state, tabs, active: previewIndex });
    }
  }
  const at = state.active >= 0 ? state.active + 1 : state.tabs.length;
  const tabs = [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)];
  return freeze({ ...state, tabs, active: at });
}

/** Turn a preview tab into a regular one (double click or first edit). */
export function pinEditor(state: WorkbenchState, index: number): WorkbenchState {
  const tab = state.tabs[index];
  if (!tab || !tab.preview) return state;
  const tabs = state.tabs.map((t, i) => (i === index ? { ...t, preview: false } : t));
  return freeze({ ...state, tabs });
}

export function activateEditor(state: WorkbenchState, index: number): WorkbenchState {
  if (index < 0 || index >= state.tabs.length || index === state.active) return state;
  return freeze({ ...state, active: index });
}

/**
 * Close a tab. Focus moves to the tab on the right, or the left when
 * the closed tab was last (VS Code behaviour).
 */
export function closeEditor(state: WorkbenchState, index: number): WorkbenchState {
  if (index < 0 || index >= state.tabs.length) return state;
  const tabs = state.tabs.filter((_, i) => i !== index);
  let active = state.active;
  if (tabs.length === 0) active = -1;
  else if (index < state.active) active = state.active - 1;
  else if (index === state.active) active = Math.min(index, tabs.length - 1);
  return freeze({ ...state, tabs, active });
}

export function activeInput(state: WorkbenchState): EditorInput | null {
  return state.tabs[state.active]?.input ?? null;
}

export function setSideOpen(state: WorkbenchState, open: boolean): WorkbenchState {
  if (state.sideOpen === open) return state;
  return freeze({ ...state, sideOpen: open });
}

export function setSideWidth(state: WorkbenchState, width: number): WorkbenchState {
  const clamped = Math.round(Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, width)));
  if (clamped === state.sideWidth) return state;
  return freeze({ ...state, sideWidth: clamped });
}

export function setPanelOpen(state: WorkbenchState, open: boolean): WorkbenchState {
  if (state.panelOpen === open) return state;
  return freeze({ ...state, panelOpen: open });
}

/** Record that a region has been used, so it stays visible from now on. */
export function revealRegion(state: WorkbenchState, region: WorkbenchRegion): WorkbenchState {
  if (state.revealed.includes(region)) return state;
  return freeze({ ...state, revealed: [...state.revealed, region] });
}

export function isRevealed(state: WorkbenchState, region: WorkbenchRegion): boolean {
  return state.revealed.includes(region);
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export const WORKBENCH_STATE_VERSION = 1;

interface SerializedWorkbenchState {
  readonly v: number;
  readonly projectId: string;
  readonly tabs: readonly { kind: string; id: string; params?: Record<string, string>; preview?: boolean }[];
  readonly active: number;
  readonly sideOpen: boolean;
  readonly sideWidth: number;
  readonly panelOpen?: boolean;
  readonly revealed: readonly string[];
}

export interface SerializeOptions {
  /**
   * Params that only make sense at the moment an editor is opened
   * (e.g. "open the add panel"). They are not restored after reload.
   */
  readonly transientParams?: readonly string[];
}

function persistentParams(
  params: Readonly<Record<string, string>> | undefined,
  transient: readonly string[],
): Record<string, string> | null {
  if (!params) return null;
  const kept = Object.fromEntries(Object.entries(params).filter(([k]) => !transient.includes(k)));
  return Object.keys(kept).length > 0 ? kept : null;
}

export function serializeWorkbenchState(state: WorkbenchState, options: SerializeOptions = {}): string {
  const transient = options.transientParams ?? [];
  const out: SerializedWorkbenchState = {
    v: WORKBENCH_STATE_VERSION,
    projectId: state.projectId,
    tabs: state.tabs.map((t) => {
      const params = persistentParams(t.input.params, transient);
      return {
        kind: t.input.kind,
        id: t.input.id,
        ...(params ? { params } : {}),
        ...(t.preview ? { preview: true } : {}),
      };
    }),
    active: state.active,
    sideOpen: state.sideOpen,
    sideWidth: state.sideWidth,
    panelOpen: state.panelOpen,
    revealed: [...state.revealed],
  };
  return JSON.stringify(out);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

/**
 * Parse persisted state. Anything malformed, from another version or
 * for another project falls back to a fresh state: layout is a
 * convenience, never worth an error.
 */
export function parseWorkbenchState(raw: string | null, projectId: string): WorkbenchState {
  const fresh = createWorkbenchState(projectId);
  if (!raw) return fresh;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (typeof data !== 'object' || data === null) return fresh;
  const d = data as Partial<SerializedWorkbenchState>;
  if (d.v !== WORKBENCH_STATE_VERSION || d.projectId !== projectId || !Array.isArray(d.tabs)) return fresh;
  const tabs: WorkbenchTab[] = [];
  for (const t of d.tabs) {
    if (!t || typeof t.kind !== 'string' || typeof t.id !== 'string' || !t.kind || !t.id) continue;
    if (tabs.some((x) => x.input.kind === t.kind && x.input.id === t.id)) continue;
    tabs.push({
      input: { kind: t.kind, id: t.id, ...(isStringRecord(t.params) ? { params: t.params } : {}) },
      preview: t.preview === true,
    });
  }
  const active =
    typeof d.active === 'number' && Number.isInteger(d.active) && d.active >= 0 && d.active < tabs.length
      ? d.active
      : tabs.length > 0
        ? 0
        : -1;
  const revealed = Array.isArray(d.revealed)
    ? d.revealed.filter((r): r is WorkbenchRegion => REGIONS.includes(r as WorkbenchRegion))
    : [];
  const sideWidth = typeof d.sideWidth === 'number' && Number.isFinite(d.sideWidth) ? d.sideWidth : SIDE_WIDTH_DEFAULT;
  return setSideWidth(
    freeze({
      projectId,
      tabs,
      active,
      sideOpen: typeof d.sideOpen === 'boolean' ? d.sideOpen : true,
      sideWidth: SIDE_WIDTH_DEFAULT,
      panelOpen: typeof d.panelOpen === 'boolean' ? d.panelOpen : true,
      revealed: [...new Set(revealed)],
    }),
    sideWidth,
  );
}
