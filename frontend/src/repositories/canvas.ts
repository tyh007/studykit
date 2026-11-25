/**
 * StudyKit v0.4 — `repositories/canvas`
 *
 * The `CanvasRepository` is the contract surface for the
 * cognitive canvas (WP-06). It lives next to the existing
 * `StudyKitRepository` (which models the canonical
 * `KnowledgeObject` graph) because the canvas is a
 * *view layer* on top of the same objects: it stores
 * placements, free nodes, and relations, but it never
 * duplicates object bodies.
 *
 * Layering (per `frontend/src/ARCHITECTURE.md` §1.3):
 *
 *   - The contract lives in `repositories/` and may
 *     import from `domain/`. Nothing else.
 *   - The Dexie / IndexedDB adapter lives in
 *     `platforms/web/dexieCanvasRepository.ts`.
 *   - The in-memory test adapter lives in
 *     `repositories/memoryCanvasRepository.ts` (alongside
 *     the existing `MemoryRepository`).
 *   - The application use cases talk to the contract;
 *     they never import Dexie tables.
 *
 * Invariants (from `domain/canvas.ts`):
 *
 *   - `putPlacement` is idempotent on `id`. The same
 *     `viewId + ref` always collapses to the same row, so
 *     re-opening a view does not duplicate a node.
 *   - `putRelation` and `undo` are *atomic*: either every
 *     write applies or none of them do.
 *   - `subscribe(viewId)` fires on any change to the four
 *     canvas tables for that view. The composition root is
 *     the only place that wires subscriptions.
 *
 * The `featureFlagOn` boolean is *passed in* by the
 * application layer. The repository itself is unaware of
 * the `v04Canvas` flag — that decision lives in
 * `application/canvas/canvasGateway.ts` so use cases
 * don't have to know about feature flags.
 */

import type {
  CanvasRelation,
  CanvasView,
  CanvasViewSnapshot,
  FreeNode,
  ObjectPlacement,
  UndoLineage,
  UndoOp,
} from '../domain/canvas';
import type { ContainerRef } from '../domain/workspace';

// ---------------------------------------------------------------------------
// Listeners + transactions
// ---------------------------------------------------------------------------

export type CanvasListener = (snapshot: CanvasViewSnapshot) => void;
export type Unsubscribe = () => void;

export interface CanvasTransaction {
  putView(view: CanvasView): void;
  putFreeNode(node: FreeNode): void;
  deleteFreeNode(id: string): void;
  putPlacement(placement: ObjectPlacement): void;
  deletePlacement(id: string): void;
  putRelation(relation: CanvasRelation): void;
  deleteRelation(id: string): void;
  appendLineage(line: UndoLineage): void;
  /** Pop the most recent lineage entry for `viewId` that
   *  was not yet undone. Returns null when the stack is
   *  empty. The use case replays the inverse; this method
   *  just hands back the entry. */
  popLineage(viewId: string): UndoLineage | null;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface CanvasRepository {
  // --- Reads (per view) ---

  getView(viewId: string): Promise<CanvasView | null>;
  /**
   * List views attached to a container. Used by the UI to
   * pick "which canvas" when a user opens one from a
   * course / project home. Returns the most-recently
   * updated view first.
   */
  listViewsForContainer(container: ContainerRef): Promise<CanvasView[]>;
  /**
   * Build the full read-model for a view. The view may not
   * exist yet (in which case the snapshot's `view` is the
   * `nullView()` placeholder and the other fields are
   * empty). The use case is responsible for creating a
   * real view.
   */
  getViewSnapshot(viewId: string): Promise<CanvasViewSnapshot>;

  // --- Writes ---

  /**
   * Atomic write of any number of canvas records. The
   * callback receives a transaction handle; the use case
   * calls the methods on the handle in any order, and the
   * adapter commits them as one. If the callback throws,
   * none of the staged writes apply.
   */
  transact<T>(fn: (tx: CanvasTransaction) => T | Promise<T>): Promise<T>;

  // --- Subscriptions ---

  /**
   * Subscribe to changes that affect a single view. The
   * listener is called with a fresh `CanvasViewSnapshot`
   * on every commit that touches the view. The
   * subscription survives across `transact` boundaries.
   */
  subscribeView(viewId: string, listener: CanvasListener): Unsubscribe;

  // --- Diagnostics ---

  /**
   * Returns the most recent lineage entries for a view,
   * newest first. Used by the integration tests to
   * assert undo / redo behavior. Production UI never
   * reads this.
   */
  listLineage(viewId: string, limit?: number): Promise<UndoLineage[]>;
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Default placeholder for a non-existent view. The
 * application layer normally creates a real `CanvasView`
 * before reading a snapshot; this exists so the repository
 * can return *something* (an empty snapshot) instead of
 * `null`, which the UI cannot render.
 */
/**
 * Sentinel id for the placeholder view in an empty
 * snapshot. The application layer compares
 * `snapshot.view.id === EMPTY_VIEW_ID` to decide whether
 * a real view already exists; using the same id as the
 * requested view would falsely report "exists" and
 * suppress the `putView` call.
 */
export const EMPTY_VIEW_ID = '__empty__' as const;

/**
 * Default placeholder for a non-existent view. The
 * application layer normally creates a real `CanvasView`
 * before reading a snapshot; this exists so the repository
 * can return *something* (an empty snapshot) instead of
 * `null`, which the UI cannot render.
 */
export function emptyViewSnapshot(viewId: string): CanvasViewSnapshot {
  return {
    view: {
      id: EMPTY_VIEW_ID,
      container: { workspaceId: null, mode: 'study', kind: 'course', id: '__pending__' },
      title: 'Untitled canvas',
      mode: 'spatial',
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    freeNodes: [],
    placements: [],
    relations: [],
    nodes: new Map(),
    revision: 0,
  };
}

/**
 * The set of operations a use case can perform. The list
 * is the *minimum* WP-06 needs; future packets may add
 * to it. The `application/canvas/canvasUseCases.ts`
 * module is the only consumer of this constant.
 */
export const CANVAS_UNDO_OPS: readonly UndoOp[] = [
  'add-free-node',
  'upgrade-free-node',
  'add-placement',
  'move-placement',
  'open-in-canvas',
  'connect-preview',
  'accept-relation',
  'reject-relation',
  'delete-relation',
  'set-view-mode',
  'set-viewport',
] as const;
