import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CloseIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';

export default function GroupNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState<string>(
    (data.canvasNode.content_json?.label as string) ?? 'Group'
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      const remote = (data.canvasNode.content_json?.label as string) ?? 'Group';
      if (remote !== label) setLabel(remote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.canvasNode.content_json?.label]);

  const commit = (next: string) => {
    setLabel(next);
    data.actions.onContentPatch(id, { label: next });
  };

  return (
    <div className={`canvas-node canvas-node-group ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="canvas-node-header">
        {editing ? (
          <input
            ref={inputRef}
            className="canvas-node-group-label-input"
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
                setLabel((data.canvasNode.content_json?.label as string) ?? 'Group');
              }
            }}
          />
        ) : (
          <span
            className="canvas-node-group-label"
            onDoubleClick={() => setEditing(true)}
          >
            {label}
          </span>
        )}
        <button
          className="canvas-node-icon-btn canvas-node-delete"
          onClick={(e) => {
            e.stopPropagation();
            data.actions.onDelete(id);
          }}
          title="Delete"
          aria-label="Delete"
        >
          <CloseIcon size="sm" />
        </button>
      </div>
      <div className="canvas-node-group-body">
        <span className="muted">Visual frame only — does not constrain children.</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
