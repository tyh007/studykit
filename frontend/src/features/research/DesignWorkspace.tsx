/**
 * StudyKit v0.4 — `features/research/DesignWorkspace`
 *
 * Structured design workspace (WP-07). Mounted from
 * the research router when the URL is
 * `#/research/design/<containerId>`.
 *
 * The orchestrator owns: the spec / decisions
 * fetch, the section / decision / task-form
 * open-state, the "Create design workspace"
 * affordance when no spec exists. The layout
 * (sections list, decisions rail, decision
 * editor, task-from-decision form) is delegated to
 * focused sibling components in
 * `design-workspace/`. The workspace stays under
 * ~500 lines; the four dialogs each live in their
 * own file.
 *
 * Strict rules (enforced by the use cases):
 *
 *   - The decision form refuses empty
 *     title / choice / rationale.
 *   - Revisions create a new row; the previous
 *     decision is never mutated.
 *   - The `questionId` from the URL params is
 *     forwarded to `createDesignSpec` so the link
 *     survives on the canonical spec.
 *   - A Task created from a decision carries
 *     `sourceRef.kind: 'decision'` (immutable).
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { useResearchDeps } from './researchContext';
import {
  createDesignSpec,
  createMethodDecision,
  reviseMethodDecision,
  setDesignSpecSectionBody,
  toggleDesignSpecSection,
  listMethodDecisionHistory,
} from '../../application/research/researchDesignUseCases';
import {
  DESIGN_SECTION_KINDS,
  type DesignSectionKind,
  type DesignSpec,
  type MethodAlternative,
  type MethodDecision,
} from '../../domain/researchDesign';
import {
  DesignSectionCard,
  DecisionsRail,
  DecisionEditor,
  type DecisionEditorValue,
  TaskFromDecisionForm,
} from './design-workspace';
import './researchDesign.css';

export interface DesignWorkspaceProps {
  readonly projectId: string;
  /**
   * Optional Research Question id to anchor the
   * initial DesignSpec to. The router passes this
   * through URL params; the workspace forwards it
   * to `createDesignSpec` so the link is preserved.
   */
  readonly questionId?: string;
  readonly onBackToProject: (projectId: string) => void;
}

const DEFAULT_SECTION_LABELS: Readonly<Record<DesignSectionKind, string>> = {
  rationale: 'Rationale & gap',
  hypotheses: 'Hypotheses / objectives',
  constructs: 'Constructs & operational definitions',
  'design-type': 'Design type',
  sample: 'Population, sample & recruitment',
  measures: 'Variables, measures & materials',
  procedure: 'Procedure',
  analysis: 'Data & analysis plan',
  ethics: 'Ethics, privacy & consent',
  risks: 'Risks, assumptions & alternatives',
  deviations: 'Deviations and decisions',
};

const DEFAULT_SECTION_HINTS: Readonly<Record<DesignSectionKind, string>> = {
  rationale: 'Why is this question worth asking? What gap does it close?',
  hypotheses: 'What do you predict, and how would you operationalise it?',
  constructs: 'Define the key variables in measurable terms.',
  'design-type': 'Within, between, mixed, observational, qualitative?',
  sample: 'Who, how many, where from, how recruited?',
  measures: 'What you measure, when, and with what instrument.',
  procedure: 'Step-by-step protocol the participant experiences.',
  analysis: 'How you will turn the data into an answer.',
  ethics: 'Consent, privacy, data handling, risk to participants.',
  risks: 'Threats to validity, key assumptions, alternative paths.',
  deviations: 'What you changed and why, with the date.',
};

