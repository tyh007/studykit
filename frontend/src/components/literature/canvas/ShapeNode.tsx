import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CloseIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';
import CanvasNodeResizer from './CanvasNodeResizer';
import {
  CANVAS_SHAPE_FILLS,
  CANVAS_SHAPE_OPTIONS,
  CANVAS_SHAPE_STROKES,
  normalizeShapeType,
} from './shape-options';

export default function ShapeNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const content = data.canvasNode.content_json as Record<string, unknown> | null;
  const style = data.canvasNode.style_json as Record<string, unknown> | null;
  const shape = normalizeShapeType(style?.shape);
  const fill = typeof style?.fill === 'string' ? style.fill : '#F8FAFC';
  const stroke = typeof style?.stroke === 'string' ? style.stroke : '#7AA68A';
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState<string>((content?.label as string) ?? 'Text');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      const remote = (content?.label as string) ?? 'Text';
      if (remote !== label) setLabel(remote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.label]);

  const commit = (next: string) => {
    const clean = next.trim() || 'Text';
    setLabel(clean);
    data.actions.onContentPatch(id, { label: clean });
  };

  return (
    <div
      className={`canvas-node canvas-node-shape canvas-node-shape-${shape} ${selected ? 'is-selected' : ''}`}
      style={{
        ['--shape-fill' as string]: fill,
        ['--shape-stroke' as string]: stroke,
      }}
    >
      <CanvasNodeResizer nodeId={id} selected={selected} minWidth={120} minHeight={80} onResize={data.actions.onResize} />
      <Handle type="target" position={Position.Top} />
      <button
        className="canvas-node-icon-btn canvas-node-delete canvas-node-shape-delete"
        onClick={(e) => {
          e.stopPropagation();
          data.actions.onDelete(id);
        }}
        title="Delete"
        aria-label="Delete shape"
      >
        <CloseIcon size="sm" />
      </button>
      {selected && (
        <div className="canvas-node-shape-controls" onPointerDown={(event) => event.stopPropagation()}>
          <select
            className="canvas-node-shape-select"
            value={shape}
            onChange={(event) => data.actions.onStylePatch(id, { shape: event.target.value })}
            aria-label="Shape type"
          >
            {CANVAS_SHAPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="canvas-node-shape-swatches" aria-label="Shape fill colors">
            {CANVAS_SHAPE_FILLS.map((color) => (
              <button
                key={color}
                type="button"
                className={`canvas-node-shape-swatch ${fill === color ? 'is-active' : ''}`}
                style={{ background: color }}
                onClick={() => data.actions.onStylePatch(id, { fill: color })}
                aria-label={`Use fill ${color}`}
                title={`Fill ${color}`}
              />
            ))}
          </div>
          <div className="canvas-node-shape-swatches" aria-label="Shape border colors">
            {CANVAS_SHAPE_STROKES.map((color) => (
              <button
                key={color}
                type="button"
                className={`canvas-node-shape-swatch is-stroke ${stroke === color ? 'is-active' : ''}`}
                style={{ background: color }}
                onClick={() => data.actions.onStylePatch(id, { stroke: color })}
                aria-label={`Use stroke ${color}`}
                title={`Stroke ${color}`}
              />
            ))}
          </div>
        </div>
      )}
      <div className="canvas-node-shape-body" onDoubleClick={() => setEditing(true)}>
        <div className="canvas-node-shape-surface" aria-hidden="true" />
        <div className="canvas-node-shape-label-wrap">
          {editing ? (
            <input
              ref={inputRef}
              className="canvas-node-shape-label-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => {
                setEditing(false);
                commit(label);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditing(false);
                  commit(label);
                } else if (e.key === 'Escape') {
                  setEditing(false);
                  setLabel((content?.label as string) ?? 'Text');
                }
              }}
            />
          ) : (
            <span className="canvas-node-shape-label">{label}</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
