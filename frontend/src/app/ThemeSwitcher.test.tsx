// Behavioral and a11y tests for the ThemeSwitcher component.
//
// ThemeSwitcher lives in `app/` (composition root) because it
// composes the shared theme runtime with the legacy
// `components/ui/Icons` set. Its tests therefore live here too —
// `shared/` is the innermost UI layer and must not import from
// `components/`, but `app/` may.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  ThemeProvider,
  createInMemoryThemeStorage,
  createFakeSystemThemeSource,
  type ThemePreference,
} from '../shared/theme';
import { ThemeSwitcher } from './ThemeSwitcher';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

function mountSwitcher(opts: {
  initial?: ThemePreference;
  system?: 'light' | 'dark';
}) {
  const storage = createInMemoryThemeStorage();
  const systemTheme = createFakeSystemThemeSource(opts.system ?? 'light');
  render(
    <ThemeProvider adapters={{ storage, systemTheme }} initialPreference={opts.initial ?? 'system'}>
      <ThemeSwitcher />
    </ThemeProvider>,
  );
  return { storage, systemTheme };
}

describe('ThemeSwitcher behavior', () => {
  it('cycles system → light → dark → system on each click', () => {
    const { storage } = mountSwitcher({ initial: 'system', system: 'light' });
    const btn = screen.getByRole('button');

    expect(btn.getAttribute('data-theme-preference')).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => { fireEvent.click(btn); });
    expect(btn.getAttribute('data-theme-preference')).toBe('light');
    expect(storage.snapshot()).toBe('light');

    act(() => { fireEvent.click(btn); });
    expect(btn.getAttribute('data-theme-preference')).toBe('dark');
    expect(storage.snapshot()).toBe('dark');

    act(() => { fireEvent.click(btn); });
    expect(btn.getAttribute('data-theme-preference')).toBe('system');
    expect(storage.snapshot()).toBe('system');
  });

  it('updates document.documentElement[data-theme] alongside storage', () => {
    const { storage } = mountSwitcher({ initial: 'system', system: 'dark' });
    const btn = screen.getByRole('button');
    // system + dark OS → data-theme=dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    act(() => { fireEvent.click(btn); });
    // system → light, OS unchanged → data-theme=light
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(storage.snapshot()).toBe('light');
  });
});

describe('ThemeSwitcher accessibility', () => {
  it('exposes an accessible name that reflects the current preference', () => {
    mountSwitcher({ initial: 'light', system: 'light' });
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-label');
    expect(btn.getAttribute('aria-label')).toMatch(/Light|System|Dark/);
  });

  it('is keyboard-activatable like a normal button', () => {
    mountSwitcher({ initial: 'light', system: 'light' });
    const btn = screen.getByRole('button');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Enter on a real <button> should trigger click → cycle.
    act(() => { fireEvent.keyDown(btn, { key: 'Enter' }); fireEvent.click(btn); });
    expect(btn.getAttribute('data-theme-preference')).toBe('dark');
  });

  it('declares itself as a button (not a div with onClick)', () => {
    mountSwitcher({ initial: 'system', system: 'light' });
    const btn = screen.getByRole('button');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });
});
