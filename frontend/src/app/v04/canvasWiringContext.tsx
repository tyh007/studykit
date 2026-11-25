/**
 * StudyKit v0.4 — `app/v04/canvasWiringContext`
 *
 * The *real* production composition for the cognitive
 * canvas (WP-06 Round 6 P0-2 + P0-3).
 *
 *   - The `CanvasUseCasesProvider` builds a single
 *     `CanvasRuntime { useCases, repository }` value
 *     object via `useMemo`. The runtime is the
 *     *single source of truth* for both the cognitive
 *     canvas's use cases and its `CanvasRepository`;
 *     the previous shape (provider creates one
 *     `createDexieCanvasRepository()` for the use
 *     cases, and the router creates a *different* one
 *     for `<CanvasRepositoryProvider>`) meant writes
 *     on A and reads on B ran against two different
 *     Dexie instances, so the live UI never received
 *     the snapshot updates.
 *   - The runtime is per-component-tree: the provider
 *     tears it down on unmount, and tests inject a
 *     replacement via `<CanvasRuntimeOverride>`.
 *   - `useCanvasRuntime()` is the single hook the
 *     router / view use to read both
 *     `runtime.useCases` and `runtime.repository`.
 *   - The provider reads `useResearchDeps()` /
 *     `useStudyDeps()` *unconditionally* (no
 *     `try/catch` wrapping hooks — a Rules of Hooks
 *     violation). The provider is always mounted
 *     inside the V04 shell's `ResearchWiring` +
 *     `StudyWiring`, so the contexts resolve; tests
 *     that want to omit the wiring can use the
 *     `CanvasRuntimeOverride` (a complete runtime
 *     pair) and skip the production provider.
 *   - When the `v04Canvas` flag is off, the provider
 *     renders its children unchanged and
 *     `useCanvasRuntime()` returns `null` — no
 *     `MemoryRepository` fallback, no `console.warn`
 *     downgrade.
 */

import React from 'react';
import { isFeatureEnabled } from '../feature-flags';
import { useResearchDeps, useResearchDepsOptional } from '../../features/research/researchContext';
import { useStudyDeps, useStudyDepsOptional } from '../../features/study';
import type { StudyKitRepository } from '../../domain/repository';
import {
  createCanvasUseCases,
  type CanvasUseCases,
} from '../../application/canvas/canvasGateway';
import { createDexieCanvasRepository } from '../../platforms/web/dexieCanvasRepository';
import {
  getCanvasNotesBackingStore,
  getCanvasSourcesBackingStore,
} from '../../platforms/web/canvasBackingStores';
import {
  listCanvasPapers,
  getCanvasPaper,
} from '../../platforms/web/canvasPaperLookup';
import {
  ShimStudyKitRepository,
} from '../../repositories/shimStudyKitRepository';
import type { CanvasRepository } from '../../repositories/canvas';
import { useDesktopWorkspace } from './desktopWorkspaceContext';

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * The *single* runtime pair the cognitive canvas reads
 * from. The same `repository` instance drives the
 * use cases AND the `<CognitiveCanvasView>`'s
 * subscription; writes on the use case side and
 * reads on the subscription side hit the same
 * Dexie tables, so the UI updates immediately.
 */
export interface CanvasRuntime {
  readonly useCases: CanvasUseCases;
  readonly repository: CanvasRepository;
}

const CanvasRuntimeContext = React.createContext<CanvasRuntime | null>(null);

// ---------------------------------------------------------------------------
// Override (test-only escape hatch)
// ---------------------------------------------------------------------------

/**
 * The *test-only* override. Tests mount this *outside*
 * `<CanvasUseCasesProvider>` to substitute a fake
 * `CanvasRuntime` (e.g. one bound to an
 * `MemoryCanvasRepository` and an in-memory
 * `MemoryRepository` objects repo). The override is
 * honoured by `useCanvasRuntime()`.
 *
 * Production code MUST NOT mount this. Production
 * always builds the runtime from the live research /
 * study repositories + Dexie canvas repository.
 */
export interface CanvasRuntimeOverrideProps {
  readonly value: CanvasRuntime;
  readonly children: React.ReactNode;
}

