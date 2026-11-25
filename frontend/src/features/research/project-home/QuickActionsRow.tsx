import React from 'react';
import { Button } from '../../../shared/ui/Button';

export interface QuickActionsRowProps {
  readonly continueLabel: string;
  readonly onContinue: () => void;
  readonly onOpenDiscovery: () => void;
  readonly onOpenLibrary: () => void;
  readonly onOpenEvidence: () => void;
  readonly onOpenDesign: () => void;
  readonly onOpenCanvas: () => void;
  readonly onCreateOutput: () => void;
}

/** Intent-first project actions; entity choices stay behind Add/Develop. */
export function QuickActionsRow(props: QuickActionsRowProps): React.ReactElement {
  const [addOpen, setAddOpen] = React.useState(false);
  return (
    <section data-testid="project-home-quick-actions" className="rd-card project-momentum">
      <div className="rd-row project-momentum-primary">
        <Button variant="primary" size="md" onClick={props.onContinue} data-testid="project-home-continue">
          {props.continueLabel}
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setAddOpen((current) => !current)}
          aria-expanded={addOpen}
          aria-controls="project-home-add-menu"
          data-testid="project-home-add"
        >
          Add
        </Button>
      </div>
      {addOpen ? (
        <div id="project-home-add-menu" className="project-add-menu" aria-label="Add or develop project work">
          <Button variant="ghost" size="sm" onClick={props.onOpenLibrary} data-testid="project-home-action-library">Sources</Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenDiscovery} data-testid="project-home-action-discovery">Search literature</Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenEvidence} data-testid="project-home-action-evidence">Capture evidence</Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenCanvas}>Idea on canvas</Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenDesign} data-testid="project-home-action-design">Develop research design</Button>
          <Button variant="ghost" size="sm" onClick={props.onCreateOutput}>Develop an output</Button>
        </div>
      ) : null}
    </section>
  );
}
