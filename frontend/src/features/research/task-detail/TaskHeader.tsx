/**
 * StudyKit v0.4 — `features/research/task-detail/TaskHeader`
 *
 * Title row of the TaskDetail surface: the back
 * button, the task title, and the status pill.
 *
 * Pure presentation; the parent owns the data.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { STATUS_LABELS } from './constants';
import type { TaskStatus } from '../../../domain/researchDesign';

export interface TaskHeaderProps {
  readonly title: string;
  readonly status: TaskStatus;
  readonly onBack: () => void;
}

export function TaskHeader(props: TaskHeaderProps): React.ReactElement {
  const tone: 'success' | 'warning' | 'neutral' =
    props.status === 'done'
      ? 'success'
      : props.status === 'blocked'
        ? 'warning'
        : 'neutral';
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onBack}
        data-testid="task-back-to-project"
      >
        ← Project
      </Button>
      <h1 style={{ margin: 0, fontSize: '1.25rem' }}>{props.title}</h1>
      <Pill data-testid="task-status" tone={tone}>
        {STATUS_LABELS[props.status]}
      </Pill>
    </header>
  );
}
