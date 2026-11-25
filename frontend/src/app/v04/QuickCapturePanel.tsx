import React from 'react';
import type { QuickCapture } from '../../platforms/desktop';
import { useDesktopWorkspace } from './desktopWorkspaceContext';

export function QuickCapturePanel(props: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.ReactElement | null {
  const workspace = useDesktopWorkspace();
  const [body, setBody] = React.useState('');
  const [items, setItems] = React.useState<ReadonlyArray<QuickCapture>>([]);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (props.open) void workspace.listQuickCaptures().then(setItems).catch((e) => setError(String(e)));
  }, [props.open, workspace]);
  if (!props.open) return null;
  const save = async (): Promise<void> => {
    if (!body.trim()) return;
    try {
      const item = await workspace.saveQuickCapture(body.trim());
      setItems((current) => [item, ...current]);
      setBody('');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="v04-capture-backdrop" role="presentation" onMouseDown={props.onClose}>
      <aside
        className="v04-capture-panel glass-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Capture"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header><h2>Quick Capture</h2><button className="btn btn-ghost btn-sm" onClick={props.onClose}>Close</button></header>
        <p>Capture first. Organise when you are ready.</p>
        <textarea
          autoFocus
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void save();
          }}
          placeholder="A thought, question, quote, or next step…"
        />
        <button className="btn btn-primary" disabled={!body.trim()} onClick={() => void save()}>
          Save to private inbox
        </button>
        {error ? <p role="alert" className="v04-entry-error">{error}</p> : null}
        <div className="v04-capture-list">
          {items.map((item) => (
            <article key={item.id}>
              <p>{item.body}</p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void workspace.archiveQuickCapture(item.id).then(() =>
                  setItems((current) => current.filter((row) => row.id !== item.id)))}
              >Archive</button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
