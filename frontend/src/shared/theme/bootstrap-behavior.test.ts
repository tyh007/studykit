// Behavioral test for the bootstrap script: we run the string in a
// controlled DOM with stubbed localStorage and matchMedia to confirm
// it sets the right data-theme attribute for each (stored, system)
// combination. This is the contract that prevents first-paint flash.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { bootstrapScript } from './bootstrapScript';

type Stored = 'light' | 'dark' | 'system' | 'garbage' | null;
type SystemPref = 'light' | 'dark';

function setupDom() {
  document.documentElement.removeAttribute('data-theme');
}

function setStored(value: Stored) {
  const store = new Map<string, string>();
  if (value !== null) store.set('studykit.theme', value);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: store.size,
  });
}

function setMatchMedia(system: SystemPref) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(prefers-color-scheme: dark)' ? system === 'dark' : false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function run() {
  // The bootstrap reads from window.localStorage / window.matchMedia /
  // document.documentElement at call time.
  // eslint-disable-next-line no-new-func
  new Function(bootstrapScript)();
}

afterEach(() => {
  vi.unstubAllGlobals();
  setupDom();
});

describe('bootstrap script behavior', () => {
  it('resolves system preference against current OS theme', () => {
    beforeEach(() => undefined);
    setStored(null);
    setMatchMedia('dark');
    setupDom();
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('honors an explicit light preference even when the OS is dark', () => {
    setStored('light');
    setMatchMedia('dark');
    setupDom();
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('honors an explicit dark preference even when the OS is light', () => {
    setStored('dark');
    setMatchMedia('light');
    setupDom();
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('does not write data-theme-pref (removed; no consumer)', () => {
    setStored('light');
    setMatchMedia('dark');
    setupDom();
    run();
    expect(document.documentElement.getAttribute('data-theme-pref')).toBeNull();
  });

  it('falls back to light when localStorage is corrupted', () => {
    setStored('garbage' as Stored);
    setMatchMedia('light');
    setupDom();
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
