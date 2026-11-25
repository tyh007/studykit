/**
 * StudyKit v0.4 — `features/research/OutputWorkspace`
 *
 * Evidence-backed Output editor (WP-10 Round 1 + Citation Foundation).
 * The user lands here from a Project Home → Output.
 *
 * Surface scope:
 *
 *   - Header: title (rename use case), status pill
 *     (`outline | draft | final`), `Mark as final`
 *     (visible when ≥ 1 Statement exists), `Delete`,
 *     `Back to project`.
 *   - Left column (~30%): sections list with
 *     keyboard-accessible reorder buttons (up /
 *     down) and an `Add section` button.
 *   - Right column: per-section Statement list with
 *     a textarea, audit badge, supports picker
 *     (accepted Claims + verified Evidence from the
 *     project), and an `AI draft from selected
 *     evidence` affordance.
 *   - Empty state: a freeform textarea. No
 *     Research Question template, no writing
 *     wizard, no red "you must add evidence"
 *     warnings. `unsupported` is an info badge,
 *     not an error.
 *
 * Persistence + lineage:
 *
 *   - All writes flow through the
 *     `ResearchRepository` injected by
 *     `useResearchDeps()` — there is no parallel
 *     store and no direct Dexie / IPC access.
 *   - Audit is recomputed live from the snapshot;
 *     the user sees the badge flip in real time as
 *     they attach / detach supports.
 *   - Clicking an Evidence Pill navigates to the
 *     existing Reader surface; clicking a Claim
 *     Pill navigates to the existing Evidence
 *     surface. The router owns the URL; the
 *     workspace just emits `onJumpToEvidence` /
 *     `onJumpToClaim` callbacks.
 *
 * Citation boundary (UI copy states it):
 *
 *   - Evidence support ≠ citation. Canonical Work
 *     identity and Statement entailment are audited
 *     as separate layers.
 *   - AI text never reaches the canonical store
 *     directly. The `OutputAiDraftPanel` keeps the
 *     draft in the Draft Layer until the user
 *     Accepts; the workspace then writes canonical
 *     Statement + Supports through `acceptOutputDraft`.
 */

