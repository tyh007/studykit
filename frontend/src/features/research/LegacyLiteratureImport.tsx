/**
 * StudyKit v0.5 P7a — "From the old literature hub" on the Research home
 * page (ADR-004). Lists legacy projects; one click brings a project in
 * and says plainly what came across, what was left out and why.
 */

import React from 'react';
import { useResearchDeps } from './researchContext';
import {
  importLegacyProject,
  listLegacyProjects,
  type LegacyImportReport,
  type LegacyLiteratureSource,
  type LegacyProjectEntry,
} from '../../application/research/importLegacyLiterature';
import { Button } from '../../shared/ui/Button';
import { Surface } from '../../shared/ui/Surface';

export interface LegacyLiteratureImportProps {
  readonly source: LegacyLiteratureSource;
  readonly userId: string;
  readonly onOpenProject: (projectId: string) => void;
}

const n = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

export function describeImport(r: LegacyImportReport): { brought: string; left: string | null } {
  const parts = [
    n(r.works.added + r.works.alreadyThere, 'paper'),
    r.excerpts ? `${n(r.excerpts, 'highlight')} as excerpts to check` : '',
    r.notes ? n(r.notes, 'note') : '',
    r.relations ? n(r.relations, 'link', 'links') + ' between papers' : '',
    r.aiSummaries ? n(r.aiSummaries, 'AI summary', 'AI summaries') + ' (in the AI panel, unchecked)' : '',
  ].filter(Boolean);
  const left = [
    r.skipped.trashedPapers ? `${n(r.skipped.trashedPapers, 'paper')} in the trash` : '',
    r.skipped.highlightsWithoutText ? `${n(r.skipped.highlightsWithoutText, 'highlight')} with no text to quote` : '',
    r.skipped.drawings ? n(r.skipped.drawings, 'drawing') : '',
    r.unavailable.length ? `${r.unavailable.join(', ')} (sign in to a sync workspace to bring these too)` : '',
  ].filter(Boolean);
  return { brought: `Brought in ${parts.join(', ')}.`, left: left.length ? `Left out: ${left.join('; ')}.` : null };
}

export function LegacyLiteratureImport(props: LegacyLiteratureImportProps): React.ReactElement | null {
  const { repository } = useResearchDeps();
  const [entries, setEntries] = React.useState<readonly LegacyProjectEntry[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reports, setReports] = React.useState<Readonly<Record<string, LegacyImportReport>>>({});
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    void listLegacyProjects(repository, props.source)
      .then(setEntries)
      .catch(() => setEntries([])); // No hub here: show nothing.
  }, [repository, props.source]);
  React.useEffect(refresh, [refresh]);

  if (entries.length === 0) return null;

  const bring = async (legacyId: string): Promise<void> => {
    setBusy(legacyId);
    setError(null);
    try {
      const report = await importLegacyProject(repository, props.source, { legacyProjectId: legacyId, userId: props.userId });
      setReports((r) => ({ ...r, [legacyId]: report }));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Could not bring that project in.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Surface level="sunken" data-testid="legacy-import" style={{ padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem' }}>From the old literature hub</h2>
      <p style={{ margin: '0 0 0.75rem 0', color: 'var(--color-text-secondary, #666)', fontSize: '0.9rem' }}>
        Bring a project in to keep working on it here. Your papers, notes and highlights come along; highlights and AI summaries arrive
        unchecked, so nothing counts until you check it.
      </p>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-danger, #b00)', fontSize: '0.85rem' }}>
          {error}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
        {entries.map((e) => {
          const report = reports[e.legacyId];
          const text = report ? describeImport(report) : null;
          return (
            <li key={e.legacyId} data-testid="legacy-import-project" style={{ display: 'grid', gap: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
                <span>{e.name}</span>
                {e.projectId ? (
                  <Button variant="secondary" size="sm" onClick={() => props.onOpenProject(e.projectId!)} data-testid="legacy-import-open">
                    Open
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => void bring(e.legacyId)} data-testid="legacy-import-bring">
                    {busy === e.legacyId ? 'Bringing it in…' : 'Bring it in'}
                  </Button>
                )}
              </div>
              {text ? (
                <p data-testid="legacy-import-report" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary, #666)' }}>
                  {text.brought}
                  {text.left ? ` ${text.left}` : ''}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}
