/**
 * StudyKit v0.5 P5 — brainstorming and disagreements.
 *
 * Brainstorm: one card, one idea. Cards are gathered into named groups;
 * the groups, in order, become the points of the argument in one step.
 *
 * Disagreement: a first-class object about a point. Each position states
 * a view and hangs checked excerpts on it; the disagreement is settled
 * with a written outcome and kept on record, never deleted silently.
 */

export interface IdeaGroup {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  /** The argument point this group became, once converted. */
  readonly claimId?: string;
}

export interface Brainstorm {
  readonly id: string;
  readonly projectId: string;
  /** What the session is about, e.g. “Why might sleep help memory?”. */
  readonly prompt: string;
  readonly groups: readonly IdeaGroup[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set once the groups were turned into argument points. */
  readonly convertedAt?: string;
  /** “Think first, then look”: true when the user asked the AI for
   *  directions before writing their own. Recorded, never blocked. */
  readonly askedAiEarly?: boolean;
}

export interface Idea {
  readonly id: string;
  readonly projectId: string;
  readonly brainstormId: string;
  readonly text: string;
  /** null while ungrouped. */
  readonly groupId: string | null;
  readonly order: number;
  readonly authorId: string;
  /** 'ai' only for ideas the user accepted from an AI suggestion. */
  readonly authorType: 'user' | 'ai';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DisagreementStatus = 'open' | 'settled';

export interface Disagreement {
  readonly id: string;
  readonly projectId: string;
  /** The point it is about, if any. */
  readonly claimId: string | null;
  /** The question in dispute, in plain words. */
  readonly question: string;
  readonly status: DisagreementStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Required when settled: what was decided and why. */
  readonly outcome?: {
    readonly summary: string;
    /** The position that prevailed, or null for “both partly / neither”. */
    readonly positionId: string | null;
    readonly settledBy: string;
    readonly settledAt: string;
  };
}

export interface DisagreementPosition {
  readonly id: string;
  readonly projectId: string;
  readonly disagreementId: string;
  /** The view, in one or two sentences. */
  readonly stance: string;
  /** Checked excerpts backing the view. */
  readonly evidenceIds: readonly string[];
  readonly authorId: string;
  /** Who holds it, when the user records someone else's view (e.g. a supervisor). */
  readonly holder: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const iso = (v: unknown): boolean => str(v) && !Number.isNaN(Date.parse(v));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isGroup(v: unknown): v is IdeaGroup {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return str(g.id) && typeof g.title === 'string' && num(g.order) && (g.claimId === undefined || str(g.claimId));
}

export function isBrainstorm(value: unknown): value is Brainstorm {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    str(v.id) &&
    str(v.projectId) &&
    typeof v.prompt === 'string' &&
    Array.isArray(v.groups) &&
    v.groups.every(isGroup) &&
    new Set((v.groups as IdeaGroup[]).map((g) => g.id)).size === v.groups.length &&
    str(v.createdBy) &&
    iso(v.createdAt) &&
    iso(v.updatedAt) &&
    (v.convertedAt === undefined || iso(v.convertedAt)) &&
    (v.askedAiEarly === undefined || typeof v.askedAiEarly === 'boolean')
  );
}

export function isIdea(value: unknown): value is Idea {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    str(v.id) &&
    str(v.projectId) &&
    str(v.brainstormId) &&
    typeof v.text === 'string' &&
    v.text.trim().length > 0 &&
    v.text.length <= 2000 &&
    (v.groupId === null || str(v.groupId)) &&
    num(v.order) &&
    str(v.authorId) &&
    (v.authorType === 'user' || v.authorType === 'ai') &&
    iso(v.createdAt) &&
    iso(v.updatedAt)
  );
}

export function isDisagreement(value: unknown): value is Disagreement {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!(str(v.id) && str(v.projectId) && str(v.createdBy) && iso(v.createdAt) && iso(v.updatedAt))) return false;
  if (v.claimId !== null && !str(v.claimId)) return false;
  if (typeof v.question !== 'string' || !v.question.trim()) return false;
  if (v.status !== 'open' && v.status !== 'settled') return false;
  if (v.status === 'settled') {
    const o = v.outcome as Record<string, unknown> | undefined;
    if (!o || typeof o.summary !== 'string' || !o.summary.trim()) return false;
    if (o.positionId !== null && !str(o.positionId)) return false;
    if (!str(o.settledBy) || !iso(o.settledAt)) return false;
  } else if (v.outcome !== undefined) {
    return false;
  }
  return true;
}

export function isDisagreementPosition(value: unknown): value is DisagreementPosition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    str(v.id) &&
    str(v.projectId) &&
    str(v.disagreementId) &&
    typeof v.stance === 'string' &&
    v.stance.trim().length > 0 &&
    Array.isArray(v.evidenceIds) &&
    v.evidenceIds.every(str) &&
    str(v.authorId) &&
    typeof v.holder === 'string' &&
    iso(v.createdAt) &&
    iso(v.updatedAt)
  );
}
