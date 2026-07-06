import React, { useMemo, useState } from 'react';
import {
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import {
  ARROW_OPTIONS,
  DASH_OPTIONS,
  DASH_PATTERNS,
  kindToEdgePayload,
  readRelationKindFromEdge,
  type ArrowSide,
  type DashStyle,
  type RelationKind,
} from './relation-types';

interface CanvasEdgePayload {
  edge_type?: 'canvas' | 'paper_relation' | null;
  relation_id?: string | null;
  relation_type?: string | null;
  label?: string | null;
  content_json?: Record<string, any> | null;
  style_json?: Record<string, any> | null;
}

interface RelationEdgeData {
  canvasEdge?: CanvasEdgePayload;
  actions?: {
    onDelete?: (edgeId: string) => void;
    onUpdateKind?: (edgeId: string, kind: RelationKind) => void;
  };
}

const SWATCH_COLORS = [
  '#64748b',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#06b6d4',
  '#0f172a',
];

// Draw an arrow head as a filled triangle pointing in `dir` (unit vector).
function ArrowHead({
  tip,
  dir,
  size = 9,
  color = 'currentColor',
  double = false,
}: {
  tip: { x: number; y: number };
  dir: { x: number; y: number };
  size?: number;
  color?: string;
  double?: boolean;
}) {
  // Perpendicular vector for the base of the triangle.
  const px = -dir.y;
  const py = dir.x;
  const back = size; // distance from tip to base
  const half = size * 0.6; // half base width
  const baseX = tip.x - dir.x * back;
  const baseY = tip.y - dir.y * back;
  const p1 = { x: baseX + px * half, y: baseY + py * half };
  const p2 = { x: baseX - px * half, y: baseY - py * half };
  const d1 = `M ${tip.x} ${tip.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`;
  if (!double) {
    return (
      <path
        d={d1}
        fill={color}
        stroke={color}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
    );
  }
  // Double arrow: small chevron in front of the filled triangle
  const chevronBack = size * 2.0;
  const cb = {
    x: tip.x - dir.x * chevronBack,
    y: tip.y - dir.y * chevronBack,
  };
  const cp1 = { x: cb.x + px * half * 0.6, y: cb.y + py * half * 0.6 };
  const cp2 = { x: cb.x - px * half * 0.6, y: cb.y - py * half * 0.6 };
  return (
    <g>
      <path
        d={d1}
        fill={color}
        stroke={color}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      <path
        d={`M ${cb.x} ${cb.y} L ${cp1.x} ${cp1.y} L ${cp2.x} ${cp2.y} Z`}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </g>
  );
}

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
    selected,
  } = props as EdgeProps & { data?: RelationEdgeData };

  const typed = (data ?? {}) as RelationEdgeData;
  const [showStyle, setShowStyle] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState<string>('');

  const kind = useMemo<RelationKind>(() => {
    if (typed.canvasEdge) {
      return readRelationKindFromEdge(typed.canvasEdge);
    }
    return {
      id: 'link',
      label: 'Link',
      color: '#64748b',
      arrowStart: 'none',
      arrowEnd: 'single',
      dashStyle: 'dashed',
      isPaperRelation: false,
    };
  }, [typed.canvasEdge]);

  // getBezierPath returns the bezier "d" string and the (labelX, labelY) midpoint
  // in absolute SVG coordinates.
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const stroke = kind.color;
  const dashArray = DASH_PATTERNS[kind.dashStyle];

  // Compute arrow tips by trimming a few pixels off the source/target so the
  // arrowhead doesn't sit underneath a node. We compute the direction along
  // the bezier by sampling near the endpoint (cubic bezier derivative).
  const arrowSize = 8;
  const inset = 2; // how much to pull the arrow tip back from the node edge

  // Derivative of cubic bezier at t: 3(1-t)^2 (P1-P0) + 6(1-t)t (P2-P1) + 3t^2 (P3-P2)
  // For react-flow's bezier the control points are based on the position and
  // handle side. Approximate direction at the end by using the segment from
  // the last control point to the target.
  function bezierDirAtEnd(): { x: number; y: number } {
    // getBezierPath doesn't return control points in v12, so we approximate:
    // The tangent at the target is roughly the direction from targetX,Y back
    // toward the midpoint of the curve. Use the vector from (target - label).
    const dx = targetX - labelX;
    const dy = targetY - labelY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  }
  function bezierDirAtStart(): { x: number; y: number } {
    const dx = labelX - sourceX;
    const dy = labelY - sourceY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  const endDir = bezierDirAtEnd();
  const startDir = bezierDirAtStart();
  const endTip = {
    x: targetX - endDir.x * inset,
    y: targetY - endDir.y * inset,
  };
  const startTip = {
    x: sourceX + startDir.x * inset,
    y: sourceY + startDir.y * inset,
  };

  const commitLabelEdit = () => {
    const next = draftLabel.trim();
    if (!next) {
      setEditingLabel(false);
      return;
    }
    if (typed.actions?.onUpdateKind) {
      typed.actions.onUpdateKind(id, { ...kind, label: next });
    }
    setEditingLabel(false);
  };

  const updateKind = (patch: Partial<RelationKind>) => {
    if (!typed.actions?.onUpdateKind) return;
    typed.actions.onUpdateKind(id, { ...kind, ...patch });
  };

  return (
    <>
      <g
        className={`react-flow__edge-pathgroup ${selected ? 'is-selected' : ''}`}
        style={{ color: stroke }}
      >
        <path
          d={edgePath}
          fill="none"
          stroke={stroke}
          strokeWidth={selected ? 2.6 : 2}
          strokeDasharray={dashArray}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke' }}
        />
        {/* Transparent interaction overlay so the line is easy to click. */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          style={{ cursor: 'pointer' }}
        />
        {kind.arrowStart !== 'none' && (
          <ArrowHead
            tip={startTip}
            dir={startDir}
            color={stroke}
            size={arrowSize}
            double={kind.arrowStart === 'double'}
          />
        )}
        {kind.arrowEnd !== 'none' && (
          <ArrowHead
            tip={endTip}
            dir={endDir}
            color={stroke}
            size={arrowSize}
            double={kind.arrowEnd === 'double'}
          />
        )}
      </g>

      <EdgeLabelRenderer>
        <div
          className={`canvas-edge-label ${kind.isPaperRelation ? 'is-paper-relation' : 'is-canvas-link'} ${selected ? 'is-selected' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            ['--edge-color' as string]: stroke,
            background: stroke,
            color: '#fff',
            padding: '0.18rem 0.55rem',
            borderRadius: 999,
            fontSize: '0.7rem',
            fontWeight: 700,
            lineHeight: 1.1,
            pointerEvents: 'all',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.18)',
            border: '1px solid color-mix(in srgb, #fff 45%, transparent)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title={kind.label}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setEditingLabel(true);
            setDraftLabel(kind.label);
          }}
        >
          {editingLabel ? (
            <input
              autoFocus
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              onBlur={commitLabelEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitLabelEdit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditingLabel(false);
                }
              }}
              onClick={(event) => event.stopPropagation()}
              style={{
                background: 'transparent',
                color: '#fff',
                border: 'none',
                outline: 'none',
                font: 'inherit',
                fontWeight: 'inherit',
                minWidth: 60,
                width: `${Math.max(60, draftLabel.length * 8)}px`,
              }}
            />
          ) : (
            kind.label
          )}
        </div>

        {selected && (
          <div
            className="canvas-edge-actions"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 32}px)`,
              display: 'flex',
              gap: 4,
              pointerEvents: 'all',
            }}
          >
            <button
              type="button"
              className="canvas-edge-action-btn"
              onClick={(event) => {
                event.stopPropagation();
                setShowStyle((v) => !v);
              }}
              title="Change line style"
              aria-label="Change line style"
              style={actionBtnStyle(stroke)}
            >
              Style
            </button>
            {typed.actions?.onDelete && (
              <button
                type="button"
                className="canvas-edge-action-btn canvas-edge-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  typed.actions?.onDelete?.(id);
                }}
                title="Delete connection"
                aria-label="Delete selected connection"
                style={actionBtnStyle(stroke, true)}
              >
                Delete
              </button>
            )}
          </div>
        )}

        {selected && showStyle && (
          <EdgeStylePopover
            x={labelX}
            y={labelY + 70}
            kind={kind}
            onChange={updateKind}
            onClose={() => setShowStyle(false)}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}

function actionBtnStyle(color: string, isDelete = false): React.CSSProperties {
  return {
    background: isDelete ? color : 'var(--glass-liquid-floating, #fff)',
    border: `1px solid ${color}`,
    color: isDelete ? '#fff' : color,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.7rem',
    fontWeight: 700,
    lineHeight: 1,
    padding: '0.3rem 0.55rem',
    borderRadius: 999,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.18)',
  };
}

