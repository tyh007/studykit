/**
 * StudyKit v0.4 — `features/research/Discovery`
 *
 * AI-native Literature Discovery surface. The user
 * types a question (or pastes a Research Question
 * from elsewhere); the natural-language question is
 * preserved alongside the structured `QuerySpec`. The
 * AI may fill the structured side; the user always
 * keeps the last word.
 *
 * Run / Re-run: a re-run creates a *new* `SearchRun`
 * with `runNumber + 1`; the previous run is preserved
 * for lineage. The host can switch between runs.
 *
 * Save / Maybe / Exclude: the user marks each
 * candidate. `Save` adds the Work to the project's
 * library (and persists a fresh `Work` if it's new);
 * `Maybe` and `Exclude` keep the candidate in the
 * store with the user's verdict and a free-text
 * reason. Both are reversible.
 *
 * Why this paper: each candidate carries a list of
 * reason chips (`matches-construct`, `recent-review`,
 * `open-access`, `high-citation`, etc.) and a
 * human-readable note for each. The provider never
 * invents a reason it can't justify.
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { Pill } from '../../shared/ui/Pill';
import { Surface } from '../../shared/ui/Surface';
import { useResearchDeps } from './researchContext';
import {
  runSearch,
  saveQuerySpec,
  saveWorkFromCandidate,
  setCandidateVerdict,
} from '../../application/research/researchUseCases';
import { buildSearchClause } from '../../application/research/openAlexProvider';
import { hashQuote, type QuerySpec, type ResearchProject, type SearchCandidate, type SearchRun } from '../../domain/research';

export interface DiscoveryProps {
  readonly projectId: string;
  readonly onClose: (projectId: string) => void;
  readonly onOpenLibrary: (projectId: string) => void;
}

const STRATEGY_OPTIONS: ReadonlyArray<{ value: QuerySpec['strategy']; label: string }> = [
  { value: 'explore', label: 'Explore' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'precise', label: 'Precise' },
  { value: 'review', label: 'Review' },
];

export function Discovery(props: DiscoveryProps): React.ReactElement {
  const deps = useResearchDeps();
  const [project, setProject] = React.useState<ResearchProject | null>(null);
  const [question, setQuestion] = React.useState('');
  const [concepts, setConcepts] = React.useState<Array<{ label: string; synonyms: string }>>([]);
  const [include, setInclude] = React.useState('');
  const [exclude, setExclude] = React.useState('');
  const [strategy, setStrategy] = React.useState<QuerySpec['strategy']>('explore');
  const [runs, setRuns] = React.useState<readonly SearchRun[]>([]);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<readonly SearchCandidate[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState<{ available: boolean; reason?: string } | null>(null);
  const ctlRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async (): Promise<void> => {
    const p = await deps.repository.getProject(props.projectId);
    setProject(p);
    if (p && question === '') {
      setQuestion(p.livingBrief);
    }
    const list = await deps.repository.listRuns({ projectId: props.projectId });
    setRuns(list);
    if (list[0]) setActiveRunId(list[0].id);
  }, [deps, props.projectId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    let cancelled = false;
    void deps.openAlex.probe().then((p) => {
      if (!cancelled) setProbe(p);
    });
    return () => {
      cancelled = true;
    };
  }, [deps.openAlex]);

  React.useEffect(() => {
    let cancelled = false;
    if (!activeRunId) {
      setCandidates([]);
      return;
    }
    void deps.repository.listCandidates({ runId: activeRunId }).then((list) => {
      if (!cancelled) setCandidates(list);
    });
    return () => {
      cancelled = true;
    };
  }, [activeRunId, deps.repository, runs.length]);

  const buildQuerySpec = (): QuerySpec => ({
    id: `qs_${Date.now().toString(36)}`,
    projectId: props.projectId,
    question,
    concepts: concepts
      .filter((c) => c.label.trim().length > 0)
      .map((c) => ({
        label: c.label.trim(),
        synonyms: c.synonyms.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
      })),
    includeTerms: include
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    excludeTerms: exclude
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    languages: ['en'],
    seedWorkIds: [],
    strategy,
    aiAssisted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const handleRun = async (): Promise<void> => {
    if (busy) return;
    if (!question.trim()) {
      setError('Add a question or paste a Research Question first.');
      return;
    }
    setBusy(true);
    setError(null);
    const ctl = new AbortController();
    ctlRef.current?.abort();
    ctlRef.current = ctl;
    try {
      // Persist the QuerySpec first so the lineage is
      // recorded even if the provider is unavailable.
      const spec = await saveQuerySpec(deps.repository, {
        projectId: props.projectId,
        question,
        concepts: buildQuerySpec().concepts,
        includeTerms: buildQuerySpec().includeTerms,
        excludeTerms: buildQuerySpec().excludeTerms,
        dateRange: undefined,
        languages: buildQuerySpec().languages,
        seedWorkIds: [],
        strategy,
        aiAssisted: false,
      });
      const { run, candidates: newCandidates } = await runSearch(deps.repository, {
        projectId: props.projectId,
        querySpec: spec,
        provider: deps.openAlex,
        signal: ctl.signal,
      });
      setActiveRunId(run.id);
      setCandidates(newCandidates);
      const list = await deps.repository.listRuns({ projectId: props.projectId });
      setRuns(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAbort = (): void => {
    ctlRef.current?.abort();
    setBusy(false);
  };

  const handleVerdict = async (
    candidate: SearchCandidate,
    verdict: 'saved' | 'maybe' | 'excluded',
    excludeReason?: string,
  ): Promise<void> => {
    try {
      if (verdict === 'saved') {
        await saveWorkFromCandidate(deps.repository, {
          candidateId: candidate.id,
          projectId: props.projectId,
        });
        return;
      }
      await setCandidateVerdict(deps.repository, {
        candidateId: candidate.id,
        userProjectId: props.projectId,
        verdict,
        ...(excludeReason ? { excludeReason } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save verdict.');
    }
  };

  return (
    <div
      data-testid="discovery"
      data-project-id={props.projectId}
      style={{ padding: '1rem', maxWidth: 1024, margin: '0 auto' }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Discovery</h1>
        <Pill data-testid="discovery-project-name">{project?.name ?? '…'}</Pill>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onClose(props.projectId)}
          data-testid="discovery-close"
        >
          Close
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onOpenLibrary(props.projectId)}
          data-testid="discovery-open-library"
        >
          Open library
        </Button>
      </header>

      {probe && !probe.available ? (
        <p
          role="status"
          data-testid="discovery-provider-unavailable"
          style={{
            margin: '0.5rem 0',
            color: 'var(--color-warning, #b80)',
            fontSize: '0.85rem',
          }}
        >
          OpenAlex is not reachable right now. You can still edit the QuerySpec and
          re-run when the provider comes back.
          {probe.reason ? ` Reason: ${probe.reason}` : ''}
        </p>
      ) : null}

      <Surface
        data-testid="discovery-query-spec"
        style={{ padding: '1rem', margin: '0.5rem 0', borderRadius: '0.5rem' }}
      >
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Query</h2>
        <label
          htmlFor="discovery-question"
          style={{ display: 'block', marginTop: '0.5rem' }}
        >
          <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
            Natural-language question
          </span>
          <textarea
            id="discovery-question"
            data-testid="discovery-question"
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
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
        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '2fr 2fr 1fr', marginTop: '0.5rem' }}>
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              Include (comma separated)
            </span>
            <Input
              data-testid="discovery-include"
              value={include}
              onChange={(e) => setInclude(e.currentTarget.value)}
              placeholder="sleep, memory"
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              Exclude (comma separated)
            </span>
            <Input
              data-testid="discovery-exclude"
              value={exclude}
              onChange={(e) => setExclude(e.currentTarget.value)}
              placeholder="review of reviews"
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              Strategy
            </span>
            <select
              data-testid="discovery-strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.currentTarget.value as QuerySpec['strategy'])}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                border: '1px solid var(--color-border, #ccc)',
                borderRadius: 'var(--radius-sm, 4px)',
                background: 'var(--color-bg, transparent)',
                color: 'var(--color-text, inherit)',
                font: 'inherit',
              }}
            >
              {STRATEGY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={handleRun}
            disabled={busy}
            data-testid="discovery-run"
          >
            {busy ? 'Running…' : 'Run / re-run'}
          </Button>
          {busy ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAbort}
              data-testid="discovery-abort"
            >
              Cancel
            </Button>
          ) : null}
          {error ? (
            <span
              role="alert"
              data-testid="discovery-error"
              style={{ color: 'var(--color-danger, #b00)', fontSize: '0.85rem' }}
            >
              {error}
            </span>
          ) : null}
        </div>
        <p
          data-testid="discovery-search-summary"
          style={{ margin: '0.5rem 0 0 0', color: 'var(--color-text-secondary, #666)', fontSize: '0.8rem' }}
        >
          Search clause: <code>{buildSearchClause(buildQuerySpec()) || '(empty)'}</code>
        </p>
      </Surface>

      <section
        data-testid="discovery-runs"
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        {runs.length === 0 ? (
          <span data-testid="discovery-runs-empty" style={{ color: 'var(--color-text-secondary, #666)' }}>
            No runs yet.
          </span>
        ) : (
          runs.map((r) => (
            <Button
              key={r.id}
              variant={r.id === activeRunId ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveRunId(r.id)}
              data-testid="discovery-run-button"
              data-run-id={r.id}
              data-run-status={r.status}
            >
              Run #{r.runNumber} · {r.status} · {r.totalHits} hits
            </Button>
          ))
        )}
      </section>

      <section data-testid="discovery-candidates" style={{ marginTop: '0.5rem' }}>
        {candidates.length === 0 ? (
          <p data-testid="discovery-candidates-empty" style={{ color: 'var(--color-text-secondary, #666)' }}>
            No candidates in this run.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {candidates.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                onVerdict={handleVerdict}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CandidateRow(props: {
  readonly candidate: SearchCandidate;
  readonly onVerdict: (
    candidate: SearchCandidate,
    verdict: 'saved' | 'maybe' | 'excluded',
    excludeReason?: string,
  ) => void | Promise<void>;
}): React.ReactElement {
  const c = props.candidate;
  const [excludeReason, setExcludeReason] = React.useState('');
  return (
    <li
      data-testid="discovery-candidate-row"
      data-candidate-id={c.id}
      data-verdict={c.verdict}
      style={{
        padding: '0.75rem 0.875rem',
        border: '1px solid var(--color-border, #ccc)',
        borderRadius: 'var(--radius-sm, 4px)',
        background: 'var(--color-bg, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{c.work.title}</div>
          <div
            data-testid="discovery-candidate-authors"
            style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
          >
            {c.work.authors.join(', ')}
            {c.work.year ? ` · ${c.work.year}` : ''}
            {c.work.venue ? ` · ${c.work.venue}` : ''}
          </div>
          <div
            data-testid="discovery-candidate-id"
            style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.75rem' }}
          >
            {c.work.identifiers.doi ? `DOI: ${c.work.identifiers.doi}` : c.work.id}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
          <span data-testid="discovery-candidate-chips" style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {c.reasonChips.map((chip) => (
              <Pill key={chip} data-testid={`chip-${chip}`}>
                {chip}
              </Pill>
            ))}
          </span>
          <span data-testid="discovery-candidate-verdict" style={{ fontSize: '0.8rem' }}>
            Verdict: <strong>{c.verdict}</strong>
          </span>
        </div>
      </div>
      {c.reasonNotes.length > 0 ? (
        <ul
          data-testid="discovery-candidate-notes"
          style={{ margin: '0.5rem 0 0 0', padding: 0, listStyle: 'none', color: 'var(--color-text-secondary, #666)', fontSize: '0.85rem' }}
        >
          {c.reasonNotes.map((n, i) => (
            <li key={i}>— {n}</li>
          ))}
        </ul>
      ) : null}
      {c.verdict === 'excluded' && c.excludeReason ? (
        <p
          data-testid="discovery-candidate-exclude-reason"
          style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary, #666)' }}
        >
          Exclude reason: {c.excludeReason}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => props.onVerdict(c, 'saved')}
          data-testid="discovery-candidate-save"
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onVerdict(c, 'maybe')}
          data-testid="discovery-candidate-maybe"
        >
          Maybe
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onVerdict(c, 'excluded', excludeReason || 'no reason given')}
          data-testid="discovery-candidate-exclude"
        >
          Exclude
        </Button>
        <Input
          data-testid="discovery-candidate-exclude-reason-input"
          value={excludeReason}
          onChange={(e) => setExcludeReason(e.currentTarget.value)}
          placeholder="exclude reason (optional)"
        />
        {c.verdict !== 'pending' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onVerdict(c, 'maybe')}
            data-testid="discovery-candidate-restore"
          >
            Restore to Maybe
          </Button>
        ) : null}
      </div>
    </li>
  );
}
