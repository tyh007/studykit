/**
 * StudyKit v0.4 — `platforms/desktop/runtime.desktop`
 *
 * The Desktop-side `RuntimeCapabilities` adapter. Active when the
 * frontend bundle is loaded by Tauri 2's WebView instead of a
 * normal browser tab.
 *
 * Detection rule (Tauri 2.x): the runtime injects
 * `__TAURI_INTERNALS__` onto `window`. The desktop adapter checks
 * for that symbol only. It does NOT import the `@tauri-apps/api`
 * package — the adapter is intentionally framework-free so it
 * compiles in a sandboxed `happy-dom` test environment where
 * Tauri's package cannot be loaded.
 *
 * WP-09B exposes a real Rust-owned workspace folder picker and
 * SQLite workspace, so `supportsNativeFileSystem` is true for
 * the Tauri runtime. The other OS bridges remain false.
 *
 * `__TAURI_INTERNALS__` is used only as a host-presence marker.
 * Its contents are private implementation details and are never
 * read. Platform diagnostics come from the WebView's public
 * `navigator` object; `hostVersion` stays empty until a future
 * adapter initialises it through Tauri's public async API.
 */

import {
  createEmptyRuntimeCapabilities,
  type RuntimeCapabilities,
  type RuntimePlatform,
} from '../../application/runtime/runtimeCapabilities';
import { detectWebPlatform } from '../web/runtime.web';

export interface DesktopRuntimeDiagnostics {
  readonly platform?: RuntimePlatform;
  readonly hostVersion?: string;
}

/**
 * Detect whether the current `globalThis` is the Tauri host.
 * Exported for tests; the production code in
 * `platforms/runtime.ts` calls this once at module load.
 */
export function hasTauriRuntime(target: {
  __TAURI_INTERNALS__?: unknown;
} = (typeof globalThis !== 'undefined'
  ? (globalThis as { __TAURI_INTERNALS__?: unknown })
  : {})): boolean {
  return typeof target.__TAURI_INTERNALS__ === 'object' && target.__TAURI_INTERNALS__ !== null;
}

/**
 * Build a Desktop `RuntimeCapabilities` snapshot from diagnostics
 * already obtained through supported platform APIs.
 *
 * `createDesktopRuntimeCapabilities` is exported separately for
 * deterministic tests and future asynchronous initialisation.
 */
export function createDesktopRuntimeCapabilities(
  diagnostics: DesktopRuntimeDiagnostics = {},
): RuntimeCapabilities {
  return Object.freeze({
    ...createEmptyRuntimeCapabilities(
      'desktop',
      diagnostics.platform ?? 'unknown',
    ),
    hostVersion: diagnostics.hostVersion ?? '',
    supportsNativeFileSystem: true,
    supportsGlobalShortcut: true,
    supportsLocalAiDiscovery: true,
  });
}

/**
 * Convenience constructor: detects the Tauri host on the current
 * `globalThis` and produces the snapshot. When no Tauri host is
 * detected this returns the *web* snapshot (via the
 * `createEmptyRuntimeCapabilities('web', ...)` baseline) so a
 * caller that only knows about this function still gets a safe
 * value — never a phantom desktop runtime in a real browser tab.
 */
export function detectDesktopRuntimeCapabilities(): RuntimeCapabilities {
  if (!hasTauriRuntime()) {
    return createEmptyRuntimeCapabilities('web', 'unknown');
  }
  const platform =
    typeof navigator === 'undefined'
      ? 'unknown'
      : detectWebPlatform(
          typeof navigator.userAgent === 'string' ? navigator.userAgent : '',
          typeof navigator.platform === 'string' ? navigator.platform : '',
        );
  return createDesktopRuntimeCapabilities({ platform });
}
