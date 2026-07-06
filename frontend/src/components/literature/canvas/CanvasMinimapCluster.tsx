import React, { useState } from 'react';
import { MiniMap } from '@xyflow/react';
import CanvasZoomControls from './CanvasZoomControls';
import type { CanvasFlowNode } from './canvas-types';

/**
 * Bottom-right navigation cluster: the minimap (for panning around the
 * canvas) plus a row of zoom controls (for resizing the viewport) sit
 * inside a single Liquid Glass card. This mirrors the layout of tools
 * like Miro and Figma, where pan and zoom live next to each other.
 *
 * Must be rendered inside a <ReactFlowProvider> for the zoom controls to
 * access useReactFlow().
 */
export default function CanvasMinimapCluster({ disabled = false }: { disabled?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

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
            <MiniMap<CanvasFlowNode>
              pannable
              zoomable
              aria-label="Canvas minimap"
              nodeStrokeWidth={2}
              nodeColor={(n) => {
                switch (n.type) {
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
              }}
              nodeStrokeColor="var(--color-border, rgba(200,160,160,0.26))"
              maskColor="rgba(28, 18, 22, 0.18)"
              style={{ background: 'transparent', width: '100%', height: '100%' }}
            />
          </div>
          <div className="canvas-minimap-divider" aria-hidden="true" />
        </>
      )}
      <CanvasZoomControls disabled={disabled} />
    </div>
  );
}
