/**
 * StudyKit v0.4 — `platforms/runtime` (single resolution point)
 *
 * The composition-root convenience for picking a `RuntimeCapabilities`
 * snapshot. Both the web and desktop adapters are loaded eagerly;
 * `getActiveRuntimeCapabilities()` returns the desktop snapshot when
 * the current `globalThis` is a Tauri host, the web snapshot
 * otherwise.
 *
 * Why a singleton and not per-call detection? The contract is
 * immutable for the lifetime of a tab — Tauri does not change its
 * host mid-session — and a singleton avoids running UA parsing /
 * `globalThis` checks on every render. Tests can override the
 * singleton through `__setActiveRuntimeCapabilitiesForTests`.
 *
 * `application/*`, `features/*`, and `shared/*` MUST import
 * `getActiveRuntimeCapabilities` from `platforms/runtime` (or from
 * the `application/runtime/runtimeCapabilities` type) — they MUST
 * NOT read `window.__TAURI_INTERNALS__` themselves. The rule
 * enforced by the shared/ import-boundary test still holds:
 * platform adapters never bleed into outer layers.
 */

import {
  createEmptyRuntimeCapabilities,
  type RuntimeCapabilities,
} from '../application/runtime/runtimeCapabilities';
import { detectDesktopRuntimeCapabilities, hasTauriRuntime } from './desktop/runtime.desktop';
import { createWebRuntimeCapabilities } from './web/runtime.web';

let cached: RuntimeCapabilities | null = null;

function resolve(): RuntimeCapabilities {
  if (hasTauriRuntime()) {
    return detectDesktopRuntimeCapabilities();
  }
  return createWebRuntimeCapabilities();
}

/**
 * Returns the active runtime snapshot. Cached for the lifetime of
 * the tab. Safe to call from React render paths.
 */
export function getActiveRuntimeCapabilities(): RuntimeCapabilities {
  if (cached === null) {
    cached = resolve();
  }
  return cached;
}

/** @internal Reset the cached snapshot. Test-only. */
export function __resetActiveRuntimeCapabilitiesForTests(): void {
  cached = null;
}

/**
 * @internal Inject a snapshot, bypassing the detector. Test-only.
 * Production code paths MUST NOT call this.
 */
export function __setActiveRuntimeCapabilitiesForTests(
  next: RuntimeCapabilities,
): void {
  cached = Object.freeze({ ...next });
}

/**
 * Convenience: returns true iff the current runtime is the Tauri
 * desktop host. Use this in the composition root to decide
 * whether to mount desktop-only wiring (Quick Capture tray,
 * workspace chooser, future SQLite adapters).
 */
export function isDesktopRuntime(): boolean {
  return getActiveRuntimeCapabilities().runtime === 'desktop';
}

/**
 * Convenience: an empty "unknown" snapshot. Useful as a safe
 * default for code that runs before the detector has run yet
 * (e.g. SSR or test bootstrapping).
 */
export function getEmptyRuntimeCapabilities(): RuntimeCapabilities {
  return createEmptyRuntimeCapabilities('web', 'unknown');
}