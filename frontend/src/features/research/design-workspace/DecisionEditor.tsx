/**
 * StudyKit v0.4 — `features/research/design-workspace/DecisionEditor`
 *
 * The dialog the user opens to write a new
 * `MethodDecision` (or revise an existing one). The
 * fields are:
 *
 *   - title  (required, non-empty)
 *   - choice (required, non-empty)
 *   - rationale (required, non-empty)
 *   - alternatives (list of {label, body, evidenceIds})
 *   - impacts (one per line)
 *   - evidence ids (one per line, optional)
 *
 * The "Create task from this decision" button is
 * optional; the host passes `onCreateTask` only when
 * the dialog is for *editing* a head (a fresh
 * decision has no id yet to point at).
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import type { MethodAlternative } from '../../../domain/researchDesign';

export interface DecisionEditorValue {
  readonly title: string;
  readonly choice: string;
  readonly rationale: string;
  readonly alternatives: readonly MethodAlternative[];
  readonly evidenceIds: readonly string[];
  readonly impacts: readonly string[];
}

export interface DecisionEditorProps {
  readonly testIdPrefix: string;
  readonly title: string;
  readonly initial: DecisionEditorValue;
  readonly onCancel: () => void;
  readonly onSave: (value: DecisionEditorValue) => void;
  /** Optional: show a "Create task from this decision" button. */
  readonly onCreateTask?: () => void;
}

export function DecisionEditor(props: DecisionEditorProps): React.ReactElement {
  const [title, setTitle] = React.useState(props.initial.title);
  const [choice, setChoice] = React.useState(props.initial.choice);
  const [rationale, setRationale] = React.useState(props.initial.rationale);
  const [altLabel, setAltLabel] = React.useState('');
  const [altBody, setAltBody] = React.useState('');
  const [alternatives, setAlternatives] = React.useState<readonly MethodAlternative[]>(
    props.initial.alternatives,
  );
  const [impacts, setImpacts] = React.useState(props.initial.impacts.join('\n'));
  const [evidenceIds, setEvidenceIds] = React.useState(props.initial.evidenceIds.join('\n'));
  const [error, setError] = React.useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    if (title.trim().length === 0) {
      setError('Title is required.');
      return;
    }
    if (choice.trim().length === 0) {
      setError('Choice is required.');
      return;
    }
    if (rationale.trim().length === 0) {
      setError('Rationale is required.');
      return;
    }
    props.onSave({
      title,
      choice,
      rationale,
      alternatives,
      evidenceIds: evidenceIds.split('\n').map((s) => s.trim()).filter((s) => s.length > 0),
      impacts: impacts.split('\n').map((s) => s.trim()).filter((s) => s.length > 0),
    });
  };

  return (
    <div
      role="dialog"
      aria-label={props.title}
      data-testid={`${props.testIdPrefix}-dialog`}
      className="rd-dialog-backdrop"
    >
      <Surface
        data-testid={`${props.testIdPrefix}-card`}
        className="rd-dialog"
      >
        <h2 className="rd-h2">{props.title}</h2>
        {error && <p role="alert" data-testid={`${props.testIdPrefix}-error`} className="rd-error">{error}</p>}
        <div className="rd-stack-sm" style={{ marginTop: '0.5rem' }}>
          <label>
            <div className="rd-muted">Title</div>
            <input
              type="text"
              className="rd-input"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              data-testid={`${props.testIdPrefix}-title`}
              aria-label="Decision title"
            />
          </label>
          <label>
            <div className="rd-muted">Choice</div>
            <textarea
              className="rd-textarea"
              value={choice}
              onChange={(e) => setChoice(e.currentTarget.value)}
              data-testid={`${props.testIdPrefix}-choice`}
              rows={3}
              aria-label="Decision choice"
            />
          </label>
          <label>
            <div className="rd-muted">Rationale</div>
            <textarea
              className="rd-textarea"
              value={rationale}
              onChange={(e) => setRationale(e.currentTarget.value)}
              data-testid={`${props.testIdPrefix}-rationale`}
              rows={3}
              aria-label="Decision rationale"
            />
          </label>
          <div>
            <div className="rd-muted">Alternatives considered (one at a time)</div>
            <div className="rd-row">
              <input
                type="text"
                placeholder="label"
                value={altLabel}
                onChange={(e) => setAltLabel(e.currentTarget.value)}
                data-testid={`${props.testIdPrefix}-alt-label`}
                style={{ flex: 1 }}
                aria-label="Alternative label"
              />
              <input
                type="text"
                placeholder="body"
                value={altBody}
                onChange={(e) => setAltBody(e.currentTarget.value)}
                data-testid={`${props.testIdPrefix}-alt-body`}
                style={{ flex: 2 }}
                aria-label="Alternative body"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (altLabel.trim().length === 0) return;
                  setAlternatives([
                    ...alternatives,
                    {
                      id: `alt_${Date.now().toString(36)}`,
                      label: altLabel.trim(),
                      body: altBody.trim(),
                      evidenceIds: [],
                    },
                  ]);
                  setAltLabel('');
                  setAltBody('');
                }}
                data-testid={`${props.testIdPrefix}-alt-add`}
              >
                Add
              </Button>
            </div>
            <ul className="rd-list" style={{ margin: '0.25rem 0' }}>
              {alternatives.map((a) => (
                <li
                  key={a.id}
                  data-testid={`${props.testIdPrefix}-alt-row`}
                  className="rd-list-item"
                >
                  <span style={{ flex: 1 }}>
                    {a.label}: {a.body}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAlternatives(alternatives.filter((x) => x.id !== a.id))
                    }
                    data-testid={`${props.testIdPrefix}-alt-remove`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <label>
            <div className="rd-muted">Impacts (one per line)</div>
            <textarea
              className="rd-textarea"
              value={impacts}
              onChange={(e) => setImpacts(e.currentTarget.value)}
              data-testid={`${props.testIdPrefix}-impacts`}
              rows={2}
              aria-label="Decision impacts"
            />
          </label>
          <label>
            <div className="rd-muted">Evidence ids (one per line, optional)</div>
            <textarea
              className="rd-textarea"
              value={evidenceIds}
              onChange={(e) => setEvidenceIds(e.currentTarget.value)}
              data-testid={`${props.testIdPrefix}-evidence-ids`}
              rows={2}
              aria-label="Decision evidence ids"
            />
          </label>
        </div>
        <div className="rd-dialog-actions">
          {props.onCreateTask && (
            <Button
              variant="secondary"
              size="md"
              onClick={props.onCreateTask}
              data-testid={`${props.testIdPrefix}-create-task`}
            >
              Create task from this decision
            </Button>
          )}
          <Button
            variant="ghost"
            size="md"
            onClick={props.onCancel}
            data-testid={`${props.testIdPrefix}-cancel`}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            data-testid={`${props.testIdPrefix}-save`}
          >
            Save
          </Button>
        </div>
      </Surface>
    </div>
  );
}
