import React from 'react';
import { useReactFlow } from '@xyflow/react';
import { MaximizeIcon, ZoomInIcon, ZoomOutIcon } from '../../ui/Icons';

/**
 * Compact zoom widget for the literature canvas. Replaces the default
 * React Flow <Controls /> with a styling that matches the rest of
 * StudyKit (glass surface, themed icons) and lives in the top-right
 * cluster alongside the minimap.
 */
export default function CanvasZoomControls({ disabled = false }: { disabled?: boolean }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="canvas-controls" role="toolbar" aria-label="Canvas zoom controls">
      <button
        type="button"
        className="canvas-control-btn"
        onClick={() => zoomIn({ duration: 200 })}
        disabled={disabled}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <ZoomInIcon size="sm" />
      </button>
      <button
        type="button"
        className="canvas-control-btn"
        onClick={() => zoomOut({ duration: 200 })}
        disabled={disabled}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <ZoomOutIcon size="sm" />
      </button>
      <button
        type="button"
        className="canvas-control-btn"
        onClick={() => fitView({ padding: 0.2, duration: 250 })}
        disabled={disabled}
        title="Fit to content"
        aria-label="Fit to content"
      >
        <MaximizeIcon size="sm" />
      </button>
    </div>
  );
}