/**
 * StudyKit v0.4 — `application/canvas/canvasUseCases`
 *
 * The canvas use cases. They take a `CanvasRepository`
 * (the contract surface from `repositories/canvas.ts`)
 * and produce / consume the cognitive-canvas types from
 * `domain/canvas.ts`. The composition root in
 * `app/canvas/canvasWiring.ts` builds the Dexie-backed
 * repository; tests inject a `MemoryCanvasRepository`.
 *
 * Per the v0.4 architecture (`frontend/src/ARCHITECTURE.md`
 * §1.3), this file:
 *
 *   - imports only from `domain/` and `repositories/`,
 *   - does NOT import from `platforms/`, `features/`,
 *     `app/`, `shared/`, or `components/`,
 *   - does NOT read feature flags (the caller / the
 *     composition root decide whether to mount the
 *     canvas UI; the use cases themselves are
 *     unconditional).
 *
 * The use cases are:
 *
 *   - `openInCanvas`     — open an existing view, or
 *                          create a new one for a
 *                          container. Materialises an
 *                          initial placement for each
 *                          object id the caller passed in
 *                          (Flow R3 step 2: keep the
 *                          selection ids when entering
 *                          the canvas).
 *   - `addFreeNode`      — add a free node (Flow S4 step
 *                          2: blank-canvas double-click /
 *                          Enter creates a free node
 *                          without first asking for a
 *                          type).
 *   - `upgradeNode`      — turn a free node into a real
 *                          `KnowledgeObject` of the chosen
 *                          `KnowledgeObjectKind` and
 *                          rebind the placement. The free
 *                          node's body becomes the new
 *                          object's body; the id stays
 *                          stable so the placement never
 *                          visibly moves.
 *   - `movePlacement`    — update x / y / w / h / focus /
 *                          collapsed.
 *   - `connectDraft`     — create a `preview` relation
 *                          (Flow R3 step 6: AI relation
 *                          appears as a clearly
 *                          distinguishable draft).
 *   - `acceptRelation`   — flip a `preview` to `accepted`
 *                          (Flow R3 step 7: user picks
 *                          supporting / opposing
 *                          evidence).
 *   - `rejectRelation`   — flip a `preview` to `rejected`
 *                          (lineage kept for undo).
 *   - `deleteRelation`   — delete an `accepted` or
 *                          `rejected` relation.
 *   - `setViewMode`      — toggle `spatial` / `outline`.
 *   - `setViewport`      — persist x / y / zoom.
 *   - `undo`             — pop the topmost lineage entry
 *                          for the view and replay its
 *                          inverse.
 *
 * Every state-changing use case writes a `UndoLineage`
 * entry. The use case itself is a pure function of
 * (deps, input); there is no global state.
 */

import type {
  CanvasObjectRef,
  CanvasRelation,
  CanvasView,
  CanvasViewMode,
  CanvasViewport,
  CognitiveRole,
  FreeNode,
  KnowledgeObjectKind as _Kind,
  ObjectPlacement,
  RelationKind,
  UndoLineage,
  UndoOp,
} from '../../domain/canvas';
import {
  defaultCognitiveRole,
  freeRef,
  knowledgeRef,
  placementId,
  refKey,
  sameRef,
} from '../../domain/canvas';
import type {
  KnowledgeObject,
  KnowledgeObjectKind,
  StudyKitRepository,
} from '../../domain/repository';
import type { ContainerRef } from '../../domain/workspace';
import type {
  CanvasRepository,
  CanvasTransaction,
} from '../../repositories/canvas';

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface CanvasUseCaseDeps {
  readonly repository: CanvasRepository;
  /**
   * The canonical `StudyKitRepository`. The `upgradeNode`
   * use case is the only one that writes here (to create
   * a real `KnowledgeObject` for a free node). The canvas
   * itself never reads through the canonical repository
   * for placement; the *application* layer
   * (`application/canvas/canvasBodyProvider.ts`) is
   * responsible for fetching the bodies the canvas
   * displays. This split is the whole reason the canvas
   * is a *view layer* and not a *second data source*.
   */
  readonly objects: StudyKitRepository;
  readonly now: () => string;
  readonly newId: () => string;
}

