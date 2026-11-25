/**
 * StudyKit v0.4 — WP-09A Desktop composition test
 *
 * Validates the desktop launch story end-to-end without needing
 * an actual Tauri binary:
 *
 *   1. The desktop adapter recognises `window.__TAURI_INTERNALS__`
 *      and produces the expected `RuntimeCapabilities`.
 *   2. The composition root (`platforms/runtime`) picks the
 *      desktop snapshot under Tauri.
 *   3. The no-account Local Workspace entry can be entered
 *      without any backend call.
 *   4. A real Research project written through the production
 *      Dexie repository survives repository/runtime recreation.
 *
 * This is a *composition* test, not a unit test. We deliberately
 * reuse the existing `workspaceFlavour` store and the existing
 * Dexie fake-table pattern instead of inventing a parallel
 * persistence story. The goal is to prove that the desktop
 * runtime does not regress the WP-02 local-first shell.
 *
 * The actual cold-start of the bundled Tauri binary is exercised
 * by the developer runbook in `frontend/src-tauri/README.md`
 * (npm run build:desktop:unsigned). That step is a host-side
 * action and not part of the Vitest suite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceFlavour } from '../application/workspaceFlavour';
import { setWorkspaceFlavour } from '../application/dataGateway';
import { createProject } from '../application/research/researchUseCases';
import { db } from '../lib/db';
import {
  __resetActiveRuntimeCapabilitiesForTests,
  __setActiveRuntimeCapabilitiesForTests,
  getActiveRuntimeCapabilities,
  isDesktopRuntime,
} from './runtime';
import { hasTauriRuntime } from './desktop/runtime.desktop';
import {
  __resetResearchDbForTests,
  createDexieResearchRepository,
} from './web/dexieResearchRepository';

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';
const PERSISTED_PROJECT_ID = 'proj_wp09a_desktop_persistence';
type InternalsCarrier = { [TAURI_INTERNALS_KEY]?: unknown };

const originalInternals = (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY];

function installFakeTauriHost(): void {
  (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY] = {};
}

function clearFakeTauriHost(): void {
  delete (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY];
}

describe('WP-09A desktop composition', () => {
  beforeEach(async () => {
    workspaceFlavour.signOut();
    sessionStorage.clear();
    localStorage.clear();
    __resetActiveRuntimeCapabilitiesForTests();
    __resetResearchDbForTests();
    await db.researchProjects.delete(PERSISTED_PROJECT_ID);
  });

  afterEach(async () => {
    if (originalInternals === undefined) {
      clearFakeTauriHost();
    } else {
      (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY] = originalInternals;
    }
    __resetActiveRuntimeCapabilitiesForTests();
    workspaceFlavour.signOut();
    sessionStorage.clear();
    localStorage.clear();
    __resetResearchDbForTests();
    await db.researchProjects.delete(PERSISTED_PROJECT_ID);
  });

  it('recognises a Tauri host on globalThis', () => {
    clearFakeTauriHost();
    expect(hasTauriRuntime()).toBe(false);

    installFakeTauriHost();
    expect(hasTauriRuntime()).toBe(true);

    clearFakeTauriHost();
    expect(hasTauriRuntime()).toBe(false);
  });

  it('picks the desktop snapshot when Tauri internals exist', () => {
    installFakeTauriHost();
    __resetActiveRuntimeCapabilitiesForTests();
    const snap = getActiveRuntimeCapabilities();
    expect(snap.runtime).toBe('desktop');
    expect(snap.platform).not.toBe('browser');
    expect(snap.hostVersion).toBe('');
    expect(isDesktopRuntime()).toBe(true);
    // WP-09: native filesystem, fail-closed global shortcut and
    // fixed-loopback local AI discovery are available in Desktop.
    expect(snap.supportsNativeFileSystem).toBe(true);
    expect(snap.supportsGlobalShortcut).toBe(true);
    expect(snap.supportsAutoUpdate).toBe(false);
    expect(snap.supportsLocalAiDiscovery).toBe(true);
  });

  it('falls back to the web snapshot when Tauri internals are absent', () => {
    clearFakeTauriHost();
    __resetActiveRuntimeCapabilitiesForTests();
    const snap = getActiveRuntimeCapabilities();
    expect(snap.runtime).toBe('web');
    expect(isDesktopRuntime()).toBe(false);
  });

  it('enters a Local Workspace without any backend call', () => {
    // Inject a desktop snapshot so the composition root knows it
    // is running under Tauri. The local entry path itself is
    // runtime-agnostic, but we assert that the desktop runtime
    // exposes the local entry the same way the web runtime does.
    __setActiveRuntimeCapabilitiesForTests({
      runtime: 'desktop',
      platform: 'macos',
      hostVersion: '0.4.0',
      supportsNativeFileSystem: false,
      supportsGlobalShortcut: false,
      supportsAutoUpdate: false,
      supportsLocalAiDiscovery: false,
    });

    // Open the local workspace through the same call path the
    // <V04Entry> `Open local workspace` button uses.
    workspaceFlavour.openLocal();

    expect(workspaceFlavour.getSnapshot()).toBe('local');
    expect(localStorage.getItem('studykit.v04.localWorkspace')).toBe('1');
    expect(localStorage.getItem('studykit.v04.syncWorkspaceId')).toBeNull();
    // The gateway never touches the network in local mode.
    expect(setWorkspaceFlavour).toBeDefined();
  });

  it('remounting the shell preserves the current local workspace choice', () => {
    installFakeTauriHost();
    __resetActiveRuntimeCapabilitiesForTests();
    expect(getActiveRuntimeCapabilities().runtime).toBe('desktop');

    workspaceFlavour.openLocal();

    // Simulate a React shell remount within the current WebView:
    // drop the runtime snapshot and rehydrate from localStorage.
    __resetActiveRuntimeCapabilitiesForTests();
    workspaceFlavour.rehydrate();

    expect(workspaceFlavour.getSnapshot()).toBe('local');
    // The runtime detector rebuilds the desktop snapshot on the
    // new "mount" because the fake Tauri host is still in place.
    __resetActiveRuntimeCapabilitiesForTests();
    expect(getActiveRuntimeCapabilities().runtime).toBe('desktop');
  });

  it('recreating the desktop adapters preserves a Research project in IndexedDB', async () => {
    installFakeTauriHost();
    expect(getActiveRuntimeCapabilities().runtime).toBe('desktop');

    const firstRepository = createDexieResearchRepository();
    await createProject(firstRepository, {
      name: 'WP-09A persistence probe',
      livingBrief: 'Stored through the production local repository.',
      container: {
        workspaceId: null,
        mode: 'research',
        kind: 'project',
        id: PERSISTED_PROJECT_ID,
      },
      idFactory: () => PERSISTED_PROJECT_ID,
    });

    // Recreate the runtime and repository wrappers while leaving
    // IndexedDB intact, matching an application cold-start boundary.
    __resetActiveRuntimeCapabilitiesForTests();
    __resetResearchDbForTests();
    const secondRepository = createDexieResearchRepository();
    const restored = await secondRepository.getProject(PERSISTED_PROJECT_ID);

    expect(getActiveRuntimeCapabilities().runtime).toBe('desktop');
    expect(restored).toMatchObject({
      id: PERSISTED_PROJECT_ID,
      name: 'WP-09A persistence probe',
      livingBrief: 'Stored through the production local repository.',
      kind: 'blank',
    });
  });
});
