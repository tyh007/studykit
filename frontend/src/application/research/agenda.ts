/**
 * StudyKit v0.5 P5b — the group meeting agenda.
 *
 * Built from the project, never typed by hand: open disagreements to
 * decide, excerpts that went against a point since the last meeting,
 * disagreements settled since then, points still missing support, and
 * group brainstorms waiting for a reveal or a decision. "Since the last
 * meeting" is when this user last marked a meeting as held; before the
 * first one, everything counts as new.
 *
 * Pure apart from `markMeetingHeld`.
 */

import { nowIso, type Claim, type ClaimEvidenceLink, type Evidence, type Work } from '../../domain/research';
import type { Brainstorm, Disagreement, DisagreementPosition, Idea } from '../../domain/brainstorm';
import { buildLedger } from './ledger';
import type { ResearchRepository } from './researchRepository';

export type AgendaTarget =
  | { readonly kind: 'disagreement'; readonly id: string }
  | { readonly kind: 'point'; readonly claimId: string }
  | { readonly kind: 'source'; readonly workId: string; readonly pageNumber?: number }
  | { readonly kind: 'brainstorm'; readonly id: string };

export interface AgendaItem {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly target: AgendaTarget;
}

export type AgendaSectionKind = 'decide' | 'counter' | 'settled' | 'gaps' | 'brainstorms';

export interface AgendaSection {
  readonly kind: AgendaSectionKind;
  readonly title: string;
  readonly items: readonly AgendaItem[];
}

export interface Agenda {
  /** The last meeting, or null before the first. */
  readonly since: string | null;
  readonly sections: readonly AgendaSection[];
  readonly itemCount: number;
}

export interface AgendaInput {
  readonly since: string | null;
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly links: readonly ClaimEvidenceLink[];
  readonly works: readonly Pick<Work, 'id' | 'title'>[];
  readonly disagreements: readonly Disagreement[];
  readonly positions: readonly DisagreementPosition[];
  readonly brainstorms: readonly Brainstorm[];
  readonly ideas: readonly Idea[];
}

/** Points still missing support listed at most. */
export const MAX_GAP_ITEMS = 5;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const after = (iso: string, since: string | null): boolean => since === null || iso > since;

