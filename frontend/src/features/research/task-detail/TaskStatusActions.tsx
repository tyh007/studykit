/**
 * StudyKit v0.4 — `features/research/task-detail/TaskStatusActions`
 *
 * Bottom row: "Cancel task" for open/in-progress/blocked
 * tasks, "Reopen" for done/cancelled tasks. The host
 * picks which one to render based on `task.status`.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';

export interface TaskStatusActionsProps {
  readonly mode: 'cancel' | 'reopen';
  readonly onCancel: (() => void) | undefined;
  readonly onReopen: (() => void) | undefined;
}

export function TaskStatusActions(
  props: TaskStatusActionsProps,
): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      {props.mode === 'cancel' && props.onCancel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onCancel}
          data-testid="task-cancel"
        >
          Cancel task
        </Button>
      )}
      {props.mode === 'reopen' && props.onReopen && (
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onReopen}
          data-testid="task-reopen"
        >
          Reopen
        </Button>
      )}
    </div>
  );
}
