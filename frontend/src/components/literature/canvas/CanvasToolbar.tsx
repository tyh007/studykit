import React from 'react';

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
      >
        + Text
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddNote}
        disabled={disabled}
        title="Add note card"
      >
        + Note
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onAddGroup}
        disabled={disabled}
        title="Add group frame"
      >
        + Group
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onFitView}
        disabled={disabled}
        title="Fit to content"
      >
        Fit
      </button>
    </div>
  );
}
