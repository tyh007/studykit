/**
 * StudyKit v0.4 — `useLocationWatch` test
 *
 * Behavioural test: when the user navigates to a
 * different route / mode / container, the *transient*
 * context (selection + draft) is released. Pinned
 * context and the prompt survive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { useLocationWatch } from './useLocationWatch';
import { assistantSession } from '../kernel';
import { locationStore, useLocation } from '../../../app/v04/locationStore';
import { makeAppLocation } from '../../../domain/workspace';
import { flushSync } from 'react-dom';

// Tell React we're in an act-aware test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function syncAct<T>(fn: () => T): T {
  let result: T;
  act(() => {
    result = fn();
  });
  flushSync(() => undefined);
  return result!;
}

function Mount() {
  useLocationWatch();
  return <div data-testid="probe" data-location={JSON.stringify(useLocation())} />;
}

beforeEach(() => {
  cleanup();
  locationStore.replace(makeAppLocation({ mode: 'study', surface: 'study-home' }));
  assistantSession.__resetForTests();
});

afterEach(() => {
  cleanup();
  assistantSession.__resetForTests();
  vi.restoreAllMocks();
});

describe('useLocationWatch', () => {
  it('releases selection + draft on route change; keeps prompt + pinned', () => {
    syncAct(() => {
      render(<Mount />);
    });
    syncAct(() => {
      assistantSession.open({ surface: 'selection' });
      assistantSession.setPrompt('why');
      assistantSession.setSelection({ text: 'a passage', objectIds: ['o-1'] });
      assistantSession.pinContext('p-1');
    });
    expect(assistantSession.getSnapshot().selectedText).toBe('a passage');
    expect(assistantSession.getSnapshot().pinnedContextIds).toEqual(['p-1']);

    // Navigate to a different route.
    syncAct(() => {
      locationStore.push(
        makeAppLocation({
          mode: 'research',
          surface: 'research-home',
        }),
      );
    });

    const s = assistantSession.getSnapshot();
    expect(s.selectedText).toBeNull();
    expect(s.selectedObjectIds).toEqual([]);
    expect(s.draft).toBeNull();
    // Prompt + pinned survive.
    expect(s.prompt).toBe('why');
    expect(s.pinnedContextIds).toEqual(['p-1']);
  });

  it('does NOT release when the location is the same (idempotent)', () => {
    syncAct(() => {
      render(<Mount />);
    });
    syncAct(() => {
      assistantSession.open({ surface: 'selection' });
      assistantSession.setSelection({ text: 'a', objectIds: ['o-1'] });
    });
    // Re-push the SAME location.
    syncAct(() => {
      locationStore.push(
        makeAppLocation({ mode: 'study', surface: 'study-home' }),
      );
    });
    expect(assistantSession.getSnapshot().selectedText).toBe('a');
  });
});
