import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport, type Viewport } from '@xyflow/react';
import CanvasZoomControls from './CanvasZoomControls';
import type { CanvasFlowNode } from './canvas-types';

const MINIMAP_WIDTH = 320;
const MINIMAP_HEIGHT = 200;
const MINIMAP_PADDING = 18;

type Size = { width: number; height: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

type MiniMapLayout = {
  bounds: Bounds;
  scale: number;
  offsetX: number;
  offsetY: number;
  viewportRect: { x: number; y: number; width: number; height: number };
};

function getNodeSize(node: CanvasFlowNode) {
  return {
    width: Math.max(1, node.width ?? node.measured?.width ?? node.data.canvasNode.width ?? 220),
    height: Math.max(1, node.height ?? node.measured?.height ?? node.data.canvasNode.height ?? 140),
  };
}

function getViewportBounds(viewport: Viewport, flowSize: Size): Bounds | null {
  if (flowSize.width <= 0 || flowSize.height <= 0 || viewport.zoom <= 0) return null;
  const minX = -viewport.x / viewport.zoom;
  const minY = -viewport.y / viewport.zoom;
  return {
    minX,
    minY,
    maxX: minX + flowSize.width / viewport.zoom,
    maxY: minY + flowSize.height / viewport.zoom,
  };
}

function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function getCanvasMinimapLayout(
  nodes: CanvasFlowNode[],
  viewport: Viewport,
  flowSize: Size
): MiniMapLayout | null {
  let bounds: Bounds | null = null;

  for (const node of nodes) {
    if (node.hidden) continue;
    const size = getNodeSize(node);
    bounds = mergeBounds(bounds, {
      minX: node.position.x,
      minY: node.position.y,
      maxX: node.position.x + size.width,
      maxY: node.position.y + size.height,
    });
  }

  const viewportBounds = getViewportBounds(viewport, flowSize);
  bounds = mergeBounds(bounds, viewportBounds);
  if (!bounds) return null;

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / width,
    (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / height
  );
  const offsetX = (MINIMAP_WIDTH - width * scale) / 2;
  const offsetY = (MINIMAP_HEIGHT - height * scale) / 2;
  const visible = viewportBounds ?? bounds;

  return {
    bounds,
    scale,
    offsetX,
    offsetY,
    viewportRect: {
      x: offsetX + (visible.minX - bounds.minX) * scale,
      y: offsetY + (visible.minY - bounds.minY) * scale,
      width: Math.max(3, (visible.maxX - visible.minX) * scale),
      height: Math.max(3, (visible.maxY - visible.minY) * scale),
    },
  };
}

function getNodeColor(node: CanvasFlowNode) {
  switch (node.type) {
    case 'paper':
      return 'var(--accent-rose, #E5B8B0)';
    case 'note':
      return 'var(--accent-butter, #F5E5BE)';
    case 'question':
      return 'var(--accent-lilac, #DCC8DC)';
    case 'text':
      return 'var(--accent-blush, #F2D5D2)';
    case 'group':
      return 'var(--accent-emerald, #7AA68A)';
    default:
      return 'var(--color-primary, #D4A8A8)';
  }
}

export default function CanvasMinimapCluster({
  disabled = false,
  nodes,
}: {
  disabled?: boolean;
  nodes: CanvasFlowNode[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [flowSize, setFlowSize] = useState<Size>({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { setCenter } = useReactFlow<CanvasFlowNode>();
  const viewport = useViewport();

  useEffect(() => {
    const flowEl = svgRef.current?.closest('.literature-canvas-flow') as HTMLElement | null;
    if (!flowEl) return;
    const updateSize = () => {
      const rect = flowEl.getBoundingClientRect();
      setFlowSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(flowEl);
    return () => observer.disconnect();
  }, [collapsed]);

  const layout = useMemo(
    () => getCanvasMinimapLayout(nodes, viewport, flowSize),
    [nodes, viewport, flowSize]
  );

  const getPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * MINIMAP_WIDTH,
      y: ((clientY - rect.top) / rect.height) * MINIMAP_HEIGHT,
    };
  };

  const panToPointer = (event: React.PointerEvent<SVGSVGElement>, duration = 0) => {
    if (disabled || !layout) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    setCenter(
      layout.bounds.minX + (point.x - layout.offsetX) / layout.scale,
      layout.bounds.minY + (point.y - layout.offsetY) / layout.scale,
      { zoom: viewport.zoom, duration }
    );
  };

  return (
    <div className={`canvas-minimap-cluster ${collapsed ? 'is-collapsed' : ''}`} aria-label="Canvas navigation">
      <div className="canvas-minimap-header">
        <span className="canvas-minimap-title">Map</span>
        <button
          type="button"
          className="canvas-minimap-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setCollapsed((value) => !value);
          }}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show minimap' : 'Hide minimap'}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="canvas-minimap">
            <svg
              ref={svgRef}
              className={`canvas-minimap-svg ${isPanning ? 'is-panning' : ''}`}
              viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
              aria-label="Canvas minimap"
              role="img"
              onPointerDown={(event) => {
                event.stopPropagation();
                if (disabled || !layout) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsPanning(true);
                panToPointer(event, 120);
              }}
              onPointerMove={(event) => {
                if (!isPanning) return;
                event.stopPropagation();
                panToPointer(event);
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                setIsPanning(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                event.stopPropagation();
                setIsPanning(false);
              }}
            >
              <rect className="canvas-minimap-bg" x="0" y="0" width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} rx="10" />
              {layout ? (
                <>
                  {nodes
                    .filter((node) => !node.hidden)
                    .map((node) => {
                      const size = getNodeSize(node);
                      return (
                        <rect
                          key={node.id}
                          className={`canvas-minimap-node canvas-minimap-node-${node.type || 'default'}`}
                          x={layout.offsetX + (node.position.x - layout.bounds.minX) * layout.scale}
                          y={layout.offsetY + (node.position.y - layout.bounds.minY) * layout.scale}
                          width={Math.max(4, size.width * layout.scale)}
                          height={Math.max(4, size.height * layout.scale)}
                          rx={node.type === 'group' ? 8 : 5}
                          fill={getNodeColor(node)}
                        />
                      );
                    })}
                  <rect
                    className="canvas-minimap-viewport"
                    x={layout.viewportRect.x}
                    y={layout.viewportRect.y}
                    width={layout.viewportRect.width}
                    height={layout.viewportRect.height}
                    rx="6"
                  />
                </>
              ) : (
                <text className="canvas-minimap-empty" x="160" y="104" textAnchor="middle">
                  Empty
                </text>
              )}
            </svg>
          </div>
          <div className="canvas-minimap-divider" aria-hidden="true" />
        </>
      )}
      <CanvasZoomControls disabled={disabled} />
    </div>
  );
}
