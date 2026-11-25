/**
 * StudyKit v0.4 — `features/research/project-home/TasksSection`
 *
 * Inline "Create a task" affordance + the project's
 * task list. The form requires non-empty title /
 * why / DoD; the use case re-checks the same. Tasks
 * are listed in `createdAt`-descending order; each
 * row is click-target for the host's "open detail"
 * navigation.
 *
 * WP-08 Round 3 (P0-5): Shared Task UI. When the
 * caller is the project owner or editor, each row
 * surfaces an assignee select + a reassign /
 * unassign control. The select is populated from
 * the project's member list (`props.members`) so
 * the assignee MUST be a project member (the
 * spec invariant). `commenter` and `viewer` see
 * the assignee as a read-only pill — they cannot
 * change it. AI never sets an assignee (the
 * canonical `ResearchTask.assignee` is null on
 * AI-accepted tasks; the use case
 * `acceptDesignTaskSuggestion` enforces this).
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import type { ResearchTask } from '../../../domain/researchDesign';

export interface TaskAssigneeMember {
  readonly userId: string;
  readonly displayName: string;
}

export interface TasksSectionProps {
  readonly tasks: readonly ResearchTask[];
  readonly showForm: boolean;
  readonly formTitle: string;
  readonly formWhy: string;
  readonly formDod: string;
  readonly onTitleChange: (v: string) => void;
  readonly onWhyChange: (v: string) => void;
  readonly onDodChange: (v: string) => void;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onOpenTask: (taskId: string) => void;
  /**
   * P0-5: assignee controls. `canAssign` is
   * `true` for owner / editor and `false` for
   * commenter / viewer (and for the AI
   * actor). The host computes it from the
   * caller's `Collaborator.role`.
   */
  readonly canAssign?: boolean;
  /** The project's members. The assignee
   *  select is populated from this list so
   *  the assignee MUST be a member. */
  readonly members?: readonly TaskAssigneeMember[];
  /** Assign the task to a member. The host
   *  calls `assignTask(...)` with the
   *  userId + displayName. */
  readonly onAssign?: (taskId: string, userId: string, displayName: string) => void;
  /** Re-assign (alias of `onAssign` — the
   *  host does not differentiate between
   *  assign and reassign). */
  readonly onReassign?: (taskId: string, userId: string, displayName: string) => void;
  /** Unassign. The host calls
   *  `unassignTask(...)`. */
  readonly onUnassign?: (taskId: string) => void;
  /** Per-row outbox status (P0-4). When the
   *  host renders the row, it looks up the
   *  outbox status for this task's last
   *  `task-assigned` / `task-status-changed`
   *  op and passes the status. The host can
   *  also pass a single "synced" status if
   *  it does not track per-op status. */
  readonly outboxStatus?: (taskId: string) => 'queued' | 'synced' | 'failed' | null;
}

