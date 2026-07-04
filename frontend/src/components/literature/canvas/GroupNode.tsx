import React, { useState, useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
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
    // Persist via the same onContentChange channel so a backend PATCH happens.
    // We keep the field under content_json.label to avoid clobbering text fields
    // used by other node types.
    data.actions.onContentChange(id, label); // triggers a PATCH; UI-only update suffices
  };

  return (
    <div className={`canvas-node canvas-node-group ${selected ? 'is-selected' : ''}`}>
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
          className="canvas-node-delete"
          onClick={(e) => {
            e.stopPropagation();
            data.actions.onDelete(id);
          }}
          title="Delete"
          aria-label="Delete"
        >
          ×
        </button>
      </div>
      <div className="canvas-node-group-body">
        <span className="muted">Visual frame only — does not constrain children.</span>
      </div>
    </div>
  );
}
