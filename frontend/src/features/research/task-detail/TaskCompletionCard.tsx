/**
 * StudyKit v0.4 — `features/research/task-detail/TaskCompletionCard`
 *
 * Read-only display of the artifact a `done` task was
 * completed against. Mounted only when
 * `task.status === 'done'` AND `task.completionRef`
 * is set; the "Complete against an artifact" form
 * is mutually exclusive.
 */

import React from 'react';
import { Surface } from '../../../shared/ui/Surface';
import { COMPLETION_LABELS } from './constants';
import type { TaskCompletionRefKind } from '../../../domain/researchDesign';

export interface TaskCompletionCardProps {
  readonly completionKind: TaskCompletionRefKind;
  readonly completionId: string;
  readonly completionNote: string | undefined;
}

export function TaskCompletionCard(
  props: TaskCompletionCardProps,
): React.ReactElement {
  return (
    <Surface data-testid="task-completion" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Completed against</h2>
      <p style={{ margin: '0.5rem 0 0 0' }}>
        <span data-testid="task-completion-kind">{COMPLETION_LABELS[props.completionKind]}</span>:{' '}
        <code data-testid="task-completion-id">{props.completionId}</code>
        {props.completionNote && <span> — {props.completionNote}</span>}
      </p>
    </Surface>
  );
}
