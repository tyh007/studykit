import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

export const RELATION_EDGE_COLORS: Record<string, string> = {
  cites: '#3b82f6',
  extends: '#8b5cf6',
  contradicts: '#ef4444',
  supports: '#22c55e',
  related: '#6b7280',
  method: '#f59e0b',
  dataset: '#06b6d4',
};

export const RELATION_EDGE_LABELS: Record<string, string> = {
  cites: 'Cites',
  extends: 'Extends',
  contradicts: 'Contradicts',
  supports: 'Supports',
  related: 'Related',
  method: 'Same Method',
  dataset: 'Same Dataset',
};

interface RelationEdgeData {
  canvasEdge?: {
    edge_type?: 'canvas' | 'paper_relation';
    relation_id?: string | null;
    relation_type?: string;
  };
}

// We accept the loose React Flow EdgeProps shape and narrow `data` ourselves.
export default function RelationEdge(props: any) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    label,
  } = props as EdgeProps & { data?: RelationEdgeData };

  const typed = (data ?? {}) as RelationEdgeData;
  const isPaperRelation = typed.canvasEdge?.edge_type === 'paper_relation';
  const relType = typed.canvasEdge?.relation_type;
  const stroke = isPaperRelation
    ? RELATION_EDGE_COLORS[relType || 'related'] || '#6b7280'
    : '#9ca3af';
  const dashArray = isPaperRelation ? undefined : '4 4';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const edgeLabel =
    label ||
    (isPaperRelation ? RELATION_EDGE_LABELS[relType || 'related'] || 'Related' : '');

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: isPaperRelation ? 2 : 1.25,
          strokeDasharray: dashArray,
        }}
      />
      {edgeLabel && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: stroke,
              color: '#fff',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              pointerEvents: 'all',
              whiteSpace: 'nowrap',
            }}
          >
            {edgeLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
