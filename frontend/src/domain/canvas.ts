/**
 * StudyKit v0.4 — `domain/canvas` (WP-06 Cognitive Canvas Adapter)
 *
 * Pure types + type guards for the *cognitive* canvas layer. The
 * canvas itself is the legacy xyflow-based engine under
 * `components/literature/canvas/`; this file describes the
 * object / view / placement / relation contract the new
 * adapter speaks when it talks to that engine and to the
 * repositories. No React, no Dexie, no env.
 *
 * Core invariants (from `studykit_v0.4_ai_native_and_cognitive_canvas_spec`
 * §4, §8, §9 and the system-design §4 identity rule):
 *
 *   1. **One object, one ID.** A `KnowledgeObject` (Evidence,
 *      Claim, Study Question, Concept, …) is referenced by a
 *      stable `CanvasObjectRef`. The canvas never duplicates the
 *      body; the placement is a *position*, not a *copy*.
 *   2. **Free nodes are first-class.** A `free` ref points at a
 *      local `FreeNode`, not at any canonical object. Free nodes
 *      can be promoted to a typed ref via the `upgrade` use case
 *      (which writes a real `KnowledgeObject` and rebinds the
 *      ref). Before promotion, the free node has no canonical
 *      meaning.
 *   3. **View != data.** A `CanvasView` is the user's current
 *      lens (spatial xyflow, Outline list, Focus). The view
 *      carries the viewport (x, y, zoom) and the mode
 *      (`spatial` | `outline`). Placements belong to a view;
 *      the underlying `KnowledgeObject` does not move with the
 *      view.
 *   4. **Relations are drafts first.** Every edge is one of
 *      `preview | accepted | rejected`. A `preview` edge is a
 *      visual suggestion that may not exist in canonical state.
 *      Only `accepted` relations may flow into the `relations`
 *      table of the `StudyKitRepository`. `rejected` is kept for
 *      lineage / undo only.
 *   5. **Undo is a first-class lineage.** Every state-changing
 *      use case writes an `UndoLineage` entry that captures the
 *      previous value. The undo use case replays the inverse
 *      operation in a single repository transaction so the
 *      placement never visibly moves until the user Accepts.
 *   6. **AI never silently moves things.** Layout / cluster /
 *      relation suggestions go through the Draft Layer
 *      (`features/ai/kernel/draftLayer.ts`) and produce
 *      `preview` relations only. `Accept` is the only path that
 *      flips a relation to `accepted`.
 *   7. **No fake relocations.** When the underlying object is
 *      archived or deleted, the placement stays in the view with
 *      a `missing` flag. The UI shows a "Source lost" chip
 *      rather than inventing a substitute.
 */

import type { ContainerRef } from './workspace';
import type { KnowledgeObjectKind } from './repository';

// Re-export so callers can `import { KnowledgeObjectKind } from './canvas'`
// without touching `repository.ts`. Keeps the import surface small.
export type { KnowledgeObjectKind } from './repository';
export { KNOWLEDGE_OBJECT_KINDS } from './repository';

// ---------------------------------------------------------------------------
// Object reference
// ---------------------------------------------------------------------------

/**
 * A canvas object is either a *free* node (no canonical body
 * yet) or a reference to a canonical `KnowledgeObject`. The
 * free node is local to the view; the `knowledge` ref is the
 * stable id used everywhere else (Reader, Evidence table,
 * Outline, Review, Output). The same ref is rendered in
 * multiple views; the body is fetched via the repository and
 * not copied.
 */
export type CanvasObjectRef =
  | { readonly kind: 'free'; readonly id: string }
  | { readonly kind: 'knowledge'; readonly id: string; readonly objectKind: KnowledgeObjectKind };

export const CANVAS_OBJECT_REF_KINDS = ['free', 'knowledge'] as const;
export type CanvasObjectRefKind = (typeof CANVAS_OBJECT_REF_KINDS)[number];

export function isCanvasObjectRef(value: unknown): value is CanvasObjectRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free') return typeof v.id === 'string' && v.id.length > 0;
  if (v.kind === 'knowledge') {
    if (typeof v.id !== 'string' || v.id.length === 0) return false;
    if (typeof v.objectKind !== 'string') return false;
    return (
      v.objectKind === 'source' ||
      v.objectKind === 'note' ||
      v.objectKind === 'concept' ||
      v.objectKind === 'question' ||
      v.objectKind === 'claim' ||
      v.objectKind === 'evidence' ||
      v.objectKind === 'task' ||
      v.objectKind === 'output'
    );
  }
  return false;
}

export function freeRef(id: string): CanvasObjectRef {
  return { kind: 'free', id };
}

export function knowledgeRef(
  id: string,
  objectKind: KnowledgeObjectKind,
): CanvasObjectRef {
  return { kind: 'knowledge', id, objectKind };
}

// ---------------------------------------------------------------------------
// Cognitive role (spec §8.2)
// ---------------------------------------------------------------------------

/**
 * The cognitive role a node plays in the user's thinking. This
 * is independent of the underlying object kind: a free node
 * has no underlying object yet, so its `role` is also `free`;
 * a `knowledge` ref to an Evidence object *can* be played as
 * an `evidence` role. The role is what the user sees; the ref
 * is what the system stores.
 */
