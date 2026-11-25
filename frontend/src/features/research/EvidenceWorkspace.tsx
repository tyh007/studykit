/**
 * StudyKit v0.4 — `features/research/EvidenceWorkspace`
 *
 * Evidence & Claim workspace. The user can:
 *
 *   - See the project's verified Evidence and
 *     rejected Evidence (the `candidate` ones are
 *     hidden by default; the host can promote them
 *     with a toggle).
 *   - Multi-paper compare: a header bar lists the
 *     Works the user has Evidence for. The user
 *     picks at least three to enable "Create Claim".
 *   - Create a Claim and link it to the selected
 *     Evidence with `supports | contradicts |
 *     qualifies`. The claim is canonical immediately
 *     (the user authored it) — AI suggestions go
 *     through `suggestClaimDraft` + `acceptClaimDraft`
 *     in a future surface.
 *
 * No Evidence → no Claim. No verified Evidence →
 * no link. These are the same invariants the
 * use-case layer enforces; the UI just renders
 * them.
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { useResearchDeps } from './researchContext';
import {
  acceptClaimDraft,
  createClaim,
  linkEvidenceToClaim,
  rejectEvidence,
  rejectClaimDraft,
  verifyEvidence,
} from '../../application/research/researchUseCases';
import {
  generateClaimDraft,
  type ClaimDraftResult,
} from '../../application/research/claimDraftUseCase';
import type {
  Claim,
  ClaimEvidenceLink,
  ClaimEvidenceRelation,
  Evidence,
  EvidenceType,
  ResearchProject,
  Work,
} from '../../domain/research';
import type { DraftRecord } from '../../features/ai/kernel/draftLayer';

export interface EvidenceWorkspaceProps {
  readonly projectId: string;
  readonly onBackToProject: (projectId: string) => void;
  /**
   * WP-11R2: open the Sources surface (the
   * unified Library + Search). The empty
   * Evidence state uses this to send the user
   * to "Add sources" / "Open a source" without
   * the disabled-Claim form in the way.
   */
  readonly onOpenLibrary?: (projectId: string) => void;
  readonly onOpenWork: (input: { projectId: string; workId: string }) => void;
  /**
   * Open the cognitive canvas with the selected
   * Evidence + Claim refs. The cognitive canvas is
   * feature-flagged (`v04Canvas`); the host UI
   * (the V04 shell) decides whether to mount it.
   * When the canvas is unavailable, the button is
   * hidden. The button is disabled when no rows
   * are selected.
   */
  readonly onOpenCanvas?: (input: {
    projectId: string;
    evidenceIds: readonly string[];
    claimIds: readonly string[];
  }) => void;
  /** True when the cognitive canvas is mounted
   *  and the "Open in Canvas" button is rendered.
   *  When false, the button is hidden (the
   *  flag-off / pre-WP-06 path). */
  readonly cognitiveCanvasAvailable?: boolean;
}

const EVIDENCE_TYPE_OPTIONS: ReadonlyArray<EvidenceType> = [
  'finding',
  'method',
  'definition',
  'theory',
  'limitation',
  'context',
];

