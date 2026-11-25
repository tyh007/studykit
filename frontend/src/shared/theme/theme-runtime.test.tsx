// Tests for the SHARED theme runtime: pure functions, storage adapter,
// system theme source, and the React provider's DOM contract.
//
// The ThemeSwitcher component lives in `app/` and has its own
// behavioral / a11y tests at src/app/ThemeSwitcher.test.tsx. This
// file does NOT import from `app/` or `components/` — it stays
// inside `shared/` so the import-boundary test can scan it freely.
//
// We use the global happy-dom environment. We do NOT render the legacy
// index.css, so DOM-only assertions stay local to the data-theme attribute.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  createInMemoryThemeStorage,
  createFakeSystemThemeSource,
  parseThemePreference,
  resolveTheme,
  toDataTheme,
  useTheme,
  useResolvedTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './index';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

function mount(opts: {
  initial?: ThemePreference;
  system?: ResolvedTheme;
  children?: React.ReactNode;
}) {
  const storage = createInMemoryThemeStorage();
  const systemTheme = createFakeSystemThemeSource(opts.system ?? 'light');
  const ui = render(
    <ThemeProvider adapters={{ storage, systemTheme }} initialPreference={opts.initial ?? 'system'}>
      {opts.children ?? <Probe />}
    </ThemeProvider>,
  );
  return { storage, systemTheme, ui };
}

function Probe() {
  const resolved = useResolvedTheme();
  return <span data-testid="resolved">{resolved}</span>;
}

/** Test helper: a button that calls setPreference on click. */
function makeSetter(getNext: (current: ThemePreference) => ThemePreference) {
  return function Setter({ id = 'force' }: { id?: string }) {
    const { preference, setPreference } = useTheme();
    return (
      <button onClick={() => setPreference(getNext(preference))} data-testid={id}>
        {id}
      </button>
    );
  };
}

describe('theme pure functions', () => {
  it('parseThemePreference accepts only the three documented values', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('auto')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference(undefined)).toBe('system');
    expect(parseThemePreference(42)).toBe('system');
  });

  it('resolveTheme passes through explicit preferences and resolves system', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('toDataTheme is the identity for our two resolved values', () => {
    expect(toDataTheme('light')).toBe('light');
    expect(toDataTheme('dark')).toBe('dark');
  });
});

describe('ThemeProvider DOM contract', () => {
  it('applies data-theme synchronously on first render', () => {
    mount({ initial: 'dark', system: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves system preference from the current OS theme', () => {
    mount({ initial: 'system', system: 'dark' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('updates data-theme when setPreference is called from a child', () => {
    const Force = makeSetter(() => 'dark');
    const { storage } = mount({
      initial: 'light',
      system: 'light',
      children: (
        <>
          <Probe />
          <Force />
        </>
      ),
    });
    act(() => {
      fireEvent.click(screen.getByTestId('force'));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(storage.snapshot()).toBe('dark');
  });
});

describe('ThemeProvider persistence', () => {
  it('rehydrates the preference from storage on mount', () => {
    const storage = createInMemoryThemeStorage('dark');
    const systemTheme = createFakeSystemThemeSource('light');
    render(
      <ThemeProvider adapters={{ storage, systemTheme }} initialPreference="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('exposes THEME_STORAGE_KEY as a stable non-empty string', () => {
    // The key is exported so future offline / desktop work can read it
    // without re-deriving the literal.
    expect(typeof THEME_STORAGE_KEY).toBe('string');
    expect(THEME_STORAGE_KEY.length).toBeGreaterThan(0);
  });

  it('persists via the storage adapter when a child calls setPreference', () => {
    const storage = {
      read: () => 'system' as ThemePreference,
      write: vi.fn(),
    };
    const systemTheme = createFakeSystemThemeSource('light');
    const Force = makeSetter(() => 'light');
    render(
      <ThemeProvider adapters={{ storage, systemTheme }} initialPreference="system">
        <Force />
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('force'));
    });
    expect(storage.write).toHaveBeenCalledWith('light');
  });
});

describe('ThemeProvider system change handling', () => {
  it('reacts to system theme changes when preference is system', () => {
    const { systemTheme } = mount({ initial: 'system', system: 'light' });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    act(() => {
      systemTheme.set('dark');
    });
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores system theme changes when preference is pinned to light', () => {
    const { systemTheme } = mount({ initial: 'light', system: 'light' });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    act(() => {
      systemTheme.set('dark');
    });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('resubscribes when preference flips back to system', () => {
    // Toggle between system and a pinned theme so we can prove
    // subscription re-attachment without depending on ThemeSwitcher.
    const Flip = makeSetter((current) => (current === 'system' ? 'light' : 'system'));
    const systemTheme = createFakeSystemThemeSource('light');
    const storage = createInMemoryThemeStorage();
    render(
      <ThemeProvider adapters={{ storage, systemTheme }} initialPreference="system">
        <Probe />
        <Flip />
      </ThemeProvider>,
    );
    // system change while in system mode is observed.
    act(() => {
      systemTheme.set('dark');
    });
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    // pin to light — system changes must be ignored.
    act(() => {
      fireEvent.click(screen.getByTestId('force'));
    });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    act(() => {
      systemTheme.set('dark');
    });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    // back to system — the subscription should be re-attached so future
    // system changes are observed again.
    act(() => {
      fireEvent.click(screen.getByTestId('force'));
    });
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    act(() => {
      systemTheme.set('light');
    });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });
});