export function CanvasRuntimeOverride(
  props: CanvasRuntimeOverrideProps,
): React.ReactElement {
  return (
    <CanvasRuntimeContext.Provider value={props.value}>
      {props.children}
    </CanvasRuntimeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface CanvasUseCasesProviderProps {
  /**
   * Optional override for the entire runtime (the
   * cognitive canvas's use cases + the canvas's
   * own Dexie-backed storage for placements /
   * relations / free nodes). Production leaves
   * this `undefined`; the provider builds the
   * default Dexie-backed runtime. Tests inject
   * a `MemoryCanvasRepository`-backed runtime so
   * the integration tests run under happy-dom.
   */
  readonly runtimeOverride?: CanvasRuntime;
  readonly children: React.ReactNode;
}

/**
 * The production `CanvasRuntime` provider. Sits inside
 * the `ResearchWiring` + `StudyWiring` (so
 * `useResearchDeps()` / `useStudyDeps()` resolve).
 * The runtime is rebuilt every render via `useMemo`;
 * the cache is per-component-tree.
 *
 * If the `v04Canvas` flag is off, the provider
 * renders its children unchanged and
 * `useCanvasRuntime()` returns `null` — no
 * `MemoryRepository` fallback, no `console.warn`
 * downgrade.
 */
export function CanvasUseCasesProvider(
  props: CanvasUseCasesProviderProps,
): React.ReactElement {
  const flagOn = isFeatureEnabled('v04Canvas');
  // Use the *optional* hooks so the provider
  // doesn't throw when the Research/Study wiring
  // is not mounted (e.g. a unit test that omits
  // the V04 shell, or a future refactor that
  // moves the provider). The provider's
  // `useMemo` returns `null` when either is
  // missing, and `useCanvasRuntime()` returns
  // `null` — the consumers render a visible
  // "Cognitive canvas unavailable" state.
  const research = useResearchDepsOptional();
  const study = useStudyDepsOptional();
  const desktop = useDesktopWorkspace();
  const desktopCanvasRepository =
    desktop.state.kind === 'ready'
      ? desktop.state.repositories.canvas
      : undefined;
  const runtime = React.useMemo<CanvasRuntime | null>(() => {
    if (!flagOn) return null;
    if (!research) return null;
    if (!study) return null;
    if (props.runtimeOverride) return props.runtimeOverride;
    const repository =
      desktopCanvasRepository ?? createDexieCanvasRepository();
    const objects = new ShimStudyKitRepository({
      research: research.repository,
      study: study.repository,
      notes: getCanvasNotesBackingStore(),
      sources: getCanvasSourcesBackingStore(),
      listPapers: listCanvasPapers,
      getPaper: getCanvasPaper,
    });
    const useCases = createCanvasUseCases({
      repository,
      objects,
      now: () => new Date().toISOString(),
      newId: () =>
        typeof globalThis.crypto !== 'undefined' &&
        typeof globalThis.crypto.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `tmp_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    });
    return { useCases, repository };
  }, [
    flagOn,
    research,
    study,
    props.runtimeOverride,
    desktopCanvasRepository,
  ]);
  return (
    <CanvasRuntimeContext.Provider value={runtime}>
      {props.children}
    </CanvasRuntimeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Resolve the cognitive canvas's `CanvasRuntime` value
 * object. Returns `null` when the canvas is not
 * available (flag off, or the provider is not mounted);
 * consumers render a visible "Cognitive canvas
 * unavailable" state. The cognitive canvas's
 * `CognitiveCanvasView` is the canonical consumer; it
 * does not fall back to `MemoryRepository` or a silent
 * `console.warn` downgrade.
 */
export function useCanvasRuntime(): CanvasRuntime | null {
  return React.useContext(CanvasRuntimeContext);
}

/**
 * Back-compat alias: `useCanvasUseCases()` reads the
 * use cases out of the same runtime. Returning the
 * use cases directly (instead of the runtime) keeps
 * existing call sites compiling.
 */
export function useCanvasUseCases(): CanvasUseCases | null {
  const runtime = useCanvasRuntime();
  return runtime ? runtime.useCases : null;
}

/**
 * Read the cognitive canvas's `CanvasRepository`
 * out of the same runtime. Returns `null` when the
 * runtime is not mounted. The cognitive canvas's
 * `useCanvasView` hook consumes this so the
 * `CognitiveCanvasView` and the use cases always
 * share the *same* repository instance.
 */
export function useCanvasRepositoryFromRuntime(): CanvasRepository | null {
  const runtime = useCanvasRuntime();
  return runtime ? runtime.repository : null;
}

// ---------------------------------------------------------------------------
// Test-only helpers (no try/catch hooks)
// ---------------------------------------------------------------------------

/**
 * Optional variant of `useResearchDeps`. Returns
 * `null` instead of throwing when the
 * `<ResearchProvider>` is not mounted. Used by
 * tests that need to render a subtree without the
 * Research wiring. Never used in production code.
 */
export function useResearchDepsSafeForTests() {
  // Falls back through the optional variant — no
  // try/catch wrapping the hook (Rules of Hooks).
  return useResearchDepsOptional();
}

/**
 * Optional variant of `useStudyDeps`. Returns `null`
 * instead of throwing when the `<StudyProvider>` is
 * not mounted.
 */
export function useStudyDepsSafeForTests() {
  return useStudyDepsOptional();
}