export function EvidenceWorkspace(props: EvidenceWorkspaceProps): React.ReactElement {
  const deps = useResearchDeps();
  const [project, setProject] = React.useState<ResearchProject | null>(null);
  const [works, setWorks] = React.useState<readonly Work[]>([]);
  const [evidence, setEvidence] = React.useState<readonly Evidence[]>([]);
  const [claims, setClaims] = React.useState<readonly Claim[]>([]);
  const [links, setLinks] = React.useState<readonly ClaimEvidenceLink[]>([]);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [selectedClaims, setSelectedClaims] = React.useState<ReadonlySet<string>>(new Set());
  // Per-evidence relation: the user picks the
  // relation (supports / contradicts / qualifies)
  // for each evidence they include in a Claim.
  // The map is keyed by evidence id; missing keys
  // default to `supports`. The selection UI is the
  // `evidence-relation` select.
  const [relations, setRelations] = React.useState<ReadonlyMap<string, ClaimEvidenceRelation>>(new Map());
  const [claimTitle, setClaimTitle] = React.useState('');
  const [claimBody, setClaimBody] = React.useState('');
  const [aiContext, setAiContext] = React.useState('');
  const [aiDraft, setAiDraft] = React.useState<{ draft: DraftRecord; title: string; body: string } | null>(null);
  const [aiFailure, setAiFailure] = React.useState<{ reason: string; message: string; prompt: string } | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async (): Promise<void> => {
    const [p, w, e, c, l] = await Promise.all([
      deps.repository.getProject(props.projectId),
      deps.repository.listWorks({ projectId: props.projectId }),
      deps.repository.listEvidence({ projectId: props.projectId }),
      deps.repository.listClaims({ projectId: props.projectId }),
      deps.repository.listLinks({ projectId: props.projectId }),
    ]);
    setProject(p);
    setWorks(w);
    setEvidence(e);
    setClaims(c);
    setLinks(l);
  }, [deps, props.projectId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    const off = deps.repository.subscribe(() => {
      void reload();
    });
    return off;
  }, [deps.repository, reload]);

  const verified = React.useMemo(() => evidence.filter((e) => e.status === 'verified'), [evidence]);
  const worksById = React.useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const claimsById = React.useMemo(() => new Map(claims.map((c) => [c.id, c])), [claims]);
  const linksByClaimId = React.useMemo(() => {
    const out = new Map<string, ClaimEvidenceLink[]>();
    for (const l of links) {
      const list = out.get(l.claimId) ?? [];
      list.push(l);
      out.set(l.claimId, list);
    }
    return out;
  }, [links]);

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setEvidenceRelation = (id: string, relation: ClaimEvidenceRelation): void => {
    setRelations((prev) => {
      const next = new Map(prev);
      next.set(id, relation);
      return next;
    });
  };

  const handleVerify = async (e: Evidence): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await verifyEvidence(deps.repository, { evidenceId: e.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify evidence.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (e: Evidence): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await rejectEvidence(deps.repository, { evidenceId: e.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject evidence.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateClaim = async (): Promise<void> => {
    if (!claimTitle.trim()) {
      setError('A claim needs a title.');
      return;
    }
    if (selected.size < 3) {
      setError('Select at least three verified Evidence from three different Works.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const selectedEvidence = verified.filter((e) => selected.has(e.id));
      const uniqueWorks = new Set(selectedEvidence.map((e) => e.workId));
      if (uniqueWorks.size < 3) {
        setError('Selected Evidence must come from at least three different Works.');
        setBusy(false);
        return;
      }
      const claim = await createClaim(deps.repository, {
        projectId: props.projectId,
        title: claimTitle.trim(),
        body: claimBody.trim(),
      });
      // The user picks the relation per evidence via
      // the per-row select. The default (when the user
      // didn't touch the select) is `supports`. The
      // map state is `relations`; we read it directly
      // so the round-trip is observable in the test.
      for (const e of selectedEvidence) {
        const relation = relations.get(e.id) ?? 'supports';
        await linkEvidenceToClaim(deps.repository, {
          projectId: props.projectId,
          claimId: claim.id,
          evidenceId: e.id,
          relation,
        });
      }
      setClaimTitle('');
      setClaimBody('');
      setSelected(new Set());
      setRelations(new Map());
      // Force a re-read of the repository so the
      // claims list reflects the new row. The
      // Dexie hook → notify → setTimeout(0) chain
      // eventually fires the subscription, but
      // there is a race in the smoke environment
      // where the setTimeout doesn't flush before
      // the next user action. The explicit reload
      // is robust + matches the same pattern the
      // AI accept path uses.
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create claim.');
    } finally {
      setBusy(false);
    }
  };

  const handleSuggestClaim = async (): Promise<void> => {
    if (!project) return;
    if (selected.size < 3) {
      setError('Select at least three verified Evidence from three different Works before suggesting a Claim.');
      return;
    }
    const selectedEvidence = verified.filter((e) => selected.has(e.id));
    const uniqueWorks = new Set(selectedEvidence.map((e) => e.workId));
    if (uniqueWorks.size < 3) {
      setError('Selected Evidence must come from at least three different Works.');
      return;
    }
    setAiBusy(true);
    setError(null);
    setAiFailure(null);
    try {
      const result: ClaimDraftResult = await generateClaimDraft({
        project,
        contextText: aiContext,
        evidence: selectedEvidence
          .map((e) => {
            const w = worksById.get(e.workId);
            return w ? { evidence: e, work: w } : null;
          })
          .filter((x): x is { evidence: Evidence; work: Work } => x !== null),
        providerRouter: deps.providerRouter,
      });
      if (result.kind === 'draft') {
        setAiDraft({ draft: result.draft, title: result.title, body: result.body });
      } else {
        setAiFailure({ reason: result.reason, message: result.message, prompt: result.prompt });
      }
    } catch (err) {
      setAiFailure({
        reason: 'unknown',
        message: err instanceof Error ? err.message : 'AI claim suggestion failed.',
        prompt: '',
      });
    } finally {
      setAiBusy(false);
    }
  };

  const handleAcceptAiDraft = async (): Promise<void> => {
    if (!aiDraft || !project) return;
    setAiBusy(true);
    setError(null);
    try {
      const claim = await acceptClaimDraft(deps.repository, {
        draftId: aiDraft.draft.id,
        projectId: props.projectId,
        title: aiDraft.title,
        body: aiDraft.body,
      });
      // Link the same evidence selection to the claim
      // with the same default relations.
      const selectedEvidence = verified.filter((e) => selected.has(e.id));
      const relations: Array<'supports' | 'contradicts' | 'qualifies'> = [
        'supports',
        'qualifies',
        'qualifies',
      ];
      let i = 0;
      for (const e of selectedEvidence) {
        const relation = relations[i] ?? 'qualifies';
        i += 1;
        await linkEvidenceToClaim(deps.repository, {
          projectId: props.projectId,
          claimId: claim.id,
          evidenceId: e.id,
          relation,
        });
      }
      setAiDraft(null);
      setAiContext('');
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept claim draft.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleRejectAiDraft = (): void => {
    if (!aiDraft) return;
    rejectClaimDraft(aiDraft.draft.id);
    setAiDraft(null);
  };

  const multiWorkCount = new Set(verified.filter((e) => selected.has(e.id)).map((e) => e.workId)).size;

  return (
    <div
      data-testid="evidence-workspace"
      data-project-id={props.projectId}
      style={{ padding: '1rem', maxWidth: 1024, margin: '0 auto' }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Evidence &amp; Claim</h1>
        <Pill data-testid="evidence-workspace-project-name">{project?.name ?? '…'}</Pill>
        <span style={{ flex: 1 }} />
        {props.cognitiveCanvasAvailable ? (
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0 && selectedClaims.size === 0}
            onClick={() => {
              if (!props.onOpenCanvas) return;
              if (selected.size === 0 && selectedClaims.size === 0) return;
              props.onOpenCanvas({
                projectId: props.projectId,
                evidenceIds: Array.from(selected),
                claimIds: Array.from(selectedClaims),
              });
            }}
            data-testid="evidence-workspace-open-canvas"
            aria-label="Open selected evidence and claims in cognitive canvas"
            title={
              selected.size + selectedClaims.size === 0
                ? 'Select at least one evidence row or one claim to open in the cognitive canvas.'
                : `Open ${selected.size} evidence + ${selectedClaims.size} claim(s) in the cognitive canvas.`
            }
          >
            Open in Canvas ({selected.size + selectedClaims.size})
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onBackToProject(props.projectId)}
          data-testid="evidence-workspace-back"
        >
          Back to project
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          data-testid="evidence-workspace-error"
          style={{ color: 'var(--color-danger, #b00)', fontSize: '0.85rem', margin: '0.5rem 0' }}
        >
          {error}
        </p>
      ) : null}

      <section data-testid="evidence-list" style={{ marginTop: '0.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Evidence</h2>
        {verified.length === 0 ? (
          <div data-testid="evidence-empty-state" className="research-empty-state" role="region" aria-label="No evidence yet">
            <p data-testid="evidence-empty" style={{ margin: '0 0 0.75rem 0', color: 'var(--color-text-secondary, #666)' }}>
              No Evidence yet. Add a source and capture a passage — the Claim form unlocks once you have Evidence.
            </p>
            <div className="research-empty-state-actions" data-testid="evidence-empty-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={() => props.onOpenLibrary?.(props.projectId)}
                data-testid="evidence-empty-add-sources"
              >
                Add sources
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => props.onOpenLibrary?.(props.projectId)}
                data-testid="evidence-empty-open-source"
              >
                Open a source
              </Button>
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {verified.map((e) => (
              <li
                key={e.id}
                data-testid="evidence-row"
                data-evidence-id={e.id}
                data-work-id={e.workId}
              >
                <Surface style={{ padding: '0.75rem 0.875rem', borderRadius: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggleSelected(e.id)}
                      data-testid="evidence-select"
                      aria-label="Select evidence for claim"
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        data-testid="evidence-quote"
                        style={{ fontStyle: 'italic' }}
                      >
                        “{e.exactQuote}”
                      </div>
                      <div
                        data-testid="evidence-interpretation"
                        style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem', marginTop: '0.25rem' }}
                      >
                        Reading: {e.userInterpretation}
                      </div>
                      <div
                        data-testid="evidence-work"
                        style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.75rem' }}
                      >
                        {worksById.get(e.workId)?.title ?? e.workId} · {e.evidenceType}
                      </div>
                    </div>
                    <label
                      htmlFor={`evidence-relation-${e.id}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.125rem',
                        fontSize: '0.75rem',
                        color: 'var(--color-text-secondary, #666)',
                      }}
                    >
                      Relation
                      <select
                        id={`evidence-relation-${e.id}`}
                        data-testid="evidence-relation"
                        data-evidence-id={e.id}
                        value={relations.get(e.id) ?? 'supports'}
                        onChange={(ev) => setEvidenceRelation(e.id, ev.currentTarget.value as ClaimEvidenceRelation)}
                        disabled={!selected.has(e.id)}
                        style={{
                          padding: '0.25rem 0.4rem',
                          border: '1px solid var(--color-border, #ccc)',
                          borderRadius: 'var(--radius-sm, 4px)',
                          background: 'var(--color-bg, transparent)',
                          color: 'var(--color-text, inherit)',
                          font: 'inherit',
                        }}
                      >
                        <option value="supports">supports</option>
                        <option value="contradicts">contradicts</option>
                        <option value="qualifies">qualifies</option>
                      </select>
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onOpenWork({ projectId: props.projectId, workId: e.workId })}
                      data-testid="evidence-open-work"
                    >
                      Open paper
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReject(e)}
                      disabled={busy}
                      data-testid="evidence-reject"
                    >
                      Reject
                    </Button>
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* WP-11R2: hide the Claim + AI-Claim forms
          when there is no verified Evidence. The
          audit Step 8 verdict was that the empty
          state showed a long disabled form instead
          of a short path forward. The shortest
          path is now in `evidence-empty-state`
          above; the Claim form only renders when
          the user actually has Evidence to combine.
      */}
      {verified.length === 0 ? null : (
      <section
        data-testid="claim-creator"
        style={{ marginTop: '1.5rem' }}
      >
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Create Claim</h2>
        <p
          data-testid="claim-creator-summary"
          style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
        >
          {selected.size} selected · {multiWorkCount} distinct works (need ≥ 3)
        </p>
        <label htmlFor="claim-title" style={{ display: 'block', marginTop: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
            Title
          </span>
          <input
            id="claim-title"
            data-testid="claim-title"
            value={claimTitle}
            onChange={(e) => setClaimTitle(e.currentTarget.value)}
            style={{
              width: '100%',
              padding: '0.4rem 0.625rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--color-bg, transparent)',
              color: 'var(--color-text, inherit)',
              font: 'inherit',
            }}
          />
        </label>
        <label htmlFor="claim-body" style={{ display: 'block', marginTop: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
            Body
          </span>
          <textarea
            id="claim-body"
            data-testid="claim-body"
            value={claimBody}
            onChange={(e) => setClaimBody(e.currentTarget.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--color-bg, transparent)',
              color: 'var(--color-text, inherit)',
              font: 'inherit',
              resize: 'vertical',
            }}
          />
        </label>
        <div style={{ marginTop: '0.5rem' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateClaim}
            disabled={busy || selected.size < 3 || multiWorkCount < 3}
            data-testid="claim-create"
          >
            Create Claim
          </Button>
        </div>
      </section>
      )}

      {verified.length === 0 ? null : (
      <section
        data-testid="claim-ai-draft"
        style={{ marginTop: '1.5rem' }}
      >
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>AI-suggested Claim</h2>
        <p
          data-testid="claim-ai-help"
          style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
        >
          {deps.providerRouter
            ? 'Pick three or more verified Evidence and ask the AI for a Claim draft. The draft is never canonical until you Accept; Reject keeps the Evidence + selection intact.'
            : 'AI is not configured in this workspace. You can still create a Claim manually above. To enable AI, sign in to a sync workspace or turn on the AI assistant.'}
        </p>
        <label htmlFor="claim-ai-context" style={{ display: 'block', marginTop: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
            Context (optional)
          </span>
          <textarea
            id="claim-ai-context"
            data-testid="claim-ai-context"
            value={aiContext}
            onChange={(e) => setAiContext(e.currentTarget.value)}
            rows={2}
            disabled={!deps.providerRouter}
            placeholder="Any extra context the AI should know about the Claim scope."
            style={{
              width: '100%',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--color-bg, transparent)',
              color: 'var(--color-text, inherit)',
              font: 'inherit',
              resize: 'vertical',
            }}
          />
        </label>
        <div style={{ marginTop: '0.5rem' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSuggestClaim}
            disabled={!deps.providerRouter || aiBusy || selected.size < 3 || multiWorkCount < 3}
            data-testid="claim-ai-suggest"
          >
            {aiBusy ? 'Drafting…' : 'Suggest Claim'}
          </Button>
        </div>
        {aiFailure ? (
          <div
            role="status"
            data-testid="claim-ai-failure"
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--color-warning, #b80)',
              borderRadius: 'var(--radius-sm, 4px)',
              color: 'var(--color-warning, #b80)',
              fontSize: '0.85rem',
            }}
          >
            <p style={{ margin: 0 }}>AI could not draft a Claim: {aiFailure.message}</p>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-secondary, #666)' }}>
              Your Evidence, selection, and focus are kept. Retry, or create the Claim manually above.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSuggestClaim}
              disabled={aiBusy}
              data-testid="claim-ai-retry"
              style={{ marginTop: '0.5rem' }}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {aiDraft ? (
          <div
            data-testid="claim-ai-draft-card"
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--color-border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)',
            }}
          >
            <p
              data-testid="claim-ai-draft-scope"
              style={{ margin: 0, color: 'var(--color-text-secondary, #666)', fontSize: '0.8rem' }}
            >
              Draft from {selected.size} Evidence across {multiWorkCount} Works
            </p>
            <p
              data-testid="claim-ai-draft-provenance"
              data-provider={aiDraft.draft.provenance.provider}
              data-model={aiDraft.draft.provenance.model ?? ''}
              style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-secondary, #666)', fontSize: '0.75rem' }}
            >
              via {aiDraft.draft.provenance.provider}
              {aiDraft.draft.provenance.model ? ` (${aiDraft.draft.provenance.model})` : ''}
            </p>
            <p
              data-testid="claim-ai-draft-title"
              style={{ margin: '0.5rem 0 0 0', fontWeight: 600 }}
            >
              {aiDraft.title}
            </p>
            <p
              data-testid="claim-ai-draft-body"
              style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
            >
              {aiDraft.body}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAcceptAiDraft}
                disabled={aiBusy}
                data-testid="claim-ai-accept"
              >
                Accept
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRejectAiDraft}
                disabled={aiBusy}
                data-testid="claim-ai-reject"
              >
                Reject
              </Button>
            </div>
          </div>
        ) : null}
      </section>
      )}

      <section data-testid="claims-list" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Claims</h2>
        {claims.length === 0 ? (
          <p data-testid="claims-empty" style={{ color: 'var(--color-text-secondary, #666)' }}>
            No Claims yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {claims.map((c) => {
              const claimLinks = linksByClaimId.get(c.id) ?? [];
              return (
                <li
                  key={c.id}
                  data-testid="claim-row"
                  data-claim-id={c.id}
                >
                  <Surface style={{ padding: '0.75rem 0.875rem', borderRadius: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={selectedClaims.has(c.id)}
                        onChange={() => {
                          setSelectedClaims((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          });
                        }}
                        data-testid="claim-select"
                        aria-label="Select claim for cognitive canvas"
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{c.title}</div>
                        <div
                          data-testid="claim-body-display"
                          style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
                        >
                          {c.body}
                        </div>
                      </div>
                    </div>
                    <ul
                      data-testid="claim-links"
                      style={{ marginTop: '0.5rem', padding: 0, listStyle: 'none' }}
                    >
                      {claimLinks.map((l) => {
                        const ev = evidence.find((e) => e.id === l.evidenceId);
                        const w = ev ? worksById.get(ev.workId) : null;
                        return (
                          <li
                            key={l.id}
                            data-testid="claim-link-row"
                            data-link-id={l.id}
                            data-relation={l.relation}
                            style={{ fontSize: '0.85rem' }}
                          >
                            <Pill data-testid="claim-link-relation">{l.relation}</Pill>{' '}
                            <span data-testid="claim-link-target">
                              {w?.title ?? ev?.workId ?? '?'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </Surface>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