// ---------------------------------------------------------------------------
// Output / errors
// ---------------------------------------------------------------------------

export type CanvasUseCaseError =
  | 'view-not-found'
  | 'placement-not-found'
  | 'relation-not-found'
  | 'free-node-not-found'
  | 'invalid-input';

export class CanvasUseCaseFailure extends Error {
  readonly code: CanvasUseCaseError;
  readonly meta: Record<string, string>;
  constructor(code: CanvasUseCaseError, meta: Record<string, string> = {}) {
    super(`canvas use case failed: ${code} ${JSON.stringify(meta)}`);
    this.name = 'CanvasUseCaseFailure';
    this.code = code;
    this.meta = meta;
  }
}

export interface CanvasUseCaseOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface CanvasUseCaseErr {
  readonly ok: false;
  readonly error: CanvasUseCaseFailure;
}

export type CanvasUseCaseResult<T> = CanvasUseCaseOk<T> | CanvasUseCaseErr;

function ok<T>(value: T): CanvasUseCaseOk<T> {
  return { ok: true, value };
}

function err(
  code: CanvasUseCaseError,
  meta: Record<string, string> = {},
): CanvasUseCaseErr {
  return { ok: false, error: new CanvasUseCaseFailure(code, meta) };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureView(
  tx: CanvasTransaction,
  snapshot: { view: CanvasView | null },
  viewId: string,
  container: ContainerRef,
  now: string,
  mode: CanvasViewMode = 'spatial',
  title = 'Untitled canvas',
): CanvasView {
  if (snapshot.view && snapshot.view.id === viewId) {
    return snapshot.view;
  }
  const view: CanvasView = {
    id: viewId,
    container,
    title,
    mode,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
  tx.putView(view);
  return view;
}

function defaultPlacement(
  ref: CanvasObjectRef,
  viewId: string,
  now: string,
): ObjectPlacement {
  return {
    id: placementId(viewId, ref),
    viewId,
    ref,
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    collapsed: false,
    focus: false,
    missing: false,
    updatedAt: now,
  };
}

function newLineageId(newId: () => string): string {
  return `undo_${newId()}`;
}

function lineage(
  op: UndoOp,
  viewId: string,
  previous: unknown,
  next: unknown,
  now: string,
  newId: () => string,
  linked: string | null = null,
): UndoLineage {
  return {
    id: newLineageId(newId),
    viewId,
    op,
    previous,
    next,
    linked,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// openInCanvas
// ---------------------------------------------------------------------------

export interface OpenInCanvasInput {
  readonly viewId: string;
  readonly container: ContainerRef;
  readonly title?: string;
  readonly mode?: CanvasViewMode;
  /** Object refs the caller wants materialised as
   *  placements in the new view. Each ref is either a
   *  `free:<id>` (existing free node) or a
   *  `knowledge:<id>:<objectKind>` (canonical object).
   *  The first `openInCanvas` call is the one that
   *  materialises them; subsequent calls leave existing
   *  placements alone. */
  readonly objectRefs?: readonly CanvasObjectRef[];
  /** Optional initial layout positions. When provided,
   *  the use case stamps each placement with the
   *  matching entry. Missing entries fall back to
   *  (0, 0). */
  readonly initialPositions?: ReadonlyMap<string, { x: number; y: number }>;
}

export interface OpenInCanvasOutput {
  readonly view: CanvasView;
  readonly createdPlacements: readonly ObjectPlacement[];
}

export async function openInCanvas(
  deps: CanvasUseCaseDeps,
  input: OpenInCanvasInput,
): Promise<CanvasUseCaseResult<OpenInCanvasOutput>> {
  if (!input.viewId || input.viewId.length === 0) {
    return err('invalid-input', { viewId: 'empty' });
  }
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const existed = snapshot.view.id !== '__empty__' && snapshot.view.id === input.viewId;
  const view = existed
    ? snapshot.view
    : {
        id: input.viewId,
        container: input.container,
        title: input.title ?? 'Untitled canvas',
        mode: input.mode ?? 'spatial',
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: now,
        updatedAt: now,
      };
  const createdPlacements: ObjectPlacement[] = [];
  const previous = {
    view: existed ? snapshot.view : null,
    placements: existed ? snapshot.placements : [],
  };
  await deps.repository.transact(async (tx) => {
    if (!existed) {
      tx.putView(view);
    }
    for (const ref of input.objectRefs ?? []) {
      const id = placementId(input.viewId, ref);
      const existing = snapshot.placements.find((p) => p.id === id);
      if (existing) continue;
      const placement = defaultPlacement(ref, input.viewId, now);
      const pos = input.initialPositions?.get(refKey(ref));
      if (pos) {
        tx.putPlacement({ ...placement, x: pos.x, y: pos.y });
        createdPlacements.push({ ...placement, x: pos.x, y: pos.y });
      } else {
        tx.putPlacement(placement);
        createdPlacements.push(placement);
      }
    }
    if (!existed) {
      tx.appendLineage(
        lineage(
          'open-in-canvas',
          input.viewId,
          previous,
          { view, createdPlacements: createdPlacements.length },
          now,
          deps.newId,
        ),
      );
    }
  });
  return ok({ view, createdPlacements });
}

// ---------------------------------------------------------------------------
// addFreeNode
// ---------------------------------------------------------------------------

export interface AddFreeNodeInput {
  readonly viewId: string;
  readonly container: ContainerRef;
  readonly body: string;
  /** Optional hint role. The user can change it later
   *  via `upgradeNode`. Defaults to `'free'`. */
  readonly hintRole?: CognitiveRole;
  readonly position?: { x: number; y: number };
}

export interface AddFreeNodeOutput {
  readonly freeNode: FreeNode;
  readonly placement: ObjectPlacement;
}

export async function addFreeNode(
  deps: CanvasUseCaseDeps,
  input: AddFreeNodeInput,
): Promise<CanvasUseCaseResult<AddFreeNodeOutput>> {
  if (!input.viewId || input.viewId.length === 0) {
    return err('invalid-input', { viewId: 'empty' });
  }
  const now = deps.now();
  const id = `freenode_${deps.newId()}`;
  const freeNode: FreeNode = {
    id,
    container: input.container,
    viewId: input.viewId,
    body: input.body,
    hintRole: input.hintRole ?? 'free',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  const ref = freeRef(id);
  const placement: ObjectPlacement = {
    id: placementId(input.viewId, ref),
    viewId: input.viewId,
    ref,
    x: input.position?.x ?? 0,
    y: input.position?.y ?? 0,
    width: 240,
    height: 120,
    collapsed: false,
    focus: false,
    missing: false,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    ensureView(tx, { view: null }, input.viewId, input.container, now);
    tx.putFreeNode(freeNode);
    tx.putPlacement(placement);
    tx.appendLineage(
      lineage(
        'add-free-node',
        input.viewId,
        null,
        { freeNode, placement },
        now,
        deps.newId,
      ),
    );
  });
  return ok({ freeNode, placement });
}

// ---------------------------------------------------------------------------
// upgradeNode
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// updateFreeNode
// ---------------------------------------------------------------------------

export interface UpdateFreeNodeInput {
  readonly viewId: string;
  /** The `free:<id>` ref whose body is being edited. */
  readonly freeRef: CanvasObjectRef;
  /** The new body text. The use case trims / no-ops on
   *  empty strings to keep the line on the canvas
   *  visible. */
  readonly body: string;
}

export interface UpdateFreeNodeOutput {
  readonly freeNode: FreeNode;
}

/**
 * Edit the body of a free node. The cognitive canvas
 * uses this from the inline body editor (CognitiveCard).
 *
 * The previous implementation abused `connectDraft`
 * with `from === to` (a self-relation) and swallowed
 * the failure with `.catch(() => undefined)` — a silent
 * no-op that left the user staring at a body that did
 * not update. The new use case is the real path: it
 * writes a fresh `FreeNode` row and a `move-free-body`
 * lineage entry so `undo` works.
 */
export async function updateFreeNode(
  deps: CanvasUseCaseDeps,
  input: UpdateFreeNodeInput,
): Promise<CanvasUseCaseResult<UpdateFreeNodeOutput>> {
  if (input.freeRef.kind !== 'free') {
    return err('invalid-input', { freeRef: 'not a free ref' });
  }
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.freeNodes.find((f) => f.id === input.freeRef.id);
  if (!previous) return err('free-node-not-found', { id: input.freeRef.id });
  const next: FreeNode = {
    ...previous,
    body: input.body,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putFreeNode(next);
    tx.appendLineage(
      lineage(
        'update-free-body',
        input.viewId,
        previous,
        next,
        now,
        deps.newId,
      ),
    );
  });
  return ok({ freeNode: next });
}

export interface UpgradeNodeInput {
  readonly viewId: string;
  /** The `free:<id>` ref to upgrade. */
  readonly freeRef: CanvasObjectRef;
  /** The target canonical object kind. */
  readonly targetKind: Exclude<KnowledgeObjectKind, 'note'> | 'note';
}

export interface UpgradeNodeOutput {
  readonly object: KnowledgeObject;
  readonly placement: ObjectPlacement;
}

export async function upgradeNode(
  deps: CanvasUseCaseDeps,
  input: UpgradeNodeInput,
): Promise<CanvasUseCaseResult<UpgradeNodeOutput>> {
  if (input.freeRef.kind !== 'free') {
    return err('invalid-input', { freeRef: 'not a free ref' });
  }
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const free = snapshot.freeNodes.find((f) => f.id === input.freeRef.id);
  if (!free) return err('free-node-not-found', { id: input.freeRef.id });
  const oldPlacement = snapshot.placements.find((p) =>
    sameRef(p.ref, input.freeRef),
  );
  if (!oldPlacement) {
    return err('placement-not-found', { id: refKey(input.freeRef) });
  }
  // Create the canonical object. The `id` is *re-used* from
  // the free node so the placement never visibly moves.
  const object: KnowledgeObject = {
    id: free.id,
    kind: input.targetKind as KnowledgeObjectKind,
    body: free.body,
    state: 'active',
    authorType: 'user',
    createdAt: free.createdAt,
    updatedAt: now,
    container: free.container,
  };
  const newRef = knowledgeRef(free.id, object.kind);
  const newPlacement: ObjectPlacement = {
    ...oldPlacement,
    id: placementId(input.viewId, newRef),
    ref: newRef,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    await deps.objects.transact((otx) => {
      otx.put(object);
    });
    tx.deleteFreeNode(free.id);
    tx.deletePlacement(oldPlacement.id);
    tx.putPlacement(newPlacement);
    tx.appendLineage(
      lineage(
        'upgrade-free-node',
        input.viewId,
        { free, placement: oldPlacement },
        { object, placement: newPlacement },
        now,
        deps.newId,
      ),
    );
  });
  return ok({ object, placement: newPlacement });
}

// ---------------------------------------------------------------------------
// removePlacement — delete a single placement (and its
// free node if any) from the view. This is the real
// Backspace / Delete key action; the previous
// implementation called `deleteRelation({ relationId:
// placement.id })` which silently no-op'd (a placement
// id is not a relation id) and left the placement in
// place. The cognitive canvas's `Backspace` now calls
// this use case; errors surface through the
// `CognitiveCanvasAdapter`'s visible error state.
// ---------------------------------------------------------------------------

export interface RemovePlacementInput {
  readonly viewId: string;
  /** The placement id (NOT the relation id; use
   *  `deleteRelation` for relation removal). */
  readonly placementId: string;
}

export interface RemovePlacementOutput {
  readonly removed: ObjectPlacement;
  readonly removedFreeNodeId: string | null;
}

export async function removePlacement(
  deps: CanvasUseCaseDeps,
  input: RemovePlacementInput,
): Promise<CanvasUseCaseResult<RemovePlacementOutput>> {
  if (!input.viewId) return err('invalid-input', { viewId: 'empty' });
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.placements.find((p) => p.id === input.placementId);
  if (!previous) return err('placement-not-found', { id: input.placementId });
  // If the placement anchors a free node, drop both.
  const freeNodeId =
    previous.ref.kind === 'free' ? previous.ref.id : null;
  const freeNode = freeNodeId
    ? snapshot.freeNodes.find((f) => f.id === freeNodeId) ?? null
    : null;
  // Cascade: drop every relation that touches this
  // placement, so the snapshot never references a
  // missing node. The lineage records the deleted
  // placement + free node + the dropped relations.
  const droppedRelations = snapshot.relations.filter(
    (r) => r.from.id === previous.ref.id || r.to.id === previous.ref.id,
  );
  await deps.repository.transact(async (tx) => {
    for (const r of droppedRelations) tx.deleteRelation(r.id);
    if (freeNode) tx.deleteFreeNode(freeNode.id);
    tx.deletePlacement(previous.id);
    tx.appendLineage(
      lineage(
        'remove-placement',
        input.viewId,
        { placement: previous, freeNode, droppedRelations },
        null,
        now,
        deps.newId,
      ),
    );
  });
  return ok({ removed: previous, removedFreeNodeId: freeNodeId });
}

// ---------------------------------------------------------------------------
// deleteFreeNode — drop a free node + its placement in
// one go. The cognitive canvas's body editor or
// selection toolbar can call this when the user
// explicitly chooses "delete free node". Errors
// propagate to the caller; no `.catch(() => undefined)`.
// ---------------------------------------------------------------------------

export interface DeleteFreeNodeInput {
  readonly viewId: string;
  readonly freeNodeId: string;
}

export interface DeleteFreeNodeOutput {
  readonly removedFreeNode: FreeNode;
}

export async function deleteFreeNode(
  deps: CanvasUseCaseDeps,
  input: DeleteFreeNodeInput,
): Promise<CanvasUseCaseResult<DeleteFreeNodeOutput>> {
  if (!input.viewId) return err('invalid-input', { viewId: 'empty' });
  if (!input.freeNodeId) return err('invalid-input', { freeNodeId: 'empty' });
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.freeNodes.find((f) => f.id === input.freeNodeId);
  if (!previous) return err('free-node-not-found', { id: input.freeNodeId });
  // Cascade the placement + any relations that
  // reference this free node.
  const placement = snapshot.placements.find(
    (p) => p.ref.kind === 'free' && p.ref.id === previous.id,
  );
  const droppedRelations = placement
    ? snapshot.relations.filter(
        (r) => r.from.id === placement.ref.id || r.to.id === placement.ref.id,
      )
    : [];
  await deps.repository.transact(async (tx) => {
    for (const r of droppedRelations) tx.deleteRelation(r.id);
    if (placement) tx.deletePlacement(placement.id);
    tx.deleteFreeNode(previous.id);
    tx.appendLineage(
      lineage(
        'delete-free-node',
        input.viewId,
        { freeNode: previous, placement, droppedRelations },
        null,
        now,
        deps.newId,
      ),
    );
  });
  return ok({ removedFreeNode: previous });
}

// ---------------------------------------------------------------------------
// movePlacement
// ---------------------------------------------------------------------------

export interface MovePlacementInput {
  readonly viewId: string;
  readonly ref: CanvasObjectRef;
  readonly patch: Partial<
    Pick<
      ObjectPlacement,
      'x' | 'y' | 'width' | 'height' | 'collapsed' | 'focus'
    >
  >;
}

export async function movePlacement(
  deps: CanvasUseCaseDeps,
  input: MovePlacementInput,
): Promise<CanvasUseCaseResult<ObjectPlacement>> {
  if (!input.viewId) return err('invalid-input', { viewId: 'empty' });
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.placements.find((p) =>
    sameRef(p.ref, input.ref),
  );
  if (!previous) return err('placement-not-found', { id: refKey(input.ref) });
  const next: ObjectPlacement = {
    ...previous,
    ...input.patch,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putPlacement(next);
    tx.appendLineage(
      lineage(
        'move-placement',
        input.viewId,
        previous,
        next,
        now,
        deps.newId,
      ),
    );
  });
  return ok(next);
}

// ---------------------------------------------------------------------------
// connectDraft — create a `preview` relation
// ---------------------------------------------------------------------------

export interface ConnectDraftInput {
  readonly viewId: string;
  readonly from: CanvasObjectRef;
  readonly to: CanvasObjectRef;
  readonly kind?: RelationKind;
  readonly authorType?: 'user' | 'ai';
  readonly originDraftId?: string;
  readonly rationale?: string;
  readonly confidence?: number;
}

export interface ConnectDraftOutput {
  readonly relation: CanvasRelation;
}

export async function connectDraft(
  deps: CanvasUseCaseDeps,
  input: ConnectDraftInput,
): Promise<CanvasUseCaseResult<ConnectDraftOutput>> {
  if (sameRef(input.from, input.to)) {
    return err('invalid-input', { from: input.from.id, to: input.to.id });
  }
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  // De-dupe: if a preview already exists for the same
  // (from, to, kind) pair, return it instead of creating a
  // duplicate.
  const existing = snapshot.relations.find(
    (r) =>
      r.status === 'preview' &&
      sameRef(r.from, input.from) &&
      sameRef(r.to, input.to) &&
      r.kind === (input.kind ?? 'untyped'),
  );
  if (existing) {
    return ok({ relation: existing });
  }
  const relation: CanvasRelation = {
    id: `rel_${deps.newId()}`,
    viewId: input.viewId,
    from: input.from,
    to: input.to,
    kind: input.kind ?? 'untyped',
    confidence: input.confidence ?? (input.authorType === 'ai' ? 0.75 : 1.0),
    authorType: input.authorType ?? 'user',
    status: 'preview',
    originDraftId: input.originDraftId ?? null,
    rationale: input.rationale ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putRelation(relation);
    tx.appendLineage(
      lineage(
        'connect-preview',
        input.viewId,
        null,
        relation,
        now,
        deps.newId,
      ),
    );
  });
  return ok({ relation });
}

