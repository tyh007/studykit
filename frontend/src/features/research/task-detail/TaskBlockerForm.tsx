/**
 * StudyKit v0.4 — `features/research/task-detail/TaskBlockerForm`
 *
 * Inline "Mark as blocked" form. The host owns the
 * local state for kind / note; this component
 * forwards the change / click events and renders the
 * inputs. The use case (`setTaskBlocker`) re-validates
 * non-empty note on submit.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import { BLOCKER_LABELS } from './constants';
import type { TaskBlockerKind } from '../../../domain/researchDesign';

export interface TaskBlockerFormProps {
  readonly blockerKind: TaskBlockerKind;
  readonly blockerNote: string;
  readonly onKindChange: (kind: TaskBlockerKind) => void;
  readonly onNoteChange: (note: string) => void;
  readonly onSubmit: () => void;
}

export function TaskBlockerForm(props: TaskBlockerFormProps): React.ReactElement {
  return (
    <Surface data-testid="task-blocker-form" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Mark as blocked</h2>
      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <select
          data-testid="task-blocker-kind-select"
          value={props.blockerKind}
          onChange={(e) => props.onKindChange(e.currentTarget.value as TaskBlockerKind)}
        >
          {Object.entries(BLOCKER_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="What are you waiting for?"
          value={props.blockerNote}
          onChange={(e) => props.onNoteChange(e.currentTarget.value)}
          data-testid="task-blocker-note-input"
          style={{ flex: 1, padding: '0.25rem' }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onSubmit}
          data-testid="task-blocker-set"
        >
          Set blocker
        </Button>
      </div>
    </Surface>
  );
}