export type CognitiveRole =
  | 'free'
  | 'source'
  | 'concept'
  | 'question'
  | 'claim'
  | 'evidence'
  | 'counterevidence'
  | 'example'
  | 'task'
  | 'output';

export const COGNITIVE_ROLES: readonly CognitiveRole[] = [
  'free',
  'source',
  'concept',
  'question',
  'claim',
  'evidence',
  'counterevidence',
  'example',
  'task',
  'output',
] as const;

export function isCognitiveRole(value: unknown): value is CognitiveRole {
  return COGNITIVE_ROLES.includes(value as CognitiveRole);
}

/**
 * Map a `KnowledgeObjectKind` onto the most natural cognitive
 * role. Users can override (e.g. a `claim` object can be
 * pinned as `evidence` if it functions as such in a given
 * view). The default is the identity mapping except
 * `note → free` (a note is open-ended) and `output` stays
 * `output`.
 */
export function defaultCognitiveRole(kind: KnowledgeObjectKind): CognitiveRole {
  switch (kind) {
    case 'source':
      return 'source';
    case 'concept':
      return 'concept';
    case 'question':
      return 'question';
    case 'claim':
      return 'claim';
    case 'evidence':
      return 'evidence';
    case 'task':
      return 'task';
    case 'output':
      return 'output';
    case 'note':
      return 'free';
  }
}

// ---------------------------------------------------------------------------
// Free node
// ---------------------------------------------------------------------------

/**
 * A free node is a local thought pinned on the canvas. It has
 * no canonical meaning until the user upgrades it; the upgrade
 * use case is the only path that turns a `FreeNode` into a
 * real `KnowledgeObject`. The same `id` becomes the new
 * `CanvasObjectRef.kind === 'knowledge'`.
 */
