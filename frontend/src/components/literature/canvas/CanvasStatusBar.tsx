import React from 'react';

interface Props {
  nodeCount: number;
  saving: boolean;
  lastSavedAt?: number;
}

function formatLastSaved(ts: number | undefined): string {
  if (!ts) return 'Idle';
  const dt = new Date(ts);
  return `Saved ${dt.toLocaleTimeString()}`;
}

export default function CanvasStatusBar({ nodeCount, saving, lastSavedAt }: Props) {
  return (
    <div className="canvas-status" aria-live="polite">
      <span>
        {nodeCount} node{nodeCount === 1 ? '' : 's'}
      </span>
      <span aria-hidden="true">·</span>
      <span>{saving ? 'Saving…' : formatLastSaved(lastSavedAt)}</span>
    </div>
  );
}
