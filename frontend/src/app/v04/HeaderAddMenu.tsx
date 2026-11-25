import React from 'react';
import { makeAppLocation, type SurfaceKind } from '../../domain/workspace';
import { AddIcon } from '../../components/ui/Icons';
import { locationStore, useLocation } from './locationStore';

/** Shell-level entry into existing canonical creation surfaces. */
export function HeaderAddMenu(): React.ReactElement {
  const location = useLocation();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const go = (surface: SurfaceKind, params?: Readonly<Record<string, string>>): void => {
    locationStore.push(makeAppLocation({
      mode: location.mode,
      surface,
      ...(location.container ? { container: location.container } : {}),
      ...(params ? { params } : {}),
    }));
    setOpen(false);
  };

  return (
    <div className="v04-header-add" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="v04-header-add-menu"
        onClick={() => setOpen((current) => !current)}
        data-testid="v04-header-add"
      >
        <AddIcon size="sm" />
        Add
      </button>
      {open ? (
        <div id="v04-header-add-menu" className="v04-header-add-menu" role="menu" aria-label="Add to current context">
          {location.mode === 'study' ? (
            location.container ? (
              <>
                <button type="button" role="menuitem" onClick={() => go('course', { add: '1' })}>Lecture, material, or blank notes</button>
                <button type="button" role="menuitem" onClick={() => go('study-canvas')}>Idea on canvas</button>
              </>
            ) : (
              <button type="button" role="menuitem" onClick={() => go('study-home', { add: '1' })}>Course</button>
            )
          ) : location.container ? (
            <>
              <button type="button" role="menuitem" onClick={() => go('library', { view: 'library', add: '1' })}>Sources</button>
              <button type="button" role="menuitem" onClick={() => go('evidence')}>Evidence from a source</button>
              <button type="button" role="menuitem" onClick={() => go('project', { details: '1' })}>Question, task, design, or output</button>
              <button type="button" role="menuitem" onClick={() => go('cognitive-canvas')}>Idea on canvas</button>
            </>
          ) : (
            <button type="button" role="menuitem" onClick={() => go('research-home', { add: '1' })}>Research project</button>
          )}
        </div>
      ) : null}
    </div>
  );
}
