// StudyKit Theme Runtime — public type contract.
// This file is the single source of truth for the theme vocabulary used by
// the rest of the app. It is intentionally tiny so it can be imported by the
// index.html bootstrap script (compiled to JS) without dragging React in.

/** What the user can ask for. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** The actual theme currently applied to <html data-theme>. */
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key for the persisted user preference. */
export const THEME_STORAGE_KEY = 'studykit.theme';

/** Validates a value read from storage. Falls back to 'system'. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

/** Resolve a preference against the current system color scheme. */
export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference;
}

/** The data-theme attribute values that map to our token blocks. */
export function toDataTheme(resolved: ResolvedTheme): 'light' | 'dark' {
  return resolved;
}
