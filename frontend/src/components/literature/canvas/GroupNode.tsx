import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CloseIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';
import CanvasNodeResizer from './CanvasNodeResizer';

export default function GroupNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const content = data.canvasNode.content_json as Record<string, unknown> | null;
  const childIds = Array.isArray(content?.child_node_ids)
    ? content.child_node_ids.filter((childId): childId is string => typeof childId === 'string')
    : [];
  const childCount = childIds.length;
  const isTrueGroup = content?.group_mode === 'true_group';
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState<string>(
    (content?.label as string) ?? 'Group'
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      const remote = (content?.label as string) ?? 'Group';
      if (remote !== label) setLabel(remote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.label]);

  const commit = (next: string) => {
    const clean = next.trim() || 'Group';
    setLabel(clean);
    data.actions.onContentPatch(id, { label: clean });
  };

  return (
    <div className={`canvas-node canvas-node-group ${isTrueGroup ? 'is-true-group' : ''} ${selected ? 'is-selected' : ''}`}>
      <CanvasNodeResizer nodeId={id} selected={selected} minWidth={220} minHeight={140} onResize={data.actions.onResize} />
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
                setLabel((content?.label as string) ?? 'Group');
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
        <span className="canvas-node-group-count">
          {childCount > 0 ? `${childCount} grouped item${childCount === 1 ? '' : 's'}` : 'Drop items nearby or select items first'}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
