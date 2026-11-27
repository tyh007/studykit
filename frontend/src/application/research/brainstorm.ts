/**
 * StudyKit v0.5 P5 — brainstorming (diverge) and disagreements.
 *
 * Brainstorm: write one idea per card; gather cards into named groups;
 * “Turn into argument” makes each group a point, in order, in one step.
 * The AI suggests only after the user has written a few ideas of their
 * own (think first, then look); asking earlier is allowed and recorded.
 *
 * Disagreement: about a point (or free-standing). Positions state a view
 * and hang checked excerpts on it. Settling needs a written outcome, and
 * a position can only prevail if it has evidence. Settled disagreements
 * are kept as a record and can't be edited.
 */

import { nowIso, type Claim } from '../../domain/research';
import {
  isHiddenUntilReveal,
  type Brainstorm,
  type BrainstormMode,
  type Disagreement,
  type DisagreementPosition,
  type Idea,
  type IdeaGroup,
  type PositionCitation,
} from '../../domain/brainstorm';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import type { ResearchRepository } from './researchRepository';
import { orderPoints } from './argument';

export interface P5Deps {
  readonly userId: string;
  readonly idFactory?: (prefix: string) => string;
}

function id(deps: P5Deps, prefix: string): string {
  return deps.idFactory?.(prefix) ?? `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Own ideas needed before the AI offers directions. */
export const OWN_IDEAS_BEFORE_AI = 3;

async function requireBrainstorm(repository: ResearchRepository, brainstormId: string): Promise<Brainstorm> {
  const b = await repository.getBrainstorm(brainstormId);
  if (!b) throw new Error(`brainstorm ${brainstormId} not found.`);
  return b;
}

/**
 * In a group brainstorm the person who started it runs it: the prompt,
 * the groups, the reveal and the conversion are theirs. Members add,
 * edit and group their own ideas.
 */
function requireFacilitator(b: Brainstorm, deps: P5Deps | undefined, action: string): void {
  if (b.mode !== 'group') return;
  if (deps?.userId !== b.createdBy) throw new Error(`${action}: only the person who started this group brainstorm can do that.`);
}

function requireRevealed(b: Brainstorm, action: string): void {
  if (isHiddenUntilReveal(b)) throw new Error(`${action}: reveal everyone's ideas first.`);
}

async function putBrainstorm(repository: ResearchRepository, b: Brainstorm): Promise<Brainstorm> {
  await repository.transact(async (tx) => tx.putBrainstorm(b));
  return b;
}

// ---------------------------------------------------------------------------
// Brainstorm
// ---------------------------------------------------------------------------

