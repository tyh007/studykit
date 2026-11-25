/**
 * StudyKit v0.4 — `components/literature/canvas/CanvasSurface`
 *
 * The single, shared ReactFlow surface for the literature
 * canvas and the cognitive canvas. WP-06 Round 6 P0-1
 * convergence (revised after Round 6 audit):
 *
 *   - This is the *only* place that imports `ReactFlow`
 *     and the xyflow `Background` inside the components
 *     that mount on the canvas.
 *   - The `ReactFlowProvider` lives in `CanvasSurfaceProvider`
 *     — a SEPARATE export. The provider wraps the *whole
 *     subtree* (the parent that calls `useSurfaceFlow()`
 *     for `screenToFlowPosition` / `zoomIn` / `zoomOut`
 *     AND the `<CanvasSurface>` element). The provider
 *     is the single source of truth for the xyflow
 *     store: parent hooks and the surface see the same
 *     `useReactFlow` instance. Nested `ReactFlowProvider`s
 *     would split the store and break `fitView` /
 *     `zoom` / `viewport` between the controller and
 *     the surface — that's the Round 6 P0-1 bug.
 *   - `LiteratureCanvas` default wraps
 *     `LiteratureCanvasInner` with `<CanvasSurfaceProvider>`;
 *     the cognitive canvas does the same around any
 *     consumer that calls `useSurfaceFlow` /
 *     `useSurfaceControls`.
 *   - The surface is a *controlled* component: every
 *     node / edge / viewport change goes through a
 *     callback the caller provides. The caller decides
 *     what to persist.
 *   - The toolbar / topbar / status bar are *not* part
 *     of the surface. The surface accepts an optional
 *     `toolbar` slot (`children` rendered above the
 *     flow) so both canvas surfaces reuse the engine's
 *     `CanvasToolbar` (and the cognitive canvas extends
 *     it with a preview-tray for `preview` relations).
 *   - The surface also accepts the legacy literature
 *     canvas's full prop surface (fitView, onFitView,
 *     onMove, deleteKeyCode, onZoomIn, onZoomOut,
 *     screenToFlowPosition via `useSurfaceFlow()`).
 *
 * Cognitive canvas adopters that need new behaviour
 * (e.g. a new event handler) extend the props here —
 * they never re-import `@xyflow/react` themselves.
 */

import React from 'react';
import {
  Background,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type Viewport,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './canvasSurface.css';

// Re-export the few types downstream callers need so
// the cognitive canvas's adapter (and the literature
// canvas) can type its callbacks without importing
// `@xyflow/react` itself.
export type { NodeChange, EdgeChange, Connection, Node, Edge, DefaultEdgeOptions, Viewport };

/**
 * The single `ReactFlowProvider` for the canvas. Wrap
 * the parent (which calls `useSurfaceFlow` /
 * `useSurfaceControls`) AND the `<CanvasSurface>` in
 * this provider so they share the same xyflow store.
 *
 * Critical (WP-06 Round 6 P0-1): `<CanvasSurface>` does
 * NOT nest a second `ReactFlowProvider` — doing so
 * would split the store between the parent's
 * `useReactFlow` and the surface's `useReactFlow`, and
 * `fitView` / `zoom` / `viewport` would no-op against
 * a different store from the one the surface is
 * rendering.
 */
export function CanvasSurfaceProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <ReactFlowProvider>{props.children}</ReactFlowProvider>;
}

/**
 * The thin wrapper around `useReactFlow`. Callers
 * (LiteratureCanvas) that need a xyflow primitive
 * (e.g. `screenToFlowPosition`, `zoomIn`, `zoomOut`)
 * get it through this hook — they never re-import
 * `@xyflow/react` themselves. The hook MUST be called
 * inside a `<CanvasSurfaceProvider>` ancestor.
 */
export function useSurfaceFlow(): ReturnType<typeof useReactFlow> {
  return useReactFlow();
}

export interface CanvasSurfaceProps<
  TNode extends Node = Node,
  TEdge extends Edge = Edge,
