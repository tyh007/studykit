import React from 'react';
import { useReactFlow } from '@xyflow/react';
import { MaximizeIcon, ZoomInIcon, ZoomOutIcon } from '../../ui/Icons';

/**
 * Compact zoom widget for the literature canvas. Renders a row of three
 * icon buttons (zoom in / zoom out / fit to content) that share a single
 * Liquid Glass card with the minimap in the bottom-right corner of the
 * canvas. Living next to the minimap lets the user pan AND zoom from the
 * same control cluster — matches apps like Miro / Figma.
 */
export default function CanvasZoomControls({ disabled = false }: { disabled?: boolean }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const stopCanvasGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="canvas-zoom-controls" role="toolbar" aria-label="Canvas zoom controls">
      <button
        type="button"
        className="canvas-zoom-btn"
        onPointerDown={stopCanvasGesture}
        onClick={(event) => {
          event.stopPropagation();
          zoomIn({ duration: 200 });
        }}
        disabled={disabled}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <ZoomInIcon size="sm" />
      </button>
      <button
        type="button"
        className="canvas-zoom-btn"
        onPointerDown={stopCanvasGesture}
        onClick={(event) => {
          event.stopPropagation();
          zoomOut({ duration: 200 });
        }}
        disabled={disabled}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <ZoomOutIcon size="sm" />
      </button>
      <button
        type="button"
        className="canvas-zoom-btn"
        onPointerDown={stopCanvasGesture}
        onClick={(event) => {
          event.stopPropagation();
          fitView({ padding: 0.2, duration: 250 });
        }}
        disabled={disabled}
        title="Fit to content"
        aria-label="Fit to content"
      >
        <MaximizeIcon size="sm" />
      </button>
    </div>
  );
}
