/**
 * StudyKit v0.5 P5 — a disagreement as a first-class object.
 *
 * State what's in dispute, put each view side by side with the checked
 * excerpts behind it, then settle it in writing. A view can only
 * prevail with evidence. Settled disagreements stay as a record.
 */

import React from 'react';
import './thinking.css';
import { useResearchDeps } from './researchContext';
import { ExcerptPicker } from './ArgumentEditor';
import {
  addPosition,
  attachEvidence,
  detachEvidence,
  settleDisagreement,
} from '../../application/research/brainstorm';
import type { Disagreement, DisagreementPosition } from '../../domain/brainstorm';
import type { Claim, Evidence } from '../../domain/research';
import { Button } from '../../shared/ui/Button';

export interface DisagreementEditorProps {
  readonly disagreementId: string;
  readonly userId: string;
  readonly onOpenSource: (input: { workId: string; pageNumber?: number }) => void;
  readonly onOpenPoint: (claimId: string) => void;
  readonly onOpenSources: () => void;
}

interface Data {
  readonly loaded: boolean;
  readonly disagreement: Disagreement | null;
  readonly positions: readonly DisagreementPosition[];
  readonly evidence: readonly Evidence[];
  readonly works: readonly { id: string; title: string }[];
  readonly claim: Claim | null;
}

function useDisagreement(disagreementId: string): Data {
  const { repository } = useResearchDeps();
  const [data, setData] = React.useState<Data>({ loaded: false, disagreement: null, positions: [], evidence: [], works: [], claim: null });
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const disagreement = await repository.getDisagreement(disagreementId);
      if (!disagreement) {
        if (!cancelled) setData((d) => ({ ...d, loaded: true, disagreement: null }));
        return;
      }
      const projectId = disagreement.projectId;
      const [positions, evidence, works, claim] = await Promise.all([
        repository.listDisagreementPositions({ disagreementId }),
        repository.listEvidence({ projectId }),
        repository.listWorks({ projectId }),
        disagreement.claimId ? repository.getClaim(disagreement.claimId) : Promise.resolve(null),
      ]);
      if (!cancelled) {
        setData({
          loaded: true,
          disagreement,
          positions,
          evidence,
          works: works.map((w) => ({ id: w.id, title: w.title || 'Untitled source' })),
          claim,
        });
      }
    };
    void refresh().catch(() => !cancelled && setData((d) => ({ ...d, loaded: true })));
    const off = repository.subscribe(() => void refresh().catch(() => undefined));
    return () => {
      cancelled = true;
      off();
    };
  }, [disagreementId, repository]);
  return data;
}

