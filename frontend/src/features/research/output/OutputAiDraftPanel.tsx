/**
 * StudyKit v0.4 — `features/research/output/OutputAiDraftPanel`
 *
 * Pure presentational panel for the AI draft flow.
 * The component owns local UI state (which draft is
 * currently held, which accept / reject button was
 * clicked last) but delegates every write to
 * `application/output/outputAiDraftUseCases` and
 * every read to the `useResearchDeps()` repository.
 *
 * Reuse over reinvention:
 *
 *   - The Draft Layer is the existing kernel
 *     (`features/ai/kernel/draftLayer`); no new
 *     storage.
 *   - The Provider Router is the existing
 *     `features/ai/kernel/providerRouter`; no new
 *     chat protocol.
 *
 * Out of scope (Round 1):
 *
 *   - Citation generation.
 *   - Multi-statement drafts (one draft = one
 *     statement in Round 1; UI accepts and writes
 *     that single statement + its supports).
 *   - Streaming / partial accept.
 */

import React from 'react';
import { useResearchDeps } from '../researchContext';
import { draftLayer } from '../../../features/ai/kernel/draftLayer';
import type { ProviderRouter } from '../../../features/ai/kernel/providerRouter';
import type { OutputSection } from '../../../domain/output';
import type { Claim, Evidence } from '../../../domain/research';
import {
  acceptOutputDraft,
  draftOutputStatements,
  rejectOutputDraft,
  type DraftOutputStatementsResult,
} from '../../../application/output/outputAiDraftUseCases';
import { Button } from '../../../shared/ui/Button';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';

export interface OutputAiDraftPanelProps {
  readonly outputId: string;
  readonly sections: readonly OutputSection[];
  readonly projectId: string;
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
}

