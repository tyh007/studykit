// matchMedia abstraction. We never want the React provider to call
// `window.matchMedia` directly — it makes tests brittle and the runtime
// harder to reason about. The default implementation queries the real
// prefers-color-scheme media query; tests pass a stub.
//
// Just like createLocalStorageThemeStorage, the default matchMedia is
// resolved defensively. Cross-origin sandboxes and some WebViews raise
// on the `matchMedia` property access itself, so we catch that case
// before the React provider ever sees it.

import type { ResolvedTheme } from './types';

export interface SystemThemeSource {
  /** Current system theme. */
  current(): ResolvedTheme;
  /**
   * Subscribe to system theme changes. Returns an unsubscribe function.
   * The listener is invoked with the new theme whenever the OS preference
   * changes. Must not throw.
   */
  subscribe(listener: (theme: ResolvedTheme) => void): () => void;
}

const DARK_MQ = '(prefers-color-scheme: dark)';

function resolveDefaultMatchMedia(): typeof window.matchMedia | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.matchMedia?.bind(window) ?? null;
  } catch {
    return null;
  }
}

/** Default: real window.matchMedia. Safe on the server (returns 'light'). */
export function createMatchMediaSystemThemeSource(
  matchMediaImpl: typeof window.matchMedia | null | undefined = resolveDefaultMatchMedia(),
): SystemThemeSource {
  return {
    current() {
      if (!matchMediaImpl) return 'light';
      try {
        return matchMediaImpl(DARK_MQ).matches ? 'dark' : 'light';
      } catch {
        return 'light';
      }
    },
    subscribe(listener) {
      if (!matchMediaImpl) return () => {};
      let mql: MediaQueryList;
      try {
        mql = matchMediaImpl(DARK_MQ);
      } catch {
        return () => {};
      }
      const handler = (e: MediaQueryListEvent) => {
        listener(e.matches ? 'dark' : 'light');
      };
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
      }
      // Legacy Safari
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    },
  };
}

/** Test stub: a controllable system theme. */
export function createFakeSystemThemeSource(initial: ResolvedTheme = 'light'): SystemThemeSource & {
  set(theme: ResolvedTheme): void;
  listenerCount(): number;
} {
  let current: ResolvedTheme = initial;
  const listeners = new Set<(theme: ResolvedTheme) => void>();
  return {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(theme) {
      current = theme;
      for (const l of listeners) l(theme);
    },
    listenerCount: () => listeners.size,
  };
}