export interface FreeNode {
  readonly id: string;
  readonly container: ContainerRef;
  readonly viewId: string;
  /** Inline body shown on the canvas card. The user can edit
   *  the body in place; the change is persisted on commit. */
  readonly body: string;
  /** Optional pre-upgrade hint. The upgrade use case decides
   *  which canonical object kind (if any) to create. */
  readonly hintRole: CognitiveRole;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user';
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/**
 * `spatial` is the xyflow canvas. `outline` is a flat list
 * with a `position` field that drives keyboard navigation.
 * Both views share the same `CanvasView` id and the same
 * underlying placements. Toggling the mode never moves data.
 */
export type CanvasViewMode = 'spatial' | 'outline';

export const CANVAS_VIEW_MODES: readonly CanvasViewMode[] = ['spatial', 'outline'] as const;
export function isCanvasViewMode(value: unknown): value is CanvasViewMode {
  return value === 'spatial' || value === 'outline';
}

export interface CanvasViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CanvasView {
  readonly id: string;
  readonly container: ContainerRef;
  /** Human-readable title. Default: "Untitled canvas". */
  readonly title: string;
  readonly mode: CanvasViewMode;
  readonly viewport: CanvasViewport;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Where a `CanvasObjectRef` sits *in this view*. The
 * placement is the only mutable bit the user is allowed to
 * move; the body is never copied here. `focus` is the
 * semantic-zoom hint: `true` means the node is the current
 * Focus root (spec §9.4). `missing` means the underlying
 * object could not be fetched (archived or deleted); the UI
 * shows a "Source lost" chip rather than a substitute.
 */
export interface ObjectPlacement {
  /**
   * Stable id, computed as `${viewId}::${refKey(ref)}`. The
   * view + ref is the natural primary key; the explicit
   * field keeps Dexie happy (it expects a single primary
   * key column) and lets the undo lineage record the
   * placement it needs to revert.
   */
  readonly id: string;
  readonly viewId: string;
  readonly ref: CanvasObjectRef;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly collapsed: boolean;
  readonly focus: boolean;
  readonly missing: boolean;
  readonly updatedAt: string;
}

/**
 * Compute the stable id of a placement from its
 * `viewId` + `ref`. Use this everywhere a placement id
 * is needed; never `crypto.randomUUID()` a placement id
 * because the same view + ref must collapse to the same
 * row (so a second `add-placement` call on an existing
 * object updates in place, not inserts a duplicate).
 */
export function placementId(viewId: string, ref: CanvasObjectRef): string {
  return `${viewId}::${refKey(ref)}`;
}

// ---------------------------------------------------------------------------
// Relation vocabulary (spec §8.3)
// ---------------------------------------------------------------------------

export type RelationKind =
  | 'explains'
  | 'example-of'
  | 'causes'
  | 'depends-on'
  | 'supports'
  | 'contradicts'
  | 'qualifies'
  | 'extends'
  | 'compares-with'
  | 'answers'
  | 'raises'
  | 'derived-from'
  | 'part-of'
  | 'next-step-for'
  | 'untyped';

export const RELATION_KINDS: readonly RelationKind[] = [
  'explains',
  'example-of',
  'causes',
  'depends-on',
  'supports',
  'contradicts',
  'qualifies',
  'extends',
  'compares-with',
  'answers',
  'raises',
  'derived-from',
  'part-of',
  'next-step-for',
  'untyped',
] as const;

export function isRelationKind(value: unknown): value is RelationKind {
  return RELATION_KINDS.includes(value as RelationKind);
}

// ---------------------------------------------------------------------------
// Relation
// ---------------------------------------------------------------------------

export type RelationStatus = 'preview' | 'accepted' | 'rejected';

export const RELATION_STATUSES: readonly RelationStatus[] = ['preview', 'accepted', 'rejected'] as const;
export function isRelationStatus(value: unknown): value is RelationStatus {
  return value === 'preview' || value === 'accepted' || value === 'rejected';
}

export type RelationAuthorType = 'user' | 'ai';

export interface CanvasRelation {
  readonly id: string;
  readonly viewId: string;
  readonly from: CanvasObjectRef;
  readonly to: CanvasObjectRef;
  readonly kind: RelationKind;
  /** Only meaningful for `accepted` and `preview`. For
   *  `rejected` we keep the line for undo only. */
  readonly confidence: number;
  readonly authorType: RelationAuthorType;
  readonly status: RelationStatus;
  /** Draft id from `features/ai/kernel/draftLayer` when the
   *  relation came from an AI suggestion. Optional. */
  readonly originDraftId: string | null;
  /** Optional free-text rationale. The user fills this in
   *  before Accept for `supports` / `contradicts` /
   *  `qualifies` relations (spec §8.3, flow R3). */
  readonly rationale: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Undo lineage
// ---------------------------------------------------------------------------

/**
 * `UndoLineage` captures the inverse of a state change so
 * the user can revert. The lineage is stored in the
 * repository and is the only thing `undo` reads; the use case
 * itself does not need to know how the change was performed.
 *
 * `op` is the high-level operation that was performed; `inverse`
 * describes what the undo use case should replay. The
 * `previous` and `next` fields are deliberately typed as
 * `unknown` here; the use case that produced the lineage
 * knows the concrete shape and stores a structured payload.
 */
export type UndoOp =
  | 'add-free-node'
  | 'update-free-body'
  | 'upgrade-free-node'
  | 'remove-placement'
  | 'delete-free-node'
  | 'add-placement'
  | 'move-placement'
  | 'open-in-canvas'
  | 'connect-preview'
  | 'accept-relation'
  | 'reject-relation'
  | 'delete-relation'
  | 'set-view-mode'
  | 'set-viewport';

export interface UndoLineage {
  readonly id: string;
  readonly viewId: string;
  readonly op: UndoOp;
  readonly previous: unknown;
  readonly next: unknown;
  /** When set, undoing this lineage also undoes the linked
   *  lineage. Used to group multi-step operations like
   *  `accept-relation` (which is `connect-preview` +
   *  status flip). */
  readonly linked: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// View-state snapshot
// ---------------------------------------------------------------------------

/**
 * The full read-model the UI needs to render a canvas view.
 * The repository assembles this from the four tables
 * (`canvasViews`, `freeNodes`, `objectPlacements`,
 * `canvasRelations`) and the `KnowledgeObject`s behind the
 * `knowledge` refs. The shape is a *snapshot*; consumers
 * re-subscribe to get fresh data.
 */
export interface CanvasViewSnapshot {
  readonly view: CanvasView;
  readonly freeNodes: readonly FreeNode[];
  readonly placements: readonly ObjectPlacement[];
  readonly relations: readonly CanvasRelation[];
  /** Same view objects, addressed by ref id (either
   *  `free:<id>` for free nodes or `knowledge:<id>` for
   *  canonical refs). Lets the UI resolve a placement
   *  without re-querying. */
  readonly nodes: ReadonlyMap<string, CanvasNodeSummary>;
  /** A counter that increments every time any of the
   *  underlying tables change. UIs can use it to decide
   *  when to re-render. */
  readonly revision: number;
}

export interface CanvasNodeSummary {
  readonly ref: CanvasObjectRef;
  readonly body: string;
  readonly role: CognitiveRole;
  readonly missing: boolean;
}

// ---------------------------------------------------------------------------
// Ref helpers (for Map keys)
// ---------------------------------------------------------------------------

/**
 * Stable string key for a ref. The `kind` is part of the
 * key on purpose: a `free:abc` and a `knowledge:abc` are
 * different nodes on the canvas.
 */
export function refKey(ref: CanvasObjectRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseRefKey(key: string): CanvasObjectRef | null {
  const idx = key.indexOf(':');
  if (idx < 0) return null;
  const kind = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (kind === 'free') return freeRef(id);
  if (kind === 'knowledge') {
    // Object kind is not recoverable from the key alone.
    // The summary map is the source of truth.
    return { kind: 'knowledge', id, objectKind: 'note' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

export function sameRef(a: CanvasObjectRef, b: CanvasObjectRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.id === b.id;
  if (a.kind === 'knowledge' && b.kind === 'knowledge') {
    return a.id === b.id && a.objectKind === b.objectKind;
  }
  return false;
}