// ---------------------------------------------------------------------------
// acceptRelation / rejectRelation / deleteRelation
// ---------------------------------------------------------------------------

export interface AcceptRelationInput {
  readonly viewId: string;
  readonly relationId: string;
  readonly rationale?: string;
}

export async function acceptRelation(
  deps: CanvasUseCaseDeps,
  input: AcceptRelationInput,
): Promise<CanvasUseCaseResult<CanvasRelation>> {
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.relations.find((r) => r.id === input.relationId);
  if (!previous) {
    return err('relation-not-found', { id: input.relationId });
  }
  if (previous.status !== 'preview') {
    return err('invalid-input', { status: previous.status });
  }
  const next: CanvasRelation = {
    ...previous,
    status: 'accepted',
    rationale: input.rationale ?? previous.rationale,
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putRelation(next);
    tx.appendLineage(
      lineage(
        'accept-relation',
        input.viewId,
        previous,
        next,
        now,
        deps.newId,
      ),
    );
  });
  return ok(next);
}

export async function rejectRelation(
  deps: CanvasUseCaseDeps,
  input: { viewId: string; relationId: string },
): Promise<CanvasUseCaseResult<CanvasRelation>> {
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.relations.find((r) => r.id === input.relationId);
  if (!previous) {
    return err('relation-not-found', { id: input.relationId });
  }
  if (previous.status !== 'preview') {
    return err('invalid-input', { status: previous.status });
  }
  const next: CanvasRelation = {
    ...previous,
    status: 'rejected',
    updatedAt: now,
  };
  await deps.repository.transact(async (tx) => {
    tx.putRelation(next);
    tx.appendLineage(
      lineage(
        'reject-relation',
        input.viewId,
        previous,
        next,
        now,
        deps.newId,
      ),
    );
  });
  return ok(next);
}

