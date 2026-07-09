import React, { useCallback, useMemo, useState } from 'react';
import {
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import {
  DASH_PATTERNS,
  readRelationKindFromEdge,
  type RelationKind,
} from './relation-types';
import RelationTypeMenu from './RelationTypeMenu';

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
  const px = -dir.y;
  const py = dir.x;
  const back = size;
  const half = size * 0.6;
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
  const { flowToScreenPosition } = useReactFlow();
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);
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
  const arrowSize = 8;
  const inset = 2;

  function bezierDirAtEnd(): { x: number; y: number } {
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

  const commitLabelEdit = useCallback(() => {
    const next = draftLabel.trim();
    if (!next) {
      setEditingLabel(false);
      return;
    }
    if (typed.actions?.onUpdateKind) {
      typed.actions.onUpdateKind(id, { ...kind, label: next });
    }
    setEditingLabel(false);
  }, [draftLabel, typed.actions, id, kind]);

  const openPicker = useCallback(
    (event?: React.MouseEvent) => {
      if (event) event.stopPropagation();
      // Position picker below the label, in screen coordinates.
      const screen = flowToScreenPosition({ x: labelX, y: labelY + 48 });
      setPickerPos({ x: screen.x, y: screen.y });
    },
    [flowToScreenPosition, labelX, labelY]
  );

  const closePicker = useCallback(() => {
    setPickerPos(null);
  }, []);

  const onPickerPick = useCallback(
    (next: RelationKind) => {
      if (typed.actions?.onUpdateKind) {
        typed.actions.onUpdateKind(id, next);
      }
      // Keep the picker open so the user can continue tweaking.
      // They click "Done" or outside to close.
    },
    [typed.actions, id]
  );

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
          className={`canvas-edge-label ${kind.isPaperRelation ? 'is-paper-relation' : 'is-canvas-link'} ${selected ? 'is-selected' : ''} ${pickerPos ? 'is-editing' : ''}`}
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
          title="Click to change relation · Double-click to rename"
          onClick={(event) => {
            event.stopPropagation();
            if (!editingLabel) openPicker(event);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
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
            <>
              <span>{kind.label}</span>
              {selected && (
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 0,
                    height: 0,
                    borderLeft: '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop: '5px solid currentColor',
                    opacity: 0.85,
                    marginLeft: 2,
                    flexShrink: 0,
                  }}
                />
              )}
            </>
          )}
        </div>

        {selected && !editingLabel && (
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
                openPicker(event);
              }}
              title="Change relation type or style"
              aria-label="Change relation"
              style={actionBtnStyle(stroke)}
            >
              Change
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

        {pickerPos && (
          <RelationTypeMenu
            position={pickerPos}
            onPick={onPickerPick}
            onCancel={closePicker}
            initialKind={kind}
            bothPaper={true}
            mode="edit"
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

export { kindToEdgePayload } from './relation-types';