export function DisagreementEditor(props: DisagreementEditorProps): React.ReactElement {
  const { disagreementId } = props;
  const { repository } = useResearchDeps();
  const deps = React.useMemo(() => ({ userId: props.userId }), [props.userId]);
  const data = useDisagreement(disagreementId);
  const [stance, setStance] = React.useState('');
  const [holder, setHolder] = React.useState('');
  const [winner, setWinner] = React.useState<string | null | undefined>(undefined);
  const [summary, setSummary] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Something went wrong.');
      return false;
    }
  };

  if (!data.loaded) return <p className="thinking-muted">Loading…</p>;
  const d = data.disagreement;
  if (!d) return <p className="thinking-muted">This disagreement no longer exists.</p>;
  const open = d.status === 'open';
  const byId = new Map(data.evidence.map((e) => [e.id, e]));
  const title = (workId: string): string => data.works.find((w) => w.id === workId)?.title ?? 'Untitled source';
  const positionLabel = (p: DisagreementPosition): string => (p.holder ? `${p.stance} — ${p.holder}` : p.stance);

  return (
    <div className="thinking disagreement" data-testid="disagreement-editor">
      <header className="thinking-header">
        <p className="thinking-kicker">
          Disagreement · <span data-testid="disagreement-status">{open ? 'Open' : 'Settled'}</span>
        </p>
        <h1 className="thinking-title">{d.question}</h1>
        {data.claim ? (
          <p className="thinking-muted">
            About{' '}
            <button type="button" className="thinking-link" onClick={() => props.onOpenPoint(data.claim!.id)}>
              {data.claim.title}
            </button>
          </p>
        ) : null}
      </header>

      {error ? (
        <p className="thinking-error" role="alert">
          {error}
        </p>
      ) : null}

      {!open && d.outcome ? (
        <section className="disagreement-outcome" data-testid="disagreement-outcome">
          <h2>Outcome</h2>
          <p>{d.outcome.summary}</p>
          <p className="thinking-muted">
            {d.outcome.positionId
              ? `The view that held up: ${positionLabel(data.positions.find((p) => p.id === d.outcome!.positionId) ?? ({ stance: 'a removed view', holder: '' } as DisagreementPosition))}`
              : 'Neither view prevailed outright.'}{' '}
            · Settled {new Date(d.outcome.settledAt).toLocaleDateString()}
          </p>
        </section>
      ) : null}

      <ol className="disagreement-positions">
        {data.positions.map((p) => (
          <PositionCard
            key={p.id}
            position={p}
            open={open}
            evidence={data.evidence}
            byId={byId}
            works={data.works}
            title={title}
            isWinner={d.outcome?.positionId === p.id}
            onOpenSource={props.onOpenSource}
            onOpenSources={props.onOpenSources}
            onAttach={(evidenceId) => run(() => attachEvidence(repository, { disagreementId, positionId: p.id, evidenceId }))}
            onDetach={(evidenceId) => run(() => detachEvidence(repository, { disagreementId, positionId: p.id, evidenceId }))}
          />
        ))}
      </ol>

      {open ? (
        <>
          <form
            className="disagreement-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!stance.trim()) return;
              const [s0, h0] = [stance, holder];
              setStance('');
              setHolder('');
              void run(() => addPosition(repository, { disagreementId, stance: s0, holder: h0 }, deps)).then((ok) => {
                if (!ok) {
                  setStance(s0);
                  setHolder(h0);
                }
              });
            }}
          >
            <input
              value={stance}
              onChange={(e) => setStance(e.target.value)}
              placeholder={data.positions.length === 0 ? 'One view, in a sentence' : 'Another view'}
              aria-label="View"
              data-testid="disagreement-stance"
            />
            <input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              placeholder="Whose view? (optional)"
              aria-label="Whose view"
              data-testid="disagreement-holder"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!stance.trim()} data-testid="disagreement-add-position">
              Add view
            </Button>
          </form>

          {data.positions.length > 0 ? (
            <section className="disagreement-settle" aria-label="Settle" data-testid="disagreement-settle">
              <h2>Settle it</h2>
              <fieldset>
                <legend>Which view holds up?</legend>
                {data.positions.map((p) => (
                  <label key={p.id} className={p.evidenceIds.length === 0 ? 'is-disabled' : undefined}>
                    <input
                      type="radio"
                      name="winner"
                      checked={winner === p.id}
                      disabled={p.evidenceIds.length === 0}
                      onChange={() => setWinner(p.id)}
                    />
                    {positionLabel(p)}
                    {p.evidenceIds.length === 0 ? <span className="thinking-muted"> (needs evidence)</span> : null}
                  </label>
                ))}
                <label>
                  <input type="radio" name="winner" checked={winner === null} onChange={() => setWinner(null)} data-testid="disagreement-neither" />
                  Neither outright / both in part
                </label>
              </fieldset>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="What did you decide, and why?"
                aria-label="Outcome"
                data-testid="disagreement-summary"
              />
              <Button
                variant="primary"
                disabled={winner === undefined || !summary.trim()}
                onClick={() =>
                  void run(() => settleDisagreement(repository, { disagreementId, summary, positionId: winner ?? null }, deps))
                }
                data-testid="disagreement-settle-button"
              >
                Settle and keep on record
              </Button>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PositionCard(props: {
  readonly position: DisagreementPosition;
  readonly open: boolean;
  readonly evidence: readonly Evidence[];
  readonly byId: ReadonlyMap<string, Evidence>;
  readonly works: readonly { id: string; title: string }[];
  readonly title: (workId: string) => string;
  readonly isWinner: boolean;
  readonly onOpenSource: (input: { workId: string; pageNumber?: number }) => void;
  readonly onOpenSources: () => void;
  readonly onAttach: (evidenceId: string) => Promise<boolean>;
  readonly onDetach: (evidenceId: string) => Promise<boolean>;
}): React.ReactElement {
  const p = props.position;
  const [picking, setPicking] = React.useState(false);
  return (
    <li className={`disagreement-position${props.isWinner ? ' is-winner' : ''}`} data-testid="disagreement-position">
      <p className="disagreement-stance">{p.stance}</p>
      {p.holder ? <p className="thinking-muted">— {p.holder}</p> : null}
      {p.evidenceIds.length > 0 ? (
        <ul className="disagreement-evidence">
          {p.evidenceIds.map((id) => {
            const e = props.byId.get(id);
            if (!e) return null;
            return (
              <li key={id} data-testid="disagreement-evidence">
                <button
                  type="button"
                  className="disagreement-evidence-open"
                  onClick={() => props.onOpenSource({ workId: e.workId, ...(e.locator.pageNumber ? { pageNumber: e.locator.pageNumber } : {}) })}
                >
                  <span>“{e.exactQuote.length > 160 ? `${e.exactQuote.slice(0, 160)}…` : e.exactQuote}”</span>
                  <span className="thinking-muted">
                    {props.title(e.workId)}
                    {e.locator.pageNumber ? `, p. ${e.locator.pageNumber}` : ''}
                  </span>
                </button>
                {props.open ? (
                  <button type="button" className="thinking-icon" aria-label="Remove excerpt" onClick={() => void props.onDetach(id)}>
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="thinking-gap">No evidence behind this view yet.</p>
      )}
      {props.open ? (
        <button type="button" className="thinking-link" onClick={() => setPicking((v) => !v)} aria-expanded={picking} data-testid="disagreement-back">
          + Back with an excerpt
        </button>
      ) : null}
      {picking ? (
        <ExcerptPicker
          evidence={props.evidence}
          works={props.works}
          exclude={new Set(p.evidenceIds)}
          onPick={(evidenceId) => void props.onAttach(evidenceId).then((ok) => ok && setPicking(false))}
          onPeek={(workId) => props.onOpenSource({ workId })}
          onOpenSources={props.onOpenSources}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </li>
  );
}
