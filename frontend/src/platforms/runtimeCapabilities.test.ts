/**
 * StudyKit v0.4 — runtime capabilities tests
 *
 * Verifies the platform adapters:
 *   - Web adapter detects common OS/browser combinations and
 *     produces the expected booleans (all false for OS-bridge
 *     capabilities in WP-09A).
 *   - Desktop adapter returns `runtime === 'desktop'` only when
 *     `window.__TAURI_INTERNALS__` is present, treats the symbol
 *     only as a host marker, and never crashes when it is missing.
 *   - The composition-root singleton picks the desktop adapter
 *     under Tauri and the web adapter otherwise.
 *
 * The tests do NOT mock `@tauri-apps/api`. The desktop adapter
 * is intentionally framework-free so a sandboxed test can drive
 * it via direct argument injection (`createDesktopRuntimeCapabilities`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebRuntimeCapabilities, detectWebPlatform } from './web/runtime.web';
import {
  createDesktopRuntimeCapabilities,
  detectDesktopRuntimeCapabilities,
  hasTauriRuntime,
} from './desktop/runtime.desktop';
import {
  __resetActiveRuntimeCapabilitiesForTests,
  __setActiveRuntimeCapabilitiesForTests,
  getActiveRuntimeCapabilities,
  isDesktopRuntime,
} from './runtime';

const ORIGINAL_INTERNALS = (globalThis as { __TAURI_INTERNALS__?: unknown })
  .__TAURI_INTERNALS__;

beforeEach(() => {
  // The composition tests install / remove `__TAURI_INTERNALS__`
  // on `globalThis`. Each test in this file must start from a
  // known-clean web baseline so a previous test's install does
  // not leak in.
  if (ORIGINAL_INTERNALS === undefined) {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
  __resetActiveRuntimeCapabilitiesForTests();
});

describe('platforms/web/runtime.web', () => {
  it('detects common desktop and mobile UAs', () => {
    expect(detectWebPlatform('Mozilla/5.0 (Macintosh)', 'MacIntel')).toBe('macos');
    expect(detectWebPlatform('Mozilla/5.0 (Windows NT 10.0)', 'Win32')).toBe('windows');
    expect(detectWebPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')).toBe(
      'linux',
    );
    expect(detectWebPlatform('Mozilla/5.0 (iPhone)', '')).toBe('ios');
    expect(detectWebPlatform('Mozilla/5.0 (Linux; Android 12)', '')).toBe('android');
    expect(detectWebPlatform('', '')).toBe('browser');
    expect(detectWebPlatform('something we have not seen', 'BeOS')).toBe('unknown');
  });

  it('returns a web snapshot with no OS-bridge capabilities', () => {
    const snap = createWebRuntimeCapabilities();
    expect(snap.runtime).toBe('web');
    expect(snap.supportsNativeFileSystem).toBe(false);
    expect(snap.supportsGlobalShortcut).toBe(false);
    expect(snap.supportsAutoUpdate).toBe(false);
    expect(snap.supportsLocalAiDiscovery).toBe(false);
  });
});

describe('platforms/desktop/runtime.desktop', () => {
  it('returns false when no Tauri internals are present', () => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(hasTauriRuntime()).toBe(false);
    const snap = detectDesktopRuntimeCapabilities();
    expect(snap.runtime).toBe('web'); // safe fallback
  });

  it('builds a desktop snapshot from supported diagnostics', () => {
    const snap = createDesktopRuntimeCapabilities({
      platform: 'macos',
      hostVersion: '2.0.0',
    });
    expect(snap.runtime).toBe('desktop');
    expect(snap.platform).toBe('macos');
    expect(snap.hostVersion).toBe('2.0.0');
    expect(snap.supportsNativeFileSystem).toBe(true);
    expect(snap.supportsGlobalShortcut).toBe(true);
    expect(snap.supportsAutoUpdate).toBe(false);
    expect(snap.supportsLocalAiDiscovery).toBe(true);
  });

  it('accepts every platform value from the runtime contract', () => {
    expect(createDesktopRuntimeCapabilities({ platform: 'macos' }).platform).toBe(
      'macos',
    );
    expect(createDesktopRuntimeCapabilities({ platform: 'windows' }).platform).toBe(
      'windows',
    );
    expect(createDesktopRuntimeCapabilities({ platform: 'linux' }).platform).toBe(
      'linux',
    );
    expect(createDesktopRuntimeCapabilities({ platform: 'ios' }).platform).toBe(
      'ios',
    );
    expect(createDesktopRuntimeCapabilities({}).platform).toBe('unknown');
  });

  it('detects Tauri runtime when __TAURI_INTERNALS__ exists', () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(hasTauriRuntime()).toBe(true);
    const snap = detectDesktopRuntimeCapabilities();
    expect(snap.runtime).toBe('desktop');
    expect(snap.platform).not.toBe('browser');
    expect(snap.hostVersion).toBe('');
  });
});

describe('platforms/runtime (singleton)', () => {
  beforeEach(() => {
    __resetActiveRuntimeCapabilitiesForTests();
  });

  afterEach(() => {
    if (ORIGINAL_INTERNALS === undefined) {
      delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    } else {
      (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
        ORIGINAL_INTERNALS;
    }
    __resetActiveRuntimeCapabilitiesForTests();
  });

  it('returns the web snapshot when no Tauri host is present', () => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    __resetActiveRuntimeCapabilitiesForTests();
    const snap = getActiveRuntimeCapabilities();
    expect(snap.runtime).toBe('web');
    expect(isDesktopRuntime()).toBe(false);
  });

  it('returns the desktop snapshot when a Tauri host is present', () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    __resetActiveRuntimeCapabilitiesForTests();
    const snap = getActiveRuntimeCapabilities();
    expect(snap.runtime).toBe('desktop');
    expect(snap.hostVersion).toBe('');
    expect(isDesktopRuntime()).toBe(true);
  });

  it('lets tests inject a snapshot', () => {
    __setActiveRuntimeCapabilitiesForTests({
      runtime: 'desktop',
      platform: 'macos',
      hostVersion: 'injected',
      supportsNativeFileSystem: false,
      supportsGlobalShortcut: false,
      supportsAutoUpdate: false,
      supportsLocalAiDiscovery: false,
    });
    expect(getActiveRuntimeCapabilities().hostVersion).toBe('injected');
    expect(isDesktopRuntime()).toBe(true);
  });
});
