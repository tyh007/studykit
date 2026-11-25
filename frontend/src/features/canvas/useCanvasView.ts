/**
 * StudyKit v0.4 — `features/canvas/useCanvasView`
 *
 * The single hook that wires a `CanvasRepository`
 * subscription to a React state. Both the spatial
 * adapter and the outline consume the same snapshot
 * this hook returns; the toggle does not move data.
 *
 * The hook is *only* the surface a component sees —
 * components never import the `CanvasRepository`
 * directly. The hook takes a `repository` argument;
 * production code passes the `runtime.repository`
 * from `useCanvasRuntime()`. Tests that mount the
 * cognitive canvas with `<CanvasRepositoryProvider>`
 * can pass the context repository instead.
 *
 * WP-06 Round 4: `listObjectRefs` was removed. The
 * adapter no longer needs it (the adapter only uses
 * the snapshot, not a separate "list objects" query).
 *
 * WP-06 Round 6: the hook signature now requires an
 * explicit `repository` argument so the use cases
 * and the subscription always share the *same*
 * repository instance. The previous version called
 * `useCanvasRepository()` which read from the
 * `<CanvasRepositoryProvider>` context — and the
 * provider was built in the router with a different
 * `createDexieCanvasRepository()` instance than the
 * one the use cases used, so live updates were
 * silently lost.
 */

import * as React from 'react';

import type { CanvasUseCases } from '../../application/canvas/canvasGateway';
import type { CanvasRepository } from '../../repositories/canvas';
import type { CanvasViewSnapshot } from '../../domain/canvas';

export interface UseCanvasViewResult {
  readonly snapshot: CanvasViewSnapshot | null;
  readonly subscribe: (listener: (s: CanvasViewSnapshot) => void) => () => void;
  readonly getSnapshot: () => CanvasViewSnapshot | null;
}

export function useCanvasView(
  viewId: string,
  _useCases: CanvasUseCases,
  repository: CanvasRepository,
): UseCanvasViewResult {
  const [snapshot, setSnapshot] = React.useState<CanvasViewSnapshot | null>(null);

  // Initial fetch + subscription.
  React.useEffect(() => {
    let cancelled = false;
    void repository.getViewSnapshot(viewId).then((initial) => {
      if (!cancelled) setSnapshot(initial);
    });
    const unsubscribe = repository.subscribeView(viewId, (next) => {
      if (!cancelled) setSnapshot(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repository, viewId]);

  // Stable function references for downstream components.
  const subscribe = React.useCallback(
    (listener: (s: CanvasViewSnapshot) => void) => repository.subscribeView(viewId, listener),
    [repository, viewId],
  );
  const getSnapshot = React.useCallback(() => snapshot, [snapshot]);

  return { snapshot, subscribe, getSnapshot };
}
