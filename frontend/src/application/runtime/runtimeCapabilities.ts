/**
 * StudyKit v0.4 — `application/runtime/runtimeCapabilities`
 *
 * Runtime capability contract for the product. The shape is intentionally
 * tiny: it answers "where am I running and what does the platform
 * offer?" so use cases and features can branch without importing
 * `platforms/*` (which they are forbidden to do — see `ARCHITECTURE.md`
 * §1.3).
 *
 * Three rules:
 *
 *   1. The contract is **platform-agnostic**. No Tauri types, no
 *      `window.__TAURI_INTERNALS__`, no fetch, no process. Just
 *      booleans and string identifiers.
 *
 *   2. Adapters live under `platforms/{web,desktop}/`. They detect
 *      the runtime and return a `RuntimeCapabilities` value.
 *
 *   3. The composition root in `app/` reads the value once (via the
 *      `getActiveRuntimeCapabilities()` singleton in `platforms/runtime.ts`)
 *      and passes it down. Application services and features
 *      receive it as a parameter or read it from a small headless
 *      selector; they never call `window.__TAURI_INTERNALS__`
 *      directly.
 *
 * WP-09A scope:
 *   - `supportsNativeFileSystem`, `supportsGlobalShortcut`,
 *     `supportsAutoUpdate`, `supportsLocalAiDiscovery` are all
 *     false in this packet. They exist as placeholders for the
 *     future WP-09B/C work (workspace folder picker, Quick
 *     Capture global hotkey, Ollama detection, in-app updater).
 *   - `platform` returns the concrete OS / browser identifier when
 *     known; otherwise `'unknown'`. It is for diagnostics, not for
 *     business branching.
 *
 * WP-09A explicitly does NOT add a feature flag for the desktop
 * runtime. The detection happens at module load — running the web
 * bundle inside `tauri://` makes the desktop adapter the active
 * one automatically. If we ever need to disable the desktop wiring
 * from devtools we can add `v04Desktop` later; for now no-op
 * adapter exposure is the right default.
 */

export type RuntimeKind = 'web' | 'desktop';

export type RuntimePlatform =
  | 'macos'
  | 'windows'
  | 'linux'
  | 'ios'
  | 'android'
  | 'browser'
  | 'unknown';

/**
 * Read-only snapshot of what the current runtime offers. Consumers
 * must treat this as immutable: a single adapter produces one
 * snapshot at module-load time, and the snapshot is reused for
 * the rest of the session.
 */
export interface RuntimeCapabilities {
  /** Which runtime produced this snapshot. `'web'` for any browser tab. */
  readonly runtime: RuntimeKind;
  /** Concrete OS / browser identifier when known. Diagnostics only. */
  readonly platform: RuntimePlatform;
  /** Version string reported by the runtime host (Tauri build version or browser UA). */
  readonly hostVersion: string;

  /**
   * Whether the runtime exposes an OS-bridged file system that a
   * workspace folder can be persisted into. WP-09A: false on every
   * platform; future WP-09B work will wire this to Tauri's fs
   * plugin and the workspace chooser.
   */
  readonly supportsNativeFileSystem: boolean;

  /**
   * Whether the runtime can register a process-wide keyboard
   * shortcut (the Quick Capture entry point). WP-09A: false; future
   * WP-09C work will wire this to Tauri's global-shortcut plugin
   * and explicitly request user permission.
   */
  readonly supportsGlobalShortcut: boolean;

  /**
   * Whether the runtime offers an in-app updater. WP-09A: false;
   * Tauri-updater integration is a later packet, after signing /
   * notarization plumbing is in place.
   */
  readonly supportsAutoUpdate: boolean;

  /**
   * Whether the runtime can detect a local AI provider (Ollama or
   * any OpenAI-compatible local endpoint). WP-09A: false; future
   * WP-09C work will add a non-blocking HTTP probe to
   * `http://localhost:11434`. The probe never auto-starts a model
   * or sends workspace data.
   */
  readonly supportsLocalAiDiscovery: boolean;
}

/** Minimal helper for tests: a stable "nothing supported" snapshot. */
export function createEmptyRuntimeCapabilities(
  runtime: RuntimeKind,
  platform: RuntimePlatform = 'unknown',
): RuntimeCapabilities {
  return Object.freeze({
    runtime,
    platform,
    hostVersion: '',
    supportsNativeFileSystem: false,
    supportsGlobalShortcut: false,
    supportsAutoUpdate: false,
    supportsLocalAiDiscovery: false,
  });
}