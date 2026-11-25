/**
 * StudyKit v0.4 — `features/research/design-workspace/DecisionsRail`
 *
 * The right-side "Decisions" rail on the design
 * workspace. Shows every head of a `MethodDecision`
 * chain for the spec, with the chain's length as a
 * `rev #` chip. Clicking a row opens the decision in
 * an in-place editor (the host owns the editor
 * dialog state). The "Create task from this
 * decision" button writes a canonical `ResearchTask`
 * with `sourceRef.kind: 'decision'` and the exact
 * decision id.
 *
 * The full row is keyboard-accessible
 * (role="button", tabIndex, Enter / Space).
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import type { DesignSectionKind, MethodDecision } from '../../../domain/researchDesign';

export interface DecisionsRailProps {
  readonly decisions: readonly MethodDecision[];
  readonly sectionLabels: Readonly<Record<DesignSectionKind, string>>;
  readonly onEdit: (decision: MethodDecision) => void;
  readonly onCreateTask: (decision: MethodDecision) => void;
}

export function DecisionsRail(props: DecisionsRailProps): React.ReactElement {
  return (
    <Surface
      data-testid="design-decisions-rail"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <h3 className="rd-h3">Decisions</h3>
      {props.decisions.length === 0 ? (
        <p
          data-testid="design-decisions-empty"
          className="rd-rail-empty"
        >
          No decisions yet. Save one from a section above.
        </p>
      ) : (
        <ul className="rd-list">
          {props.decisions.map((d) => {
            const rev = (d.supersedesLineage?.length ?? 0) + 1;
            return (
              <li
                key={d.id}
                data-testid="design-decision-row"
                data-decision-id={d.id}
                data-section-kind={d.sectionKind}
                className="rd-list-item rd-list-item-clickable"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.25rem' }}
                role="button"
                tabIndex={0}
                onClick={() => props.onEdit(d)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    props.onEdit(d);
                  }
                }}
                aria-label={`Edit decision: ${d.title}`}
              >
                <div className="rd-row">
                  <div style={{ flex: 1, fontWeight: 500 }}>{d.title}</div>
                  <Pill data-testid="design-decision-rev" tone="neutral">rev #{rev}</Pill>
                </div>
                <div className="rd-list-item-meta">
                  {props.sectionLabels[d.sectionKind]} · {d.impacts.length} impact{d.impacts.length === 1 ? '' : 's'}
                </div>
                <div className="rd-list-item-sub">
                  {d.createdAt.slice(0, 10)}
                </div>
                <div className="rd-row-end" style={{ marginTop: '0.25rem' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onCreateTask(d);
                    }}
                    data-testid="design-decision-create-task"
                    data-decision-id={d.id}
                    aria-label={`Create task from decision: ${d.title}`}
                  >
                    Create task
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
