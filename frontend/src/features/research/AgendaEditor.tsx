/**
 * StudyKit v0.5 P5b — the group meeting agenda, built from the project:
 * what to decide, new evidence against a point, what was settled, what
 * the group still has to brainstorm, and points missing support. Copy
 * it into the meeting chat; mark the meeting held so the next agenda
 * counts from then.
 */

import React from 'react';
import './thinking.css';
import { useResearchDeps } from './researchContext';
import { agendaToText, loadAgenda, markMeetingHeld, type Agenda, type AgendaTarget } from '../../application/research/agenda';
import { Button } from '../../shared/ui/Button';

export interface AgendaEditorProps {
  readonly projectId: string;
  readonly onOpen: (target: AgendaTarget) => void;
}

export function AgendaEditor(props: AgendaEditorProps): React.ReactElement {
  const { projectId } = props;
  const { repository } = useResearchDeps();
  const [data, setData] = React.useState<{ agenda: Agenda; projectName: string } | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void loadAgenda(repository, projectId)
        .then((d) => !cancelled && setData(d))
        .catch(() => undefined);
    };
    refresh();
    const off = repository.subscribe(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [repository, projectId]);

  if (!data) return <p className="thinking-muted">Loading…</p>;
  const { agenda } = data;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(agendaToText(agenda, data.projectName));
      setNote('Copied. Paste it into the meeting chat or notes.');
    } catch {
      setNote('Couldn’t copy. Select the agenda and copy it by hand.');
    }
  };

  return (
    <div className="thinking agenda" data-testid="agenda-editor">
      <header className="thinking-header">
        <p className="thinking-kicker">Meeting agenda</p>
        <h1 className="thinking-title">{data.projectName || 'Research project'}</h1>
        <p className="thinking-muted" data-testid="agenda-since">
          {agenda.since
            ? `What came up since the last meeting on ${new Date(agenda.since).toLocaleDateString()}.`
            : 'Built from your project: open disagreements, evidence against your points and gaps.'}
        </p>
      </header>

      {agenda.sections.length === 0 ? (
        <p className="thinking-muted" data-testid="agenda-empty">
          Nothing to discuss yet: no open disagreements, no evidence against a point, no missing support.
        </p>
      ) : (
        agenda.sections.map((s) => (
          <section key={s.kind} className="agenda-section" aria-label={s.title} data-testid={`agenda-section-${s.kind}`}>
            <h2>{s.title}</h2>
            <ol>
              {s.items.map((i) => (
                <li key={i.key}>
                  <button type="button" className="agenda-item" onClick={() => props.onOpen(i.target)} data-testid="agenda-item">
                    <span className="agenda-item-title">{i.title}</span>
                    <span className="thinking-muted">{i.detail}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}

      <footer className="brainstorm-footer">
        <p className="thinking-muted" role="status" data-testid="agenda-note">
          {note ?? 'After the meeting, mark it held: the next agenda shows only what’s new.'}
        </p>
        <span className="agenda-actions">
          <Button variant="secondary" size="sm" onClick={() => void copy()} data-testid="agenda-copy">
            Copy as text
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void markMeetingHeld(repository, projectId)
                .then(() => setNote('Marked as held. The next agenda counts from now.'))
                .catch(() => setNote('Couldn’t save that. Try again.'))
            }
            data-testid="agenda-held"
          >
            Mark meeting held
          </Button>
        </span>
      </footer>
    </div>
  );
}
