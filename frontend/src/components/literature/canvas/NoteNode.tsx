import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CloseIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';

export default function NoteNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(
    (data.canvasNode.content_json?.text as string) ?? ''
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      const remote = (data.canvasNode.content_json?.text as string) ?? '';
      if (remote !== value) setValue(remote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.canvasNode.content_json?.text]);

  const commit = (next: string) => {
    setValue(next);
    data.actions.onContentChange(id, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setEditing(false);
      setValue((data.canvasNode.content_json?.text as string) ?? '');
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setEditing(false);
      commit(value);
    }
  };

  return (
    <div className={`canvas-node canvas-node-note ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="canvas-node-header">
        <span className="canvas-node-type">Note</span>
        <button
          className="canvas-node-icon-btn canvas-node-delete"
          onClick={(e) => {
            e.stopPropagation();
            data.actions.onDelete(id);
          }}
          title="Delete"
          aria-label="Delete node"
        >
          <CloseIcon size="sm" />
        </button>
      </div>
      {editing ? (
        <textarea
          ref={inputRef}
          className="canvas-node-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            commit(value);
          }}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className="canvas-node-body" onDoubleClick={() => setEditing(true)}>
          {value || <span className="canvas-node-placeholder">Double-click to add a note</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
