import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasFlowNode } from './canvas-types';

interface QuestionNodeProps extends NodeProps<CanvasFlowNode> {
  onRegenerate?: (nodeId: string) => void;
  onInsertAsNote?: (nodeId: string) => void;
}

export default function QuestionNode({
  id,
  data,
  selected,
  onRegenerate,
  onInsertAsNote,
}: QuestionNodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    (data.canvasNode.content_json?.prompt as string) ?? ''
  );
  const [value, setValue] = useState<string>(
    (data.canvasNode.content_json?.text as string) ?? ''
  );
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) promptRef.current?.focus();
  }, [editing]);

  // Keep local state in sync with remote updates (after regeneration, etc.).
  useEffect(() => {
    if (!editing) {
      const remotePrompt = (data.canvasNode.content_json?.prompt as string) ?? '';
      const remoteText = (data.canvasNode.content_json?.text as string) ?? '';
      if (remotePrompt !== draft) setDraft(remotePrompt);
      if (remoteText !== value) setValue(remoteText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.canvasNode.content_json?.prompt, data.canvasNode.content_json?.text]);

  const sources: string[] =
    (data.canvasNode.content_json?.sources as string[]) ?? [];

  const commitPrompt = (next: string) => {
    setDraft(next);
    // Persist the new prompt but keep the existing answer visible until the
    // user clicks Regenerate.
    data.actions.onContentPatch(id, { prompt: next, text: value });
  };

  return (
    <div className={`canvas-node canvas-node-question ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="canvas-node-header">
        <span className="canvas-node-type">Question</span>
        <div className="canvas-node-header-actions">
          {onRegenerate && (
            <button
              className="canvas-node-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate(id);
              }}
              title="Regenerate answer"
              aria-label="Regenerate"
            >
              ↻
            </button>
          )}
          {onInsertAsNote && (
            <button
              className="canvas-node-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                onInsertAsNote(id);
              }}
              title="Insert answer as a note"
              aria-label="Insert as note"
            >
              ⤴
            </button>
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
      </div>
      <div className="canvas-node-body canvas-node-question-body">
        {editing ? (
          <textarea
            ref={promptRef}
            className="canvas-node-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              commitPrompt(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false);
                setDraft(
                  (data.canvasNode.content_json?.prompt as string) ?? ''
                );
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setEditing(false);
                commitPrompt(draft);
              }
            }}
          />
        ) : (
          <div
            className="canvas-node-question-prompt"
            onDoubleClick={() => setEditing(true)}
          >
            {draft || (
              <span className="canvas-node-placeholder">Double-click to set a question</span>
            )}
          </div>
        )}
        <div className="canvas-node-question-answer">
          {value || <span className="muted">No answer yet — ask the AI assistant.</span>}
        </div>
        {sources.length > 0 && (
          <div className="canvas-node-question-sources">
            <span className="muted">Sources:</span> {sources.length} paper
            {sources.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
