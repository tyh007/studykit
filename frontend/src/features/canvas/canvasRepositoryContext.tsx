/**
 * StudyKit v0.4 — `features/canvas/canvasRepositoryContext`
 *
 * The React context that hands a `CanvasRepository` to
 * the cognitive canvas. The composition root in
 * `app/v04/canvasWiringContext.tsx` builds a single
 * `CanvasRuntime { useCases, repository }` value object
 * for the cognitive canvas; the runtime is the *single
 * source of truth* and the production router never
 * builds a parallel repository.
 *
 * This context remains as a *legacy* test-only seam:
 * the existing unit tests (`cognitiveCanvas.test.tsx`)
 * mount `<CanvasRepositoryProvider>` to inject a
 * `MemoryCanvasRepository`. New tests that need a
 * full production composition should use
 * `<CanvasRuntimeOverride>` from the v04 wiring.
 *
 * When no provider is mounted, the context falls back
 * to a *fresh* `MemoryCanvasRepository` so unit tests
 * that render the view without the provider still get
 * a working state. The fallback is deliberately
 * fragile: production code MUST go through the
 * runtime.
 */

import * as React from 'react';

import { MemoryCanvasRepository } from '../../repositories/memoryCanvasRepository';
import type { CanvasRepository } from '../../repositories/canvas';

const CanvasRepositoryContext = React.createContext<CanvasRepository | null>(null);

export interface CanvasRepositoryProviderProps {
  readonly value: CanvasRepository;
  readonly children: React.ReactNode;
}

export function CanvasRepositoryProvider(
  props: CanvasRepositoryProviderProps,
): React.ReactElement {
  return (
    <CanvasRepositoryContext.Provider value={props.value}>
      {props.children}
    </CanvasRepositoryContext.Provider>
  );
}

/**
 * React hook variant. Used by components that are
 * already inside a `<CanvasRepositoryProvider>`.
 * Throws if the provider is not mounted (production
 * code should always have the provider; tests inject
 * a provider too).
 */
export function useCanvasRepository(): CanvasRepository {
  const value = React.useContext(CanvasRepositoryContext);
  if (!value) {
    throw new Error(
      'useCanvasRepository: no <CanvasRepositoryProvider> ancestor. The cognitive canvas is opt-in; ' +
        'mount <CanvasRepositoryProvider> in the V04 shell when the v04Canvas flag is on.',
    );
  }
  return value;
}

/**
 * Optional variant. Returns `null` when the provider
 * is not mounted. Used by `CognitiveCanvasView` to
 * fall back to the runtime's repository when no
 * `<CanvasRepositoryProvider>` is present.
 */
export function useCanvasRepositoryOptional(): CanvasRepository | null {
  return React.useContext(CanvasRepositoryContext);
}
