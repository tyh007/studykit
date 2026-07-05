import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CloseIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';
import CanvasNodeResizer from './CanvasNodeResizer';

export default function ShapeNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState<string>(
    (data.canvasNode.content_json?.label as string) ?? 'Shape'
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      const remote = (data.canvasNode.content_json?.label as string) ?? 'Shape';
      if (remote !== label) setLabel(remote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.canvasNode.content_json?.label]);

  const commit = (next: string) => {
    const clean = next.trim() || 'Shape';
    setLabel(clean);
    data.actions.onContentPatch(id, { label: clean });
  };

  return (
    <div className={`canvas-node canvas-node-shape ${selected ? 'is-selected' : ''}`}>
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
      <div className="canvas-node-shape-body" onDoubleClick={() => setEditing(true)}>
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
                setLabel((data.canvasNode.content_json?.label as string) ?? 'Shape');
              }
            }}
          />
        ) : (
          <span className="canvas-node-shape-label">{label}</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
