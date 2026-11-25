// Thin storage adapter so the theme runtime stays testable without a real
// localStorage. The default implementation reads/writes window.localStorage;
// tests can pass a fake via createLocalStorageThemeStorage({...}).
//
// We resolve the default Storage lazily and *defensively*. Just reading
// `window.localStorage` can throw in a sandboxed iframe or under a strict
// CSP (the `localStorage` getter itself raises a SecurityError). Catching
// the property access — not just the eventual getItem/setItem — keeps the
// theme runtime usable in every environment we ship to.

import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  type ThemePreference,
} from './types';

export interface ThemeStorage {
  read(): ThemePreference;
  write(preference: ThemePreference): void;
}

/** Resolve the default localStorage, or null when unavailable. */
function resolveDefaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageThemeStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = resolveDefaultStorage(),
): ThemeStorage {
  return {
    read() {
      if (!storage) return 'system';
      try {
        return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
      } catch {
        return 'system';
      }
    },
    write(preference) {
      if (!storage) return;
      try {
        storage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // localStorage may be unavailable (private mode, quota); stay silent —
        // the in-memory preference is still authoritative for the session.
      }
    },
  };
}

/** In-memory fake for tests. */
export function createInMemoryThemeStorage(initial: ThemePreference = 'system'): ThemeStorage & { snapshot: () => ThemePreference } {
  let current: ThemePreference = initial;
  return {
    read: () => current,
    write: (preference) => {
      current = preference;
    },
    snapshot: () => current,
  };
}
