/**
 * StudyKit v0.5 P6 — the provenance report for one piece of writing:
 * the AI use statement, where the text came from, evidence coverage,
 * and every paragraph with the excerpts behind it. Download as Markdown
 * (to attach) or JSON (for tools), or print to PDF.
 */

import React from 'react';
import './provenance.css';
import { useResearchDeps } from './researchContext';
import { loadProvenanceReport, reportToJson, reportToMarkdown, type ProvenanceReport } from '../../application/research/provenanceReport';
import { SENTENCE_SOURCES, SENTENCE_SOURCE_LABEL } from '../../domain/provenance';
import { Button } from '../../shared/ui/Button';

export interface ProvenanceReportViewProps {
  readonly outputId: string;
  readonly onOpenOutput: () => void;
  readonly onOpenSource: (input: { workId: string; pageNumber?: number }) => void;
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const fileBase = (title: string): string => `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'writing'}-provenance`;

export function ProvenanceReportView(props: ProvenanceReportViewProps): React.ReactElement {
  const { repository } = useResearchDeps();
  const [report, setReport] = React.useState<ProvenanceReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void loadProvenanceReport(repository, props.outputId)
        .then((r) => !cancelled && setReport(r))
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Could not build the report.'));
    };
    refresh();
    const off = repository.subscribe(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [repository, props.outputId]);

  if (error) return <p className="provenance-muted" role="alert">{error}</p>;
  if (!report) return <p className="provenance-muted">Building the report…</p>;
  const { coverage } = report;
  const pct = (n: number): number => (coverage.sentences ? Math.round((n / coverage.sentences) * 100) : 0);

  return (
    <div className="provenance" data-testid="provenance-report">
      <header className="provenance-header">
        <p className="provenance-kicker">Provenance report</p>
        <h1>{report.title}</h1>
        <p className="provenance-muted">
          Built from what StudyKit recorded as you worked. A paragraph’s source is set when it is first written; editing it later doesn’t change it.
        </p>
        <div className="provenance-actions">
          <Button variant="primary" size="sm" onClick={() => download(`${fileBase(report.title)}.md`, reportToMarkdown(report), 'text/markdown')} data-testid="provenance-download-md">
            Download (Markdown)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => download(`${fileBase(report.title)}.json`, reportToJson(report), 'application/json')} data-testid="provenance-download-json">
            Download data (JSON)
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            Print or save as PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenOutput}>
            Back to the text
          </Button>
        </div>
      </header>

      <section className="provenance-section" aria-label="AI use statement">
        <h2>AI use statement</h2>
        <p data-testid="provenance-ai-statement">{report.aiStatement}</p>
        <button
          type="button"
          className="provenance-link"
          onClick={() =>
            void navigator.clipboard
              .writeText(report.aiStatement)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copied' : 'Copy the statement'}
        </button>
      </section>

      <section className="provenance-section provenance-summary" aria-label="Summary">
        <div>
          <h2>Where the text came from</h2>
          <ul className="provenance-legend" data-testid="provenance-by-source">
            {SENTENCE_SOURCES.filter((k) => report.bySource[k] > 0).map((k) => (
              <li key={k}>
                <span className={`provenance-dot provenance-dot--${k}`} aria-hidden="true" />
                {SENTENCE_SOURCE_LABEL[k]}: <strong>{report.bySource[k]}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Evidence coverage</h2>
          <p data-testid="provenance-coverage">
            <strong>
              {coverage.backed} of {coverage.sentences}
            </strong>{' '}
            paragraphs ({pct(coverage.backed)}%) are backed by checked excerpts.
          </p>
          {coverage.contested + coverage.unbacked + coverage.broken > 0 ? (
            <p className="provenance-muted">
              {[
                coverage.contested ? `${coverage.contested} with evidence for and against` : '',
                coverage.unbacked ? `${coverage.unbacked} without a checked excerpt` : '',
                coverage.broken ? `${coverage.broken} citing something removed` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </section>

      <section className="provenance-section" aria-label="Paragraph by paragraph">
        <h2>Paragraph by paragraph</h2>
        <ol className="provenance-sentences">
          {report.sentences.map((s) => (
            <li key={s.statementId} className={`provenance-sentence provenance-sentence--${s.source}`} data-testid="provenance-sentence">
              {s.section ? <p className="provenance-kicker">{s.section}</p> : null}
              <p className="provenance-text">{s.text}</p>
              <p className="provenance-meta" data-testid="provenance-sentence-source">
                <span className={`provenance-dot provenance-dot--${s.source}`} aria-hidden="true" />
                {SENTENCE_SOURCE_LABEL[s.source]}
                {s.ai ? ` · ${s.ai.model ? `${s.ai.provider} (${s.ai.model})` : s.ai.provider}` : ''}
                {s.source === 'ai-edited' && s.aiWordsKept !== undefined ? ` · ${Math.round(s.aiWordsKept * 100)}% of the AI’s words kept` : ''}
                {s.pointFromAi ? ' · point first suggested by the AI' : ''}
              </p>
              {s.excerpts.length > 0 ? (
                <ul className="provenance-excerpts">
                  {s.excerpts.map((e) => (
                    <li key={e.evidenceId}>
                      <button
                        type="button"
                        className="provenance-excerpt"
                        onClick={() => props.onOpenSource({ workId: e.source.workId, ...(e.pageNumber ? { pageNumber: e.pageNumber } : {}) })}
                      >
                        <span>
                          “{e.quote}”{e.relation === 'contradicts' ? ' (against)' : e.relation === 'qualifies' ? ' (limits)' : ''}
                        </span>
                        <span className="provenance-muted">
                          {e.source.title}
                          {e.pageNumber ? `, p. ${e.pageNumber}` : ''}
                          {e.checked ? '' : ' · not checked'}
                          {e.suggestedByAi ? ' · proposed by the AI, checked by you' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="provenance-gap">No checked excerpt behind this paragraph.</p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
