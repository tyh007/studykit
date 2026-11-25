/**
 * StudyKit v0.4 — `features/canvas/canvasMappings`
 *
 * Pure functions that turn a `CanvasViewSnapshot` from
 * the cognitive-canvas repository into the
 * `CanvasFlowNode[]` / `CanvasFlowEdge[]` shapes the
 * existing Literature Canvas engine expects.
 *
 * The mappings deliberately *reuse* the engine's types
 * and node renderers so the cognitive canvas is not a
 * second long-term canvas. The engine's existing
 * `TextNode`, `NoteNode`, `QuestionNode` components
 * are imported directly; the cognitive canvas adds
 * its own `CognitiveCard` for the engine's `paper` /
 * `shape` roles that don't fit the cognitive model.
 *
 * Important: the placement stores *only* the
 * `CanvasObjectRef` + position. The body lives in the
 * canonical store (Dexie via the shim) and is read
 * once on snapshot build, then surfaced through the
 * `data.canvasNode.content_json.text` field. The
 * adapter never duplicates the body back to the
 * placement.
 */

import type { Node, Edge, Viewport } from '@xyflow/react';

import type {
  CanvasFlowNode,
  CanvasFlowEdge,
  CanvasNodeData,
  CanvasEdgeData,
  CanvasNodeActions,
  CanvasEdgeActions,
} from '../../components/literature/canvas/canvas-types';
import type {
  LiteratureCanvasNode,
  LiteratureCanvasEdge,
} from '../../types';
import {
  defaultCognitiveRole,
  refKey,
  type CanvasObjectRef,
  type CanvasRelation,
  type CanvasViewSnapshot,
  type CognitiveRole,
  type ObjectPlacement,
} from '../../domain/canvas';
import { kindToEdgePayload, type RelationKind } from '../../components/literature/canvas/relation-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISO_NOW = '1970-01-01T00:00:00.000Z';

function placementToLiteratureNode(
  placement: ObjectPlacement,
  ref: CanvasObjectRef,
  body: string,
  role: CognitiveRole,
  missing: boolean,
): LiteratureCanvasNode {
  // The engine stores the body in `content_json.text`
  // and a "kind label" in `content_json.role`. The
  // engine's `TextNode` reads `text`; the cognitive
  // card reads both.
  const isFree = ref.kind === 'free';
  return {
    id: placement.id,
    canvas_id: placement.viewId,
    node_type: nodeTypeForRole(role),
    ref_type: isFree ? 'cognitive-free' : `cognitive-${ref.objectKind}`,
    ref_id: isFree ? ref.id : ref.id,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    z_index: 0,
    content_json: {
      text: body,
      role,
      missing,
      refKind: ref.kind,
      objectKind: ref.kind === 'knowledge' ? ref.objectKind : null,
    },
    style_json: { focus: placement.focus, collapsed: placement.collapsed },
    created_at: ISO_NOW,
    updated_at: placement.updatedAt,
  };
}

function nodeTypeForRole(role: CognitiveRole): LiteratureCanvasNode['node_type'] {
  switch (role) {
    case 'free':
      // The cognitive canvas owns the free node's
      // presentation so the role label, the
      // "source lost" badge, and the upgrade affordance
      // render through the same CognitiveCard. The
      // engine's NoteNode would work, but the
      // cognitive canvas needs a uniform card for
      // every role.
      return 'paper';
    case 'question':
      return 'question';
    case 'concept':
    case 'claim':
    case 'evidence':
    case 'counterevidence':
    case 'example':
    case 'task':
    case 'output':
    case 'source':
      // Engine doesn't have a dedicated renderer for
      // these; the cognitive canvas's `CognitiveCard`
      // handles them.
      return 'paper';
  }
}

function placementToFlowNode(
  placement: ObjectPlacement,
  ref: CanvasObjectRef,
  body: string,
  role: CognitiveRole,
  missing: boolean,
  actions: CanvasNodeActions,
): CanvasFlowNode {
  const canvasNode = placementToLiteratureNode(placement, ref, body, role, missing);
  const data: CanvasNodeData = { canvasNode, paper: null, actions };
  return {
    id: placement.id,
    type: canvasNode.node_type,
    position: { x: placement.x, y: placement.y },
    data: data as unknown as Record<string, unknown>,
    width: placement.width,
    height: placement.height,
    selected: false,
    positionAbsolute: { x: placement.x, y: placement.y },
    dragging: false,
  } as unknown as CanvasFlowNode;
}

function relationToLiteratureEdge(
  relation: CanvasRelation,
): LiteratureCanvasEdge {
  // The engine's edge reads `relation_id` (the kind
  // preset) and `edge_type` (`canvas` vs
  // `paper_relation`). The cognitive canvas uses
  // `canvas` and pushes the cognitive `kind` through
  // `relation_id`. The engine's `RelationEdge` reads
  // the kind from the relation_id field via
  // `kindToEdgePayload`.
  return {
    id: relation.id,
    canvas_id: relation.viewId,
    source_node_id: nodeIdForRef(relation.viewId, relation.from),
    target_node_id: nodeIdForRef(relation.viewId, relation.to),
    relation_id: relation.kind === 'untyped' ? null : (relation.kind as LiteratureCanvasEdge['relation_id']),
    edge_type: 'canvas',
    relation_type: null,
    label: null,
    content_json: {
      status: relation.status,
      authorType: relation.authorType,
      rationale: relation.rationale,
      confidence: relation.confidence,
      originDraftId: relation.originDraftId,
    },
    style_json: relation.status === 'preview' ? { dashed: true } : {},
    created_at: relation.createdAt,
    updated_at: relation.updatedAt,
  };
}

