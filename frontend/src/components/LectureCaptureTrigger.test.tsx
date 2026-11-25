/**
 * StudyKit v0.4 — `LectureCaptureTrigger` production mount
 * (WP-04 Gate fix #2)
 *
 * The previous round shipped the `<LectureFocusAdapter>`
 * with no real consumer in the production surface tree.
 * The user's WP-04 Gate review caught it: the report
 * claimed "LectureFocusAdapter is mounted in the v0.3
 * body" but no real import existed.
 *
 * The fix: a `<LectureCaptureTrigger>` is rendered inside
 * the `<LectureView>` in `App.tsx`. This test mounts the
 * trigger directly and asserts:
 *
 *   1. Flag off → trigger returns `null`; the v0.3 surface
 *      is byte-for-byte unchanged.
 *   2. Flag on + no `<StudyProvider>` ancestor → the
 *      adapter throws (useStudyDeps has no Provider). The
 *      trigger does NOT silently swallow the throw.
 *   3. Flag on + a real `<StudyProvider>` ancestor → the
 *      trigger renders the adapter, which renders the
 *      "Capture / Understand" button. The user can
 *      click the button to open the drawer.
 *
 * The test does NOT bypass the adapter or stub the
 * `useStudyDeps` call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LectureCaptureTrigger } from './LectureCaptureTrigger';
import { StudyProvider } from '../features/study';
import {
  __resetAiKernelForTests,
  draftLayer,
} from '../features/ai';
import {
  __resetFeatureFlagsForTests,
  __setFeatureFlagForTests,
} from '../app/feature-flags';
import { setWorkspaceFlavour } from '../application/dataGateway';
import { useStore } from '../store/useStore';
import { locationStore } from '../app/v04/locationStore';
import { makeAppLocation } from '../domain/workspace';
import { MemoryStudyRepository } from '../application/study/studyRepository';
import type { UseCaseDeps } from '../application/study/studyUseCases';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setWorkspaceFlavour('local');
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
  __resetFeatureFlagsForTests();
  useStore.getState().resetStore();
  act(() => {
    locationStore.replace(
      makeAppLocation({
        mode: 'study',
        surface: 'lecture',
        container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c-1' },
        surfaceId: 'lec-1',
      }),
    );
  });
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
  __resetAiKernelForTests();
  draftLayer.__resetForTests();
});

describe('components/LectureCaptureTrigger / production mount', () => {
  it('flag off: returns null; no DOM, no provider needed', () => {
    __setFeatureFlagForTests('v04Study', false);
    const { container } = render(
      <LectureCaptureTrigger courseId="c-1" lectureId="lec-1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('flag on + no provider: the adapter throws (no silent fallback)', () => {
    __setFeatureFlagForTests('v04Study', true);
    expect(() => {
      render(<LectureCaptureTrigger courseId="c-1" lectureId="lec-1" />);
    }).toThrow(/no <StudyProvider> ancestor/);
  });

  it('flag on + real provider: the Capture / Understand button is rendered', () => {
    __setFeatureFlagForTests('v04Study', true);
    const deps: UseCaseDeps & { repository: MemoryStudyRepository } = {
      repository: new MemoryStudyRepository(),
      providerRouter: undefined,
      draftLayer,
    };
    render(
      <StudyProvider
        value={deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
      >
        <LectureCaptureTrigger courseId="c-1" lectureId="lec-1" />
      </StudyProvider>,
    );
    const btn = screen.getByTestId('v04-lecture-focus-open-understand');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toBe('Capture / Understand');
  });

  it('flag on + real provider: clicking the button opens the UnderstandDrawer', async () => {
    const user = userEvent.setup();
    __setFeatureFlagForTests('v04Study', true);
    const deps: UseCaseDeps & { repository: MemoryStudyRepository } = {
      repository: new MemoryStudyRepository(),
      providerRouter: undefined,
      draftLayer,
    };
    render(
      <StudyProvider
        value={deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
      >
        <LectureCaptureTrigger courseId="c-1" lectureId="lec-1" />
      </StudyProvider>,
    );
    await user.click(screen.getByTestId('v04-lecture-focus-open-understand'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-drawer')).toBeInTheDocument();
    });
  });

  it('flag off → on: the button appears without remounting the host', async () => {
    const user = userEvent.setup();
    __setFeatureFlagForTests('v04Study', false);
    const deps: UseCaseDeps & { repository: MemoryStudyRepository } = {
      repository: new MemoryStudyRepository(),
      providerRouter: undefined,
      draftLayer,
    };
    const { rerender } = render(
      <StudyProvider
        value={deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
      >
        <LectureCaptureTrigger courseId="c-1" lectureId="lec-1" />
      </StudyProvider>,
    );
    expect(screen.queryByTestId('v04-lecture-focus-open-understand')).toBeNull();
    // Flip the flag on.
    __setFeatureFlagForTests('v04Study', true);
    rerender(
      <StudyProvider
        value={deps as unknown as Parameters<typeof StudyProvider>[0]['value']}
      >
        <LectureCaptureTrigger courseId="c-1" lectureId="lec-1" />
      </StudyProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('v04-lecture-focus-open-understand')).toBeInTheDocument();
    });
    // Click it; the drawer opens.
    await user.click(screen.getByTestId('v04-lecture-focus-open-understand'));
    await waitFor(() => {
      expect(screen.getByTestId('v04-understand-drawer')).toBeInTheDocument();
    });
  });
});
