/**
 * StudyKit v0.4 — `features/research/task-detail/TaskBlockerCard`
 *
 * Read-only display of an *active* blocker. The host
 * only mounts this card when `task.status === 'blocked'`
 * AND `task.blocker` is set; the "Mark as blocked" form
 * lives in `TaskBlockerForm` and is mutually exclusive
 * with this view.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import { BLOCKER_LABELS } from './constants';
import type { TaskBlockerKind } from '../../../domain/researchDesign';

export interface TaskBlockerCardProps {
  readonly blockerKind: TaskBlockerKind;
  readonly blockerNote: string;
  readonly onClear: () => void;
}

export function TaskBlockerCard(props: TaskBlockerCardProps): React.ReactElement {
  return (
    <Surface data-testid="task-blocker" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Blocker</h2>
      <p style={{ margin: '0.5rem 0 0 0' }}>
        <span data-testid="task-blocker-kind">{BLOCKER_LABELS[props.blockerKind]}</span>:{' '}
        <span data-testid="task-blocker-note">{props.blockerNote}</span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onClear}
        data-testid="task-blocker-clear"
      >
        Clear blocker
      </Button>
    </Surface>
  );
}
