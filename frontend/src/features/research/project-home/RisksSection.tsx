/**
 * StudyKit v0.4 — `features/research/project-home/RisksSection`
 *
 * Inline "Add a risk or assumption" affordance.
 * The form lets the user pick `risk` (with a
 * `severity`) or `assumption` (no severity), write
 * a short title, and optionally fill a body +
 * mitigation. Saving calls the `createRisk` use
 * case; the canonical row is a `ResearchRisk`.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import type { ResearchRisk, ResearchRiskKind } from '../../../domain/researchDesign';

export interface RisksSectionProps {
  readonly risks: readonly ResearchRisk[];
  readonly showForm: boolean;
  readonly formKind: ResearchRiskKind;
  readonly formTitle: string;
  readonly formBody: string;
  readonly formSeverity: 'low' | 'medium' | 'high';
  readonly formMitigation: string;
  readonly onKindChange: (k: ResearchRiskKind) => void;
  readonly onTitleChange: (v: string) => void;
  readonly onBodyChange: (v: string) => void;
  readonly onSeverityChange: (s: 'low' | 'medium' | 'high') => void;
  readonly onMitigationChange: (v: string) => void;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

export function RisksSection(props: RisksSectionProps): React.ReactElement {
  return (
    <Surface
      data-testid="project-home-risks"
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <header className="rd-row">
        <h2 className="rd-h3">Risks &amp; assumptions</h2>
        <div style={{ flex: 1 }} />
        {!props.showForm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpen}
            data-testid="project-home-new-risk"
            aria-label="Add a risk or assumption"
          >
            Add
          </Button>
        )}
      </header>
      {props.showForm && (
        <div data-testid="project-home-new-risk-form" className="rd-inline-form">
          <select
            className="rd-select"
            value={props.formKind}
            onChange={(e) => props.onKindChange(e.currentTarget.value as ResearchRiskKind)}
            data-testid="project-home-new-risk-kind"
            aria-label="Risk kind"
          >
            <option value="risk">Risk</option>
            <option value="assumption">Assumption</option>
          </select>
          <input
            type="text"
            className="rd-input"
            placeholder="Short title"
            value={props.formTitle}
            onChange={(e) => props.onTitleChange(e.currentTarget.value)}
            data-testid="project-home-new-risk-title"
            aria-label="Risk title"
          />
          <textarea
            className="rd-textarea"
            placeholder="What is the risk? (or, for assumptions, what must hold true?)"
            value={props.formBody}
            onChange={(e) => props.onBodyChange(e.currentTarget.value)}
            data-testid="project-home-new-risk-body"
            rows={2}
            aria-label="Risk body"
          />
          {props.formKind === 'risk' && (
            <select
              className="rd-select"
              value={props.formSeverity}
              onChange={(e) => props.onSeverityChange(e.currentTarget.value as 'low' | 'medium' | 'high')}
              data-testid="project-home-new-risk-severity"
              aria-label="Risk severity"
            >
              <option value="low">Low severity</option>
              <option value="medium">Medium severity</option>
              <option value="high">High severity</option>
            </select>
          )}
          <input
            type="text"
            className="rd-input"
            placeholder="Mitigation (optional)"
            value={props.formMitigation}
            onChange={(e) => props.onMitigationChange(e.currentTarget.value)}
            data-testid="project-home-new-risk-mitigation"
            aria-label="Risk mitigation"
          />
          <div className="rd-inline-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onCancel}
              data-testid="project-home-new-risk-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={props.onSave}
              disabled={props.formTitle.trim().length === 0}
              data-testid="project-home-new-risk-save"
            >
              Save
            </Button>
          </div>
        </div>
      )}
      {props.risks.length === 0 ? (
        <p className="rd-dep-empty">No risks or assumptions recorded.</p>
      ) : (
        <ul className="rd-list">
          {props.risks.map((r) => (
            <li
              key={r.id}
              data-testid="project-home-risk-row"
              data-risk-id={r.id}
              className="rd-list-item"
              style={{ flexDirection: 'column', alignItems: 'flex-start' }}
            >
              <div className="rd-row" style={{ width: '100%' }}>
                <Pill data-testid="project-home-risk-kind">{r.kind}</Pill>
                {r.severity && <Pill data-testid="project-home-risk-severity">{r.severity}</Pill>}
                <span style={{ flex: 1 }}>{r.title}</span>
              </div>
              {r.body && <div className="rd-list-item-meta">{r.body}</div>}
              {r.mitigation && (
                <div className="rd-list-item-sub">Mitigation: {r.mitigation}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
