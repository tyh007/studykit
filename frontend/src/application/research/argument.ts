/**
 * StudyKit v0.5 P3 — the argument skeleton (ADR-003).
 *
 * An argument is the project's points in order. Every point has four
 * slots:
 *
 *   - evidence  — verified excerpts that support it        (required)
 *   - reasoning — why the evidence supports it (claim body) (required)
 *   - counter   — verified excerpts against it             (or "none found")
 *   - limits    — verified excerpts that qualify it        (or "none found")
 *
 * An empty slot is a gap. Only verified excerpts can be cited, so every
 * citation in the write-up traces back to a page in a source. The
 * write-up can be composed only once every slot of every point is
 * filled or explicitly marked as considered.
 *
 * No new tables: slots are `ClaimEvidenceLink`s (supports / contradicts /
 * qualifies), the reasoning is `Claim.body`, and order + "none found"
 * marks live in the optional `Claim.argument` field.
 */

import {
  nowIso,
  type Claim,
  type ClaimEvidenceLink,
  type ClaimEvidenceRelation,
  type Evidence,
} from '../../domain/research';
import type { OutputDocument, OutputSection, OutputStatement, StatementSupport } from '../../domain/output';
import type { ResearchRepository } from './researchRepository';

export type ArgumentSlot = 'evidence' | 'reasoning' | 'counter' | 'limits';
export type CiteSlot = Exclude<ArgumentSlot, 'reasoning'>;

export const SLOT_RELATION: Readonly<Record<CiteSlot, ClaimEvidenceRelation>> = {
  evidence: 'supports',
  counter: 'contradicts',
  limits: 'qualifies',
};

export interface ArgumentCite {
  readonly linkId: string;
  readonly evidenceId: string;
  readonly workId: string;
  readonly workTitle: string;
  readonly pageNumber?: number;
  readonly quote: string;
  /** The user's own words about this excerpt, if any. */
  readonly note: string;
}

export interface ArgumentPoint {
  readonly claim: Claim;
  readonly evidence: readonly ArgumentCite[];
  readonly reasoning: string;
  readonly counter: readonly ArgumentCite[];
  readonly limits: readonly ArgumentCite[];
  readonly noCounter: boolean;
  readonly noLimits: boolean;
  /** Slots still empty, in reading order. */
  readonly gaps: readonly ArgumentSlot[];
  /** Distinct sources behind the supporting excerpts. */
  readonly supportingSources: number;
  readonly complete: boolean;
}

export interface ArgumentView {
  readonly points: readonly ArgumentPoint[];
  readonly completeCount: number;
  /** True when there is at least one point and every point is complete. */
  readonly ready: boolean;
}

export interface BuildArgumentInput {
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly links: readonly ClaimEvidenceLink[];
  readonly works?: readonly { readonly id: string; readonly title: string }[];
}