interface EdgeStylePopoverProps {
  x: number;
  y: number;
  kind: RelationKind;
  onChange: (patch: Partial<RelationKind>) => void;
  onClose: () => void;
}

function EdgeStylePopover({ x, y, kind, onChange, onClose }: EdgeStylePopoverProps) {
  return (
    <div
      className="canvas-edge-style-popover"
      style={{
        position: 'absolute',
        transform: `translate(-50%, 0) translate(${x}px, ${y}px)`,
        background: 'var(--glass-liquid-floating, #fff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
        padding: '0.4rem',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
        pointerEvents: 'all',
        minWidth: 200,
        zIndex: 70,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        style={{
          fontSize: '0.65rem',
          color: 'var(--color-text-muted, #6b7280)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 4,
        }}
      >
        Color
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 4,
          marginBottom: 8,
        }}
      >
        {SWATCH_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange({ color: swatch })}
            aria-label={`Color ${swatch}`}
            title={swatch}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: 4,
              background: swatch,
              border:
                kind.color === swatch
                  ? '2px solid currentColor'
                  : '1px solid var(--color-border, #e5e7eb)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>

      <div
        style={{
          fontSize: '0.65rem',
          color: 'var(--color-text-muted, #6b7280)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 4,
        }}
      >
        End arrow
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {ARROW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ arrowEnd: opt.value as ArrowSide })}
            style={pillStyle(kind.arrowEnd === opt.value, kind.color)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        style={{
          fontSize: '0.65rem',
          color: 'var(--color-text-muted, #6b7280)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 4,
        }}
      >
        Start arrow
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {ARROW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ arrowStart: opt.value as ArrowSide })}
            style={pillStyle(kind.arrowStart === opt.value, kind.color)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        style={{
          fontSize: '0.65rem',
          color: 'var(--color-text-muted, #6b7280)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 4,
        }}
      >
        Line style
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {DASH_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ dashStyle: opt.value as DashStyle })}
            style={pillStyle(kind.dashStyle === opt.value, kind.color)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '0.3rem 0.6rem',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            font: 'inherit',
            color: 'var(--color-text-secondary, #6b7280)',
            borderRadius: 4,
            fontSize: '0.7rem',
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function pillStyle(active: boolean, color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: '0.3rem 0.4rem',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.7rem',
    background: active
      ? color
      : 'color-mix(in srgb, var(--color-bg, #fff) 60%, transparent)',
    color: active ? '#fff' : 'inherit',
    fontWeight: active ? 600 : 500,
  };
}

export { kindToEdgePayload };
