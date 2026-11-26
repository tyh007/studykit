/**
 * StudyKit v0.5 — generic project workbench layout (ADR-003 §1–§2).
 *
 * Mode-agnostic: the host supplies the explorer, the editor registry
 * and titles. The workbench owns layout, tabs and the side bar.
 *
 * P1 renders one editor group and mounts only the active editor, so
 * heavy editors (PDF readers, canvases) do not stay alive in hidden
 * tabs.
 */

import React from 'react';
import './workbench.css';
import { inputKey, type EditorInput } from './workbenchState';
import type { WorkbenchController } from './useWorkbenchState';

export interface EditorDefinition {
  /** Render the editor for `input`. Called only for the active tab. */
  render(input: EditorInput): React.ReactNode;
}

export interface WorkbenchProps {
  readonly controller: WorkbenchController;
  readonly editors: Readonly<Record<string, EditorDefinition>>;
  readonly titleFor: (input: EditorInput) => string;
  /** Side bar content (the explorer). */
  readonly explorer: React.ReactNode;
  /** Accessible name of the side bar, e.g. "Project explorer". */
  readonly explorerLabel: string;
  /** Shown in the editor area when no tab is open. */
  readonly emptyState: React.ReactNode;
}

function useNarrowViewport(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const get = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [narrow, setNarrow] = React.useState(get);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setNarrow(mql.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);
  return narrow;
}

export function Workbench(props: WorkbenchProps): React.ReactElement {
  const { controller, editors, titleFor } = props;
  const { state } = controller;
  const narrow = useNarrowViewport(1023);
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  const sideVisible = narrow ? overlayOpen : state.sideOpen;
  const activeTab = state.tabs[state.active] ?? null;

  const toggleSide = (): void => {
    if (narrow) setOverlayOpen((v) => !v);
    else controller.setSideOpen(!state.sideOpen);
  };

  // Close the narrow-screen overlay once something is opened from it.
  const activeKey = activeTab ? inputKey(activeTab.input) : '';
  React.useEffect(() => {
    if (narrow) setOverlayOpen(false);
  }, [activeKey, narrow]);

  // Side bar resize (pointer drag on the splitter).
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.sideWidth;
    const onMove = (e: PointerEvent): void => controller.setSideWidth(startWidth + (e.clientX - startX));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onSplitterKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') controller.setSideWidth(state.sideWidth - 16);
    else if (event.key === 'ArrowRight') controller.setSideWidth(state.sideWidth + 16);
    else return;
    event.preventDefault();
  };

  const definition = activeTab ? editors[activeTab.input.kind] : undefined;

  return (
    <div
      className={`workbench${narrow ? ' workbench--narrow' : ''}${sideVisible ? ' workbench--side-open' : ''}`}
      data-testid="workbench"
      style={{ '--workbench-side-width': `${state.sideWidth}px` } as React.CSSProperties}
    >
      {sideVisible && (
        <aside className="workbench-side" aria-label={props.explorerLabel} data-testid="workbench-side">
          {props.explorer}
        </aside>
      )}
      {sideVisible && !narrow && (
        <div
          className="workbench-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side bar"
          aria-valuenow={state.sideWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={onSplitterKey}
        />
      )}
      {narrow && sideVisible && (
        <div className="workbench-scrim" aria-hidden="true" onClick={() => setOverlayOpen(false)} />
      )}
      <section className="workbench-main" aria-label="Editors">
        <div className="workbench-tabbar">
          <button
            type="button"
            className="workbench-icon-button"
            onClick={toggleSide}
            aria-label={sideVisible ? 'Hide side bar' : 'Show side bar'}
            aria-expanded={sideVisible}
            data-testid="workbench-toggle-side"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
              <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" />
            </svg>
          </button>
          <div className="workbench-tabs" role="tablist" aria-label="Open editors">
            {state.tabs.map((tab, index) => {
              const title = titleFor(tab.input);
              const selected = index === state.active;
              return (
                <div
                  key={inputKey(tab.input)}
                  className={`workbench-tab${selected ? ' is-active' : ''}${tab.preview ? ' is-preview' : ''}`}
                  data-testid="workbench-tab"
                  data-editor-kind={tab.input.kind}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`workbench-tab-${index}`}
                    aria-selected={selected}
                    aria-controls="workbench-editor"
                    className="workbench-tab-label"
                    title={tab.preview ? `${title} (preview)` : title}
                    onClick={() => controller.activate(index)}
                    onDoubleClick={() => controller.pin(index)}
                    onAuxClick={(e) => {
                      if (e.button === 1) controller.close(index);
                    }}
                  >
                    {title}
                  </button>
                  <button
                    type="button"
                    className="workbench-tab-close"
                    aria-label={`Close ${title}`}
                    onClick={() => controller.close(index)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div
          className="workbench-editor"
          id="workbench-editor"
          role={activeTab ? 'tabpanel' : undefined}
          aria-labelledby={activeTab ? `workbench-tab-${state.active}` : undefined}
          data-testid="workbench-editor"
          data-editor-kind={activeTab?.input.kind}
          // First interaction inside a preview editor pins it (VS Code).
          onInputCapture={() => {
            if (activeTab?.preview) controller.pin(state.active);
          }}
        >
          {activeTab && definition ? (
            <React.Suspense
              fallback={<p className="workbench-loading sk-delayed-fallback" role="status">Loading…</p>}
            >
              <React.Fragment key={inputKey(activeTab.input)}>{definition.render(activeTab.input)}</React.Fragment>
            </React.Suspense>
          ) : activeTab ? (
            <p className="workbench-loading" role="status">This item can’t be opened here.</p>
          ) : (
            props.emptyState
          )}
        </div>
      </section>
    </div>
  );
}