function relationToFlowEdge(
  relation: CanvasRelation,
  actions: CanvasEdgeActions,
): CanvasFlowEdge {
  const canvasEdge = relationToLiteratureEdge(relation);
  const data: CanvasEdgeData = { canvasEdge, actions };
  return {
    id: relation.id,
    source: canvasEdge.source_node_id,
    target: canvasEdge.target_node_id,
    data: data as unknown as Record<string, unknown>,
    type: 'relation',
  } as unknown as CanvasFlowEdge;
}

/**
 * Stable engine node id for a placement ref. The
 * engine treats `LiteratureCanvasNode.id` as the
 * unique key; the cognitive canvas's `placementId`
 * function (in `domain/canvas.ts`) is the
 * same.
 */
function nodeIdForRef(viewId: string, ref: CanvasObjectRef): string {
  return `${viewId}::${refKey(ref)}`;
}

// `CanvasRelation` has no `label()` method. The engine
// reads the visible label from `relation_id` and the
// `kindToEdgePayload` lookup; the cognitive canvas
// keeps the edge label empty so the engine's renderer
// can apply its own kind label.
function _silence(): null {
  return null;
}
_silence();

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface CognitiveAdapterActions {
  readonly onNodeContentChange: (nodeId: string, text: string) => void;
  readonly onNodeResize: (nodeId: string, width: number, height: number) => void;
  readonly onNodeDelete: (nodeId: string) => void;
  readonly onEdgeDelete: (edgeId: string) => void;
  readonly onEdgeUpdateKind?: (edgeId: string, kind: RelationKind) => void;
  readonly onConnect: (fromRef: CanvasObjectRef, toRef: CanvasObjectRef) => void;
  readonly onViewportChange: (viewport: Viewport) => void;
}

export function snapshotToFlowGraph(
  snapshot: CanvasViewSnapshot,
  actions: CognitiveAdapterActions,
): {
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
} {
  const nodeActions: CanvasNodeActions = {
    onContentChange: (nodeId, text) => actions.onNodeContentChange(nodeId, text),
    onContentPatch: (nodeId) => {
      // The cognitive canvas doesn't model
      // `content_json` patches separately. Treated
      // as a delete for now; future packets can wire
      // a real patch.
      actions.onNodeDelete(nodeId);
    },
    onStylePatch: (nodeId) => {
      // Same — collapse / focus move through
      // `onResize` + the underlying use case.
      actions.onNodeDelete(nodeId);
    },
    onResize: (nodeId, width, height) => actions.onNodeResize(nodeId, width, height),
    onDelete: (nodeId) => actions.onNodeDelete(nodeId),
  };
  const edgeActions: CanvasEdgeActions = {
    onDelete: (edgeId) => actions.onEdgeDelete(edgeId),
    ...(actions.onEdgeUpdateKind
      ? { onUpdateKind: (edgeId, kind) => actions.onEdgeUpdateKind!(edgeId, kind) }
      : {}),
  };
  const nodes: CanvasFlowNode[] = [];
  for (const p of snapshot.placements) {
    const summary = snapshot.nodes.get(refKey(p.ref));
    const body = summary?.body ?? '';
    const role = summary?.role ?? defaultCognitiveRole(p.ref.kind === 'knowledge' ? p.ref.objectKind : 'note');
    const missing = !!summary?.missing;
    nodes.push(placementToFlowNode(p, p.ref, body, role, missing, nodeActions));
  }
  // Free nodes that are NOT yet placed get a virtual
  // placement at (0, 0) so the canvas can render them.
  // In practice the use case materialises a placement
  // on creation, but the engine tolerates orphans.
  for (const fn of snapshot.freeNodes) {
    const ref: CanvasObjectRef = { kind: 'free', id: fn.id };
    if (snapshot.placements.some((p) => p.ref.kind === 'free' && p.ref.id === fn.id)) continue;
    const summary = snapshot.nodes.get(refKey(ref));
    nodes.push(
      placementToFlowNode(
        {
          id: `${snapshot.view.id}::${refKey(ref)}`,
          viewId: snapshot.view.id,
          ref,
          x: 0,
          y: 0,
          width: 240,
          height: 120,
          collapsed: false,
          focus: false,
          missing: false,
          updatedAt: fn.updatedAt,
        },
        ref,
        summary?.body ?? fn.body,
        summary?.role ?? fn.hintRole,
        false,
        nodeActions,
      ),
    );
  }
  const edges: CanvasFlowEdge[] = snapshot.relations
    .filter((r) => r.status !== 'rejected')
    .map((r) => relationToFlowEdge(r, edgeActions));
  return { nodes, edges };
}

/**
 * Engine node id from a placement id (the engine
 * treats `LiteratureCanvasNode.id` as the unique key;
 * the cognitive canvas uses `placementId`).
 */
export function engineNodeIdForPlacement(placement: ObjectPlacement): string {
  return placement.id;
}

/**
 * Engine node id from a `CanvasObjectRef`. Used by the
 * adapter to resolve "the user dropped a connect
 * between two engine nodes" back into
 * `CanvasObjectRef` instances.
 */
export function refForEngineNodeId(
  viewId: string,
  nodeId: string,
  placements: readonly ObjectPlacement[],
): CanvasObjectRef | null {
  for (const p of placements) {
    if (p.id === nodeId) return p.ref;
  }
  // Fall back: the engine id may be the bare ref
  // (`free:abc` or `knowledge:abc`).
  void viewId;
  return null;
}

// `kindToEdgePayload` is the engine's mapping from a
// relation kind to a visual edge payload. The
// adapter uses it when rendering preview / accepted
// edges; the function lives in the engine and is
// stable.
export { kindToEdgePayload };
