import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { CloseIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';
import { getGroupChildIds, isTrueGroupNode } from './group-utils';
import CanvasNodeResizer from './CanvasNodeResizer';

interface GroupNodeProps extends NodeProps<CanvasFlowNode> {
  onUngroup?: (groupId: string) => void;
}

const NODE_TYPE_GLYPHS: Record<string, string> = {
  paper: '📄',
  note: '📝',
  text: 'T',
  question: '?',
  shape: '◇',
  group: '▢',
};

export default function GroupNode({ id, data, selected, onUngroup }: GroupNodeProps) {
  const { getNodes } = useReactFlow();
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
  const [isDropTarget, setIsDropTarget] = useState(false);
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

  // Look up the actual child node objects so we can show their titles in the body.
  const childNodes = childIds
    .map((cid) => getNodes().find((n) => n.id === cid))
    .filter((n): n is CanvasFlowNode => Boolean(n));

  return (
    <div
      className={`canvas-node canvas-node-group ${isTrueGroup ? 'is-true-group' : ''} ${selected ? 'is-selected' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
      onDragOver={(event) => {
        // React Flow's own drag handling for nodes stops propagation; we
        // still want to highlight this group when something is dragged over it.
        event.stopPropagation();
        if (event.dataTransfer.types.includes('application/reactflow')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setIsDropTarget(true);
        }
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target) setIsDropTarget(false);
      }}
      onDrop={(event) => {
        event.stopPropagation();
        setIsDropTarget(false);
      }}
    >
      <CanvasNodeResizer nodeId={id} selected={selected} minWidth={220} minHeight={140} onResize={data.actions.onResize} />
      <Handle type="target" position={Position.Top} />
      <div className="canvas-node-group-header">
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
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="canvas-node-group-label"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {label}
          </span>
        )}
        <span className="canvas-node-group-count-badge" title="Grouped items">
          {childCount}
        </span>
        {isTrueGroup && onUngroup && (
          <button
            type="button"
            className="canvas-node-group-ungroup"
            onClick={(e) => {
              e.stopPropagation();
              onUngroup(id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Ungroup (keep children)"
            aria-label="Ungroup"
          >
            Ungroup
          </button>
        )}
        <button
          className="canvas-node-icon-btn canvas-node-delete"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            data.actions.onDelete(id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Delete"
          aria-label="Delete"
        >
          <CloseIcon size="sm" />
        </button>
      </div>
      <div className="canvas-node-group-body">
        {childCount === 0 ? (
          <span className="canvas-node-group-count">
            Drop items here to group them
          </span>
        ) : (
          <ul className="canvas-node-group-member-list">
            {childNodes.slice(0, 6).map((child) => {
              const text = (child.data.canvasNode.content_json as any)?.text
                || (child.data.canvasNode.content_json as any)?.title
                || (child.data.canvasNode.content_json as any)?.label
                || (child.data.canvasNode.content_json as any)?.prompt
                || child.id.slice(0, 6);
              const preview = String(text).replace(/\s+/g, ' ').trim().slice(0, 36);
              return (
                <li
                  key={child.id}
                  className={`canvas-node-group-member is-type-${child.type}`}
                  title={preview}
                >
                  <span className="canvas-node-group-member-glyph" aria-hidden>
                    {NODE_TYPE_GLYPHS[child.type ?? ''] ?? '•'}
                  </span>
                  <span className="canvas-node-group-member-text">{preview}</span>
                </li>
              );
            })}
            {childCount > 6 && (
              <li className="canvas-node-group-member is-overflow">
                +{childCount - 6} more
              </li>
            )}
          </ul>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
