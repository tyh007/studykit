/**
 * StudyKit v0.5 P5b — sending brainstorms and disagreements to project
 * members.
 *
 * What is shared, once the project has other members:
 *
 *   - Group brainstorms (brainwriting) and their ideas. Solo brainstorms
 *     stay on this device.
 *   - Every disagreement and its views. They are about the project, not
 *     private notes; ones written before anyone joined go out on the
 *     first sync. Each view carries a copy of its excerpts (quote, source,
 *     page) because excerpts and points are not synced; the disagreement
 *     carries its point's title for the same reason.
 *
 * Who sends what (mirrors the server, `backend/routes/collab.js`):
 *
 *   - manage (owner, editor): disagreements, any view, any idea.
 *   - contribute (commenter): their own ideas and views.
 *   - read (viewer): nothing.
 *   - A group brainstorm's own row (prompt, groups, reveal) only by the
 *     person who started it.
 *
 * Sending is a diff, not a call in every use case: after local changes,
 * `pushThinking` sends each row whose content differs from what this
 * device last sent or received (the marks hold a hash of each row; two
 * writes in the same millisecond still differ), and an `idea-removed` for an
 * idea that was sent and is now gone. Rows received from members are
 * marked, so they are never echoed back. Conflicts: last write wins by
 * `updatedAt`, except that a settled disagreement is never reopened and
 * a reveal is never undone.
 *
 * Note on brainwriting: unrevealed ideas do reach members' devices; the
 * editor hides them until the reveal. The point is to avoid anchoring on
 * the first ideas, not secrecy.
 */

import type { Brainstorm, Disagreement, DisagreementPosition, Idea, PositionCitation } from '../../domain/brainstorm';
import { isCollaboratorRole } from '../../domain/collaboration';
import type { Evidence } from '../../domain/research';
import { capabilitiesForRole } from '../collaboration/permissionMatrix';
import type { ResearchRepository } from './researchRepository';

export interface IdeaRemoved {
  readonly id: string;
  readonly projectId: string;
  readonly brainstormId: string;
  readonly authorId: string;
}

export type ThinkingOp =
  | { readonly kind: 'brainstorm-saved'; readonly payload: Brainstorm }
  | { readonly kind: 'idea-saved'; readonly payload: Idea }
  | { readonly kind: 'idea-removed'; readonly payload: IdeaRemoved }
  | { readonly kind: 'disagreement-saved'; readonly payload: Disagreement }
  | { readonly kind: 'disagreement-position-saved'; readonly payload: DisagreementPosition };

export const THINKING_OP_KINDS = [
  'brainstorm-saved',
  'idea-saved',
  'idea-removed',
  'disagreement-saved',
  'disagreement-position-saved',
] as const;

export interface ThinkingSyncPort {
  /** Append an op to the collaboration outbox (best effort, never throws). */
  record(op: ThinkingOp): void;
}

export type ThinkingAccess = 'manage' | 'contribute' | 'read';

/** Not collaborating (null) means the user's own project. */
export function thinkingAccess(role: string | null): ThinkingAccess {
  if (role === null) return 'manage';
  if (!isCollaboratorRole(role)) return 'read';
  const caps = capabilitiesForRole(role);
  if (caps.includes('thinking.manage')) return 'manage';
  if (caps.includes('thinking.contribute')) return 'contribute';
  return 'read';
}

// ---------------------------------------------------------------------------
// Marks: what this device last sent or received, per row
// ---------------------------------------------------------------------------

export interface SyncMark {
  /** Hash of the row as last sent or received. */
  readonly h: string;
  /** For ideas: where it lived, to send a removal later. */
  readonly idea?: { readonly brainstormId: string; readonly authorId: string };
}

export interface SyncMarks {
  get(id: string): SyncMark | undefined;
  set(id: string, mark: SyncMark): void;
  delete(id: string): void;
  entries(): [string, SyncMark][];
}

export function memoryMarks(): SyncMarks {
  const m = new Map<string, SyncMark>();
  return {
    get: (id) => m.get(id),
    set: (id, mark) => void m.set(id, mark),
    delete: (id) => void m.delete(id),
    entries: () => [...m.entries()],
  };
}

