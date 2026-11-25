import React from 'react';
import type { CanvasFlowNode } from './canvas-types';
import { BrainIcon, CloseIcon, CornellIcon, LinkIcon, MindMapIcon, PDFIcon } from '../../ui/Icons';

interface Props {
  selectedNodes: CanvasFlowNode[];
  onAskAI: () => void;
  onCreateNote: () => void;
  onGroup: () => void;
  onDelete: () => void;
  onOpenPaper?: () => void;
  onConnectorMode: () => void;
}

export default function SelectionToolbar({
  selectedNodes,
  onAskAI,
  onCreateNote,
  onGroup,
  onDelete,
  onOpenPaper,
  onConnectorMode,
}: Props) {
  if (selectedNodes.length === 0) return null;

  const singlePaper = selectedNodes.length === 1 && selectedNodes[0].type === 'paper';

  return (
    <div className="canvas-selection-toolbar" role="toolbar" aria-label="Selected canvas item actions">
      <span className="canvas-selection-count">
        {selectedNodes.length} selected
      </span>
      {singlePaper && onOpenPaper && (
        <button type="button" onClick={onOpenPaper} title="Open PDF" aria-label="Open selected paper PDF">
          <PDFIcon size="sm" />
          PDF
        </button>
      )}
      <button type="button" onClick={onAskAI} title="Ask AI" aria-label="Ask AI about selection">
        <BrainIcon size="sm" />
        Ask
      </button>
      <button type="button" onClick={onCreateNote} title="Create linked note" aria-label="Create note for selection">
        <CornellIcon size="sm" />
        Note
      </button>
      <button type="button" onClick={onConnectorMode} title="Connect items" aria-label="Show connector guidance">
        <LinkIcon size="sm" />
        Connect
      </button>
      <button type="button" onClick={onGroup} title="Add group frame" aria-label="Group selected items with frame">
        <MindMapIcon size="sm" />
        Group
      </button>
      <button type="button" onClick={onDelete} title="Delete selected" aria-label="Delete selected nodes">
        <CloseIcon size="sm" />
        Delete
      </button>
    </div>
  );
}
