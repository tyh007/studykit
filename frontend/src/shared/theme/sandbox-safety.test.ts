// Regression tests for sandbox / SSR safety of the theme runtime's
// default adapters.
//
// The contract: `createLocalStorageThemeStorage()` and
// `createMatchMediaSystemThemeSource()` MUST NOT throw at construction
// or first call when `window.localStorage` or `window.matchMedia` are
// missing or raise on access (cross-origin sandboxes, strict CSP,
// private browsing, SSR). They must quietly degrade to in-memory /
// "always light" so the rest of the app keeps working.

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createLocalStorageThemeStorage,
  createMatchMediaSystemThemeSource,
} from './index';
import type { ThemePreference } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createLocalStorageThemeStorage default adapter', () => {
  it('does not throw when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => createLocalStorageThemeStorage()).not.toThrow();
    const s = createLocalStorageThemeStorage();
    expect(s.read()).toBe<ThemePreference>('system');
    expect(() => s.write('dark')).not.toThrow();
  });

  it('does not throw when window.localStorage getter raises SecurityError', () => {
    const win = {
      get localStorage() {
        throw new Error('SecurityError: storage access denied');
      },
    };
    vi.stubGlobal('window', win);
    expect(() => createLocalStorageThemeStorage()).not.toThrow();
    const s = createLocalStorageThemeStorage();
    expect(s.read()).toBe<ThemePreference>('system');
    expect(() => s.write('light')).not.toThrow();
  });

  it('does not throw when getItem / setItem throw', () => {
    const storage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    };
    vi.stubGlobal('window', { localStorage: storage });
    const s = createLocalStorageThemeStorage();
    expect(s.read()).toBe<ThemePreference>('system');
    expect(() => s.write('dark')).not.toThrow();
  });
});

describe('createMatchMediaSystemThemeSource default adapter', () => {
  it('does not throw when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => createMatchMediaSystemThemeSource()).not.toThrow();
    const src = createMatchMediaSystemThemeSource();
    expect(src.current()).toBe<'light' | 'dark'>('light');
    expect(() => src.subscribe(() => {})()).not.toThrow();
  });

  it('does not throw when window.matchMedia getter raises', () => {
    const win = {
      get matchMedia() {
        throw new Error('SecurityError: matchMedia denied');
      },
    };
    vi.stubGlobal('window', win);
    expect(() => createMatchMediaSystemThemeSource()).not.toThrow();
    const src = createMatchMediaSystemThemeSource();
    expect(src.current()).toBe<'light' | 'dark'>('light');
    expect(() => src.subscribe(() => {})()).not.toThrow();
  });

  it('returns light and no-ops subscription when matchMedia is missing', () => {
    vi.stubGlobal('window', {});
    const src = createMatchMediaSystemThemeSource();
    expect(src.current()).toBe<'light' | 'dark'>('light');
    const unsub = src.subscribe(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
