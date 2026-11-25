/**
 * StudyKit v0.4 — `features/research/task-detail/TaskWhyCard`
 *
 * The two prose cards that explain WHY a task exists
 * and what "done" looks like. Both are read-only —
 * they're written when the task is created (or by
 * `setTaskDefinition` on the use case surface, which
 * the host does not currently expose inline).
 */

import React from 'react';
import { Surface } from '../../../shared/ui/Surface';

export interface TaskWhyCardProps {
  readonly why: string;
  readonly definitionOfDone: string;
}

export function TaskWhyCard(props: TaskWhyCardProps): React.ReactElement {
  return (
    <>
      <Surface data-testid="task-why" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Why this exists</h2>
        <p style={{ margin: '0.5rem 0 0 0' }}>{props.why}</p>
      </Surface>
      <Surface data-testid="task-dod" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Definition of done</h2>
        <p style={{ margin: '0.5rem 0 0 0' }}>{props.definitionOfDone}</p>
      </Surface>
    </>
  );
}