export function DesignWorkspace(props: DesignWorkspaceProps): React.ReactElement {
  const deps = useResearchDeps();
  const [spec, setSpec] = React.useState<DesignSpec | null>(null);
  const [decisions, setDecisions] = React.useState<readonly MethodDecision[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [showBlankHint, setShowBlankHint] = React.useState(false);

  const reload = React.useCallback(async (): Promise<void> => {
    try {
      const specs = await deps.repository.listDesignSpecs({ projectId: props.projectId, limit: 1 });
      const current = specs[0] ?? null;
      setSpec(current);
      if (current) {
        const all = await deps.repository.listMethodDecisions({
          projectId: props.projectId,
          specId: current.id,
          limit: 200,
        });
        const heads = computeDecisionHeads(all);
        setDecisions(heads);
      } else {
        setDecisions([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load design.');
    }
  }, [deps.repository, props.projectId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const createFirstSpec = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const created = await createDesignSpec(deps.repository, {
        projectId: props.projectId,
        ...(props.questionId ? { questionId: props.questionId } : {}),
        kind: 'empirical',
        templateEnabled: !showBlankHint,
      });
      setSpec(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create design spec.');
    } finally {
      setCreating(false);
    }
  };

  if (!spec) {
    return (
      <DesignEmpty
        creating={creating}
        showBlankHint={showBlankHint}
        onToggleBlankHint={setShowBlankHint}
        onCreate={createFirstSpec}
        onBack={() => props.onBackToProject(props.projectId)}
        error={error}
      />
    );
  }

  return (
    <DesignBody
      key={spec.id}
      spec={spec}
      decisions={decisions}
      onBack={() => props.onBackToProject(props.projectId)}
      onSpecChange={setSpec}
      onDecisionsChange={setDecisions}
      onError={setError}
      onTaskCreated={() => { /* host routes to task detail in a future packet */ }}
    />
  );
}

/**
 * The empty-state view: no spec yet. The user can
 * toggle a "Blank start" hint (the workspace never
 * auto-fills a section) and click "Create design
 * workspace" to call `createDesignSpec`.
 */
function DesignEmpty(props: {
  readonly creating: boolean;
  readonly showBlankHint: boolean;
  readonly onToggleBlankHint: (v: boolean) => void;
  readonly onCreate: () => void;
  readonly onBack: () => void;
  readonly error: string | null;
}): React.ReactElement {
  return (
    <div
      data-testid="design-workspace-empty"
      style={{ padding: '1rem', maxWidth: 920, margin: '0 auto' }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onBack}
        data-testid="design-back-to-project"
      >
        ← Project
      </Button>
      <h1 style={{ marginTop: '1rem' }}>Design workspace</h1>
      <p className="rd-muted">
        The design workspace is empty. You can start from a blank slate, or let the
        default template suggest the first section.
      </p>
      {props.error && <p role="alert" data-testid="design-empty-error">{props.error}</p>}
      <div className="rd-row" style={{ marginTop: '0.5rem' }}>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          data-testid="design-blank-toggle"
        >
          <input
            type="checkbox"
            checked={props.showBlankHint}
            onChange={(e) => props.onToggleBlankHint(e.currentTarget.checked)}
            data-testid="design-blank-toggle-input"
          />
          Blank start (no template)
        </label>
        <Button
          variant="primary"
          size="md"
          onClick={props.onCreate}
          disabled={props.creating}
          data-testid="design-create"
        >
          {props.creating ? 'Creating…' : 'Create design workspace'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The populated design workspace body. Owns the
 * new / edit dialog state; delegates the section
 * cards, decisions rail, and dialogs to sibling
 * components.
 */
function DesignBody(props: {
  readonly spec: DesignSpec;
  readonly decisions: readonly MethodDecision[];
  readonly onBack: () => void;
  readonly onSpecChange: (next: DesignSpec) => void;
  readonly onDecisionsChange: (next: readonly MethodDecision[]) => void;
  readonly onError: (msg: string) => void;
  readonly onTaskCreated: (taskId: string) => void;
}): React.ReactElement {
  const deps = useResearchDeps();
  const [editingDecision, setEditingDecision] = React.useState<MethodDecision | null>(null);
  const [showNewDecision, setShowNewDecision] = React.useState<DesignSectionKind | null>(null);
  const [taskFromDecision, setTaskFromDecision] = React.useState<MethodDecision | null>(null);

  const sectionsByKind = new Map(props.spec.sections.map((s) => [s.kind, s]));

  const onSaveSection = async (kind: DesignSectionKind, body: string): Promise<void> => {
    try {
      const next = await setDesignSpecSectionBody(deps.repository, {
        designSpecId: props.spec.id,
        kind,
        body,
      });
      props.onSpecChange(next);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : 'Failed to save section.');
    }
  };

  const onToggleSection = async (kind: DesignSectionKind, expanded: boolean): Promise<void> => {
    try {
      const next = await toggleDesignSpecSection(deps.repository, {
        designSpecId: props.spec.id,
        kind,
        expanded,
      });
      props.onSpecChange(next);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : 'Failed to toggle section.');
    }
  };

  const reloadDecisions = async (): Promise<void> => {
    const all = await deps.repository.listMethodDecisions({
      projectId: props.spec.projectId,
      specId: props.spec.id,
      limit: 200,
    });
    props.onDecisionsChange(computeDecisionHeads(all));
  };

  const onCreateDecision = async (input: DecisionEditorValue & { readonly sectionKind: DesignSectionKind }): Promise<void> => {
    try {
      await createMethodDecision(deps.repository, {
        projectId: props.spec.projectId,
        specId: props.spec.id,
        sectionKind: input.sectionKind,
        title: input.title,
        choice: input.choice,
        rationale: input.rationale,
        ...(input.alternatives.length > 0
          ? {
              alternatives: input.alternatives.map((a) => ({
                label: a.label,
                body: a.body,
                evidenceIds: [...a.evidenceIds],
              })),
            }
          : {}),
        evidenceIds: [...input.evidenceIds],
        impacts: [...input.impacts],
      });
      setShowNewDecision(null);
      await reloadDecisions();
    } catch (err) {
      props.onError(err instanceof Error ? err.message : 'Failed to save decision.');
    }
  };

  const onReviseDecision = async (prev: MethodDecision, input: DecisionEditorValue): Promise<void> => {
    try {
      await reviseMethodDecision(deps.repository, {
        previousDecisionId: prev.id,
        title: input.title,
        choice: input.choice,
        rationale: input.rationale,
        ...(input.alternatives.length > 0
          ? {
              alternatives: input.alternatives.map((a) => ({
                label: a.label,
                body: a.body,
                evidenceIds: [...a.evidenceIds],
              })),
            }
          : {}),
        evidenceIds: [...input.evidenceIds],
        impacts: [...input.impacts],
      });
      setEditingDecision(null);
      await reloadDecisions();
    } catch (err) {
      props.onError(err instanceof Error ? err.message : 'Failed to revise decision.');
    }
  };

  return (
    <div
      data-testid="design-workspace"
      data-spec-id={props.spec.id}
      className="rd-stack-md"
      style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}
    >
      <header className="rd-row">
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onBack}
          data-testid="design-back-to-project"
        >
          ← Project
        </Button>
        <h1 className="rd-h2">{props.spec.name}</h1>
        <Pill data-testid="design-spec-kind">{props.spec.kind}</Pill>
      </header>
      <div className="rd-grid-2-360">
        <Surface
          data-testid="design-sections"
          style={{ padding: '1rem', borderRadius: '0.5rem' }}
        >
          {DESIGN_SECTION_KINDS.map((kind) => {
            const section = sectionsByKind.get(kind);
            return (
              <DesignSectionCard
                key={kind}
                kind={kind}
                label={DEFAULT_SECTION_LABELS[kind]}
                hint={DEFAULT_SECTION_HINTS[kind]}
                state={{
                  body: section?.body ?? '',
                  expanded: section?.expanded ?? false,
                }}
                hasDecision={props.decisions.some((d) => d.sectionKind === kind)}
                onChangeBody={(body) => void onSaveSection(kind, body)}
                onToggle={(expanded) => void onToggleSection(kind, expanded)}
                onOpenDecision={() => setShowNewDecision(kind)}
              />
            );
          })}
        </Surface>
        <DecisionsRail
          decisions={props.decisions}
          sectionLabels={DEFAULT_SECTION_LABELS}
          onEdit={(d) => setEditingDecision(d)}
          onCreateTask={(d) => setTaskFromDecision(d)}
        />
      </div>
      {showNewDecision !== null && (
        <DecisionEditor
          testIdPrefix="design-decision-new"
          title={`New decision: ${DEFAULT_SECTION_LABELS[showNewDecision]}`}
          initial={{
            title: '',
            choice: '',
            rationale: '',
            alternatives: [],
            evidenceIds: [],
            impacts: [],
          }}
          onCancel={() => setShowNewDecision(null)}
          onSave={(v) => void onCreateDecision({ ...v, sectionKind: showNewDecision })}
        />
      )}
      {editingDecision && (
        <DecisionEditor
          testIdPrefix="design-decision-edit"
          title={`Revise: ${editingDecision.title}`}
          initial={{
            title: editingDecision.title,
            choice: editingDecision.choice,
            rationale: editingDecision.rationale,
            alternatives: editingDecision.alternatives,
            evidenceIds: [...editingDecision.evidenceIds],
            impacts: [...editingDecision.impacts],
          }}
          onCancel={() => setEditingDecision(null)}
          onSave={(v) => void onReviseDecision(editingDecision, v)}
          onCreateTask={() => setTaskFromDecision(editingDecision)}
        />
      )}
      {taskFromDecision && (
        <TaskFromDecisionForm
          decision={taskFromDecision}
          projectId={props.spec.projectId}
          onCancel={() => setTaskFromDecision(null)}
          onCreated={(taskId) => {
            setTaskFromDecision(null);
            props.onTaskCreated(taskId);
          }}
          onError={props.onError}
        />
      )}
    </div>
  );
}

/**
 * Compute the heads of the decision chains. A
 * decision is a head iff no other decision has
 * `supersedes === this.id`. The view layer
 * (`deriveMethodDecisionViews`) is the canonical
 * implementation; this local helper avoids a
 * circular import.
 */
function computeDecisionHeads(all: readonly MethodDecision[]): readonly MethodDecision[] {
  const superseded = new Set<string>();
  for (const d of all) {
    if (d.supersedes) superseded.add(d.supersedes);
  }
  return all
    .filter((d) => !superseded.has(d.id))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// `listMethodDecisionHistory` is wired for the
// future chain-history view; the rail currently
// shows the head + the rev # chip. Re-export the
// import so the bundler keeps it for type-checking.
void listMethodDecisionHistory;
// `MethodAlternative` re-exported for the editor
// import above; keep it referenced so the unused
// warning does not surface when the bundler prunes.
export type { MethodAlternative };
