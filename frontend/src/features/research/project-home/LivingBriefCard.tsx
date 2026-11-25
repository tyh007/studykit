/**
 * StudyKit v0.4 — `features/research/project-home/LivingBriefCard`
 *
 * Compact freeform "Living Brief" editor on the
 * Project Home. The brief is the user's *project
 * goal* — it is intentionally separate from
 * ResearchQuestion; a project may exist before any
 * question is asked. The card is editable; the
 * `Save` button enables when the text differs from
 * the persisted value.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';

export interface LivingBriefCardProps {
  readonly brief: string;
  readonly dirty: boolean;
  readonly onChange: (v: string) => void;
  readonly onSave: () => void;
}

export function LivingBriefCard(props: LivingBriefCardProps): React.ReactElement {
  return (
    <Surface
      data-testid="project-home-living-brief"
      style={{ padding: '1rem', borderRadius: '0.5rem' }}
    >
      <h2 className="rd-h3">Living Brief</h2>
      <p className="rd-hint">Freeform goal. Refine it whenever you want.</p>
      <textarea
        data-testid="project-home-brief-input"
        value={props.brief}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        placeholder="What is this project about?"
        rows={4}
        className="rd-textarea"
        aria-label="Living brief"
      />
      <div className="rd-row-end" style={{ marginTop: '0.5rem' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={props.onSave}
          disabled={!props.dirty}
          data-testid="project-home-brief-save"
        >
          {props.dirty ? 'Save brief' : 'Saved'}
        </Button>
      </div>
    </Surface>
  );
}
