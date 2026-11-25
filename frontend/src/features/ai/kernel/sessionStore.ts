/**
 * StudyKit v0.4 — AI Interaction Kernel: `AssistantSessionStore`
 *
 * Single source of truth for the Intent Capsule session.
 * The store is a tiny, *pure JS* state machine — no React,
 * no Dexie, no network. It exposes:
 *
 *   - `open(surface, initial)`     → open the capsule from a surface
 *   - `close()`                    → close; the previously-focused
 *                                    DOM element is restored by the
 *                                    UI (the store just hands the id
 *                                    back)
 *   - `setPrompt(text)`            → free-text intent
 *   - `setSelection(text, ids)`    → transient selection
 *   - `pinContext(id)`             → lift a selection into the session
 *   - `unpinContext(id)`           → drop a pin
 *   - `setScope(policy)`           → widen the scope (user gesture)
 *   - `setDraft(draftId)`          → record the active draft
 *   - `setError(message)`          → display a non-fatal error
 *   - `cancel()`                   → soft cancel: keeps prompt,
 *                                    selection, scope; clears
 *                                    `generating` draft
 *   - `clearTransient()`           → drop non-pinned selection
 *                                    (called by the UI on route
 *                                    change)
 *
 * Why a separate store? Three reasons:
 *
 *   1. The same session must be observable from *both*
 *      surfaces (Lecture and Reader/Canvas) without each
 *      one duplicating React state.
 *   2. WP-03 wants the prompt, selection and scope to
 *      survive a `close → open` round-trip — but only
 *      when the user has not navigated away.
 *   3. Tests can drive the store directly and assert the
 *      transitions, no DOM required.
 *
 * The store is exposed as `assistantSession` (singleton)
 * and `useAssistantSession()` (a `useSyncExternalStore`
 * hook). Tests can call `__resetAssistantSessionForTests`.
 */

import { useSyncExternalStore } from 'react';
import type {
  ContextPacket,
  InvocationSurface,
  ScopePolicy,
} from './contextResolver';
import type { DraftRecord } from './draftLayer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'closed'        // capsule not visible
  | 'open-idle'     // visible, no draft yet
  | 'dispatching'   // a `run` is in flight
  | 'reviewing'     // a draft is on screen, awaiting Accept / Reject
  | 'error';        // a soft, recoverable error

