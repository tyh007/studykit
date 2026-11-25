/**
 * StudyKit v0.4 — `features/research/project-home/StatusGrid`
 *
 * The four status columns on the Project Home:
 *
 *   - Next decision (sections to fill in)
 *   - Blocked by (tasks with a blocker)
 *   - Waiting for (tasks whose deps are not done)
 *   - Recent decisions (heads of MethodDecision chains)
 *
 * Pure presentation. The host passes the derived
 * `ProjectHomeStatus` object from
 * `deriveProjectHomeStatus`; the column renders
 * each row's primary / secondary text and a
 * per-row click handler.
 */

import React from 'react';
import { Surface } from '../../../shared/ui/Surface';
import type { deriveProjectHomeStatus } from '../../../application/research/researchDesignUseCases';

type Status = Awaited<ReturnType<typeof deriveProjectHomeStatus>>;

export interface StatusGridProps {
  readonly status: Status;
  readonly onOpenDesign: () => void;
  readonly onOpenTask: (taskId: string) => void;
}

export function StatusGrid(props: StatusGridProps): React.ReactElement {
  return (
    <div
      data-testid="project-home-status"
      className="rd-grid-2"
    >
      <StatusColumn
        testIdPrefix="project-home-next"
        title="Next decision"
        emptyText="Design is settled for now."
        rows={props.status.nextSections.slice(0, 4).map((s) => ({
          key: `${s.designSpecId}-${s.sectionKind}-${s.reason}`,
          primary: `Fill the "${s.sectionKind}" section`,
          secondary:
            s.reason === 'spec-missing-for-question'
              ? 'Open the design to start a spec for an open question.'
              : s.reason === 'spec-exists-no-sections'
                ? 'Spec exists, no sections yet. Open design to start.'
                : 'Section after the last one you touched.',
          onOpen: props.onOpenDesign,
        }))}
      />
      <StatusColumn
        testIdPrefix="project-home-blocked"
        title="Blocked by"
        emptyText="Nothing is blocked."
        rows={props.status.blockedTasks.map(({ task, blocker }) => ({
          key: task.id,
          primary: task.title,
          secondary: `${blocker.kind}: ${blocker.note}`,
          onOpen: () => props.onOpenTask(task.id),
        }))}
      />
      <StatusColumn
        testIdPrefix="project-home-waiting"
        title="Waiting for"
        emptyText="No pending dependencies."
        rows={props.status.waitingTasks.map(({ task, pendingDependencies }) => ({
          key: task.id,
          primary: task.title,
          secondary: `${pendingDependencies.length} pending dependenc${pendingDependencies.length === 1 ? 'y' : 'ies'}`,
          onOpen: () => props.onOpenTask(task.id),
        }))}
      />
      <StatusColumn
        testIdPrefix="project-home-recent"
        title="Recent decisions"
        emptyText="No decisions yet."
        rows={props.status.recentDecisions.map(({ decision }) => ({
          key: decision.id,
          primary: decision.title,
          secondary: `${decision.sectionKind} · ${decision.impacts.length} impact${decision.impacts.length === 1 ? '' : 's'}`,
        }))}
      />
    </div>
  );
}

export function StatusColumn(props: {
  readonly title: string;
  readonly emptyText: string;
  readonly testIdPrefix: string;
  readonly rows: ReadonlyArray<{
    key: string;
    primary: string;
    secondary: string;
    onOpen?: () => void;
  }>;
}): React.ReactElement {
  return (
    <Surface
      data-testid={`${props.testIdPrefix}-column`}
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <h3 className="rd-h3">{props.title}</h3>
      {props.rows.length === 0 ? (
        <p
          data-testid={`${props.testIdPrefix}-empty`}
          className="rd-dep-empty"
        >
          {props.emptyText}
        </p>
      ) : (
        <ul className="rd-list">
          {props.rows.map((r) => (
            <li
              key={r.key}
              data-testid={`${props.testIdPrefix}-row`}
              data-row-key={r.key}
              className={`rd-list-item ${r.onOpen ? 'rd-list-item-clickable' : ''}`}
              onClick={r.onOpen}
            >
              <div style={{ fontWeight: 500 }}>{r.primary}</div>
              <div className="rd-list-item-meta">{r.secondary}</div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