import React from 'react';
import { useResearchDeps } from './researchContext';
import {
  auditOutput,
  auditLabel,
  auditTone,
  stableSectionOrder,
  stableStatementOrder,
  type OutputDocument,
  type OutputSection,
  type OutputStatement,
  type StatementAudit,
  type StatementAuditState,
  type StatementSupport,
  type SupportRelation,
} from '../../domain/output';
import type { Claim, Evidence } from '../../domain/research';
import type { Work } from '../../domain/research';
import {
  auditCitation,
  type CitationAudit,
  type StatementCitation,
} from '../../domain/citation';
import {
  addSection,
  addStatement,
  attachSupport,
  createOutput,
  deleteOutput,
  deleteSection,
  deleteStatement,
  removeSupport,
  renameOutput,
  reorderSections,
  reorderStatements,
  setOutputStatus,
  updateStatement,
} from '../../application/output/outputUseCases';
import {
  insertStatementCitation,
  removeStatementCitation,
} from '../../application/output/citationUseCases';
import {
  exportOutputCslJson,
  exportOutputMarkdown,
} from '../../application/output/citationExport';
import {
  exportCitationsBibtex,
  exportCitationsRis,
  formatCitationsWithCsl,
  type CitationStyle,
  type FormattedCitations,
} from '../../application/output/citationFormatting';
import {
  applyCitationVerification,
  type CitationVerificationResult,
  type VerifiableWorkField,
} from '../../application/output/citationVerification';
import { Button } from '../../shared/ui/Button';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { Input } from '../../shared/ui/Input';
import { OutputAiDraftPanel } from './output/OutputAiDraftPanel';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface OutputWorkspaceProps {
  readonly projectId: string;
  readonly outputId: string;
  readonly onBackToProject: (projectId: string) => void;
  readonly onJumpToEvidence: (input: { projectId: string; evidenceId: string }) => void;
  readonly onJumpToClaim: (input: { projectId: string; claimId: string }) => void;
  readonly onOpenReader: (input: { projectId: string; workId: string }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OutputWorkspace(props: OutputWorkspaceProps): React.ReactElement | null {
  const deps = useResearchDeps();
  const [output, setOutput] = React.useState<OutputDocument | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [sections, setSections] = React.useState<readonly OutputSection[]>([]);
  const [statements, setStatements] = React.useState<readonly OutputStatement[]>([]);
  const [supports, setSupports] = React.useState<readonly StatementSupport[]>([]);
  const [claims, setClaims] = React.useState<readonly Claim[]>([]);
  const [evidence, setEvidence] = React.useState<readonly Evidence[]>([]);
  const [works, setWorks] = React.useState<readonly Work[]>([]);
  const [citations, setCitations] = React.useState<readonly StatementCitation[]>([]);
  const [saveState, setSaveState] = React.useState<'idle' | 'pending' | 'error'>('idle');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [citationStyle, setCitationStyle] = React.useState<CitationStyle>('apa');
  const [formattedCitations, setFormattedCitations] = React.useState<FormattedCitations | null>(null);

  // Live subscription: refresh on every commit.
  React.useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!deps.repository) return;
      try {
        const [o, secs, claimsAll, evAll, worksAll, stmtsAll, sups, citationRows] = await Promise.all([
          deps.repository.getOutput(props.outputId),
          deps.repository.listOutputSections({ outputId: props.outputId }),
          deps.repository.listClaims({ projectId: props.projectId }),
          deps.repository.listEvidence({ projectId: props.projectId }),
          deps.repository.listWorks({ projectId: props.projectId }),
          deps.repository.listOutputStatements({ outputId: props.outputId }),
          deps.repository.listStatementSupports({ outputId: props.outputId }),
          deps.repository.listStatementCitations({ outputId: props.outputId }),
        ]);
        if (!active) return;
        setOutput(o);
        setLoaded(true);
        setSections(stableSectionOrder(secs));
        setClaims(claimsAll.filter((c) => c.status === 'canonical'));
        setEvidence(evAll.filter((e) => e.status === 'verified'));
        setWorks(worksAll);
        setStatements(stableStatementOrder(stmtsAll));
        setSupports(sups);
        setCitations(citationRows);
        setSaveState('idle');
        setSaveError(null);
      } catch (err) {
        if (!active) return;
        setSaveState('error');
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    };
    void refresh();
    const unsub = deps.repository.subscribe(() => {
      void refresh();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [deps.repository, props.outputId, props.projectId]);

  if (!deps.repository) return null;
  if (!loaded) {
    return (
      <div data-testid="output-workspace-loading" style={{ padding: '1rem' }}>
        Loading…
      </div>
    );
  }
  if (!output) {
    return (
      <div data-testid="output-workspace-missing" style={{ padding: '1rem' }}>
        Output not found.
        <Button variant="ghost" size="sm" onClick={() => props.onBackToProject(props.projectId)}>
          Back to project
        </Button>
      </div>
    );
  }

  const claimLookup = new Map<string, Claim>(claims.map((c) => [c.id, c]));
  const evidenceLookup = new Map<string, Evidence>(evidence.map((e) => [e.id, e]));
  const workLookup = new Map<string, Work>(works.map((work) => [work.id, work]));
  const audit = auditOutput({
    output: { id: output.id, projectId: output.projectId },
    statements,
    supports,
    lookups: {
      claims: claimLookup,
      evidence: evidenceLookup,
    },
  });

  const onRename = async (next: string) => {
    setSaveState('pending');
    try {
      await renameOutput(deps.repository!, { outputId: output.id, title: next });
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const onMarkFinal = async () => {
    setSaveState('pending');
    try {
      await setOutputStatus(deps.repository!, { outputId: output.id, status: 'final' });
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this output and all its sections, statements, and supports?')) {
      return;
    }
    try {
      await deleteOutput(deps.repository!, { outputId: output.id });
      props.onBackToProject(props.projectId);
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadText = (content: string, extension: string, type: string): void => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${output.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'output'}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadExport = async (kind: 'markdown' | 'csl-json' | 'bibtex' | 'ris') => {
    try {
      const csl = exportOutputCslJson({ citations, works });
      if (kind === 'markdown') {
        downloadText(exportOutputMarkdown({ output, sections, statements, citations, works }), 'md', 'text/markdown');
      } else if (kind === 'csl-json') {
        downloadText(JSON.stringify(csl, null, 2), 'csl.json', 'application/json');
      } else if (kind === 'bibtex') {
        downloadText(await exportCitationsBibtex(csl), 'bib', 'application/x-bibtex');
      } else {
        downloadText(await exportCitationsRis(csl), 'ris', 'application/x-research-info-systems');
      }
      setSaveState('idle');
      setSaveError(null);
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      data-testid="output-workspace"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 30%) 1fr',
        gap: '0.75rem',
        padding: '0.75rem',
        height: '100%',
      }}
    >
      {/* Header */}
      <Surface
        level="floating"
        glass
        style={{
          gridColumn: '1 / -1',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onBackToProject(props.projectId)}
          aria-label="Back to project"
        >
          ← Project
        </Button>
        <OutputTitleEditor
          title={output.title}
          status={output.status}
          onRename={onRename}
        />
        <div style={{ flex: 1 }} />
        <Pill tone={output.status === 'final' ? 'success' : 'info'} data-testid="output-status-pill">
          {output.status}
        </Pill>
        <Button
          variant="primary"
          size="sm"
          onClick={onMarkFinal}
          disabled={output.status === 'final' || statements.length === 0}
          data-testid="output-mark-final"
        >
          Mark as final
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void downloadExport('markdown')} data-testid="output-export-markdown">
          Markdown
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void downloadExport('csl-json')} data-testid="output-export-csl">
          CSL JSON
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void downloadExport('bibtex')} data-testid="output-export-bibtex">BibTeX</Button>
        <Button variant="ghost" size="sm" onClick={() => void downloadExport('ris')} data-testid="output-export-ris">RIS</Button>
        <select value={citationStyle} onChange={(event) => setCitationStyle(event.target.value as CitationStyle)} aria-label="Citation style">
          <option value="apa">APA 7</option>
          <option value="mla">MLA 9</option>
          <option value="chicago-author-date">Chicago author-date</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          data-testid="output-preview-bibliography"
          onClick={() => {
            setSaveState('pending');
            void formatCitationsWithCsl(exportOutputCslJson({ citations, works }), citationStyle)
              .then((result) => {
                setFormattedCitations(result);
                setSaveState('idle');
                setSaveError(null);
              })
              .catch((err: unknown) => {
                setSaveState('error');
                setSaveError(err instanceof Error ? err.message : String(err));
              });
          }}
        >
          Preview style
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          data-testid="output-delete"
          aria-label="Delete output"
        >
          Delete
        </Button>
        <SaveIndicator state={saveState} error={saveError} />
      </Surface>

      {formattedCitations ? (
        <Surface level="sunken" style={{ gridColumn: '1 / -1', padding: '0.75rem' }} data-testid="output-bibliography-preview">
          <strong>{formattedCitations.style} bibliography</strong>{' '}
          <a href="https://citationstyles.org/" target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem' }}>
            CSL Project styles
          </a>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0 0' }}>{formattedCitations.bibliography || 'No citations yet.'}</pre>
        </Surface>
      ) : null}

      {/* Sections (left) */}
      <Surface
        level="sunken"
        style={{ padding: '0.75rem', overflow: 'auto' }}
        data-testid="output-sections-column"
      >
        <SectionsPanel
          output={output}
          sections={sections}
          statements={statements}
          onAddSection={async (title) => {
            await addSection(deps.repository!, { outputId: output.id, title });
          }}
          onRenameSection={async (sectionId, title) => {
            const cur = sections.find((s) => s.id === sectionId);
            if (!cur) return;
            await deps.repository!.transact(async (tx) => {
              tx.putOutputSection({ ...cur, title, updatedAt: new Date().toISOString() });
            });
          }}
          onDeleteSection={async (sectionId) => {
            await deleteSection(deps.repository!, { sectionId });
          }}
          onReorderSection={async (sectionIdsInOrder) => {
            await reorderSections(deps.repository!, { outputId: output.id, sectionIdsInOrder });
          }}
        />
      </Surface>

      {/* Statements (right) */}
      <Surface
        level="surface"
        style={{ padding: '0.75rem', overflow: 'auto' }}
        data-testid="output-statements-column"
      >
        <StatementsPanel
          output={output}
          sections={sections}
          statements={statements}
          supports={supports}
          audits={audit.byStatement}
          claims={claims}
          evidence={evidence}
          claimLookup={claimLookup}
          evidenceLookup={evidenceLookup}
          workLookup={workLookup}
          citations={citations}
          projectId={props.projectId}
          onAddStatement={async (sectionId, body) => {
            await addStatement(deps.repository!, { sectionId, body });
          }}
          onUpdateStatement={async (statementId, body) => {
            await updateStatement(deps.repository!, { statementId, body });
          }}
          onDeleteStatement={async (statementId) => {
            await deleteStatement(deps.repository!, { statementId });
          }}
          onReorderStatements={async (sectionId, statementIdsInOrder) => {
            await reorderStatements(deps.repository!, { sectionId, statementIdsInOrder });
          }}
          onAttachSupport={async (statementId, ref, relation) => {
            await attachSupport(deps.repository!, { statementId, ref, relation });
          }}
          onRemoveSupport={async (supportId) => {
            await removeSupport(deps.repository!, { supportId });
          }}
          onInsertCitation={async (statementId, workId) => {
            await insertStatementCitation(deps.repository!, { statementId, workId });
          }}
          onRemoveCitation={async (citationId) => {
            await removeStatementCitation(deps.repository!, citationId);
          }}
          onVerifyCitation={deps.citationVerifier
            ? (work) => deps.citationVerifier!.verify(work)
            : undefined}
          onApplyCitationVerification={async (result, acceptedFields, acceptIntegrity) => {
            await applyCitationVerification(deps.repository!, { result, acceptedFields, acceptIntegrity });
          }}
          onJumpToEvidence={props.onJumpToEvidence}
          onJumpToClaim={props.onJumpToClaim}
          onOpenReader={props.onOpenReader}
          aiDraftSlot={
            <OutputAiDraftPanel
              outputId={output.id}
              sections={sections}
              projectId={props.projectId}
              claims={claims}
              evidence={evidence}
            />
          }
        />
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SaveIndicator(props: { state: 'idle' | 'pending' | 'error'; error: string | null }): React.ReactElement {
  if (props.state === 'pending') {
    return <span data-testid="output-save-state">Saving…</span>;
  }
  if (props.state === 'error') {
    return (
      <span data-testid="output-save-state" role="alert">
        <Pill tone="error">Save failed</Pill>
        <span style={{ marginLeft: '0.5rem' }}>{props.error ?? 'Unknown error'}</span>
      </span>
    );
  }
  return <span data-testid="output-save-state" style={{ opacity: 0.6 }}>Saved</span>;
}

function OutputTitleEditor(props: {
  title: string;
  status: OutputDocument['status'];
  onRename: (next: string) => void | Promise<void>;
}): React.ReactElement {
  const [value, setValue] = React.useState(props.title);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => setValue(props.title), [props.title]);
  if (editing) {
    return (
      <Input
        size="sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={async () => {
          if (value.trim().length > 0 && value !== props.title) {
            await props.onRename(value.trim());
          }
          setEditing(false);
        }}
        onKeyDown={async (e) => {
          if (e.key === 'Enter') {
            if (value.trim().length > 0 && value !== props.title) {
              await props.onRename(value.trim());
            }
            setEditing(false);
          }
          if (e.key === 'Escape') {
            setValue(props.title);
            setEditing(false);
          }
        }}
        aria-label="Output title"
        data-testid="output-title-input"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        background: 'none',
        border: 'none',
        fontWeight: 600,
        fontSize: '1rem',
        cursor: 'text',
        color: 'inherit',
      }}
      data-testid="output-title"
    >
      {props.title}
    </button>
  );
}

