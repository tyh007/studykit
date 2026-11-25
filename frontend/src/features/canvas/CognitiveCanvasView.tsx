/**
 * StudyKit v0.4 — `features/canvas/CognitiveCanvasView`
 *
 * The thin wrapper that owns the *snapshot* /
 * *use-cases* pair and toggles between the spatial
 * (`CognitiveCanvasAdapter`) and the linear
 * (`CanvasOutline`) views.
 *
 * The view is the only place that subscribes to the
 * `CanvasRepository` for a given `viewId`; both
 * the adapter and the outline consume the *same*
 * snapshot via the `useCanvasView` hook.
 *
 * WP-06 Round 6: the repository is read from
 * `useCanvasRuntime()` (the single source of truth
 * that lives in the same React tree as the use
 * cases). When the view is mounted in a unit test
 * (no `CanvasUseCasesProvider`, only a
 * `<CanvasRepositoryProvider>`), the view falls
 * back to the context repository. The runtime
 * always takes precedence.
 *
 * The wrapper is also where the "Open in Canvas" entry
 * point is satisfied: callers pass `initialRefs` to
 * materialise a set of canonical refs (e.g. the
 * EvidenceWorkspace's selected rows) on first open.
 */

import React from 'react';

import { CognitiveCanvasAdapter } from './CognitiveCanvasAdapter';
import { CanvasOutline } from './CanvasOutline';
import { useCanvasView } from './useCanvasView';
import { useCanvasRepositoryOptional } from './canvasRepositoryContext';
import { useCanvasRuntime } from '../../app/v04/canvasWiringContext';
import { CanvasSurfaceProvider } from '../../components/literature/canvas/CanvasSurface';
import type { CanvasUseCases } from '../../application/canvas/canvasGateway';
import type { CanvasRepository } from '../../repositories/canvas';
import { refKey, type CanvasObjectRef } from '../../domain/canvas';
import type { ContainerRef } from '../../domain/workspace';

export interface CognitiveCanvasViewProps {
  readonly viewId: string;
  readonly useCases: CanvasUseCases;
  /**
   * Optional repository override. Production leaves
   * this `undefined`; the view reads from the
   * `useCanvasRuntime()` runtime. Tests that mount
   * the view outside the production `CanvasUseCasesProvider`
   * pass the `MemoryCanvasRepository` here so the
   * `useCanvasView` hook subscribes to the same
   * instance the use cases write to.
   */
  readonly repository?: CanvasRepository;
  /** Refs to materialise as placements on first
   *  open. The `openInCanvas` use case dedupes
   *  by ref id, so passing the same list twice is
   *  safe. */
  readonly initialRefs?: readonly CanvasObjectRef[];
}

export function CognitiveCanvasView(
  props: CognitiveCanvasViewProps,
): React.ReactElement {
  const { viewId, useCases, initialRefs } = props;
  // The runtime is the single source of truth. The
  // explicit `repository` prop wins when both are
  // present (a test-only escape hatch).
  const runtime = useCanvasRuntime();
  const contextRepository = useCanvasRepositoryOptional();
  const repository = props.repository ?? runtime?.repository ?? contextRepository;
  if (!repository) {
    return (
      <div
        className="literature-canvas"
        role="status"
        aria-live="polite"
        data-testid="cognitive-canvas-loading"
      >
        Loading canvas…
      </div>
    );
  }
  const { snapshot, subscribe, getSnapshot } = useCanvasView(viewId, useCases, repository);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  // Eagerly open the view when none exists yet. We do
  // this in the parent (CognitiveCanvasView) so the
  // adapter always has a non-empty snapshot to render
  // — otherwise it would mount a "Loading canvas…"
  // placeholder and the `useEffect`-driven open would
  // race with the snapshot subscription.
  const container = containerForView(viewId);
  const openedRef = React.useRef(false);
  React.useEffect(() => {
    if (openedRef.current) return;
    const current = getSnapshot();
    if (!current || current.view.id === '__empty__') {
      openedRef.current = true;
      void useCases.openInCanvas({
        viewId,
        container,
        ...(initialRefs && initialRefs.length > 0 ? { objectRefs: initialRefs } : {}),
      });
    } else {
      openedRef.current = true;
    }
  }, [viewId, useCases, getSnapshot, initialRefs, container]);

  if (!snapshot || snapshot.view.id === '__empty__') {
    return (
      <div
        className="literature-canvas"
        role="status"
        aria-live="polite"
        data-testid="cognitive-canvas-loading"
      >
        Loading canvas…
      </div>
    );
  }
  if (snapshot.view.mode === 'outline') {
    return (
      <CanvasOutline
        viewId={viewId}
        useCases={useCases}
        snapshot={snapshot}
        selectedRefKey={selectedKey}
        onSelect={setSelectedKey}
      />
    );
  }
  return (
    <CanvasSurfaceProvider>
      <CognitiveCanvasAdapter
        viewId={viewId}
        useCases={useCases}
        subscribe={subscribe}
        getSnapshot={getSnapshot}
      />
    </CanvasSurfaceProvider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a `viewId` to a `ContainerRef` for the use cases
 * that materialise free nodes / upgrades. The cognitive
 * canvas's own `viewId` does not carry a project id,
 * so this falls back to a stable placeholder. The V04
 * router passes a `viewId = canvas-<projectId>` so the
 * `id` resolves to the project.
 */
function containerForView(viewId: string): ContainerRef {
  const projectId = viewId.startsWith('canvas-') ? viewId.slice('canvas-'.length) : 'local';
  return {
    workspaceId: null,
    mode: 'research',
    kind: 'project',
    id: projectId,
  };
}

// `refKey` is re-exported so the test file can import
// the type guard helper from this module.
export { refKey };