const marksCache = new Map<string, SyncMarks>();

/** Marks kept in localStorage, per project. Losing them only re-sends rows. */
export function storedMarks(projectId: string): SyncMarks {
  const cached = marksCache.get(projectId);
  if (cached) return cached;
  const key = `studykit.thinkingSync.v1.${projectId}`;
  let data: Record<string, SyncMark> = {};
  try {
    data = JSON.parse(globalThis.localStorage?.getItem(key) ?? '{}') as Record<string, SyncMark>;
  } catch {
    data = {};
  }
  const save = (): void => {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(data));
    } catch {
      // Storage full or unavailable: rows are re-sent next time; ops are idempotent by content.
    }
  };
  const marks: SyncMarks = {
    get: (id) => data[id],
    set: (id, mark) => {
      data[id] = mark;
      save();
    },
    delete: (id) => {
      if (!(id in data)) return;
      delete data[id];
      save();
    },
    entries: () => Object.entries(data),
  };
  marksCache.set(projectId, marks);
  return marks;
}

/** FNV-1a over the row's JSON: cheap, stable, enough to spot a change. */
export function rowHash(row: unknown): string {
  const text = JSON.stringify(row);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function pageOf(e: Evidence): number | undefined {
  const n = (e.locator as { pageNumber?: unknown }).pageNumber;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Fill in excerpt copies from this device, keeping copies it doesn't have. */
function withCitations(
  p: DisagreementPosition,
  evidence: ReadonlyMap<string, Evidence>,
  workTitles: ReadonlyMap<string, string>,
): DisagreementPosition {
  if (p.evidenceIds.length === 0) return p.citations ? { ...p, citations: [] } : p;
  const known = new Map((p.citations ?? []).map((c) => [c.evidenceId, c]));
  const citations: PositionCitation[] = [];
  for (const id of p.evidenceIds) {
    const e = evidence.get(id);
    if (e) {
      const page = pageOf(e);
      citations.push({
        evidenceId: id,
        quote: e.exactQuote.slice(0, 4000),
        source: workTitles.get(e.workId) || 'Untitled source',
        ...(page ? { pageNumber: page } : {}),
      });
    } else if (known.has(id)) {
      citations.push(known.get(id)!);
    }
  }
  return { ...p, citations };
}

/**
 * Send what changed since the last push. Returns the number of ops
 * recorded. Safe to call often: unchanged rows are skipped.
 */
export async function pushThinking(
  repository: ResearchRepository,
  port: ThinkingSyncPort,
  marks: SyncMarks,
  input: { readonly projectId: string; readonly userId: string; readonly access: ThinkingAccess },
): Promise<number> {
  if (input.access === 'read') return 0;
  const manage = input.access === 'manage';
  const { projectId, userId } = input;
  let sent = 0;
  const send = (op: ThinkingOp, id: string, mark: SyncMark): void => {
    port.record(op);
    marks.set(id, mark);
    sent += 1;
  };
  const changed = (row: { readonly id: string }): boolean => marks.get(row.id)?.h !== rowHash(row);

  // Group brainstorms and their ideas.
  const brainstorms = (await repository.listBrainstorms({ projectId })).filter((b) => b.mode === 'group');
  const liveIdeas = new Set<string>();
  for (const b of brainstorms) {
    if (b.createdBy === userId && changed(b)) send({ kind: 'brainstorm-saved', payload: b }, b.id, { h: rowHash(b) });
    for (const idea of await repository.listIdeas({ brainstormId: b.id })) {
      liveIdeas.add(idea.id);
      if (!(manage || idea.authorId === userId) || !changed(idea)) continue;
      send({ kind: 'idea-saved', payload: idea }, idea.id, {
        h: rowHash(idea),
        idea: { brainstormId: b.id, authorId: idea.authorId },
      });
    }
  }
  // Removed ideas that members still have.
  for (const [id, mark] of marks.entries()) {
    if (!mark.idea || liveIdeas.has(id)) continue;
    if (!brainstorms.some((b) => b.id === mark.idea!.brainstormId)) continue;
    if (manage || mark.idea.authorId === userId) {
      port.record({ kind: 'idea-removed', payload: { id, projectId, ...mark.idea } });
      sent += 1;
    }
    marks.delete(id);
  }

  // Disagreements and views.
  const disagreements = await repository.listDisagreements({ projectId });
  if (disagreements.length > 0) {
    const [evidence, works] = await Promise.all([repository.listEvidence({ projectId }), repository.listWorks({ projectId })]);
    const evidenceById = new Map(evidence.map((e) => [e.id, e]));
    const workTitles = new Map(works.map((w) => [w.id, w.title]));
    for (const d of disagreements) {
      if (manage && changed(d)) {
        const claim = d.claimId ? await repository.getClaim(d.claimId) : null;
        const payload: Disagreement = claim ? { ...d, pointTitle: claim.title } : d;
        send({ kind: 'disagreement-saved', payload }, d.id, { h: rowHash(d) });
      }
      for (const p of await repository.listDisagreementPositions({ disagreementId: d.id })) {
        if (!(manage || p.authorId === userId) || !changed(p)) continue;
        send({ kind: 'disagreement-position-saved', payload: withCitations(p, evidenceById, workTitles) }, p.id, { h: rowHash(p) });
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

const newer = (incoming: string, local: string | undefined): boolean => local === undefined || incoming >= local;

/**
 * How rows received from members land locally. Every applied row is
 * marked so it is not sent back.
 */
export function thinkingApplyTarget(
  repository: ResearchRepository,
  marksFor: (projectId: string) => SyncMarks = storedMarks,
): {
  applyBrainstorm(row: Brainstorm): Promise<void>;
  applyIdea(row: Idea): Promise<void>;
  applyIdeaRemoved(row: IdeaRemoved): Promise<void>;
  applyDisagreement(row: Disagreement): Promise<void>;
  applyDisagreementPosition(row: DisagreementPosition): Promise<void>;
} {
  return {
    async applyBrainstorm(row) {
      if (row.mode !== 'group') return;
      const local = await repository.getBrainstorm(row.id);
      if (local && !newer(row.updatedAt, local.updatedAt)) return;
      // A reveal is one-way.
      const revealedAt = local?.revealedAt ?? row.revealedAt;
      const next: Brainstorm = { ...row, ...(revealedAt ? { revealedAt } : {}) };
      await repository.transact(async (tx) => tx.putBrainstorm(next));
      marksFor(row.projectId).set(row.id, { h: rowHash(next) });
    },
    async applyIdea(row) {
      const local = (await repository.listIdeas({ brainstormId: row.brainstormId })).find((i) => i.id === row.id);
      if (local && !newer(row.updatedAt, local.updatedAt)) return;
      await repository.transact(async (tx) => tx.putIdea(row));
      marksFor(row.projectId).set(row.id, { h: rowHash(row), idea: { brainstormId: row.brainstormId, authorId: row.authorId } });
    },
    async applyIdeaRemoved(row) {
      await repository.transact(async (tx) => tx.deleteIdea(row.id));
      marksFor(row.projectId).delete(row.id);
    },
    async applyDisagreement(row) {
      const local = await repository.getDisagreement(row.id);
      if (local) {
        // A settled record is never reopened; settling wins over edits.
        if (local.status === 'settled' && row.status === 'open') return;
        const settles = local.status === 'open' && row.status === 'settled';
        if (!settles && !newer(row.updatedAt, local.updatedAt)) return;
      }
      await repository.transact(async (tx) => tx.putDisagreement(row));
      marksFor(row.projectId).set(row.id, { h: rowHash(row) });
    },
    async applyDisagreementPosition(row) {
      const local = (await repository.listDisagreementPositions({ disagreementId: row.disagreementId })).find((p) => p.id === row.id);
      if (local && !newer(row.updatedAt, local.updatedAt)) return;
      await repository.transact(async (tx) => tx.putDisagreementPosition(row));
      marksFor(row.projectId).set(row.id, { h: rowHash(row) });
    },
  };
}
