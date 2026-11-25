/**
 * StudyKit v0.4 — `features/research/task-detail/TaskCompletionForm`
 *
 * "Complete against an artifact" form. The host
 * supplies the candidate lists (decision heads,
 * verified evidence) and the local state; this
 * component renders the kind / id / note controls
 * and the submit button. The "Complete" button is
 * disabled until the user picks an artifact id.
 *
 * The use case (`completeTask`) re-checks that the
 * picked id is a real `output` / `decision` / `evidence`
 * record; the UI is a thin shell.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import type { TaskCompletionRefKind } from '../../../domain/researchDesign';

export interface TaskCompletionCandidate {
  readonly id: string;
  readonly label: string;
}

export interface TaskCompletionFormProps {
  readonly completionKind: TaskCompletionRefKind;
  readonly completionId: string;
  readonly completionNote: string;
  readonly decisionCandidates: readonly TaskCompletionCandidate[];
  readonly evidenceCandidates: readonly TaskCompletionCandidate[];
  readonly onKindChange: (kind: TaskCompletionRefKind) => void;
  readonly onIdChange: (id: string) => void;
  readonly onNoteChange: (note: string) => void;
  readonly onSubmit: () => void;
}

export function TaskCompletionForm(
  props: TaskCompletionFormProps,
): React.ReactElement {
  const isDecision = props.completionKind === 'decision';
  const candidates = isDecision ? props.decisionCandidates : props.evidenceCandidates;
  const placeholder = isDecision ? '— pick a decision —' : '— pick verified evidence —';
  return (
    <Surface data-testid="task-complete-form" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Complete against an artifact</h2>
      <p
        style={{
          margin: '0.25rem 0',
          color: 'var(--color-text-secondary, #666)',
          fontSize: '0.85rem',
        }}
      >
        The task cannot be marked done without a real MethodDecision or verified Evidence. Output completion lands in WP-10.
      </p>
      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <select
          data-testid="task-completion-kind-select"
          value={props.completionKind}
          onChange={(e) => {
            props.onKindChange(e.currentTarget.value as TaskCompletionRefKind);
            props.onIdChange('');
          }}
        >
          <option value="decision">Method decision</option>
          <option value="evidence">Verified evidence</option>
        </select>
        <select
          data-testid="task-completion-id-select"
          value={props.completionId}
          onChange={(e) => props.onIdChange(e.currentTarget.value)}
        >
          <option value="">{placeholder}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="note (optional)"
          value={props.completionNote}
          onChange={(e) => props.onNoteChange(e.currentTarget.value)}
          data-testid="task-completion-note-input"
          style={{ flex: 1, padding: '0.25rem' }}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={props.onSubmit}
          disabled={props.completionId.trim().length === 0}
          data-testid="task-complete"
        >
          Complete
        </Button>
      </div>
    </Surface>
  );
}
