/**
 * StudyKit v0.4 — `features/research/design-workspace/TaskFromDecisionForm`
 *
 * The "Create task from this decision" dialog. The
 * form is *pre-filled* with the decision's title +
 * rationale; the user edits the title / why / DoD.
 * The `sourceRef` is **immutable**: saving writes a
 * canonical `ResearchTask` with
 * `sourceRef.kind: 'decision'` and the exact
 * decision id. The `sourceNote` carries the
 * decision's title for the lineage chip.
 *
 * The canonical `authorType` stays `'user'`; the
 * `origin` defaults to `{ kind: 'user' }` because
 * the user explicitly picked the decision (the
 * decision itself came from the design workspace,
 * which is a user-authored surface).
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import { useResearchDeps } from '../researchContext';
import { createTask } from '../../../application/research/researchDesignUseCases';
import type { MethodDecision } from '../../../domain/researchDesign';

export interface TaskFromDecisionFormProps {
  readonly decision: MethodDecision;
  readonly projectId: string;
  readonly onCancel: () => void;
  readonly onCreated: (taskId: string) => void;
  readonly onError: (msg: string) => void;
}

export function TaskFromDecisionForm(
  props: TaskFromDecisionFormProps,
): React.ReactElement {
  const deps = useResearchDeps();
  const [title, setTitle] = React.useState(props.decision.title);
  const [why, setWhy] = React.useState(props.decision.rationale);
  const [dod, setDod] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      const created = await createTask(deps.repository, {
        projectId: props.projectId,
        title,
        why,
        definitionOfDone: dod,
        // The sourceRef is the decision itself. The
        // form is *not* allowed to change it; the
        // use case re-checks the decision exists in
        // the same project (referential invariant).
        sourceRef: { kind: 'decision', id: props.decision.id },
        sourceNote: props.decision.title,
      });
      props.onCreated(created.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create task.';
      setErr(msg);
      props.onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Create task from decision"
      data-testid="design-task-from-decision-dialog"
      className="rd-dialog-backdrop"
    >
      <Surface
        data-testid="design-task-from-decision-card"
        className="rd-dialog"
      >
        <h2 className="rd-h2">Create task from decision</h2>
        <p className="rd-muted">
          From decision: <strong>{props.decision.title}</strong>
        </p>
        {err && <p role="alert" data-testid="design-task-from-decision-error" className="rd-error">{err}</p>}
        <div className="rd-stack-sm" style={{ marginTop: '0.5rem' }}>
          <label>
            <div className="rd-muted">Title</div>
            <input
              type="text"
              className="rd-input"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              data-testid="design-task-from-decision-title"
              aria-label="Task title"
            />
          </label>
          <label>
            <div className="rd-muted">Why this task exists</div>
            <textarea
              className="rd-textarea"
              value={why}
              onChange={(e) => setWhy(e.currentTarget.value)}
              data-testid="design-task-from-decision-why"
              rows={3}
              aria-label="Why this task"
            />
          </label>
          <label>
            <div className="rd-muted">Definition of done</div>
            <textarea
              className="rd-textarea"
              value={dod}
              onChange={(e) => setDod(e.currentTarget.value)}
              data-testid="design-task-from-decision-dod"
              rows={3}
              aria-label="Definition of done"
            />
          </label>
          <p className="rd-muted">
            Source: <code data-testid="design-task-from-decision-source">decision:{props.decision.id}</code>
          </p>
        </div>
        <div className="rd-dialog-actions">
          <Button
            variant="ghost"
            size="md"
            onClick={props.onCancel}
            data-testid="design-task-from-decision-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void submit()}
            disabled={
              saving ||
              title.trim().length === 0 ||
              why.trim().length === 0 ||
              dod.trim().length === 0
            }
            data-testid="design-task-from-decision-save"
          >
            {saving ? 'Saving…' : 'Create task'}
          </Button>
        </div>
      </Surface>
    </div>
  );
}
