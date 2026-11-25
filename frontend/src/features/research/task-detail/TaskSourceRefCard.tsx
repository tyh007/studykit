/**
 * StudyKit v0.4 — `features/research/task-detail/TaskSourceRefCard`
 *
 * Source card. Renders the source kind + label
 * (resolved against the parent-supplied lookups for
 * question / decision / risk / evidence-gap) and a
 * deep-link button when the source can be opened.
 *
 * Pure presentation. Lookups are owned by the parent
 * (TaskDetail) and passed in as already-resolved
 * labels so this card stays a thin shell.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';

export interface TaskSourceRefCardProps {
  readonly sourceKind: string;
  readonly sourceLabel: string;
  readonly sourceNote: string | undefined;
  readonly canOpenQuestion: boolean;
  readonly canOpenDecision: boolean;
  readonly onOpenQuestion: (() => void) | undefined;
  readonly onOpenDecision: (() => void) | undefined;
}

export function TaskSourceRefCard(
  props: TaskSourceRefCardProps,
): React.ReactElement {
  return (
    <Surface data-testid="task-source" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Source</h2>
      <p style={{ margin: '0.5rem 0 0 0' }}>
        <span data-testid="task-source-kind">{props.sourceKind}</span>:{' '}
        <span data-testid="task-source-label">{props.sourceLabel}</span>
        {props.sourceNote && (
          <span style={{ color: 'var(--color-text-secondary, #666)' }}> — {props.sourceNote}</span>
        )}
      </p>
      {props.canOpenQuestion && props.onOpenQuestion && (
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onOpenQuestion}
          data-testid="task-source-open-question"
        >
          Open question
        </Button>
      )}
      {props.canOpenDecision && props.onOpenDecision && (
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onOpenDecision}
          data-testid="task-source-open-decision"
        >
          Open decision
        </Button>
      )}
    </Surface>
  );
}