function SectionsPanel(props: {
  output: OutputDocument;
  sections: readonly OutputSection[];
  statements: readonly OutputStatement[];
  onAddSection: (title: string) => Promise<void>;
  onRenameSection: (sectionId: string, title: string) => Promise<void>;
  onDeleteSection: (sectionId: string) => Promise<void>;
  onReorderSection: (sectionIdsInOrder: readonly string[]) => Promise<void>;
}): React.ReactElement {
  const [draft, setDraft] = React.useState('');
  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <strong>Sections</strong>
        <span style={{ opacity: 0.6 }}>{props.sections.length}</span>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0' }} data-testid="output-sections-list">
        {props.sections.map((s, idx) => (
          <li
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.25rem 0',
            }}
            data-testid="output-section-row"
            data-section-id={s.id}
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${s.title} up`}
              disabled={idx === 0}
              onClick={() => {
                const ordered = [...props.sections];
                const [moved] = ordered.splice(idx, 1);
                ordered.splice(idx - 1, 0, moved!);
                void props.onReorderSection(ordered.map((x) => x.id));
              }}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${s.title} down`}
              disabled={idx === props.sections.length - 1}
              onClick={() => {
                const ordered = [...props.sections];
                const [moved] = ordered.splice(idx, 1);
                ordered.splice(idx + 1, 0, moved!);
                void props.onReorderSection(ordered.map((x) => x.id));
              }}
            >
              ↓
            </Button>
            <span style={{ flex: 1 }}>{s.title}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${s.title}`}
              onClick={() => void props.onDeleteSection(s.id)}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (draft.trim().length === 0) return;
          await props.onAddSection(draft.trim());
          setDraft('');
        }}
      >
        <Input
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add section"
          aria-label="New section title"
          data-testid="output-add-section-input"
        />
        <Button type="submit" size="sm" variant="primary" disabled={draft.trim().length === 0}>
          Add
        </Button>
      </form>
    </div>
  );
}

function StatementsPanel(props: {
  output: OutputDocument;
  sections: readonly OutputSection[];
  statements: readonly OutputStatement[];
  supports: readonly StatementSupport[];
  audits: ReadonlyMap<string, StatementAudit>;
  claims: readonly Claim[];
  evidence: readonly Evidence[];
  claimLookup: Map<string, Claim>;
  evidenceLookup: Map<string, Evidence>;
  workLookup: Map<string, Work>;
  citations: readonly StatementCitation[];
  projectId: string;
  onAddStatement: (sectionId: string, body: string) => Promise<void>;
  onUpdateStatement: (statementId: string, body: string) => Promise<void>;
  onDeleteStatement: (statementId: string) => Promise<void>;
  onReorderStatements: (sectionId: string, statementIdsInOrder: readonly string[]) => Promise<void>;
  onAttachSupport: (
    statementId: string,
    ref: { kind: 'claim' | 'evidence'; id: string },
    relation: SupportRelation,
  ) => Promise<void>;
  onRemoveSupport: (supportId: string) => Promise<void>;
  onInsertCitation: (statementId: string, workId: string) => Promise<void>;
  onRemoveCitation: (citationId: string) => Promise<void>;
  onVerifyCitation?: (work: Work) => Promise<CitationVerificationResult>;
  onApplyCitationVerification: (
    result: CitationVerificationResult,
    acceptedFields: readonly VerifiableWorkField[],
    acceptIntegrity: boolean,
  ) => Promise<void>;
  onJumpToEvidence: (input: { projectId: string; evidenceId: string }) => void;
  onJumpToClaim: (input: { projectId: string; claimId: string }) => void;
  onOpenReader: (input: { projectId: string; workId: string }) => void;
  aiDraftSlot: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      {props.sections.length === 0 && props.statements.length === 0 && (
        <EmptyState />
      )}
      {props.aiDraftSlot}
      {props.sections.map((section) => {
        const sectionStatements = props.statements.filter((s) => s.sectionId === section.id);
        return (
          <div key={section.id} style={{ marginBottom: '1.25rem' }} data-testid="output-section-block">
            <header>
              <h3 style={{ marginBottom: '0.25rem' }}>{section.title}</h3>
            </header>
            <StatementsForSection
              section={section}
              statements={sectionStatements}
              supports={props.supports}
              audits={props.audits}
              onAdd={(body) => props.onAddStatement(section.id, body)}
              onUpdate={(id, body) => props.onUpdateStatement(id, body)}
              onDelete={(id) => props.onDeleteStatement(id)}
              onReorder={(ids) => props.onReorderStatements(section.id, ids)}
              onAttach={(id, ref, relation) => props.onAttachSupport(id, ref, relation)}
              onRemove={(id) => props.onRemoveSupport(id)}
              claimLookup={props.claimLookup}
              evidenceLookup={props.evidenceLookup}
              workLookup={props.workLookup}
              citations={props.citations}
              onInsertCitation={props.onInsertCitation}
              onRemoveCitation={props.onRemoveCitation}
              onVerifyCitation={props.onVerifyCitation}
              onApplyCitationVerification={props.onApplyCitationVerification}
              projectId={props.projectId}
              onJumpToEvidence={props.onJumpToEvidence}
              onJumpToClaim={props.onJumpToClaim}
              onOpenReader={props.onOpenReader}
            />
          </div>
        );
      })}
    </div>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div
      data-testid="output-empty-state"
      style={{
        padding: '1.5rem',
        border: '1px dashed currentColor',
        borderRadius: '0.5rem',
        marginBottom: '1rem',
        opacity: 0.85,
      }}
    >
      <p style={{ margin: 0 }}>
        Start writing. You can attach evidence from the supports picker as you go — unsupported is fine,
        it's an info badge, not an error.
      </p>
      <p style={{ margin: '0.25rem 0 0 0', opacity: 0.6, fontSize: '0.85rem' }}>
        Evidence support and bibliographic citations are separate; use either when it helps.
      </p>
    </div>
  );
}

function StatementsForSection(props: {
  section: OutputSection;
  statements: readonly OutputStatement[];
  supports: readonly StatementSupport[];
  audits: ReadonlyMap<string, StatementAudit>;
  onAdd: (body: string) => Promise<void>;
  onUpdate: (statementId: string, body: string) => Promise<void>;
  onDelete: (statementId: string) => Promise<void>;
  onReorder: (statementIdsInOrder: readonly string[]) => Promise<void>;
  onAttach: (
    statementId: string,
    ref: { kind: 'claim' | 'evidence'; id: string },
    relation: SupportRelation,
  ) => Promise<void>;
  onRemove: (supportId: string) => Promise<void>;
  claimLookup: Map<string, Claim>;
  evidenceLookup: Map<string, Evidence>;
  workLookup: Map<string, Work>;
  citations: readonly StatementCitation[];
  onInsertCitation: (statementId: string, workId: string) => Promise<void>;
  onRemoveCitation: (citationId: string) => Promise<void>;
  onVerifyCitation?: (work: Work) => Promise<CitationVerificationResult>;
  onApplyCitationVerification: (
    result: CitationVerificationResult,
    acceptedFields: readonly VerifiableWorkField[],
    acceptIntegrity: boolean,
  ) => Promise<void>;
  projectId: string;
  onJumpToEvidence: (input: { projectId: string; evidenceId: string }) => void;
  onJumpToClaim: (input: { projectId: string; claimId: string }) => void;
  onOpenReader: (input: { projectId: string; workId: string }) => void;
}): React.ReactElement {
  const [draft, setDraft] = React.useState('');
  return (
    <div data-testid="output-statements-list">
      {props.statements.map((stmt, idx) => {
        const audit = props.audits.get(stmt.id);
        const stmtSupports = props.supports.filter((s) => s.statementId === stmt.id);
        return (
          <div
            key={stmt.id}
            style={{
              border: '1px solid currentColor',
              borderRadius: '0.5rem',
              padding: '0.5rem',
              margin: '0.5rem 0',
            }}
            data-testid="output-statement-row"
            data-statement-id={stmt.id}
          >
            <StatementEditor statement={stmt} onUpdate={props.onUpdate} />
            <StatementControls
              statement={stmt}
              index={idx}
              total={props.statements.length}
              onMoveUp={() => {
                const ordered = [...props.statements];
                const [moved] = ordered.splice(idx, 1);
                ordered.splice(idx - 1, 0, moved!);
                void props.onReorder(ordered.map((x) => x.id));
              }}
              onMoveDown={() => {
                const ordered = [...props.statements];
                const [moved] = ordered.splice(idx, 1);
                ordered.splice(idx + 1, 0, moved!);
                void props.onReorder(ordered.map((x) => x.id));
              }}
              onDelete={() => void props.onDelete(stmt.id)}
            />
            <AuditBadge
              audit={audit}
              onJumpToEvidence={props.onJumpToEvidence}
              onJumpToClaim={props.onJumpToClaim}
              onOpenReader={props.onOpenReader}
              projectId={props.projectId}
              claimLookup={props.claimLookup}
              evidenceLookup={props.evidenceLookup}
            />
            <SupportsRow
              statement={stmt}
              supports={stmtSupports}
              claimLookup={props.claimLookup}
              evidenceLookup={props.evidenceLookup}
              onAttach={(ref, relation) => props.onAttach(stmt.id, ref, relation)}
              onRemove={props.onRemove}
              onJumpToEvidence={props.onJumpToEvidence}
              onJumpToClaim={props.onJumpToClaim}
              onOpenReader={props.onOpenReader}
              projectId={props.projectId}
            />
            <CitationsRow
              statement={stmt}
              citations={props.citations.filter((citation) => citation.statementId === stmt.id)}
              workLookup={props.workLookup}
              evidence={Array.from(props.evidenceLookup.values())}
              supports={stmtSupports}
              onInsert={(workId) => props.onInsertCitation(stmt.id, workId)}
              onRemove={props.onRemoveCitation}
              onVerify={props.onVerifyCitation}
              onApplyVerification={props.onApplyCitationVerification}
              onOpenReader={props.onOpenReader}
              projectId={props.projectId}
            />
          </div>
        );
      })}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (draft.trim().length === 0) return;
          await props.onAdd(draft.trim());
          setDraft('');
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a statement…"
          aria-label="New statement body"
          data-testid="output-add-statement-input"
          style={{
            width: '100%',
            minHeight: '4rem',
            padding: '0.5rem',
            borderRadius: '0.5rem',
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: 'inherit',
          }}
        />
        <Button type="submit" size="sm" variant="primary" disabled={draft.trim().length === 0}>
          Add statement
        </Button>
      </form>
    </div>
  );
}

function StatementEditor(props: {
  statement: OutputStatement;
  onUpdate: (statementId: string, body: string) => Promise<void>;
}): React.ReactElement {
  const [value, setValue] = React.useState(props.statement.body);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setValue(props.statement.body), [props.statement.body]);
  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={async () => {
        if (value.trim().length === 0 || value === props.statement.body) return;
        setSaving(true);
        try {
          await props.onUpdate(props.statement.id, value.trim());
        } finally {
          setSaving(false);
        }
      }}
      aria-label="Statement body"
      data-testid="output-statement-body"
      style={{
        width: '100%',
        minHeight: '3.5rem',
        padding: '0.5rem',
        borderRadius: '0.5rem',
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
      }}
    >
      {value}
    </textarea>
  );
}

function StatementControls(props: {
  statement: OutputStatement;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Move statement up"
        disabled={props.index === 0}
        onClick={props.onMoveUp}
        data-testid="output-statement-move-up"
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Move statement down"
        disabled={props.index === props.total - 1}
        onClick={props.onMoveDown}
        data-testid="output-statement-move-down"
      >
        ↓
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Delete statement"
        onClick={props.onDelete}
        data-testid="output-statement-delete"
      >
        Delete
      </Button>
    </div>
  );
}

function AuditBadge(props: {
  audit: StatementAudit | undefined;
  projectId: string;
  onJumpToEvidence: (input: { projectId: string; evidenceId: string }) => void;
  onJumpToClaim: (input: { projectId: string; claimId: string }) => void;
  onOpenReader: (input: { projectId: string; workId: string }) => void;
  claimLookup: Map<string, Claim>;
  evidenceLookup: Map<string, Evidence>;
}): React.ReactElement {
  if (!props.audit) return <></>;
  const state: StatementAuditState = props.audit.state;
  const tone = auditTone(state);
  const label = auditLabel(state);
  const titleParts: string[] = [];
  for (const reason of props.audit.reasons) {
    if (reason.kind === 'no-supports') {
      titleParts.push('No supports attached');
    } else if (reason.kind === 'only-contradicts') {
      titleParts.push('Only contradicts attached');
    } else if (reason.kind === 'broken-ref') {
      titleParts.push(`Broken ref (${reason.ref.kind} ${reason.ref.id}): ${reason.why}`);
    } else if (reason.kind === 'claim-not-accepted') {
      titleParts.push(`Claim ${reason.ref.id} is not accepted`);
    } else if (reason.kind === 'evidence-not-verified') {
      titleParts.push(`Evidence ${reason.ref.id} is not verified`);
    }
  }
  return (
    <div style={{ marginTop: '0.5rem' }} data-testid="output-audit-badge" data-state={state}>
      <Pill tone={tone} title={titleParts.join('; ') || label}>
        {label}
      </Pill>
      {/* Surface the refs as clickable chips. The
          audit tells the user *why* via the title
          tooltip; the chips give them an entry to
          open the linked object. */}
      <span style={{ display: 'inline-flex', gap: '0.25rem', flexWrap: 'wrap', marginLeft: '0.5rem' }}>
        {props.audit.refs.map((ref) => (
          <button
            key={`${ref.kind}:${ref.id}`}
            type="button"
            onClick={() => {
              if (ref.kind === 'evidence') {
                const ev = props.evidenceLookup.get(ref.id);
                if (ev) {
                  props.onOpenReader({ projectId: props.projectId, workId: ev.workId });
                }
                props.onJumpToEvidence({ projectId: props.projectId, evidenceId: ref.id });
              } else {
                props.onJumpToClaim({ projectId: props.projectId, claimId: ref.id });
              }
            }}
            style={{
              padding: '0 0.5rem',
              borderRadius: '999px',
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
            data-testid={`output-audit-ref-${ref.kind}-${ref.id}`}
          >
            {ref.kind}:{ref.id}
          </button>
        ))}
      </span>
    </div>
  );
}

function SupportsRow(props: {
  statement: OutputStatement;
  supports: readonly StatementSupport[];
  claimLookup: Map<string, Claim>;
  evidenceLookup: Map<string, Evidence>;
  onAttach: (
    ref: { kind: 'claim' | 'evidence'; id: string },
    relation: SupportRelation,
  ) => Promise<void>;
  onRemove: (supportId: string) => Promise<void>;
  onJumpToEvidence: (input: { projectId: string; evidenceId: string }) => void;
  onJumpToClaim: (input: { projectId: string; claimId: string }) => void;
  onOpenReader: (input: { projectId: string; workId: string }) => void;
  projectId: string;
}): React.ReactElement {
  return (
    <div style={{ marginTop: '0.5rem' }} data-testid="output-supports-row">
      <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>
        Evidence support is not a bibliographic citation.
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}>
        {props.supports.map((s) => {
          const ref = s.ref;
          if (ref.kind === 'evidence') {
            const ev = props.evidenceLookup.get(ref.id);
            return (
              <Pill
                key={s.id}
                tone={s.relation === 'contradicts' ? 'warning' : s.relation === 'qualifies' ? 'info' : 'success'}
                data-testid={`output-support-${s.id}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (ev) props.onOpenReader({ projectId: props.projectId, workId: ev.workId });
                    props.onJumpToEvidence({ projectId: props.projectId, evidenceId: ref.id });
                  }}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                >
                  Evidence {ref.id} · {s.relation}
                </button>
                <Button variant="ghost" size="sm" onClick={() => void props.onRemove(s.id)} aria-label="Remove support">
                  ×
                </Button>
              </Pill>
            );
          }
          const claim = props.claimLookup.get(ref.id);
          return (
            <Pill
              key={s.id}
              tone={s.relation === 'contradicts' ? 'warning' : s.relation === 'qualifies' ? 'info' : 'success'}
              data-testid={`output-support-${s.id}`}
            >
              <button
                type="button"
                onClick={() => props.onJumpToClaim({ projectId: props.projectId, claimId: ref.id })}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                Claim {claim?.title ?? ref.id} · {s.relation}
              </button>
              <Button variant="ghost" size="sm" onClick={() => void props.onRemove(s.id)} aria-label="Remove support">
                ×
              </Button>
            </Pill>
          );
        })}
      </div>
      <SupportPicker
        claimLookup={props.claimLookup}
        evidenceLookup={props.evidenceLookup}
        onAttach={(ref, relation) => props.onAttach(ref, relation)}
      />
    </div>
  );
}

