import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

export const RELATION_EDGE_COLORS: Record<string, string> = {
  link: '#64748b',
  cites: '#3b82f6',
  extends: '#8b5cf6',
  contradicts: '#ef4444',
  supports: '#22c55e',
  related: '#6b7280',
  method: '#f59e0b',
  dataset: '#06b6d4',
};

export const RELATION_EDGE_LABELS: Record<string, string> = {
  link: 'Link',
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
    content_json?: Record<string, any>;
  };
  actions?: {
    onDelete?: (edgeId: string) => void;
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
    selected,
  } = props as EdgeProps & { data?: RelationEdgeData };

  const typed = (data ?? {}) as RelationEdgeData;
  const isPaperRelation = typed.canvasEdge?.edge_type === 'paper_relation';
  const relType =
    typed.canvasEdge?.relation_type ||
    typed.canvasEdge?.content_json?.relation_type ||
    (isPaperRelation ? 'related' : 'link');
  const stroke = RELATION_EDGE_COLORS[relType] || (isPaperRelation ? '#6b7280' : '#64748b');
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
    RELATION_EDGE_LABELS[relType] ||
    (isPaperRelation ? 'Related' : 'Link');
  const edgeLabelText = String(edgeLabel);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: selected ? (isPaperRelation ? 3.2 : 2.4) : (isPaperRelation ? 2.5 : 1.75),
          strokeDasharray: dashArray,
        }}
        interactionWidth={18}
      />
      {edgeLabel && (
        <EdgeLabelRenderer>
          <div
            className={`canvas-edge-label ${isPaperRelation ? 'is-paper-relation' : 'is-canvas-link'} ${selected ? 'is-selected' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              ['--edge-color' as string]: stroke,
            }}
            title={edgeLabelText}
          >
            {edgeLabelText}
          </div>
          {selected && typed.actions?.onDelete && (
            <button
              type="button"
              className="canvas-edge-delete"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 28}px)`,
                ['--edge-color' as string]: stroke,
              }}
              onClick={(event) => {
                event.stopPropagation();
                typed.actions?.onDelete?.(id);
              }}
              title="Delete connection"
              aria-label="Delete selected connection"
            >
              Delete
            </button>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