export function OutputAiDraftPanel(props: OutputAiDraftPanelProps): React.ReactElement | null {
  const deps = useResearchDeps();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<DraftOutputStatementsResult | null>(null);
  const [accepting, setAccepting] = React.useState(false);
  const [rejected, setRejected] = React.useState(false);
  const [sectionId, setSectionId] = React.useState(props.sections[0]?.id ?? '');
  const [selectedRefs, setSelectedRefs] = React.useState<ReadonlySet<string>>(
    new Set(),
  );

  React.useEffect(() => {
    if (!props.sections.some((section) => section.id === sectionId)) {
      setSectionId(props.sections[0]?.id ?? '');
    }
  }, [props.sections, sectionId]);

  const selectedClaimIds = props.claims
    .filter((claim) => selectedRefs.has(`claim:${claim.id}`))
    .map((claim) => claim.id);
  const selectedEvidenceIds = props.evidence
    .filter((evidence) => selectedRefs.has(`evidence:${evidence.id}`))
    .map((evidence) => evidence.id);
  const ready = selectedClaimIds.length + selectedEvidenceIds.length > 0;
  if (!deps.repository) return null;
  if (!deps.providerRouter) return null;

  const providerRouter: ProviderRouter = deps.providerRouter;

  const onDraft = async () => {
    if (!sectionId) {
      setError('Add a section first — the AI draft targets a single section.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await draftOutputStatements(deps.repository!, {
        projectId: props.projectId,
        outputId: props.outputId,
        sectionId,
        selectedClaimIds,
        selectedEvidenceIds,
        providerRouter,
      });
      setResult(r);
      setRejected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async () => {
    if (!result) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptOutputDraft({
        draftId: result.draft.id,
        repository: deps.repository!,
      });
      setSelectedRefs(new Set());
      setResult(null);
      setRejected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  };

  const onReject = () => {
    if (!result) return;
    rejectOutputDraft({ draftId: result.draft.id });
    setRejected(true);
    setResult(null);
    setSelectedRefs(new Set());
  };

  const toggleRef = (key: string) => {
    setSelectedRefs((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onEditDraft = (nextBody: string) => {
    if (!result || result.draft.body.kind !== 'note-draft') return;
    const updatedDraft = draftLayer.updateBody(
      result.draft.id,
      { ...result.draft.body, body: nextBody },
      result.draft.title,
    );
    setResult({
      ...result,
      draft: updatedDraft,
      candidates: result.candidates.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              statement: { ...candidate.statement, body: nextBody },
            }
          : candidate,
      ),
    });
  };

  return (
    <Surface
      level="floating"
      glass
      style={{ padding: '0.75rem', marginBottom: '0.75rem' }}
      data-testid="output-ai-draft-panel"
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <strong>AI draft</strong>
        <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>
          Drafts one statement from your selected evidence. The text never becomes canonical until you Accept.
        </span>
      </header>

      {!result && (
        <>
          <details style={{ marginTop: '0.5rem' }}>
            <summary>
              Choose context ({selectedClaimIds.length + selectedEvidenceIds.length})
            </summary>
            <div data-testid="output-ai-context-picker">
              {props.claims.map((claim) => (
                <label key={`claim:${claim.id}`} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={selectedRefs.has(`claim:${claim.id}`)}
                    onChange={() => toggleRef(`claim:${claim.id}`)}
                    aria-label={`Use claim ${claim.title}`}
                  />{' '}
                  Claim · {claim.title}
                </label>
              ))}
              {props.evidence.map((evidence) => (
                <label key={`evidence:${evidence.id}`} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={selectedRefs.has(`evidence:${evidence.id}`)}
                    onChange={() => toggleRef(`evidence:${evidence.id}`)}
                    aria-label={`Use evidence ${evidence.id}`}
                  />{' '}
                  Evidence · {evidence.exactQuote.slice(0, 100)}
                </label>
              ))}
            </div>
          </details>
          <div
            style={{
              marginTop: '0.5rem',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            {props.sections.length > 1 && (
              <label>
                Section{' '}
                <select
                  value={sectionId}
                  onChange={(event) => setSectionId(event.target.value)}
                  disabled={busy}
                  aria-label="AI draft target section"
                  data-testid="output-ai-draft-section"
                >
                  {props.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={!ready || !sectionId || busy}
              onClick={() => void onDraft()}
              data-testid="output-ai-draft-button"
            >
              {busy ? 'Drafting…' : 'Draft from selected evidence'}
            </Button>
            {!ready && (
              <span style={{ opacity: 0.6 }} data-testid="output-ai-draft-empty">
                Select at least one accepted Claim or verified Evidence first.
              </span>
            )}
          </div>
        </>
      )}

      {result && !rejected && (
        <div style={{ marginTop: '0.5rem' }} data-testid="output-ai-draft-result">
          <Pill tone="info">
            {result.draft.provenance.provider} · {result.draft.provenance.model ?? 'unknown model'}
          </Pill>
          <textarea
            value={
              result.draft.body.kind === 'note-draft'
                ? result.draft.body.body
                : result.candidates[0]?.statement.body ?? ''
            }
            onChange={(event) => onEditDraft(event.target.value)}
            aria-label="Edit AI draft statement"
            style={{
              whiteSpace: 'pre-wrap',
              padding: '0.5rem',
              border: '1px solid currentColor',
              borderRadius: '0.5rem',
              marginTop: '0.5rem',
              maxHeight: '12rem',
              overflow: 'auto',
              width: '100%',
              minHeight: '8rem',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
            }}
            data-testid="output-ai-draft-body"
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <Button
              variant="primary"
              size="sm"
              disabled={accepting}
              onClick={() => void onAccept()}
              data-testid="output-ai-draft-accept"
            >
              {accepting ? 'Accepting…' : 'Accept'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={accepting}
              onClick={onReject}
              data-testid="output-ai-draft-reject"
            >
              Reject
            </Button>
            <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>
              Draft {result.draft.id.slice(0, 12)}…
            </span>
          </div>
        </div>
      )}

      {rejected && (
        <p style={{ marginTop: '0.5rem', opacity: 0.6 }} data-testid="output-ai-draft-rejected">
          Draft rejected. You can start a fresh draft anytime.
        </p>
      )}

      {error && (
        <p
          style={{ marginTop: '0.5rem' }}
          role="alert"
          data-testid="output-ai-draft-error"
        >
          <Pill tone="error">AI draft failed</Pill>
          <span style={{ marginLeft: '0.5rem' }}>{error}</span>
        </p>
      )}
    </Surface>
  );
}

export { draftLayer };