function CitationsRow(props: {
  statement: OutputStatement;
  citations: readonly StatementCitation[];
  workLookup: Map<string, Work>;
  evidence: readonly Evidence[];
  supports: readonly StatementSupport[];
  onInsert: (workId: string) => Promise<void>;
  onRemove: (citationId: string) => Promise<void>;
  onVerify?: (work: Work) => Promise<CitationVerificationResult>;
  onApplyVerification: (
    result: CitationVerificationResult,
    acceptedFields: readonly VerifiableWorkField[],
    acceptIntegrity: boolean,
  ) => Promise<void>;
  onOpenReader: (input: { projectId: string; workId: string }) => void;
  projectId: string;
}): React.ReactElement {
  const [workId, setWorkId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [verification, setVerification] = React.useState<CitationVerificationResult | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [acceptedFields, setAcceptedFields] = React.useState<readonly VerifiableWorkField[]>([]);
  const [acceptIntegrity, setAcceptIntegrity] = React.useState(false);
  const citedWorkIds = new Set(props.citations.map((citation) => citation.workId));
  const audits = props.citations.map((citation) => ({
    citation,
    audit: auditCitation({
      citation,
      statement: props.statement,
      work: props.workLookup.get(citation.workId) ?? null,
      evidence: props.evidence,
      supports: props.supports,
    }),
  }));
  const toneFor = (audit: CitationAudit): 'success' | 'warning' | 'error' =>
    audit.state === 'verified' ? 'success' : audit.state === 'blocked' ? 'error' : 'warning';
  return (
    <div style={{ marginTop: '0.75rem' }} data-testid="output-citations-row">
      <strong style={{ fontSize: '0.85rem' }}>Citations</strong>{' '}
      <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>
        Citation identity and evidence support are audited separately.
      </span>
      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
        {audits.map(({ citation, audit }) => {
          const work = props.workLookup.get(citation.workId);
          return (
            <Pill key={citation.id} tone={toneFor(audit)} data-testid={`output-citation-${citation.id}`}>
              <button
                type="button"
                onClick={() => props.onOpenReader({ projectId: props.projectId, workId: citation.workId })}
                style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
                title={audit.checks.map((check) => `${check.layer}: ${check.message}`).join('\n')}
              >
                @{citation.citeKey} · {work?.title ?? 'Missing Work'} · {audit.state}
              </button>
              <Button variant="ghost" size="sm" aria-label="Remove citation" onClick={() => void props.onRemove(citation.id)}>
                ×
              </Button>
              {props.onVerify && work ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={verifying}
                  data-testid={`output-citation-verify-${citation.id}`}
                  onClick={() => {
                    setError(null);
                    setVerifying(true);
                    void props.onVerify!(work)
                      .then((result) => {
                        setVerification(result);
                        setAcceptedFields([]);
                        setAcceptIntegrity(false);
                      })
                      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
                      .finally(() => setVerifying(false));
                  }}
                >
                  {verifying ? 'Checking…' : 'Verify'}
                </Button>
              ) : null}
            </Pill>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
        <select
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
          aria-label="Canonical Work citation"
          data-testid="output-citation-work"
        >
          <option value="">Select canonical Work…</option>
          {Array.from(props.workLookup.values())
            .filter((work) => !citedWorkIds.has(work.id))
            .map((work) => (
              <option key={work.id} value={work.id}>
                {work.title} {work.year ? `(${work.year})` : '(year missing)'}
              </option>
            ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          disabled={!workId}
          data-testid="output-citation-insert"
          onClick={() => {
            setError(null);
            void props.onInsert(workId)
              .then(() => setWorkId(''))
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
          }}
        >
          Insert citation
        </Button>
      </div>
      {verification ? (
        <Surface level="sunken" style={{ marginTop: '0.5rem', padding: '0.5rem' }} data-testid="output-citation-verification-preview">
          <strong>Registry preview</strong>{' '}
          <Pill tone={verification.integrity === 'retracted' ? 'error' : verification.integrity === 'ok' ? 'success' : 'warning'}>
            integrity: {verification.integrity}
          </Pill>
          <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>
            {verification.sources.map((source) => source.providerId).join(' + ') || 'No registry responded'}
          </div>
          {verification.differences.map((difference) => (
            <label key={difference.field} style={{ display: 'block', marginTop: '0.25rem' }}>
              <input
                type="checkbox"
                checked={acceptedFields.includes(difference.field)}
                onChange={(event) => setAcceptedFields((current) => event.target.checked
                  ? [...current, difference.field]
                  : current.filter((field) => field !== difference.field))}
              />{' '}
              {difference.field}: {formatVerificationValue(difference.current)} → {formatVerificationValue(difference.proposed)} ({difference.providerId})
            </label>
          ))}
          <label style={{ display: 'block', marginTop: '0.25rem' }}>
            <input type="checkbox" checked={acceptIntegrity} onChange={(event) => setAcceptIntegrity(event.target.checked)} />{' '}
            Save integrity check ({verification.integrity})
          </label>
          {verification.errors.length > 0 ? <p role="status">Partial check: {verification.errors.join(' ')}</p> : null}
          <Button
            variant="primary"
            size="sm"
            disabled={acceptedFields.length === 0 && !acceptIntegrity}
            data-testid="output-citation-apply-verification"
            onClick={() => {
              setError(null);
              void props.onApplyVerification(verification, acceptedFields, acceptIntegrity)
                .then(() => setVerification(null))
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
            }}
          >
            Apply selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setVerification(null)}>Keep current</Button>
        </Surface>
      ) : null}
      {error && <p role="alert" style={{ margin: '0.25rem 0 0' }}>{error}</p>}
    </div>
  );
}

function formatVerificationValue(value: string | number | readonly string[] | undefined): string {
  if (value === undefined) return 'missing';
  return Array.isArray(value) ? value.join('; ') : String(value);
}

function SupportPicker(props: {
  claimLookup: Map<string, Claim>;
  evidenceLookup: Map<string, Evidence>;
  onAttach: (
    ref: { kind: 'claim' | 'evidence'; id: string },
    relation: SupportRelation,
  ) => Promise<void>;
}): React.ReactElement {
  const [filter, setFilter] = React.useState('');
  const [refKind, setRefKind] = React.useState<'claim' | 'evidence'>('evidence');
  const [refId, setRefId] = React.useState('');
  const [relation, setRelation] = React.useState<SupportRelation>('supports');

  const claimOptions: Array<{ id: string; claim: Claim }> = [];
  for (const [id, claim] of props.claimLookup) {
    if (!filter || claim.title.toLowerCase().includes(filter.toLowerCase())) {
      claimOptions.push({ id, claim });
    }
  }
  const evidenceOptions: Array<{ id: string; evidence: Evidence }> = [];
  for (const [id, evidence] of props.evidenceLookup) {
    if (!filter || evidence.exactQuote.toLowerCase().includes(filter.toLowerCase())) {
      evidenceOptions.push({ id, evidence });
    }
  }

  return (
    <div style={{ marginTop: '0.5rem' }} data-testid="output-support-picker">
      <Input
        size="sm"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter evidence / claims by text"
        aria-label="Support filter"
        data-testid="output-support-filter"
      />
      <select
        value={refKind}
        onChange={(e) => {
          setRefKind(e.target.value as 'claim' | 'evidence');
          setRefId('');
        }}
        aria-label="Ref kind"
        data-testid="output-support-ref-kind"
      >
        <option value="evidence">Evidence</option>
        <option value="claim">Claim</option>
      </select>
      <select
        value={refId}
        onChange={(e) => setRefId(e.target.value)}
        aria-label="Ref id"
        data-testid="output-support-ref-id"
      >
        <option value="">Select…</option>
        {(refKind === 'evidence' ? evidenceOptions : claimOptions).map((entry) => (
          <option key={entry.id} value={entry.id}>
            {refKind === 'evidence'
              ? `${entry.id} — ${(entry as { evidence: Evidence }).evidence.exactQuote.slice(0, 60)}`
              : `${entry.id} — ${(entry as { claim: Claim }).claim.title}`}
          </option>
        ))}
      </select>
      <select
        value={relation}
        onChange={(e) => setRelation(e.target.value as SupportRelation)}
        aria-label="Relation"
        data-testid="output-support-relation"
      >
        <option value="supports">supports</option>
        <option value="qualifies">qualifies</option>
        <option value="contradicts">contradicts</option>
      </select>
      <Button
        variant="primary"
        size="sm"
        disabled={refId.length === 0}
        onClick={() => {
          void props.onAttach({ kind: refKind, id: refId }, relation);
          setRefId('');
        }}
        data-testid="output-support-attach"
      >
        Attach
      </Button>
    </div>
  );
}