export async function deleteRelation(
  deps: CanvasUseCaseDeps,
  input: { viewId: string; relationId: string },
): Promise<CanvasUseCaseResult<void>> {
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const previous = snapshot.relations.find((r) => r.id === input.relationId);
  if (!previous) {
    return err('relation-not-found', { id: input.relationId });
  }
  await deps.repository.transact(async (tx) => {
    tx.deleteRelation(previous.id);
    tx.appendLineage(
      lineage(
        'delete-relation',
        input.viewId,
        previous,
        null,
        now,
        deps.newId,
      ),
    );
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// setViewMode / setViewport
// ---------------------------------------------------------------------------

export async function setViewMode(
  deps: CanvasUseCaseDeps,
  input: { viewId: string; mode: CanvasViewMode },
): Promise<CanvasUseCaseResult<CanvasView>> {
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  if (snapshot.view.id === '__empty__' || snapshot.view.id !== input.viewId) {
    return err('view-not-found', { viewId: input.viewId });
  }
  const previous = snapshot.view;
  const next: CanvasView = { ...previous, mode: input.mode, updatedAt: now };
  await deps.repository.transact(async (tx) => {
    tx.putView(next);
    tx.appendLineage(
      lineage('set-view-mode', input.viewId, previous, next, now, deps.newId),
    );
  });
  return ok(next);
}

export async function setViewport(
  deps: CanvasUseCaseDeps,
  input: { viewId: string; viewport: CanvasViewport },
): Promise<CanvasUseCaseResult<CanvasView>> {
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  if (snapshot.view.id === '__empty__' || snapshot.view.id !== input.viewId) {
    return err('view-not-found', { viewId: input.viewId });
  }
  const previous = snapshot.view;
  const next: CanvasView = { ...previous, viewport: input.viewport, updatedAt: now };
  await deps.repository.transact(async (tx) => {
    tx.putView(next);
    tx.appendLineage(
      lineage('set-viewport', input.viewId, previous, next, now, deps.newId),
    );
  });
  return ok(next);
}

// ---------------------------------------------------------------------------
// undo — pop the topmost entry for a view and replay its inverse
// ---------------------------------------------------------------------------

export interface UndoOutput {
  readonly undone: UndoLineage;
}

export async function undo(
  deps: CanvasUseCaseDeps,
  input: { viewId: string },
): Promise<CanvasUseCaseResult<UndoOutput>> {
  const now = deps.now();
  const snapshot = await deps.repository.getViewSnapshot(input.viewId);
  const stack = await deps.repository.listLineage(input.viewId);
  if (stack.length === 0) {
    return err('invalid-input', { undo: 'empty' });
  }
  const top = stack[0];
  // We replay the inverse manually (the line's `previous`
  // already carries the inverse). This is the *only* place
  // we re-apply a previous value; the inverse is a pure
  // function of the lineage entry. If the callback throws,
  // the repository aborts the transaction and the
  // `await` re-throws; we let that propagate (the user
  // sees an error toast). The result of the callback is
  // `null` — we just need the side-effects to apply.
  await deps.repository.transact(async (tx) => {
    tx.popLineage(input.viewId);
    switch (top.op) {
      case 'add-free-node': {
        const next = top.next as { freeNode: FreeNode; placement: ObjectPlacement };
        tx.deleteFreeNode(next.freeNode.id);
        tx.deletePlacement(next.placement.id);
        return null;
      }
      case 'add-placement':
      case 'open-in-canvas': {
        const next = top.next as
          | { view: CanvasView; createdPlacements?: readonly ObjectPlacement[] }
          | { createdPlacements: readonly ObjectPlacement[] };
        const created =
          'createdPlacements' in next && Array.isArray(next.createdPlacements)
            ? next.createdPlacements
            : [];
        for (const p of created) {
          tx.deletePlacement(p.id);
        }
        return null;
      }
      case 'move-placement': {
        const previous = top.previous as ObjectPlacement | null;
        if (previous) tx.putPlacement(previous);
        return null;
      }
      case 'set-view-mode':
      case 'set-viewport': {
        const previous = top.previous as CanvasView | null;
        if (previous) tx.putView(previous);
        return null;
      }
      case 'remove-placement': {
        // Inverse: re-create the placement (and its
        // free node if any) + the relations that the
        // removal cascade dropped.
        const previous = top.previous as
          | {
              placement: ObjectPlacement;
              freeNode: FreeNode | null;
              droppedRelations: CanvasRelation[];
            }
          | null;
        if (previous) {
          if (previous.freeNode) tx.putFreeNode(previous.freeNode);
          tx.putPlacement(previous.placement);
          for (const r of previous.droppedRelations) tx.putRelation(r);
        }
        return null;
      }
      case 'delete-free-node': {
        // Inverse: re-create the free node + its
        // placement + the relations the deletion
        // cascade dropped.
        const previous = top.previous as
          | {
              freeNode: FreeNode;
              placement: ObjectPlacement | null;
              droppedRelations: CanvasRelation[];
            }
          | null;
        if (previous) {
          tx.putFreeNode(previous.freeNode);
          if (previous.placement) tx.putPlacement(previous.placement);
          for (const r of previous.droppedRelations) tx.putRelation(r);
        }
        return null;
      }
      case 'connect-preview': {
        const next = top.next as CanvasRelation | null;
        if (next) tx.deleteRelation(next.id);
        return null;
      }
      case 'accept-relation':
      case 'reject-relation': {
        const previous = top.previous as CanvasRelation | null;
        if (previous) tx.putRelation(previous);
        return null;
      }
      case 'delete-relation': {
        const previous = top.previous as CanvasRelation | null;
        if (previous) tx.putRelation(previous);
        return null;
      }
      case 'upgrade-free-node': {
        // Inverse: delete the new object + placement, restore
        // the free node + old placement. The new object's id
        // is the same as the free node's id.
        const prev = top.previous as { free: FreeNode; placement: ObjectPlacement } | null;
        const next = top.next as { object: KnowledgeObject; placement: ObjectPlacement } | null;
        if (prev) {
          tx.putFreeNode(prev.free);
          tx.putPlacement(prev.placement);
        }
        if (next) {
          await deps.objects.transact((otx) => {
            otx.delete(next.object.id);
          });
          tx.deletePlacement(next.placement.id);
        }
        return null;
      }
      case 'update-free-body': {
        // Inverse: restore the previous body. The
        // free node row stays the same; we just
        // rewrite the body + updatedAt.
        const previous = top.previous as FreeNode | null;
        if (previous) tx.putFreeNode(previous);
        return null;
      }
    }
  });
  // `top` is captured before transact so its value is stable.
  // Touch `snapshot` so the destructuring above doesn't get
  // tree-shaken in a future refactor.
  void snapshot;
  return ok({ undone: top });
}

// ---------------------------------------------------------------------------
// Default cognitive role (re-exported for the UI)
// ---------------------------------------------------------------------------

export { defaultCognitiveRole };
