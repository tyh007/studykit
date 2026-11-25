/**
 * StudyKit v0.4 — `features/research/project-home/LineageColumns`
 *
 * Two side-by-side "Recent Evidence" / "Recent Claims"
 * columns. Pure presentation; the host supplies the
 * pre-sliced lists.
 */

import React from 'react';
import { Surface } from '../../../shared/ui/Surface';
import type { Claim, Evidence, Work } from '../../../domain/research';

export interface LineageColumnsProps {
  readonly recentEvidence: readonly Evidence[];
  readonly recentClaims: readonly Claim[];
  readonly worksById: ReadonlyMap<string, Work>;
  readonly onOpenReader: (workId: string) => void;
}

export function LineageColumns(props: LineageColumnsProps): React.ReactElement {
  return (
    <section
      data-testid="project-home-lineage"
      className="rd-grid-2"
      style={{ marginTop: '0.5rem' }}
    >
      <LineageColumn
        title="Recent Evidence"
        emptyText="No Evidence yet."
        testIdPrefix="project-home-evidence"
        rows={props.recentEvidence.map((e) => ({
          id: e.id,
          primary:
            e.exactQuote.length > 80
              ? `${e.exactQuote.slice(0, 80).trim()}…`
              : e.exactQuote,
          secondary: `${e.evidenceType} · ${e.status} · ${props.worksById.get(e.workId)?.title ?? 'unknown'}`,
          onOpen: () => props.onOpenReader(e.workId),
        }))}
      />
      <LineageColumn
        title="Recent Claims"
        emptyText="No Claims yet."
        testIdPrefix="project-home-claim"
        rows={props.recentClaims.map((c) => ({
          id: c.id,
          primary: c.title,
          secondary: c.body.length > 80 ? `${c.body.slice(0, 80).trim()}…` : c.body,
        }))}
      />
    </section>
  );
}

function LineageColumn(props: {
  readonly title: string;
  readonly emptyText: string;
  readonly testIdPrefix: string;
  readonly rows: ReadonlyArray<{
    id: string;
    primary: string;
    secondary: string;
    onOpen?: () => void;
  }>;
}): React.ReactElement {
  return (
    <Surface
      data-testid={`${props.testIdPrefix}-column`}
      style={{ padding: '0.75rem', borderRadius: '0.5rem' }}
    >
      <h3 className="rd-h3">{props.title}</h3>
      {props.rows.length === 0 ? (
        <p
          data-testid={`${props.testIdPrefix}-empty`}
          className="rd-dep-empty"
        >
          {props.emptyText}
        </p>
      ) : (
        <ul className="rd-list">
          {props.rows.map((r) => (
            <li
              key={r.id}
              data-testid={`${props.testIdPrefix}-row`}
              data-row-id={r.id}
              className={`rd-list-item ${r.onOpen ? 'rd-list-item-clickable' : ''}`}
              onClick={r.onOpen}
            >
              <div style={{ fontWeight: 500 }}>{r.primary}</div>
              <div className="rd-list-item-meta">{r.secondary}</div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