export interface AssistantSessionState {
  readonly status: SessionStatus;
  /** True when the capsule is rendered. */
  readonly isOpen: boolean;
  /** Where the user invoked the capsule from. */
  readonly invocationSurface: InvocationSurface | null;
  /** What the user typed in the intent field. Survives close → open. */
  readonly prompt: string;
  /** Transient selection; cleared on route change. */
  readonly selectedText: string | null;
  readonly selectedObjectIds: readonly string[];
  /** Items the user explicitly pinned. */
  readonly pinnedContextIds: readonly string[];
  /** Scope the user picked (defaults to the resolver's choice). */
  readonly scopePolicy: ScopePolicy;
  /** The last resolved context packet, if any. Refreshed every time the user
   *  edits a chip. */
  readonly lastContext: ContextPacket | null;
  /** The current draft (or null when none). */
  readonly draft: DraftRecord | null;
  /** A non-fatal error message. Cleared on the next user action. */
  readonly error: string | null;
  /** The id of the DOM element that had focus before the capsule opened.
   *  The UI restores focus to this element on close. */
  readonly restoreFocusId: string | null;
  /**
   * Pre-computed `args` for the actions the surface
   * (e.g. cognitive canvas) wants to expose. The
   * `IntentCapsule.buildArgsForAction` reads from this
   * map first; the cognitive canvas's `Ask AI` button
   * populates it with the typed args the 3 canvas
   * actions need (`canvas-suggest-relations` /
   * `-cluster` / `-layout`). The map is cleared on
   * route change.
   */
  readonly actionArgsById: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const INITIAL_STATE: AssistantSessionState = Object.freeze({
  status: 'closed',
  isOpen: false,
  invocationSurface: null,
  prompt: '',
  selectedText: null,
  selectedObjectIds: Object.freeze([]),
  pinnedContextIds: Object.freeze([]),
  scopePolicy: 'selection',
  lastContext: null,
  draft: null,
  error: null,
  restoreFocusId: null,
  actionArgsById: Object.freeze({}),
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let state: AssistantSessionState = INITIAL_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function set(patch: Partial<AssistantSessionState>): void {
  state = Object.freeze({ ...state, ...patch });
  emit();
}

export const assistantSession = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): AssistantSessionState {
    return state;
  },

  /**
   * Open the capsule. The caller passes the surface and an
   * optional initial prompt. The store also remembers the
   * id of the element that had focus at the moment of
   * opening; the UI restores focus to it on close.
   *
   * WP-06 Round 6 P0-3: the per-action `actionArgsById`
   * map is *not* reset here — `openCapsule` (the
   * public adapter) is responsible for setting it
   * before the `open()` call. `close()` is responsible
   * for clearing the map (a generic reopen from a
   * different surface must not see the previous
   * surface's typed args). The map survives a
   * close → open round-trip only when the surface
   * repopulates it.
   */
  open(input: {
    surface: InvocationSurface;
    initialPrompt?: string;
    restoreFocusId?: string | null;
    initialScope?: ScopePolicy;
  }): void {
    set({
      status: 'open-idle',
      isOpen: true,
      invocationSurface: input.surface,
      ...(input.initialPrompt !== undefined ? { prompt: input.initialPrompt } : {}),
      restoreFocusId: input.restoreFocusId ?? null,
      ...(input.initialScope !== undefined ? { scopePolicy: input.initialScope } : {}),
      // Errors are sticky across opens, but a fresh open
      // clears any in-flight error so the user sees a
      // clean capsule.
      error: null,
    });
  },

  /** Close the capsule.
   *
   * WP-06 Round 6 P0-3: the per-action
   * `actionArgsById` map is cleared on `close`. A
   * fresh open from a different surface (or from
   * the same surface with a new snapshot) MUST NOT
   * see the stale typed args. The prompt, scope
   * and pinned context survive the close (the
   * previous behaviour), but the surface-specific
   * action args are transient. */
  close(): void {
    set({
      status: 'closed',
      isOpen: false,
      actionArgsById: Object.freeze({}),
    });
  },

  setPrompt(text: string): void {
    if (text === state.prompt) return;
    set({ prompt: text });
  },

  setSelection(input: { text: string | null; objectIds: readonly string[] }): void {
    const ids = Object.freeze([...input.objectIds]);
    if (state.selectedText === input.text && sameIds(state.selectedObjectIds, ids)) {
      return;
    }
    set({ selectedText: input.text, selectedObjectIds: ids });
  },

  pinContext(id: string): void {
    if (state.pinnedContextIds.includes(id)) return;
    set({ pinnedContextIds: Object.freeze([...state.pinnedContextIds, id]) });
  },

  unpinContext(id: string): void {
    if (!state.pinnedContextIds.includes(id)) return;
    set({
      pinnedContextIds: Object.freeze(state.pinnedContextIds.filter((x) => x !== id)),
    });
  },

  setScope(policy: ScopePolicy): void {
    if (policy === state.scopePolicy) return;
    set({ scopePolicy: policy });
  },

  setContext(packet: ContextPacket | null): void {
    set({ lastContext: packet });
  },

  setDraft(draft: DraftRecord | null): void {
    if (draft === null) {
      set({ draft: null, status: state.isOpen ? 'open-idle' : state.status });
      return;
    }
    set({ draft, status: 'reviewing' });
  },

  setError(message: string | null): void {
    set({ error: message, status: message ? 'error' : state.status });
  },

  /**
   * Soft cancel: keep the prompt, selection and scope;
   * clear the in-flight draft. Returns the focus to the
   * store's `restoreFocusId` so the UI can move focus
   * back.
   */
  cancel(): void {
    set({
      status: state.isOpen ? 'open-idle' : 'closed',
      draft: null,
    });
  },

  /**
   * Drop transient selection / scope. Called by the UI
   * when the user navigates away (route change). Pinned
   * items survive; prompt survives; draft is dropped;
   * per-action args are cleared (a future surface
   * will re-populate them on the next open).
   */
  clearTransient(): void {
    set({
      selectedText: null,
      selectedObjectIds: Object.freeze([]),
      scopePolicy: state.pinnedContextIds.length > 0 ? 'explicit-set' : state.scopePolicy,
      draft: null,
      actionArgsById: Object.freeze({}),
    });
  },

  /**
   * Set the per-action args map. The
   * `IntentCapsule.buildArgsForAction` reads from
   * this map first; the cognitive canvas's `Ask AI`
   * button populates it with the typed args the 3
   * canvas actions need (`canvas-suggest-relations`
   * / `-cluster` / `-layout`). Pass an empty object
   * to clear.
   */
  setActionArgs(args: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
    set({ actionArgsById: Object.freeze({ ...args }) });
  },

  /** Test-only reset. */
  __resetForTests(): void {
    state = INITIAL_STATE;
    emit();
  },
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAssistantSession(): AssistantSessionState {
  return useSyncExternalStore(
    assistantSession.subscribe,
    assistantSession.getSnapshot,
    assistantSession.getSnapshot,
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
