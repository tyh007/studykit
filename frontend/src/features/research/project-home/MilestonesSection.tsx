/**
 * StudyKit v0.4 — `features/research/project-home/MilestonesSection`
 *
 * Inline "Add a milestone" affordance. The kind
 * dropdown is restricted to research-kinds
 * (`proposal` / `pilot` / `ethics` /
 * `data-collection` / `analysis` / `chapter` /
 * `submission` / `custom`). A custom kind requires
 * a label; the rest reject a label. The target
 * date is user-supplied; AI never assigns dates.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import type { Milestone, MilestoneKind } from '../../../domain/researchDesign';

export interface MilestonesSectionProps {
  readonly milestones: readonly Milestone[];
  readonly showForm: boolean;
  readonly formKind: MilestoneKind;
  readonly formLabel: string;
  readonly formTarget: string;
  readonly onKindChange: (k: MilestoneKind) => void;
  readonly onLabelChange: (v: string) => void;
  readonly onTargetChange: (v: string) => void;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

const MILESTONE_KINDS_UI: readonly { value: MilestoneKind; label: string }[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'pilot', label: 'Pilot' },
  { value: 'ethics', label: 'Ethics' },
  { value: 'data-collection', label: 'Data collection' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'submission', label: 'Submission' },
  { value: 'custom', label: 'Custom…' },
];

export function MilestonesSection(props: MilestonesSectionProps): React.ReactElement {
  return (
    <Surface
      data-testid="project-home-milestones"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <header className="rd-row">
        <h2 className="rd-h3">Milestones</h2>
        <div style={{ flex: 1 }} />
        {!props.showForm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpen}
            data-testid="project-home-new-milestone"
            aria-label="Add a milestone"
          >
            Add
          </Button>
        )}
      </header>
      {props.showForm && (
        <div data-testid="project-home-new-milestone-form" className="rd-inline-form">
          <select
            className="rd-select"
            value={props.formKind}
            onChange={(e) => props.onKindChange(e.currentTarget.value as MilestoneKind)}
            data-testid="project-home-new-milestone-kind"
            aria-label="Milestone kind"
          >
            {MILESTONE_KINDS_UI.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          {props.formKind === 'custom' && (
            <input
              type="text"
              className="rd-input"
              placeholder="Custom label"
              value={props.formLabel}
              onChange={(e) => props.onLabelChange(e.currentTarget.value)}
              data-testid="project-home-new-milestone-label"
              aria-label="Milestone label"
            />
          )}
          <input
            type="date"
            className="rd-input"
            value={props.formTarget}
            onChange={(e) => props.onTargetChange(e.currentTarget.value)}
            data-testid="project-home-new-milestone-target"
            aria-label="Target date"
          />
          <div className="rd-inline-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onCancel}
              data-testid="project-home-new-milestone-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={props.onSave}
              data-testid="project-home-new-milestone-save"
            >
              Save
            </Button>
          </div>
        </div>
      )}
      {props.milestones.length === 0 ? (
        <p className="rd-dep-empty">No milestones recorded.</p>
      ) : (
        <ul className="rd-list">
          {props.milestones.map((m) => (
            <li
              key={m.id}
              data-testid="project-home-milestone-row"
              data-milestone-id={m.id}
              className="rd-list-item"
            >
              <Pill data-testid="project-home-milestone-kind">{m.kind}</Pill>
              <span style={{ flex: 1 }}>{m.label || m.kind}</span>
              {m.targetDate && <span className="rd-list-item-meta">by {m.targetDate.slice(0, 10)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
