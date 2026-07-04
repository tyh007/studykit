import React from 'react';
import { AddIcon, CornellIcon, MindMapIcon, SyncIcon } from '../../ui/Icons';

interface Props {
  onAddText: () => void;
  onAddNote: () => void;
  onAddGroup: () => void;
  onFitView: () => void;
  disabled?: boolean;
}

export default function CanvasToolbar({
  onAddText,
  onAddNote,
  onAddGroup,
  onFitView,
  disabled,
}: Props) {
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas actions">
      <button
        className="canvas-toolbar-btn"
        onClick={onAddText}
        disabled={disabled}
        title="Add text card"
        aria-label="Add text card"
      >
        <AddIcon size="sm" /> Text
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddNote}
        disabled={disabled}
        title="Add note card"
        aria-label="Add note card"
      >
        <CornellIcon size="sm" /> Note
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddGroup}
        disabled={disabled}
        title="Add group frame"
        aria-label="Add group frame"
      >
        <MindMapIcon size="sm" /> Group
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onFitView}
        disabled={disabled}
        title="Fit to content"
        aria-label="Fit to content"
      >
        <SyncIcon size="sm" /> Fit
      </button>
    </div>
  );
}