> {
  /** The flow nodes (controlled). */
  readonly nodes: readonly TNode[];
  /** The flow edges (controlled). */
  readonly edges: readonly TEdge[];
  /** The `nodeTypes` registry passed to `<ReactFlow>`. */
  readonly nodeTypes: NodeTypes;
  /** The `edgeTypes` registry passed to `<ReactFlow>`. */
  readonly edgeTypes?: EdgeTypes;
  /** Default edge options. */
  readonly defaultEdgeOptions?: DefaultEdgeOptions;
  /** Initial viewport when no `viewport` prop is provided. */
  readonly initialViewport?: Viewport | null;
  /** Controlled viewport (when the caller wants to drive it). */
  readonly viewport?: Viewport;
  /** Called on every node change (drag, select, remove, …). */
  readonly onNodesChange?: (changes: NodeChange<TNode>[]) => void;
  /** Called on every edge change. */
  readonly onEdgesChange?: (changes: EdgeChange<TEdge>[]) => void;
  /** Called when the user connects two handles. */
  readonly onConnect?: (conn: Connection) => void;
  /** Called when the user finishes panning / zooming. */
  readonly onViewportChange?: (viewport: Viewport) => void;
  /** Called on every pan / zoom (legacy `onMove`). */
  readonly onMove?: (viewport: Viewport) => void;
  /** Called when the user clicks the Fit View toolbar button. */
  readonly onFitView?: () => void;
  /**
   * When `true`, the surface calls `fitView` on mount
   * (the literature canvas's behaviour when the
   * project has no saved viewport).
   */
  readonly fitViewOnLoad?: boolean;
  /** Key code that triggers node deletion in the surface. */
  readonly deleteKeyCode?: string | string[] | null;
  /** Called when the selection changes. */
  readonly onSelectionChange?: (selection: { nodes: readonly Node[]; edges: readonly Edge[] }) => void;
  /** Called on keydown over the surface (the caller
   *  decides which keys to handle; the surface does not
   *  consume any keys itself). */
  readonly onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called on double-click on the surface background. */
  readonly onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** CSS class for the wrapper div. The engine's
   *  `literature-canvas.css` and the cognitive canvas's
   *  `canvas.css` both target this class so the surface
   *  looks the same in both surfaces. */
  readonly className?: string;
  /** Extra attributes (e.g. `role`, `aria-label`, `tabIndex`). */
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly tabIndex?: number;
  /** A toolbar / topbar rendered above the flow. The
   *  engine's `CanvasToolbar` lives here in both
   *  LiteratureCanvas and CognitiveCanvasAdapter. The
   *  surface does not own its own toolbar. */
  readonly toolbar?: React.ReactNode;
  /** Status / hint nodes rendered *over* the flow (e.g.
   *  "loading", "connector hint"). The surface renders
   *  them after the flow, so they sit visually on top
   *  via the CSS. */
  readonly overlay?: React.ReactNode;
  /** Whether to hide the React Flow attribution (the
   *  engine's behaviour is to hide it; both surfaces
   *  do the same). */
  readonly hideAttribution?: boolean;
  /** Whether nodes are draggable (default `true`). */
  readonly nodesDraggable?: boolean;
  /** Whether the user can connect nodes (default `true`). */
  readonly nodesConnectable?: boolean;
  /** Whether the user can select elements (default `true`). */
  readonly elementsSelectable?: boolean;
  /** Whether selection-on-drag is enabled (default `true`). */
  readonly selectionOnDrag?: boolean;
  /** Pan-on-drag keys (default `[1, 2]` — middle / right mouse). */
  readonly panOnDrag?: number[] | boolean;
  /** Multi-selection key (default `['Shift', 'Meta', 'Control']`). */
  readonly multiSelectionKeyCode?: string[] | null;
  /** Min zoom. */
  readonly minZoom?: number;
  /** Max zoom. */
  readonly maxZoom?: number;
  /** Children rendered *inside* the flow (e.g. a `<Controls>` or
   *  `<MiniMap>`). The engine's literature canvas renders its
   *  `CanvasMinimapCluster` as a sibling overlay; the surface
   *  still supports the legacy shape where children are
   *  inside the `<ReactFlow>` element. */
  readonly flowChildren?: React.ReactNode;
}

