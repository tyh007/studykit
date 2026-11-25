/**
 * StudyKit v0.4 — `features/research/task-detail/TaskDependencyList`
 *
 * Renders the task's dependency rows + an
 * "Add dependency" select. The host owns the
 * add / remove writers (use cases enforce cycle
 * safety) and the full task list used to populate
 * the add-select; this card is presentation.
 *
 * Each row shows: "Waiting on <title> — <status>".
 * Unknown dep ids render as "missing" so a stale
 * row never silently disappears.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import { STATUS_LABELS } from './constants';
import type { ResearchTask, TaskStatus } from '../../../domain/researchDesign';

export interface TaskDependencyCandidate {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
}

export interface TaskDependencyListProps {
  readonly dependencies: readonly string[];
  readonly depTasks: ReadonlyMap<string, ResearchTask>;
  readonly candidates: readonly TaskDependencyCandidate[];
  readonly onRemoveDependency: (dependsOnTaskId: string) => void;
  readonly onAddDependency: (dependsOnTaskId: string) => void;
}

export function TaskDependencyList(
  props: TaskDependencyListProps,
): React.ReactElement {
  return (
    <Surface data-testid="task-dependencies" style={{ padding: '0.75rem', borderRadius: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.95rem' }}>Dependencies</h2>
      {props.dependencies.length === 0 ? (
        <p style={{ margin: '0.5rem 0 0 0', color: 'var(--color-text-secondary, #666)' }}>
          No dependencies. This task can move on its own.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0 0' }}>
          {props.dependencies.map((dep) => {
            const depTask = props.depTasks.get(dep);
            const status = depTask ? STATUS_LABELS[depTask.status] : 'missing';
            return (
              <li
                key={dep}
                data-testid="task-dependency-row"
                data-depends-on={dep}
                data-dependency-status={depTask?.status ?? 'missing'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.25rem 0',
                }}
              >
                <span>
                  Waiting on <strong>{depTask?.title ?? dep}</strong> — {status}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onRemoveDependency(dep)}
                  data-testid="task-dependency-remove"
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <select
          data-testid="task-dependency-add-select"
          defaultValue=""
          onChange={(e) => {
            if (e.currentTarget.value) {
              props.onAddDependency(e.currentTarget.value);
              e.currentTarget.value = '';
            }
          }}
        >
          <option value="">Add dependency…</option>
          {props.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.status})
            </option>
          ))}
        </select>
      </div>
    </Surface>
  );
}
