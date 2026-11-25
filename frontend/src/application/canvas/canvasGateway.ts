/**
 * StudyKit v0.4 — `application/canvas/canvasGateway`
 *
 * The application-layer entry point for the cognitive
 * canvas. The use cases live in
 * `application/canvas/canvasUseCases.ts`; this module
 * exports the *factory* the composition root uses to
 * build a `CanvasUseCases` value object.
 *
 * Per the v0.4 architecture (`frontend/src/ARCHITECTURE.md`
 * §1.3), `application/` may not import from `platforms/`,
 * `app/`, or `features/`. The Dexie / IndexedDB adapter
 * lives in `platforms/web/dexieCanvasRepository.ts` and is
 * injected by `app/canvas/canvasWiring.ts` at composition
 * time. Tests inject a `MemoryCanvasRepository` directly.
 *
 * The factory does:
 *
 *   - Build the `CanvasRepository` (Dexie in production,
 *     in-memory in tests).
 *   - Build the `StudyKitRepository` (the existing
 *     Dexie-backed implementation — `upgradeNode` is the
 *     only use case that writes through it; the canvas
 *     itself never reads from it).
 *   - Freeze the deps into a single value object the
 *     React components consume.
 *
 * Feature flag handling lives in the *composition root*,
 * not here. Use cases do not know about the flag.
 */

import type { CanvasRepository } from '../../repositories/canvas';
import type { StudyKitRepository } from '../../domain/repository';
import * as useCases from './canvasUseCases';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class CanvasFeatureOffError extends Error {
  constructor() {
    super(
      'Cognitive Canvas is disabled. Enable the v04Canvas feature flag to use this code path.',
    );
    this.name = 'CanvasFeatureOffError';
  }
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface CanvasUseCaseDeps {
  readonly repository: CanvasRepository;
  readonly objects: StudyKitRepository;
  readonly now: () => string;
  readonly newId: () => string;
}

// ---------------------------------------------------------------------------
// Frozen value object
// ---------------------------------------------------------------------------

/**
 * The frozen handle a React component or test driver uses
 * to invoke the use cases. The methods are bound at
 * construction time so the call site does not have to pass
 * the deps every time.
 *
 * Every method returns a discriminated result
 * (`{ ok: true, value } | { ok: false, error }`). The
 * caller is responsible for the `if (!result.ok)` branch;
 * the use cases never throw on expected error paths.
 */
export interface CanvasUseCases {
  readonly deps: CanvasUseCaseDeps;
  /**
   * Each method is bound to the deps at construction
   * time. The bound shape accepts only the `input` arg
   * (the deps are pre-baked) and returns a
   * `CanvasUseCaseResult<T>`. We declare the shape
   * explicitly here so the React side can call
   * `useCases.openInCanvas(input)` without TypeScript
   * complaining about missing `deps`.
   */
  openInCanvas(input: useCases.OpenInCanvasInput): Promise<useCases.CanvasUseCaseResult<useCases.OpenInCanvasOutput>>;
  addFreeNode(input: useCases.AddFreeNodeInput): Promise<useCases.CanvasUseCaseResult<useCases.AddFreeNodeOutput>>;
  updateFreeNode(input: useCases.UpdateFreeNodeInput): Promise<useCases.CanvasUseCaseResult<useCases.UpdateFreeNodeOutput>>;
  removePlacement(input: useCases.RemovePlacementInput): Promise<useCases.CanvasUseCaseResult<useCases.RemovePlacementOutput>>;
  deleteFreeNode(input: useCases.DeleteFreeNodeInput): Promise<useCases.CanvasUseCaseResult<useCases.DeleteFreeNodeOutput>>;
  upgradeNode(input: useCases.UpgradeNodeInput): Promise<useCases.CanvasUseCaseResult<useCases.UpgradeNodeOutput>>;
  movePlacement(input: useCases.MovePlacementInput): Promise<useCases.CanvasUseCaseResult<import('../../domain/canvas').ObjectPlacement>>;
  connectDraft(input: useCases.ConnectDraftInput): Promise<useCases.CanvasUseCaseResult<useCases.ConnectDraftOutput>>;
  acceptRelation(input: useCases.AcceptRelationInput): Promise<useCases.CanvasUseCaseResult<import('../../domain/canvas').CanvasRelation>>;
  rejectRelation(input: { viewId: string; relationId: string }): Promise<useCases.CanvasUseCaseResult<import('../../domain/canvas').CanvasRelation>>;
  deleteRelation(input: { viewId: string; relationId: string }): Promise<useCases.CanvasUseCaseResult<void>>;
  setViewMode(input: { viewId: string; mode: import('../../domain/canvas').CanvasViewMode }): Promise<useCases.CanvasUseCaseResult<import('../../domain/canvas').CanvasView>>;
  setViewport(input: { viewId: string; viewport: import('../../domain/canvas').CanvasViewport }): Promise<useCases.CanvasUseCaseResult<import('../../domain/canvas').CanvasView>>;
  undo(input: { viewId: string }): Promise<useCases.CanvasUseCaseResult<useCases.UndoOutput>>;
}

/**
 * Build a `CanvasUseCases` value object. The factory is
 * pure: it freezes the deps, binds the use cases, and
 * returns the handle. It does not import the Dexie
 * adapter; the composition root passes the right
 * `CanvasRepository` and `StudyKitRepository`.
 */
export function createCanvasUseCases(deps: CanvasUseCaseDeps): CanvasUseCases {
  return Object.freeze<CanvasUseCases>({
    deps,
    openInCanvas: (input) => useCases.openInCanvas(deps, input),
    addFreeNode: (input) => useCases.addFreeNode(deps, input),
    updateFreeNode: (input) => useCases.updateFreeNode(deps, input),
    removePlacement: (input) => useCases.removePlacement(deps, input),
    deleteFreeNode: (input) => useCases.deleteFreeNode(deps, input),
    upgradeNode: (input) => useCases.upgradeNode(deps, input),
    movePlacement: (input) => useCases.movePlacement(deps, input),
    connectDraft: (input) => useCases.connectDraft(deps, input),
    acceptRelation: (input) => useCases.acceptRelation(deps, input),
    rejectRelation: (input) => useCases.rejectRelation(deps, input),
    deleteRelation: (input) => useCases.deleteRelation(deps, input),
    setViewMode: (input) => useCases.setViewMode(deps, input),
    setViewport: (input) => useCases.setViewport(deps, input),
    undo: (input) => useCases.undo(deps, input),
  });
}

// Re-export the use case functions so callers (and
// tests) can import them from a single file.
export * from './canvasUseCases';