export async function startBrainstorm(
  repository: ResearchRepository,
  input: { projectId: string; prompt: string },
  deps: P5Deps,
): Promise<Brainstorm> {
  const now = nowIso();
  return putBrainstorm(repository, {
    id: id(deps, 'bs'),
    projectId: input.projectId,
    prompt: input.prompt.trim(),
    groups: [],
    createdBy: deps.userId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updatePrompt(repository: ResearchRepository, brainstormId: string, prompt: string, deps?: P5Deps): Promise<Brainstorm> {
  const b = await requireBrainstorm(repository, brainstormId);
  requireFacilitator(b, deps, 'updatePrompt');
  return putBrainstorm(repository, { ...b, prompt: prompt.trim(), updatedAt: nowIso() });
}

/**
 * Solo (this device only) or group (brainwriting: everyone writes on
 * their own, then the ideas are revealed together). Chosen before the
 * first idea; fixed after that.
 */
export async function setBrainstormMode(
  repository: ResearchRepository,
  brainstormId: string,
  mode: BrainstormMode,
  deps: P5Deps,
): Promise<Brainstorm> {
  const b = await requireBrainstorm(repository, brainstormId);
  if (b.createdBy !== deps.userId) throw new Error('setBrainstormMode: only the person who started it can change who writes.');
  if ((b.mode ?? 'solo') === mode) return b;
  if ((await repository.listIdeas({ brainstormId })).length > 0) {
    throw new Error('setBrainstormMode: choose who writes before the first idea.');
  }
  return putBrainstorm(repository, { ...b, mode, updatedAt: nowIso() });
}

/** Brainwriting: show everyone's ideas at once. One-way. */
export async function revealIdeas(repository: ResearchRepository, brainstormId: string, deps: P5Deps): Promise<Brainstorm> {
  const b = await requireBrainstorm(repository, brainstormId);
  if (b.mode !== 'group') throw new Error('revealIdeas: only a group brainstorm has ideas to reveal.');
  requireFacilitator(b, deps, 'revealIdeas');
  if (b.revealedAt) return b;
  const now = nowIso();
  return putBrainstorm(repository, { ...b, revealedAt: now, updatedAt: now });
}

/** The ideas this user may see: before the reveal, only their own. */
export function visibleIdeas(b: Brainstorm, ideas: readonly Idea[], userId: string): Idea[] {
  return isHiddenUntilReveal(b) ? ideas.filter((i) => i.authorId === userId) : [...ideas];
}

/**
 * The moderator's note after a reveal: ideas nobody has picked up yet
 * (not in any group), and how many of them came from other members.
 */
export function unpickedIdeas(ideas: readonly Idea[], userId: string): { readonly total: number; readonly fromOthers: number } {
  const loose = ideas.filter((i) => i.groupId === null);
  return { total: loose.length, fromOthers: loose.filter((i) => i.authorId !== userId).length };
}

export async function addIdea(
  repository: ResearchRepository,
  input: { brainstormId: string; text: string; groupId?: string | null; fromAi?: boolean },
  deps: P5Deps,
): Promise<Idea> {
  const text = input.text.trim();
  if (!text) throw new Error('addIdea: an idea needs some words.');
  const b = await requireBrainstorm(repository, input.brainstormId);
  if (input.groupId && !b.groups.some((g) => g.id === input.groupId)) throw new Error('addIdea: unknown group.');
  if (input.groupId) requireRevealed(b, 'addIdea');
  const ideas = await repository.listIdeas({ brainstormId: b.id });
  const now = nowIso();
  const idea: Idea = {
    id: id(deps, 'idea'),
    projectId: b.projectId,
    brainstormId: b.id,
    text: text.slice(0, 2000),
    groupId: input.groupId ?? null,
    // Monotonic even when several ideas are added at once (fast typing):
    // never below the clock, never below the last idea + 1.
    order: Math.max(Date.now(), ideas.reduce((m, i) => Math.max(m, i.order + 1), 0)),
    authorId: deps.userId,
    authorType: input.fromAi ? 'ai' : 'user',
    createdAt: now,
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putIdea(idea);
    // A group brainstorm's row is the facilitator's; members only add ideas.
    if (b.mode !== 'group') tx.putBrainstorm({ ...b, updatedAt: now });
  });
  return idea;
}

function requireOwnIdea(b: Brainstorm, idea: Idea, deps: P5Deps | undefined, action: string): void {
  if (b.mode === 'group' && deps?.userId !== idea.authorId) throw new Error(`${action}: you can only change your own ideas.`);
}

export async function editIdea(
  repository: ResearchRepository,
  ideaId: string,
  text: string,
  brainstormId: string,
  deps?: P5Deps,
): Promise<void> {
  const t = text.trim();
  const b = await requireBrainstorm(repository, brainstormId);
  const idea = (await repository.listIdeas({ brainstormId })).find((i) => i.id === ideaId);
  if (!idea) throw new Error(`editIdea: idea ${ideaId} not found.`);
  requireOwnIdea(b, idea, deps, 'editIdea');
  await repository.transact(async (tx) => {
    if (t) tx.putIdea({ ...idea, text: t.slice(0, 2000), updatedAt: nowIso() });
    else tx.deleteIdea(ideaId);
  });
}

export async function removeIdea(repository: ResearchRepository, ideaId: string, brainstormId: string, deps?: P5Deps): Promise<void> {
  const b = await requireBrainstorm(repository, brainstormId);
  const idea = (await repository.listIdeas({ brainstormId })).find((i) => i.id === ideaId);
  if (!idea) return;
  requireOwnIdea(b, idea, deps, 'removeIdea');
  await repository.transact(async (tx) => tx.deleteIdea(ideaId));
}

/** Put an idea in a group (or back to ungrouped with null). */
export async function moveIdea(
  repository: ResearchRepository,
  input: { brainstormId: string; ideaId: string; groupId: string | null },
): Promise<void> {
  const b = await requireBrainstorm(repository, input.brainstormId);
  requireRevealed(b, 'moveIdea');
  if (input.groupId && !b.groups.some((g) => g.id === input.groupId)) throw new Error('moveIdea: unknown group.');
  const idea = (await repository.listIdeas({ brainstormId: b.id })).find((i) => i.id === input.ideaId);
  if (!idea) throw new Error(`moveIdea: idea ${input.ideaId} not found.`);
  if (idea.groupId === input.groupId) return;
  await repository.transact(async (tx) => tx.putIdea({ ...idea, groupId: input.groupId, updatedAt: nowIso() }));
}

export async function addGroup(
  repository: ResearchRepository,
  input: { brainstormId: string; title: string; ideaIds?: readonly string[] },
  deps: P5Deps,
): Promise<IdeaGroup> {
  const title = input.title.trim();
  if (!title) throw new Error('addGroup: a group needs a name.');
  const b = await requireBrainstorm(repository, input.brainstormId);
  requireFacilitator(b, deps, 'addGroup');
  requireRevealed(b, 'addGroup');
  const group: IdeaGroup = { id: id(deps, 'grp'), title, order: b.groups.reduce((m, g) => Math.max(m, g.order + 1), 0) };
  const now = nowIso();
  const ideas = input.ideaIds?.length ? await repository.listIdeas({ brainstormId: b.id }) : [];
  await repository.transact(async (tx) => {
    tx.putBrainstorm({ ...b, groups: [...b.groups, group], updatedAt: now });
    for (const idea of ideas) if (input.ideaIds!.includes(idea.id)) tx.putIdea({ ...idea, groupId: group.id, updatedAt: now });
  });
  return group;
}

export async function renameGroup(
  repository: ResearchRepository,
  brainstormId: string,
  groupId: string,
  title: string,
  deps?: P5Deps,
): Promise<void> {
  const t = title.trim();
  if (!t) throw new Error('renameGroup: a group needs a name.');
  const b = await requireBrainstorm(repository, brainstormId);
  requireFacilitator(b, deps, 'renameGroup');
  await putBrainstorm(repository, {
    ...b,
    groups: b.groups.map((g) => (g.id === groupId ? { ...g, title: t } : g)),
    updatedAt: nowIso(),
  });
}

/** Remove a group; its ideas go back to ungrouped. */
export async function removeGroup(repository: ResearchRepository, brainstormId: string, groupId: string, deps?: P5Deps): Promise<void> {
  const b = await requireBrainstorm(repository, brainstormId);
  requireFacilitator(b, deps, 'removeGroup');
  const ideas = await repository.listIdeas({ brainstormId });
  const now = nowIso();
  await repository.transact(async (tx) => {
    tx.putBrainstorm({ ...b, groups: b.groups.filter((g) => g.id !== groupId), updatedAt: now });
    for (const i of ideas) if (i.groupId === groupId) tx.putIdea({ ...i, groupId: null, updatedAt: now });
  });
}

export async function moveGroup(
  repository: ResearchRepository,
  brainstormId: string,
  groupId: string,
  offset: -1 | 1,
  deps?: P5Deps,
): Promise<void> {
  const b = await requireBrainstorm(repository, brainstormId);
  requireFacilitator(b, deps, 'moveGroup');
  const groups = [...b.groups].sort((x, y) => x.order - y.order);
  const from = groups.findIndex((g) => g.id === groupId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= groups.length) return;
  const [g] = groups.splice(from, 1);
  groups.splice(to, 0, g!);
  await putBrainstorm(repository, { ...b, groups: groups.map((x, i) => ({ ...x, order: i })), updatedAt: nowIso() });
}

/**
 * Turn the groups into argument points, in group order, in one step.
 * Each group with at least one idea becomes a point titled with the
 * group's name; groups converted earlier (they remember their point)
 * are skipped, so running it again only adds new groups.
 */
export async function convertToArgument(
  repository: ResearchRepository,
  brainstormId: string,
  deps: P5Deps,
): Promise<readonly Claim[]> {
  const b = await requireBrainstorm(repository, brainstormId);
  requireFacilitator(b, deps, 'convertToArgument');
  requireRevealed(b, 'convertToArgument');
  const ideas = await repository.listIdeas({ brainstormId });
  const existing = orderPoints(await repository.listClaims({ projectId: b.projectId }));
  const now = nowIso();
  const toConvert = [...b.groups]
    .sort((x, y) => x.order - y.order)
    .filter((g) => !g.claimId && ideas.some((i) => i.groupId === g.id));
  if (toConvert.length === 0) throw new Error('convertToArgument: name a group and put ideas in it first.');
  const claims: Claim[] = toConvert.map((g, i) => ({
    id: id(deps, 'c'),
    projectId: b.projectId,
    title: g.title,
    body: '',
    status: 'canonical',
    aiSuggested: false,
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
    argument: { order: existing.length + i },
  }));
  const claimByGroup = new Map(toConvert.map((g, i) => [g.id, claims[i]!.id]));
  const next: Brainstorm = {
    ...b,
    groups: b.groups.map((g) => (claimByGroup.has(g.id) ? { ...g, claimId: claimByGroup.get(g.id)! } : g)),
    convertedAt: now,
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    existing.forEach((c, i) => {
      if (c.argument?.order !== i) tx.putClaim({ ...c, argument: { ...c.argument, order: i }, updatedAt: now });
    });
    for (const c of claims) tx.putClaim(c);
    tx.putBrainstorm(next);
  });
  return claims;
}

// ---------------------------------------------------------------------------
// AI: directions you haven't covered
// ---------------------------------------------------------------------------

export async function suggestDirections(
  repository: ResearchRepository,
  router: ProviderRouter,
  input: { brainstormId: string; early: boolean; userId?: string },
): Promise<string[]> {
  const b = await requireBrainstorm(repository, input.brainstormId);
  // Before a reveal the AI sees only this member's ideas, like they do.
  const ideas = (await repository.listIdeas({ brainstormId: b.id })).filter(
    (i) => i.authorType === 'user' && (!isHiddenUntilReveal(b) || i.authorId === input.userId),
  );
  if (!input.early && ideas.length < OWN_IDEAS_BEFORE_AI) {
    throw new Error(`suggestDirections: write ${OWN_IDEAS_BEFORE_AI} ideas of your own first.`);
  }
  if (input.early && !b.askedAiEarly && b.mode !== 'group') await putBrainstorm(repository, { ...b, askedAiEarly: true, updatedAt: nowIso() });
  const response = await router.chat({
    messages: [
      {
        role: 'system',
        content: [
          'You help a researcher brainstorm. Do not repeat, merge or polish their ideas.',
          'Name at most three directions they have not covered, one per line, each under 15 words.',
          'No numbering, no preamble, no conclusion.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Topic: ${b.prompt || '(not stated)'}\nMy ideas so far:\n${ideas.map((i) => `- ${i.text}`).join('\n') || '(none yet)'}`,
      },
    ],
  });
  return response.content
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0 && l.length <= 300)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Disagreements
// ---------------------------------------------------------------------------

async function requireOpen(repository: ResearchRepository, disagreementId: string): Promise<Disagreement> {
  const d = await repository.getDisagreement(disagreementId);
  if (!d) throw new Error(`disagreement ${disagreementId} not found.`);
  if (d.status === 'settled') throw new Error('This disagreement is settled and kept as a record. Open a new one to revisit it.');
  return d;
}

export async function openDisagreement(
  repository: ResearchRepository,
  input: { projectId: string; question: string; claimId?: string | null },
  deps: P5Deps,
): Promise<Disagreement> {
  const question = input.question.trim();
  if (!question) throw new Error('openDisagreement: say what is in dispute.');
  let pointTitle: string | undefined;
  if (input.claimId) {
    const claim = await repository.getClaim(input.claimId);
    if (!claim || claim.projectId !== input.projectId) throw new Error('openDisagreement: unknown point.');
    pointTitle = claim.title;
  }
  const now = nowIso();
  const d: Disagreement = {
    id: id(deps, 'dis'),
    projectId: input.projectId,
    claimId: input.claimId ?? null,
    ...(pointTitle ? { pointTitle } : {}),
    question,
    status: 'open',
    createdBy: deps.userId,
    createdAt: now,
    updatedAt: now,
  };
  await repository.transact(async (tx) => tx.putDisagreement(d));
  return d;
}

export async function addPosition(
  repository: ResearchRepository,
  input: { disagreementId: string; stance: string; holder?: string },
  deps: P5Deps,
): Promise<DisagreementPosition> {
  const d = await requireOpen(repository, input.disagreementId);
  const stance = input.stance.trim();
  if (!stance) throw new Error('addPosition: state the view in a sentence.');
  const now = nowIso();
  const p: DisagreementPosition = {
    id: id(deps, 'pos'),
    projectId: d.projectId,
    disagreementId: d.id,
    stance,
    evidenceIds: [],
    authorId: deps.userId,
    holder: input.holder?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putDisagreementPosition(p);
    tx.putDisagreement({ ...d, updatedAt: now });
  });
  return p;
}

async function requirePosition(repository: ResearchRepository, positionId: string, disagreementId: string): Promise<DisagreementPosition> {
  const p = (await repository.listDisagreementPositions({ disagreementId })).find((x) => x.id === positionId);
  if (!p) throw new Error(`position ${positionId} not found.`);
  return p;
}

/** Back a position with a checked excerpt. */
export async function attachEvidence(
  repository: ResearchRepository,
  input: { disagreementId: string; positionId: string; evidenceId: string },
): Promise<void> {
  const d = await requireOpen(repository, input.disagreementId);
  const p = await requirePosition(repository, input.positionId, d.id);
  const e = await repository.getEvidence(input.evidenceId);
  if (!e || e.projectId !== d.projectId) throw new Error('attachEvidence: excerpt not found in this project.');
  if (e.status !== 'verified') throw new Error('attachEvidence: only checked excerpts can back a position.');
  if (p.evidenceIds.includes(e.id)) return;
  const work = await repository.getWork(e.workId);
  const citation: PositionCitation = {
    evidenceId: e.id,
    quote: e.exactQuote.slice(0, 4000),
    source: work?.title || 'Untitled source',
    ...(e.locator.pageNumber ? { pageNumber: e.locator.pageNumber } : {}),
  };
  const now = nowIso();
  await repository.transact(async (tx) => {
    tx.putDisagreementPosition({
      ...p,
      evidenceIds: [...p.evidenceIds, e.id],
      citations: [...(p.citations ?? []).filter((c) => c.evidenceId !== e.id), citation],
      updatedAt: now,
    });
    tx.putDisagreement({ ...d, updatedAt: now });
  });
}

export async function detachEvidence(
  repository: ResearchRepository,
  input: { disagreementId: string; positionId: string; evidenceId: string },
): Promise<void> {
  const d = await requireOpen(repository, input.disagreementId);
  const p = await requirePosition(repository, input.positionId, d.id);
  await repository.transact(async (tx) =>
    tx.putDisagreementPosition({
      ...p,
      evidenceIds: p.evidenceIds.filter((x) => x !== input.evidenceId),
      ...(p.citations ? { citations: p.citations.filter((c) => c.evidenceId !== input.evidenceId) } : {}),
      updatedAt: nowIso(),
    }),
  );
}

/**
 * Settle with a written outcome. A position can only prevail if it is
 * backed by evidence; “neither / both in part” (null) needs only the
 * summary. Settled disagreements are a permanent record.
 */
export async function settleDisagreement(
  repository: ResearchRepository,
  input: { disagreementId: string; summary: string; positionId: string | null },
  deps: P5Deps,
): Promise<Disagreement> {
  const d = await requireOpen(repository, input.disagreementId);
  const summary = input.summary.trim();
  if (!summary) throw new Error('settleDisagreement: write down what was decided and why.');
  const positions = await repository.listDisagreementPositions({ disagreementId: d.id });
  if (positions.length === 0) throw new Error('settleDisagreement: add at least one position first.');
  if (input.positionId) {
    const p = positions.find((x) => x.id === input.positionId);
    if (!p) throw new Error('settleDisagreement: unknown position.');
    if (p.evidenceIds.length === 0) throw new Error('settleDisagreement: a view can only prevail with evidence behind it.');
  }
  const now = nowIso();
  const settled: Disagreement = {
    ...d,
    status: 'settled',
    outcome: { summary, positionId: input.positionId, settledBy: deps.userId, settledAt: now },
    updatedAt: now,
  };
  await repository.transact(async (tx) => tx.putDisagreement(settled));
  return settled;
}
