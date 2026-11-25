/**
 * StudyKit v0.4 — `features/research/design-workspace/DesignSectionCard`
 *
 * One progressive section of a `DesignSpec`. The
 * body is a free-text textarea; the user expands /
 * collapses the section via the toggle button. A
 * "Save decision" button opens the
 * `DecisionEditor` for the section kind.
 *
 * Sections that have a non-empty body stay visible.
 * The `expanded` flag persists the user's last
 * explicit choice so a refresh keeps the same view.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import type { DesignSectionKind } from '../../../domain/researchDesign';

export interface DesignSectionCardProps {
  readonly kind: DesignSectionKind;
  readonly label: string;
  readonly hint: string;
  readonly state: { readonly body: string; readonly expanded: boolean };
  readonly hasDecision: boolean;
  readonly onChangeBody: (body: string) => void;
  readonly onToggle: (expanded: boolean) => void;
  readonly onOpenDecision: () => void;
}

export function DesignSectionCard(props: DesignSectionCardProps): React.ReactElement {
  const visible = props.state.body.length > 0 || props.state.expanded;
  return (
    <div
      data-testid={`design-section-${props.kind}`}
      data-section-kind={props.kind}
      data-expanded={visible ? 'true' : 'false'}
      className="rd-section"
    >
      <div className="rd-section-head">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onToggle(!visible)}
          data-testid={`design-section-toggle-${props.kind}`}
          aria-label={visible ? 'Collapse section' : 'Expand section'}
        >
          {visible ? '▾' : '▸'}
        </Button>
        <h2 className="rd-h3" style={{ margin: 0, fontSize: '1rem' }}>{props.label}</h2>
        {props.hasDecision && <Pill data-testid={`design-section-decision-${props.kind}`}>decision</Pill>}
        <div className="rd-grow" />
        {visible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpenDecision}
            data-testid={`design-section-new-decision-${props.kind}`}
          >
            Save decision
          </Button>
        )}
      </div>
      {visible && (
        <div className="rd-section-body">
          <p className="rd-hint">{props.hint}</p>
          <textarea
            data-testid={`design-section-body-${props.kind}`}
            value={props.state.body}
            onChange={(e) => props.onChangeBody(e.currentTarget.value)}
            rows={4}
            placeholder="Type here. The section auto-saves on every change."
            className="rd-textarea"
            aria-label={`${props.label} body`}
          />
        </div>
      )}
    </div>
  );
}
