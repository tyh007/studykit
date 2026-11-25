/**
 * StudyKit v0.4 — `app/` barrel.
 *
 * App-shell level concerns live here: feature flags, theme
 * switcher, and the v04 Local-first App Shell composition. The
 * v04 shell re-exports through `./v04`. Consumers import the
 * shell from this barrel, not from individual files.
 */

export * from './feature-flags';
export { ThemeSwitcher, type ThemeSwitcherProps } from './ThemeSwitcher';
export * from './v04';
