/**
 * StudyKit v0.5 P4 — what the partner sees (ADR-003 §6).
 *
 * Context follows the user's focus: the open editor first, then the
 * project. Each item becomes a visible, removable chip, and is stored
 * on the message exactly as sent.
 */

import type { AiContextRef } from '../../domain/aiThread';
import type { Claim, ClaimEvidenceLink, Evidence } from '../../domain/research';
import { buildArgument } from './argument';
import { clampExcerpt } from './aiPartner';

export interface AiContextSource {
  readonly projectName: string;
  readonly question: string;
  readonly works: readonly { readonly id: string; readonly title: string }[];
  readonly outputs: readonly { readonly id: string; readonly title: string }[];
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly links: readonly ClaimEvidenceLink[];
}

export interface FocusedEditor {
  readonly kind: string;
  readonly id: string;
}

const page = (e: Evidence): string => (e.locator.pageNumber ? `, p. ${e.locator.pageNumber}` : '');

function argumentOutline(src: AiContextSource): string {
  const view = buildArgument({ claims: src.claims, evidence: src.evidence, links: src.links, works: src.works });
  if (view.points.length === 0) return 'No points yet.';
  return view.points
    .map((p, i) => {
      const cite = (list: readonly { quote: string; workTitle: string; pageNumber?: number }[]): string =>
        list.length === 0
          ? '(empty)'
          : list.map((c) => `“${c.quote.slice(0, 200)}” (${c.workTitle}${c.pageNumber ? `, p. ${c.pageNumber}` : ''})`).join('; ');
      return [
        `${i + 1}. ${p.claim.title}`,
        `   Evidence: ${cite(p.evidence)}`,
        `   Why it holds: ${p.reasoning || '(empty)'}`,
        `   Against it: ${p.noCounter ? 'looked, none found' : cite(p.counter)}`,
        `   Limits: ${p.noLimits ? 'looked, none found' : cite(p.limits)}`,
      ].join('\n');
    })
    .join('\n');
}

/** Context chips for the focused editor, most specific first. */
export function contextForFocus(src: AiContextSource, focus: FocusedEditor | null): AiContextRef[] {
  const refs: AiContextRef[] = [];
  if (focus?.kind === 'argument') {
    refs.push({ kind: 'argument', objectId: focus.id, label: 'Your argument', locator: null, excerpt: clampExcerpt(argumentOutline(src)) });
  } else if (focus?.kind === 'work') {
    const title = src.works.find((w) => w.id === focus.id)?.title ?? 'Source';
    const excerpts = src.evidence
      .filter((e) => e.workId === focus.id && e.status !== 'rejected')
      .map((e) => `“${e.exactQuote}”${page(e)}${e.userInterpretation ? ` — ${e.userInterpretation}` : ''}`);
    refs.push({
      kind: 'work',
      objectId: focus.id,
      label: title,
      locator: null,
      excerpt: clampExcerpt(excerpts.length > 0 ? `Your excerpts from this source:\n${excerpts.join('\n')}` : 'No excerpts from this source yet.'),
    });
  } else if (focus?.kind === 'output') {
    const title = src.outputs.find((o) => o.id === focus.id)?.title ?? 'Draft';
    refs.push({ kind: 'output', objectId: focus.id, label: title, locator: null, excerpt: null });
  } else if (src.claims.length > 0) {
    refs.push({
      kind: 'argument',
      objectId: null,
      label: 'Your points',
      locator: null,
      excerpt: clampExcerpt(src.claims.map((c, i) => `${i + 1}. ${c.title}`).join('\n')),
    });
  }
  if (src.question.trim()) {
    refs.push({ kind: 'project', objectId: null, label: 'Your question', locator: null, excerpt: clampExcerpt(src.question.trim()) });
  }
  return refs;
}

/** A stable key for a chip, used to remember which ones the user removed. */
export function contextKey(ref: AiContextRef): string {
  return `${ref.kind}:${ref.objectId ?? ref.label}`;
}