export function TasksSection(props: TasksSectionProps): React.ReactElement {
  const canAssign = props.canAssign ?? false;
  const members = props.members ?? [];
  return (
    <Surface
      data-testid="project-home-tasks"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <header className="rd-row">
        <h2 className="rd-h3">Tasks</h2>
        <div style={{ flex: 1 }} />
        {!props.showForm && (
          <Button
            variant="primary"
            size="sm"
            onClick={props.onOpen}
            data-testid="project-home-new-task"
          >
            Create a task
          </Button>
        )}
      </header>
      {props.showForm && (
        <div
          data-testid="project-home-new-task-form"
          className="rd-inline-form"
        >
          <input
            type="text"
            className="rd-input"
            placeholder="Title"
            value={props.formTitle}
            onChange={(e) => props.onTitleChange(e.currentTarget.value)}
            data-testid="project-home-new-task-title"
            aria-label="Task title"
          />
          <textarea
            className="rd-textarea"
            placeholder="Why does this task exist?"
            value={props.formWhy}
            onChange={(e) => props.onWhyChange(e.currentTarget.value)}
            data-testid="project-home-new-task-why"
            rows={2}
            aria-label="Why this task"
          />
          <textarea
            className="rd-textarea"
            placeholder="How do you know it is done?"
            value={props.formDod}
            onChange={(e) => props.onDodChange(e.currentTarget.value)}
            data-testid="project-home-new-task-dod"
            rows={2}
            aria-label="Definition of done"
          />
          <div className="rd-inline-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onCancel}
              data-testid="project-home-new-task-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={props.onSave}
              disabled={
                props.formTitle.trim().length === 0 ||
                props.formWhy.trim().length === 0 ||
                props.formDod.trim().length === 0
              }
              data-testid="project-home-new-task-save"
            >
              Save task
            </Button>
          </div>
        </div>
      )}
      {props.tasks.length === 0 ? (
        <p data-testid="project-home-tasks-empty" className="rd-dep-empty">
          No tasks yet. Create one above, or start from an open question.
        </p>
      ) : (
        <ul className="rd-list">
          {props.tasks.map((t) => {
            const status = props.outboxStatus?.(t.id);
            return (
              <li
                key={t.id}
                data-testid="project-home-task-row"
                data-task-id={t.id}
                data-status={t.status}
                data-origin-kind={t.origin.kind}
                data-assignee-user-id={t.assignee?.userId ?? ''}
                data-assignee-display-name={t.assignee?.displayName ?? ''}
                data-published-from-scratch-id={t.publishedFromScratchId ?? ''}
                className="rd-list-item rd-list-item-clickable"
                onClick={() => props.onOpenTask(t.id)}
              >
                <span style={{ flex: 1 }}>{t.title}</span>
                <Pill
                  tone={t.status === 'done' ? 'success' : t.status === 'blocked' ? 'warning' : 'neutral'}
                  data-testid="project-home-task-status"
                >
                  {t.status}
                </Pill>
                {t.sourceRef.kind !== 'manual' && (
                  <Pill data-testid="project-home-task-source">from {t.sourceRef.kind}</Pill>
                )}
                {t.origin.kind === 'ai-accepted' && (
                  <Pill data-testid="project-home-task-origin" tone="info">
                    AI
                  </Pill>
                )}
                {t.publishedFromScratchId && (
                  <Pill
                    data-testid="project-home-task-from-scratch"
                    data-scratch-id={t.publishedFromScratchId}
                    tone="info"
                  >
                    from scratch
                  </Pill>
                )}
                {/* P0-5: assignee control. The
                    select is rendered only for
                    owner / editor. The
                    `commenter` / `viewer` sees
                    the assignee as a read-only
                    pill. */}
                {t.assignee ? (
                  canAssign ? (
                    <select
                      data-testid={`project-home-task-assignee-select-${t.id}`}
                      value={t.assignee.userId}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const member = members.find((m) => m.userId === e.currentTarget.value);
                        if (member) {
                          props.onReassign?.(t.id, member.userId, member.displayName);
                        }
                      }}
                    >
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Pill
                      data-testid={`project-home-task-assignee-${t.id}`}
                      data-assignee-user-id={t.assignee.userId}
                    >
                      {t.assignee.displayName}
                    </Pill>
                  )
                ) : canAssign ? (
                  <select
                    data-testid={`project-home-task-assignee-select-${t.id}`}
                    value=""
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const member = members.find((m) => m.userId === e.currentTarget.value);
                      if (member) {
                        props.onAssign?.(t.id, member.userId, member.displayName);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Assign…
                    </option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                ) : null}
                {canAssign && t.assignee && (
                  <button
                    type="button"
                    data-testid={`project-home-task-unassign-${t.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onUnassign?.(t.id);
                    }}
                  >
                    Unassign
                  </button>
                )}
                {status && (
                  <Pill
                    data-testid={`project-home-task-outbox-${t.id}`}
                    data-outbox-status={status}
                    tone={status === 'failed' ? 'warning' : 'neutral'}
                  >
                    {status}
                  </Pill>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
