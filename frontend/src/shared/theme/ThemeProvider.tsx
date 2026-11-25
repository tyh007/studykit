// StudyKit Theme Runtime — React provider and hook.
//
// Responsibilities:
//   1. Set <html data-theme="..."> as the single source of truth for which
//      token block CSS should apply.
//   2. Keep the resolved theme in sync with the user preference and the
//      OS color scheme (when preference is 'system').
//   3. Persist user choice to the supplied storage adapter.
//   4. Avoid hydration flashes: the first render MUST already reflect the
//      current state, so initial state is computed synchronously from the
//      adapters (not inside an effect).
//
// What it does NOT do:
//   - Touch other layers (domain, app, features).
//   - Read the legacy WorkspaceSettings.theme field. That is a v0.3 storage
//     concern; the migration to write through here is WP-02 work.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  resolveTheme,
  toDataTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './types';
import type { ThemeStorage } from './storage';
import type { SystemThemeSource } from './systemTheme';

export interface ThemeRuntimeAdapters {
  storage: ThemeStorage;
  systemTheme: SystemThemeSource;
  /**
   * Optional override for the document target. Defaults to
   * `document.documentElement` (i.e. <html>).
   */
  documentTarget?: HTMLElement | null;
}

export interface ThemeContextValue {
  /** What the user asked for. */
  preference: ThemePreference;
  /** What is actually applied to <html data-theme>. */
  resolved: ResolvedTheme;
  /** Set and persist a new user preference. */
  setPreference(preference: ThemePreference): void;
}

const noop = () => {};
const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved: 'light',
  setPreference: noop,
});

export interface ThemeProviderProps {
  adapters: ThemeRuntimeAdapters;
  /** Initial preference if storage is empty. Defaults to 'system'. */
  initialPreference?: ThemePreference;
  children: React.ReactNode;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const { adapters, initialPreference = 'system', children } = props;
  const { storage, systemTheme, documentTarget } = adapters;

  // Read the preference synchronously so the first paint already has the
  // right data-theme. The bootstrap script in index.html has already set
  // data-theme, but we re-derive here in case the runtime is used without
  // the bootstrap (e.g. tests, Storybook, future Tauri).
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const fromStorage = storage.read();
    return fromStorage === 'system' && initialPreference !== 'system' ? initialPreference : fromStorage;
  });
  const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme.current());

  const resolved = useMemo(
    () => resolveTheme(preference, system),
    [preference, system],
  );

  // Apply data-theme whenever the resolved theme changes. We do this in an
  // effect so it is idempotent and safe under React 19 strict-mode double
  // invocation; the bootstrap script in index.html guarantees no flash
  // before the first effect runs.
  useEffect(() => {
    const target = documentTarget ?? (typeof document !== 'undefined' ? document.documentElement : null);
    if (!target) return;
    const next = toDataTheme(resolved);
    if (target.getAttribute('data-theme') !== next) {
      target.setAttribute('data-theme', next);
    }
  }, [resolved, documentTarget]);

  // Subscribe to system theme changes so the resolved theme tracks the OS
  // when the user has chosen 'system'. The subscription is intentionally
  // only active when preference === 'system' — there is no point in
  // re-rendering on OS changes for users who pinned a theme.
  useEffect(() => {
    if (preference !== 'system') return;
    return systemTheme.subscribe((next) => setSystem(next));
  }, [preference, systemTheme]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      storage.write(next);
      // Always re-derive the system theme on preference change. When the
      // user pins a theme this keeps the resolved value in sync; when they
      // switch back to 'system' it makes the subscription pick up the
      // current OS state on the very next render instead of the stale
      // snapshot we were holding while a theme was pinned.
      setSystem(systemTheme.current());
    },
    [storage, systemTheme],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Returns only the resolved theme — handy for components that don't care
 *  about the user preference but want a re-render on theme switch. */
export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext).resolved;
}
