import React from 'react';
import { NodeResizer } from '@xyflow/react';

interface CanvasNodeResizerProps {
  nodeId: string;
  selected?: boolean;
  minWidth?: number;
  minHeight?: number;
  onResize: (nodeId: string, width: number, height: number) => void;
}

export default function CanvasNodeResizer({
  nodeId,
  selected,
  minWidth = 180,
  minHeight = 100,
  onResize,
}: CanvasNodeResizerProps) {
  return (
    <NodeResizer
      isVisible={!!selected}
      minWidth={minWidth}
      minHeight={minHeight}
      lineClassName="canvas-node-resizer-line"
      handleClassName="canvas-node-resizer-handle"
      onResizeEnd={(_event, params) => onResize(nodeId, params.width, params.height)}
    />
  );
}