/** Points in argument order: explicit order first, then oldest first. */
export function orderPoints(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((a, b) => {
    const oa = a.argument?.order ?? Number.POSITIVE_INFINITY;
    const ob = b.argument?.order ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa < ob ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const AUTO_NOTE = /^(Supports|Contradicts|Qualifies): /;

/** The user's own words for a cited excerpt (never our auto-generated label). */
function ownNote(link: ClaimEvidenceLink, evidence: Evidence): string {
  const candidates = [link.note ?? '', evidence.userInterpretation];
  for (const c of candidates) {
    const t = c.trim();
    if (t && !AUTO_NOTE.test(t)) return t;
  }
  return '';
}

export function buildArgument(input: BuildArgumentInput): ArgumentView {
  const verified = new Map(input.evidence.filter((e) => e.status === 'verified').map((e) => [e.id, e]));
  const titles = new Map((input.works ?? []).map((w) => [w.id, w.title]));
  const linksByClaim = new Map<string, ClaimEvidenceLink[]>();
  for (const link of input.links) {
    if (!verified.has(link.evidenceId)) continue;
    const list = linksByClaim.get(link.claimId) ?? [];
    list.push(link);
    linksByClaim.set(link.claimId, list);
  }

  const points = orderPoints(input.claims).map((claim): ArgumentPoint => {
    const cites = (relation: ClaimEvidenceRelation): ArgumentCite[] =>
      (linksByClaim.get(claim.id) ?? [])
        .filter((l) => l.relation === relation)
        .map((l) => {
          const e = verified.get(l.evidenceId)!;
          return {
            linkId: l.id,
            evidenceId: e.id,
            workId: e.workId,
            workTitle: titles.get(e.workId) ?? 'Untitled source',
            ...(e.locator.pageNumber !== undefined ? { pageNumber: e.locator.pageNumber } : {}),
            quote: e.exactQuote,
            note: ownNote(l, e),
          };
        });
    const evidence = cites('supports');
    const counter = cites('contradicts');
    const limits = cites('qualifies');
    const reasoning = claim.body.trim();
    const noCounter = claim.argument?.noCounter === true;
    const noLimits = claim.argument?.noLimits === true;
    const gaps: ArgumentSlot[] = [];
    if (evidence.length === 0) gaps.push('evidence');
    if (!reasoning) gaps.push('reasoning');
    if (counter.length === 0 && !noCounter) gaps.push('counter');
    if (limits.length === 0 && !noLimits) gaps.push('limits');
    return {
      claim,
      evidence,
      reasoning,
      counter,
      limits,
      noCounter,
      noLimits,
      gaps,
      supportingSources: new Set(evidence.map((c) => c.workId)).size,
      complete: gaps.length === 0,
    };
  });
  const completeCount = points.filter((p) => p.complete).length;
  return { points, completeCount, ready: points.length > 0 && completeCount === points.length };
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

function makeId(idFactory: (() => string) | undefined, prefix: string): string {
  if (idFactory) return idFactory();
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function requireClaim(repository: ResearchRepository, claimId: string): Promise<Claim> {
  const claim = await repository.getClaim(claimId);
  if (!claim) throw new Error(`argument: point ${claimId} not found.`);
  return claim;
}

export interface AddPointInput {
  readonly projectId: string;
  readonly title: string;
  readonly idFactory?: () => string;
}

/** Add a point at the end of the argument. */
export async function addPoint(repository: ResearchRepository, input: AddPointInput): Promise<Claim> {
  const title = input.title.trim();
  if (!title) throw new Error('addPoint: a point needs a title.');
  const existing = orderPoints(await repository.listClaims({ projectId: input.projectId }));
  const now = nowIso();
  // Give every point an explicit order so the new one lands last.
  const renumbered = existing.map((c, i) => (c.argument?.order === i ? null : withArgument(c, { order: i }, now)));
  const claim: Claim = {
    id: makeId(input.idFactory, 'c'),
    projectId: input.projectId,
    title,
    body: '',
    status: 'canonical',
    aiSuggested: false,
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
    argument: { order: existing.length },
  };
  await repository.transact(async (tx) => {
    for (const c of renumbered) if (c) tx.putClaim(c);
    tx.putClaim(claim);
  });
  return claim;
}

function withArgument(claim: Claim, patch: Partial<NonNullable<Claim['argument']>>, now: string): Claim {
  return { ...claim, argument: { ...claim.argument, ...patch }, updatedAt: now };
}

export interface UpdatePointInput {
  readonly claimId: string;
  readonly title?: string;
  readonly reasoning?: string;
  readonly noCounter?: boolean;
  readonly noLimits?: boolean;
}

export async function updatePoint(repository: ResearchRepository, input: UpdatePointInput): Promise<Claim> {
  const claim = await requireClaim(repository, input.claimId);
  if (input.title !== undefined && !input.title.trim()) throw new Error('updatePoint: a point needs a title.');
  const now = nowIso();
  let next: Claim = {
    ...claim,
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.reasoning !== undefined ? { body: input.reasoning } : {}),
    updatedAt: now,
  };
  const patch: Partial<NonNullable<Claim['argument']>> = {
    ...(input.noCounter !== undefined ? { noCounter: input.noCounter } : {}),
    ...(input.noLimits !== undefined ? { noLimits: input.noLimits } : {}),
  };
  if (Object.keys(patch).length > 0) next = withArgument(next, patch, now);
  await repository.transact(async (tx) => {
    tx.putClaim(next);
  });
  return next;
}

export interface MovePointInput {
  readonly projectId: string;
  readonly claimId: string;
  readonly offset: -1 | 1;
}

/** Move a point one place up or down; a move past either end is a no-op. */
export async function movePoint(repository: ResearchRepository, input: MovePointInput): Promise<void> {
  const ordered = orderPoints(await repository.listClaims({ projectId: input.projectId }));
  const from = ordered.findIndex((c) => c.id === input.claimId);
  if (from < 0) throw new Error(`movePoint: point ${input.claimId} not found.`);
  const to = from + input.offset;
  if (to < 0 || to >= ordered.length) return;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved!);
  const now = nowIso();
  await repository.transact(async (tx) => {
    ordered.forEach((c, i) => {
      if (c.argument?.order !== i) tx.putClaim(withArgument(c, { order: i }, now));
    });
  });
}

export interface CiteInSlotInput {
  readonly projectId: string;
  readonly claimId: string;
  readonly evidenceId: string;
  readonly slot: CiteSlot;
  readonly idFactory?: () => string;
}

/**
 * Put a verified excerpt in one of a point's slots. Citing the same
 * excerpt in the same slot twice returns the existing link.
 */
export async function citeInSlot(repository: ResearchRepository, input: CiteInSlotInput): Promise<ClaimEvidenceLink> {
  const claim = await requireClaim(repository, input.claimId);
  if (claim.projectId !== input.projectId) throw new Error('citeInSlot: point belongs to another project.');
  const evidence = await repository.getEvidence(input.evidenceId);
  if (!evidence) throw new Error(`citeInSlot: excerpt ${input.evidenceId} not found.`);
  if (evidence.status !== 'verified') {
    throw new Error('citeInSlot: only checked excerpts can be cited. Say what the excerpt shows first.');
  }
  const relation = SLOT_RELATION[input.slot];
  const links = await repository.listLinks({ projectId: input.projectId });
  const existing = links.find(
    (l) => l.claimId === input.claimId && l.evidenceId === input.evidenceId && l.relation === relation,
  );
  if (existing) return existing;
  const now = nowIso();
  const link: ClaimEvidenceLink = {
    id: makeId(input.idFactory, 'l'),
    projectId: input.projectId,
    claimId: input.claimId,
    evidenceId: input.evidenceId,
    relation,
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putLink(link);
  });
  return link;
}

export async function removeCite(repository: ResearchRepository, linkId: string): Promise<void> {
  await repository.transact(async (tx) => {
    tx.deleteLink(linkId);
  });
}

// ---------------------------------------------------------------------------
// Write-up
// ---------------------------------------------------------------------------

export interface ComposeDraftInput {
  readonly projectId: string;
  readonly idFactory?: () => string;
}

export interface ComposeDraftResult {
  readonly output: OutputDocument;
  readonly sectionCount: number;
  readonly citationCount: number;
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?。！？]$/.test(t) ? t : `${t}.`;
}

function joinNotes(cites: readonly ArgumentCite[]): string {
  return cites
    .map((c) => c.note)
    .filter((n) => n.length > 0)
    .map((n) => n.replace(/[.!?。！？]+$/, ''))
    .join('; ');
}

/** The paragraphs one point turns into, each with the excerpts it cites. */
export function composePoint(point: ArgumentPoint): { body: string; cites: readonly ArgumentCite[]; relation: ClaimEvidenceRelation }[] {
  const paragraphs: { body: string; cites: readonly ArgumentCite[]; relation: ClaimEvidenceRelation }[] = [
    { body: `${sentence(point.claim.title)} ${sentence(point.reasoning)}`.trim(), cites: point.evidence, relation: 'supports' },
  ];
  if (point.counter.length > 0) {
    const notes = joinNotes(point.counter);
    paragraphs.push({
      body: notes ? `However, not every source agrees: ${sentence(notes)}` : 'However, not every source agrees.',
      cites: point.counter,
      relation: 'contradicts',
    });
  }
  if (point.limits.length > 0) {
    const notes = joinNotes(point.limits);
    paragraphs.push({
      body: notes ? `This holds within limits: ${sentence(notes)}` : 'This holds only within the limits the sources describe.',
      cites: point.limits,
      relation: 'qualifies',
    });
  }
  return paragraphs;
}

/**
 * Turn a complete argument into a first draft: one section per point,
 * one paragraph per filled slot, and every cited excerpt attached as a
 * support so the draft's citations open the source at the right page.
 * Written in one transaction; nothing is written if the argument has gaps.
 */
export async function composeArgumentDraft(
  repository: ResearchRepository,
  input: ComposeDraftInput,
): Promise<ComposeDraftResult> {
  const project = await repository.getProject(input.projectId);
  if (!project) throw new Error(`composeArgumentDraft: project ${input.projectId} not found.`);
  const [claims, evidence, links, works, outputs] = await Promise.all([
    repository.listClaims({ projectId: input.projectId }),
    repository.listEvidence({ projectId: input.projectId }),
    repository.listLinks({ projectId: input.projectId }),
    repository.listWorks({ projectId: input.projectId }),
    repository.listOutputs({ projectId: input.projectId }),
  ]);
  const view = buildArgument({ claims, evidence, links, works });
  if (!view.ready) {
    throw new Error('composeArgumentDraft: fill the empty slots first.');
  }

  const now = nowIso();
  const base = 'Draft from your argument';
  const taken = new Set(outputs.map((o) => o.title));
  let title = base;
  for (let n = 2; taken.has(title); n += 1) title = `${base} ${n}`;
  const output: OutputDocument = {
    id: makeId(input.idFactory, 'out'),
    projectId: input.projectId,
    title,
    status: 'draft',
    authorType: 'user',
    createdAt: now,
    updatedAt: now,
  };
  const sections: OutputSection[] = [];
  const statements: OutputStatement[] = [];
  const supports: StatementSupport[] = [];
  view.points.forEach((point, si) => {
    const section: OutputSection = {
      id: makeId(input.idFactory, 'sec'),
      projectId: input.projectId,
      outputId: output.id,
      title: point.claim.title,
      order: si,
      createdAt: now,
      updatedAt: now,
    };
    sections.push(section);
    composePoint(point).forEach((para, pi) => {
      const statement: OutputStatement = {
        id: makeId(input.idFactory, 'st'),
        projectId: input.projectId,
        outputId: output.id,
        sectionId: section.id,
        body: para.body,
        order: pi,
        authorType: 'user',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      statements.push(statement);
      for (const cite of para.cites) {
        supports.push({
          id: makeId(input.idFactory, 'sup'),
          projectId: input.projectId,
          outputId: output.id,
          statementId: statement.id,
          ref: { kind: 'evidence', id: cite.evidenceId },
          relation: para.relation,
          authorType: 'user',
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  });

  await repository.transact(async (tx) => {
    tx.putOutput(output);
    for (const s of sections) tx.putOutputSection(s);
    for (const s of statements) tx.putOutputStatement(s);
    for (const s of supports) tx.putStatementSupport(s);
  });
  return { output, sectionCount: sections.length, citationCount: supports.length };
}