function CanvasSurfaceInner<TNode extends Node, TEdge extends Edge>(
  props: CanvasSurfaceProps<TNode, TEdge>,
): React.ReactElement {
  const {
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    defaultEdgeOptions,
    initialViewport,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onViewportChange,
    onMove,
    onFitView,
    fitViewOnLoad,
    deleteKeyCode,
    onSelectionChange,
    onKeyDown,
    onDoubleClick,
    className,
    role,
    ariaLabel,
    tabIndex,
    toolbar,
    overlay,
    hideAttribution = true,
    nodesDraggable = true,
    nodesConnectable = true,
    elementsSelectable = true,
    selectionOnDrag = true,
    panOnDrag = [1, 2],
    multiSelectionKeyCode = ['Shift', 'Meta', 'Control'],
    minZoom = 0.1,
    maxZoom = 2,
    flowChildren,
  } = props;
  const reactFlow = useReactFlow();
  // The literature canvas's `onFitView` callback uses
  // `reactFlow.fitView`. We forward the call so the
  // toolbar's Fit button works through the surface.
  const handleFitView = React.useCallback(() => {
    if (onFitView) {
      onFitView();
      return;
    }
    reactFlow.fitView({ duration: 200 });
  }, [onFitView, reactFlow]);
  // When the caller did not pass `onMove`, forward to
  // `onViewportChange` (the legacy literature canvas
  // behaviour). When both are provided, call both.
  const handleMoveEnd = React.useCallback(
    (_event: unknown, viewport: Viewport) => {
      onMove?.(viewport);
      onViewportChange?.(viewport);
    },
    [onMove, onViewportChange],
  );
  // Expose the fit-view helper to the toolbar slot via
  // a React context. The toolbar can call
  // `useSurfaceControls().fitView` without re-importing
  // `@xyflow/react`.
  const surfaceControls = React.useMemo(
    () => ({ fitView: handleFitView }),
    [handleFitView],
  );
  return (
    <SurfaceControlsContext.Provider value={surfaceControls}>
      <div
        className={className ?? 'canvas-surface'}
        role={role}
        aria-label={ariaLabel}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
      >
        {toolbar}
        <div className="canvas-surface__flow">
          <ReactFlow<TNode, TEdge>
            nodes={nodes as TNode[]}
            edges={edges as TEdge[]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMoveEnd={handleMoveEnd}
            onSelectionChange={onSelectionChange as (selection: { nodes: Node[]; edges: Edge[] }) => void}
            defaultViewport={initialViewport ?? undefined}
            proOptions={hideAttribution ? { hideAttribution: true } : undefined}
            defaultEdgeOptions={defaultEdgeOptions}
            minZoom={minZoom}
            maxZoom={maxZoom}
            fitView={fitViewOnLoad}
            deleteKeyCode={deleteKeyCode ?? null}
            selectionOnDrag={selectionOnDrag}
            panOnDrag={panOnDrag}
            nodesDraggable={nodesDraggable}
            nodesConnectable={nodesConnectable}
            elementsSelectable={elementsSelectable}
            multiSelectionKeyCode={multiSelectionKeyCode}
          >
            {flowChildren ?? <Background gap={20} size={1} />}
          </ReactFlow>
        </div>
        {overlay}
      </div>
    </SurfaceControlsContext.Provider>
  );
}

const SurfaceControlsContext = React.createContext<{ fitView: () => void } | null>(null);

/**
 * Read the surface's controls (currently just `fitView`).
 * Used by toolbar / overlay children that need to drive
 * the underlying xyflow without re-importing it. The
 * hook returns a no-op `fitView` when no
 * `<CanvasSurface>` is mounted in the tree; the
 * `<CanvasSurfaceProvider>` is what wires the real
 * store.
 */
export function useSurfaceControls(): { fitView: () => void } {
  const value = React.useContext(SurfaceControlsContext);
  if (!value) {
    return { fitView: () => undefined };
  }
  return value;
}

/**
 * The `<CanvasSurface>` element. MUST be rendered
 * inside a `<CanvasSurfaceProvider>` so the
 * `useReactFlow` calls (in the parent AND in this
 * component) share the same store. The surface itself
 * does NOT create a `ReactFlowProvider` — that would
 * split the store between the controller and the
 * surface.
 */
export function CanvasSurface<TNode extends Node, TEdge extends Edge>(
  props: CanvasSurfaceProps<TNode, TEdge>,
): React.ReactElement {
  return <CanvasSurfaceInner {...props} />;
}
