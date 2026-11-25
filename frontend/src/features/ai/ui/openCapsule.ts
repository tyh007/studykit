/**
 * StudyKit v0.4 — `openCapsule` adapter
 *
 * Tiny public seam that any surface (Lecture card,
 * Literature canvas, sidebar header) calls to open the
 * Intent Capsule with the right initial context. The
 * adapter writes to the assistant session store and
 * returns synchronously; the `IntentCapsuleProvider`
 * (mounted once in the AppShell) re-renders the
 * floating panel.
 *
 * The adapter is *the only* way UI code opens the
 * capsule. Tests use it to assert that the right
 * `invocationSurface` and selection reach the store.
 *
 * WP-06 Round 6 P0-4: surfaces that know the *typed*
 * args their AI actions need (e.g. the cognitive
 * canvas's 3 `canvas-suggest-*` actions) pass them
 * through `precomputedActionArgs`. The
 * `IntentCapsule.buildArgsForAction` reads from the
 * session's `actionArgsById` map first, so clicking
 * a chip dispatches a real `providerRouter.chat()`
 * with the typed args, not an empty `{}`.
 *
 * This file is intentionally framework-agnostic — no
 * React, no DOM, no React Testing Library. The provider
 * hooks (`useOpenCapsule`) add the React glue.
 */

import {
  assistantSession,
  type ContextPacket,
  type InvocationSurface,
  type ScopePolicy,
} from '../kernel';
import type { ContainerRef } from '../../../domain/workspace';

export type CanvasActionId =
  | 'canvas-suggest-relations'
  | 'canvas-suggest-cluster'
  | 'canvas-suggest-layout';

export type PrecomputedActionArgs = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

export interface OpenCapsuleInput {
  readonly surface: InvocationSurface;
  /** Optional pre-selected text. */
  readonly selectedText?: string | null;
  /** Optional pre-selected object ids. */
  readonly selectedObjectIds?: readonly string[];
  /**
   * Optional container override. Surfaces that know
   * better (e.g. NoteEditor inside a course) pass the
   * course ref; the resolver uses it as the packet's
   * container.
   */
  readonly container?: ContainerRef | null;
  /** Optional pre-resolved context packet (used by tests). */
  readonly precomputedContext?: ContextPacket | null;
  /**
   * Optional map of `actionId → typed args`. Surfaces
   * that own the typed args (e.g. the cognitive
   * canvas's 3 `canvas-suggest-*` actions) populate
   * this so clicking the chip dispatches with the
   * right typed input, not an empty `{}`.
   */
  readonly precomputedActionArgs?: PrecomputedActionArgs;
  /** Optional initial prompt (rarely used — most surfaces let the user type). */
  readonly initialPrompt?: string;
  /** Optional scope override. */
  readonly initialScope?: ScopePolicy;
  /** Element id to restore focus to on close. Defaults to the
   *  currently-focused element at the moment of the call. */
  readonly restoreFocusId?: string | null;
}

/**
 * Open the Intent Capsule with the given input. The
 * function is synchronous; the actual rendering happens
 * in the React provider that subscribes to the session
 * store.
 */
export function openCapsule(input: OpenCapsuleInput): void {
  const restoreFocusId = input.restoreFocusId ?? currentFocusId();
  if (input.precomputedContext) {
    assistantSession.setContext(input.precomputedContext);
  }
  if (input.selectedText !== undefined || input.selectedObjectIds !== undefined) {
    assistantSession.setSelection({
      text: input.selectedText ?? null,
      objectIds: input.selectedObjectIds ?? [],
    });
  }
  // WP-06 Round 6 P0-3: always reset the per-action
  // args map on every `openCapsule` call. A generic
  // open (no `precomputedActionArgs`) clears the map;
  // a surface-specific open (the cognitive canvas)
  // replaces it. Either way, stale args from a
  // previous surface do not leak into a fresh open.
  assistantSession.setActionArgs(input.precomputedActionArgs ?? {});
  // The session is a tiny pure-JS store; we cannot
  // store a typed `ContainerRef` directly without
  // extending the state shape. The IntentCapsule
  // passes the container via `setContext` so the
  // packet is built with the right container even when
  // the live session state has none.
  if (input.container) {
    const existing = input.precomputedContext ?? null;
    assistantSession.setContext({
      ...(existing ?? {}),
      container: input.container,
    } as ContextPacket);
  }
  assistantSession.open({
    surface: input.surface,
    ...(input.initialPrompt !== undefined ? { initialPrompt: input.initialPrompt } : {}),
    restoreFocusId,
    ...(input.initialScope !== undefined ? { initialScope: input.initialScope } : {}),
  });
}

/**
 * Close the capsule and restore focus to the element
 * that had focus before it was opened. The function is
 * idempotent.
 */
export function closeCapsule(): void {
  if (!assistantSession.getSnapshot().isOpen) return;
  const restoreFocusId = assistantSession.getSnapshot().restoreFocusId;
  assistantSession.close();
  if (restoreFocusId && typeof document !== 'undefined') {
    // Restore focus synchronously. We deliberately do
    // *not* defer to a microtask: the panel is unmounted
    // by the time the focus call runs, so the focus
    // correctly lands on the originating element. Tests
    // relying on `waitFor` to observe the focus shift
    // still work because the focus call is synchronous.
    try {
      const el = document.getElementById(restoreFocusId);
      if (el && typeof (el as HTMLElement).focus === 'function') {
        (el as HTMLElement).focus({ preventScroll: false });
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Read the id of the currently-focused element, if any.
 * The Capsule restores focus to this id on close.
 */
function currentFocusId(): string | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  if (!active) return null;
  // `id` is a string-or-empty; we only want real ids.
  if ('id' in active && typeof (active as { id?: unknown }).id === 'string' && (active as { id: string }).id.length > 0) {
    return (active as { id: string }).id;
  }
  return null;
}