function pageOf(e: Evidence): number | undefined {
  const n = (e.locator as { pageNumber?: unknown }).pageNumber;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

export function buildAgenda(input: AgendaInput): Agenda {
  const { since } = input;
  const claimById = new Map(input.claims.map((c) => [c.id, c]));
  const titleOf = (workId: string): string => input.works.find((w) => w.id === workId)?.title || 'Untitled source';
  const positionsOf = (id: string): DisagreementPosition[] => input.positions.filter((p) => p.disagreementId === id);
  const pointOf = (d: Disagreement): string | undefined => (d.claimId ? claimById.get(d.claimId)?.title : undefined) ?? d.pointTitle;

  // 1. To decide: open disagreements, oldest first.
  const decide: AgendaItem[] = input.disagreements
    .filter((d) => d.status === 'open')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((d) => {
      const views = positionsOf(d.id);
      const unbacked = views.filter((p) => p.evidenceIds.length === 0).length;
      const about = pointOf(d);
      const parts = [views.length === 0 ? 'No views written yet' : plural(views.length, 'view', 'views')];
      if (unbacked > 0) parts.push(`${unbacked} without evidence`);
      if (about) parts.push(`about “${about}”`);
      return { key: `d:${d.id}`, title: d.question, detail: parts.join(' · '), target: { kind: 'disagreement', id: d.id } };
    });

  // 2. New excerpts that go against a point.
  const verified = new Map(input.evidence.filter((e) => e.status === 'verified').map((e) => [e.id, e]));
  const counter: AgendaItem[] = input.links
    .filter((l) => l.relation === 'contradicts' && after(l.createdAt, since) && verified.has(l.evidenceId) && claimById.has(l.claimId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((l) => {
      const e = verified.get(l.evidenceId)!;
      const page = pageOf(e);
      const quote = e.exactQuote.length > 140 ? `${e.exactQuote.slice(0, 140)}…` : e.exactQuote;
      return {
        key: `l:${l.id}`,
        title: `Against “${claimById.get(l.claimId)!.title}”`,
        detail: `“${quote}” — ${titleOf(e.workId)}${page ? `, p. ${page}` : ''}`,
        target: { kind: 'source', workId: e.workId, ...(page ? { pageNumber: page } : {}) },
      };
    });

  // 3. Settled since the last meeting, to report back.
  const settled: AgendaItem[] = input.disagreements
    .filter((d) => d.status === 'settled' && d.outcome && after(d.outcome.settledAt, since))
    .sort((a, b) => a.outcome!.settledAt.localeCompare(b.outcome!.settledAt))
    .map((d) => ({ key: `s:${d.id}`, title: d.question, detail: `Decided: ${d.outcome!.summary}`, target: { kind: 'disagreement', id: d.id } }));

  // 4. Points still missing support (the ledger's gaps).
  const ledger = buildLedger({ claims: input.claims, evidence: input.evidence, links: input.links });
  const gaps: AgendaItem[] = [];
  for (const g of ledger.gaps) {
    if (g.kind !== 'no-support' && g.kind !== 'single-source') continue;
    gaps.push({
      key: `g:${g.claimId}`,
      title: g.title,
      detail: g.kind === 'no-support' ? 'No excerpt supports it yet' : 'All support comes from one source',
      target: { kind: 'point', claimId: g.claimId },
    });
  }

  // 5. Group brainstorms waiting on the group.
  const brainstorms: AgendaItem[] = [];
  for (const b of input.brainstorms) {
    if (b.mode !== 'group') continue;
    const count = input.ideas.filter((i) => i.brainstormId === b.id).length;
    const title = b.prompt || 'Group brainstorm';
    if (!b.revealedAt) {
      brainstorms.push({ key: `b:${b.id}`, title, detail: `${plural(count, 'idea', 'ideas')} written, not revealed yet`, target: { kind: 'brainstorm', id: b.id } });
    } else if (!b.groups.some((g) => g.claimId)) {
      brainstorms.push({ key: `b:${b.id}`, title, detail: `${plural(count, 'idea', 'ideas')} revealed, not turned into points yet`, target: { kind: 'brainstorm', id: b.id } });
    }
  }

  const sections: AgendaSection[] = [
    { kind: 'decide' as const, title: 'To decide', items: decide },
    { kind: 'counter' as const, title: since ? 'New evidence against our points' : 'Evidence against our points', items: counter },
    { kind: 'settled' as const, title: since ? 'Settled since the last meeting' : 'Settled', items: settled },
    { kind: 'brainstorms' as const, title: 'Brainstorms waiting on the group', items: brainstorms },
    { kind: 'gaps' as const, title: 'Points still missing support', items: gaps.slice(0, MAX_GAP_ITEMS) },
  ].filter((s) => s.items.length > 0);
  return { since, sections, itemCount: sections.reduce((n, s) => n + s.items.length, 0) };
}

/** Plain text (Markdown) to paste into a chat or meeting notes. */
export function agendaToText(agenda: Agenda, projectName: string): string {
  const lines = [`# Meeting agenda — ${projectName || 'Research project'}`];
  if (agenda.since) lines.push(`Since the last meeting (${agenda.since.slice(0, 10)}).`);
  if (agenda.sections.length === 0) lines.push('', 'Nothing open: no disagreements, no new evidence against a point, no gaps.');
  for (const s of agenda.sections) {
    lines.push('', `## ${s.title}`);
    for (const i of s.items) lines.push(`- ${i.title} — ${i.detail}`);
  }
  return lines.join('\n');
}

/** Load everything the agenda needs for a project. */
export async function loadAgenda(repository: ResearchRepository, projectId: string): Promise<{ agenda: Agenda; projectName: string }> {
  const [project, claims, evidence, links, works, disagreements, brainstorms, ideas] = await Promise.all([
    repository.getProject(projectId),
    repository.listClaims({ projectId }),
    repository.listEvidence({ projectId }),
    repository.listLinks({ projectId }),
    repository.listWorks({ projectId }),
    repository.listDisagreements({ projectId }),
    repository.listBrainstorms({ projectId }),
    repository.listIdeas({ projectId }),
  ]);
  const positions = (await Promise.all(disagreements.map((d) => repository.listDisagreementPositions({ disagreementId: d.id })))).flat();
  const agenda = buildAgenda({
    since: project?.lastMeetingAt ?? null,
    claims,
    evidence,
    links,
    works,
    disagreements,
    positions,
    brainstorms,
    ideas,
  });
  return { agenda, projectName: project?.name ?? '' };
}

/** The meeting happened: the next agenda counts from now. */
export async function markMeetingHeld(repository: ResearchRepository, projectId: string): Promise<string> {
  const project = await repository.getProject(projectId);
  if (!project) throw new Error(`markMeetingHeld: project ${projectId} not found.`);
  const now = nowIso();
  await repository.transact(async (tx) => tx.putProject({ ...project, lastMeetingAt: now, updatedAt: now }));
  return now;
}
