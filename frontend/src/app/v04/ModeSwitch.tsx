/**
 * StudyKit v0.4 — `ModeSwitch`
 *
 * Two-tab switcher between Study and Research. Per D-011, Study
 * is the *first* focus on a fresh install, Research is *equally
 * visible* — never hidden.
 *
 * Switching mode:
 *   1. Clears *legacy in-memory selection only*. Dexie / IndexedDB rows
 *      are NOT touched; reload restores the user's data, the
 *      selection just resets to "no container picked".
 *   2. Pushes a new `AppLocation` so back / forward stay right.
 *
 * `AppLocation` is the only production navigation state. The
 * legacy `sidebarMode` remains inside the legacy app only and is
 * never written by this switch.
 */

import React from 'react';
import { useStore } from '../../store/useStore';
import { makeAppLocation } from '../../domain/workspace';
import { locationStore, useLocation } from './locationStore';
import { useWorkspaceFlavour } from '../../application/workspaceFlavour';

const MODES: ReadonlyArray<{ id: 'study' | 'research'; label: string; sidebarMode: 'modules' | 'literature'; surface: 'study-home' | 'research-home' }> = [
  { id: 'study', label: 'Study', sidebarMode: 'modules', surface: 'study-home' },
  { id: 'research', label: 'Research', sidebarMode: 'literature', surface: 'research-home' },
];

export function ModeSwitch(): React.ReactElement {
  const location = useLocation();
  const flavour = useWorkspaceFlavour();
  const selectModule = useStore((s) => s.selectModule);
  const selectLecture = useStore((s) => s.selectLecture);
  const selectLitProject = useStore((s) => s.selectLitProject);
  const selectLitPaper = useStore((s) => s.selectLitPaper);

  const switchTo = (mode: 'study' | 'research'): void => {
    if (mode === location.mode) return;
    // 1. Clear legacy selection. Data stays in Dexie; this only resets
    //    the v0.3 in-memory "what is the user looking at".
    selectModule(null);
    selectLecture(null);
    selectLitProject(null);
    selectLitPaper(null);
    // 2. Push the new top-level location.
    locationStore.push(
      makeAppLocation({ mode, surface: mode === 'study' ? 'study-home' : 'research-home' }),
    );
  };

  return (
    <div role="tablist" aria-label="Workspace mode" className="mode-switch" data-testid="mode-switch" data-flavour={flavour}>
      {MODES.map((m) => {
        const selected = m.id === location.mode;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => switchTo(m.id)}
            className={`mode-switch-tab${selected ? ' is-selected' : ''}`}
            data-testid={`mode-switch-${m.id}`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
