/**
 * StudyKit v0.5 P6b — what external AI agents may do with a project.
 *
 * The rules that make StudyKit a research ledger, applied to agents the
 * same way as to the built-in AI:
 *
 *   - Agents see only projects the user shared with them, and every
 *     excerpt says whether the user checked it against the source.
 *   - Agents never write final content. They can propose an excerpt
 *     (stored as an unchecked excerpt the user verifies at the source
 *     page) or propose a point (an accept/reject card in the project AI
 *     panel, in a conversation named after the agent). Accepting or
 *     rejecting is recorded, as for the built-in AI.
 *   - Everything an agent proposes is marked as coming from that agent,
 *     and the provenance report counts it.
 *   - At most MAX_PENDING proposals per project wait at once, so an
 *     agent cannot flood the user.
 */

import { nowIso, type Claim, type Evidence, type ResearchSourceLocator } from '../../../domain/research';
import type { AiMessage, AiThread } from '../../../domain/aiThread';
import { buildLedger } from '../ledger';
import { buildArgument } from '../argument';
import { createEvidenceDraft } from '../researchUseCases';
import type { ResearchRepository } from '../researchRepository';
import { AGENT_DRAFT_PREFIX, AGENT_PROVIDER_ID } from './agentIds';

export const MAX_PENDING = 20;
export const MAX_QUOTE_CHARS = 2000;
export const MAX_TITLE_CHARS = 300;
export const MAX_WHY_CHARS = 2000;

export { AGENT_DRAFT_PREFIX, AGENT_PROVIDER_ID };

export interface AgentContext {
  readonly repository: ResearchRepository;
  /** Projects the user shared with agents. */
  readonly sharedProjectIds: ReadonlySet<string>;
  /** The agent's name as it introduced itself (e.g. "Claude Desktop"). */
  readonly agentName: string;
  /** The StudyKit user on this device. */
  readonly userId: string;
  readonly idFactory?: (prefix: string) => string;
}

/** An error the agent should see and can act on. */
export class AgentToolError extends Error {}

function newId(ctx: AgentContext, prefix: string): string {
  return ctx.idFactory?.(prefix) ?? `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function requireShared(ctx: AgentContext, projectId: unknown): Promise<string> {
  if (typeof projectId !== 'string' || !ctx.sharedProjectIds.has(projectId)) {
    throw new AgentToolError('Unknown project, or the researcher has not shared it with AI agents. Call list_projects.');
  }
  if (!(await ctx.repository.getProject(projectId))) throw new AgentToolError('That project no longer exists.');
  return projectId;
}

function text(v: unknown, name: string, max: number, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw new AgentToolError(`${name} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new AgentToolError(`${name} must be a string.`);
  const t = v.trim();
  if (required && !t) throw new AgentToolError(`${name} is required.`);
  if (t.length > max) throw new AgentToolError(`${name} is longer than ${max} characters.`);
  return t;
}

function pageOf(e: Evidence): number | undefined {
  const n = (e.locator as { pageNumber?: unknown }).pageNumber;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listProjects(ctx: AgentContext): Promise<unknown> {
  const projects = await ctx.repository.listProjects();
  return {
    projects: projects
      .filter((p) => ctx.sharedProjectIds.has(p.id))
      .map((p) => ({ projectId: p.id, name: p.name, question: p.livingBrief })),
  };
}

export async function getProject(ctx: AgentContext, args: Record<string, unknown>): Promise<unknown> {
  const projectId = await requireShared(ctx, args.projectId);
  const [project, claims, evidence, links, works, disagreements] = await Promise.all([
    ctx.repository.getProject(projectId),
    ctx.repository.listClaims({ projectId }),
    ctx.repository.listEvidence({ projectId }),
    ctx.repository.listLinks({ projectId }),
    ctx.repository.listWorks({ projectId }),
    ctx.repository.listDisagreements({ projectId }),
  ]);
  const canonical = claims.filter((c) => c.status === 'canonical');
  const ledger = buildLedger({ claims: canonical, evidence, links });
  const argument = buildArgument({ claims: canonical, evidence, links, works });
  const status = new Map(ledger.points.map((p) => [p.claim.id, p.status]));
  const cite = (c: { evidenceId: string; workTitle: string; pageNumber?: number; quote: string }) => ({
    excerptId: c.evidenceId,
    quote: c.quote,
    source: c.workTitle,
    ...(c.pageNumber ? { page: c.pageNumber } : {}),
  });
  return {
    projectId,
    name: project?.name ?? '',
    question: project?.livingBrief ?? '',
    points: argument.points.map((p) => ({
      pointId: p.claim.id,
      title: p.claim.title,
      reasoning: p.reasoning,
      status: status.get(p.claim.id) ?? 'no-support',
      evidence: p.evidence.map(cite),
      counterEvidence: p.counter.map(cite),
      limits: p.limits.map(cite),
      missing: p.gaps,
    })),
    openDisagreements: disagreements.filter((d) => d.status === 'open').map((d) => ({ question: d.question, pointId: d.claimId })),
    note: 'Every excerpt listed under a point was checked by the researcher against the source page.',
  };
}

export async function listSources(ctx: AgentContext, args: Record<string, unknown>): Promise<unknown> {
  const projectId = await requireShared(ctx, args.projectId);
  const works = await ctx.repository.listWorks({ projectId });
  return {
    sources: works.map((w) => ({
      sourceId: w.id,
      title: w.title,
      authors: w.authors,
      ...(w.year ? { year: w.year } : {}),
      ...(w.identifiers?.doi ? { doi: w.identifiers.doi } : {}),
    })),
  };
}

export async function listExcerpts(ctx: AgentContext, args: Record<string, unknown>): Promise<unknown> {
  const projectId = await requireShared(ctx, args.projectId);
  const checkedOnly = args.checkedOnly === true;
  const [evidence, works] = await Promise.all([ctx.repository.listEvidence({ projectId }), ctx.repository.listWorks({ projectId })]);
  const titles = new Map(works.map((w) => [w.id, w.title]));
  return {
    excerpts: evidence
      .filter((e) => e.status !== 'rejected' && (!checkedOnly || e.status === 'verified'))
      .map((e) => {
        const page = pageOf(e);
        return {
          excerptId: e.id,
          sourceId: e.workId,
          source: titles.get(e.workId) ?? '',
          ...(page ? { page } : {}),
          quote: e.exactQuote,
          checked: e.status === 'verified',
          ...(e.status === 'verified' && e.userInterpretation ? { researcherNote: e.userInterpretation } : {}),
        };
      }),
    note: 'checked: true means the researcher verified the quote at that page. Treat unchecked excerpts as unconfirmed.',
  };
}

// ---------------------------------------------------------------------------
// Propose (drafts only)
// ---------------------------------------------------------------------------

/** The conversation that records what this agent did in a project. */
async function agentThread(ctx: AgentContext, projectId: string): Promise<AiThread> {
  const title = `From ${ctx.agentName}`;
  const existing = (await ctx.repository.listAiThreads({ projectId })).find((t) => t.title === title && t.archivedAt === null);
  if (existing) return existing;
  const now = nowIso();
  const thread: AiThread = {
    id: newId(ctx, 'thr'),
    projectId,
    title,
    // Proposals stay on this device until the user decides on them.
    visibility: 'private',
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await ctx.repository.transact(async (tx) => tx.putAiThread(thread));
  return thread;
}

/** Proposals from any agent still waiting for the user in this project. */
export async function pendingProposals(repository: ResearchRepository, projectId: string): Promise<{ excerpts: number; points: number }> {
  const [evidence, threads] = await Promise.all([repository.listEvidence({ projectId }), repository.listAiThreads({ projectId })]);
  const excerpts = evidence.filter((e) => e.status === 'candidate' && e.draftId?.startsWith(AGENT_DRAFT_PREFIX)).length;
  let points = 0;
  for (const t of threads) {
    const [messages, decisions] = await Promise.all([repository.listAiMessages({ threadId: t.id }), repository.listAiDraftDecisions({ threadId: t.id })]);
    const decided = new Set(decisions.map((d) => d.draftId));
    for (const m of messages) if (m.provider?.id === AGENT_PROVIDER_ID) points += m.drafts.filter((d) => !decided.has(d.draftId)).length;
  }
  return { excerpts, points };
}

async function requireRoom(ctx: AgentContext, projectId: string): Promise<void> {
  const p = await pendingProposals(ctx.repository, projectId);
  if (p.excerpts + p.points >= MAX_PENDING) {
    throw new AgentToolError(`${MAX_PENDING} proposals are already waiting for the researcher. Wait until they have reviewed them.`);
  }
}

async function record(ctx: AgentContext, thread: AiThread, body: string, extra: Partial<AiMessage> = {}): Promise<AiMessage> {
  const message: AiMessage = {
    id: newId(ctx, 'msg'),
    threadId: thread.id,
    projectId: thread.projectId,
    role: 'assistant',
    authorId: ctx.userId,
    body: body.slice(0, 60_000),
    context: [],
    drafts: [],
    provider: { id: AGENT_PROVIDER_ID, model: ctx.agentName },
    status: 'complete',
    createdAt: nowIso(),
    ...extra,
  };
  await ctx.repository.transact(async (tx) => {
    tx.appendAiMessage(message);
    tx.putAiThread({ ...thread, updatedAt: message.createdAt });
  });
  return message;
}

export async function proposeExcerpt(ctx: AgentContext, args: Record<string, unknown>): Promise<unknown> {
  const projectId = await requireShared(ctx, args.projectId);
  const sourceId = text(args.sourceId, 'sourceId', 200);
  const quote = text(args.quote, 'quote', MAX_QUOTE_CHARS);
  const why = text(args.why, 'why', MAX_WHY_CHARS, false);
  const page = args.page;
  if (page !== undefined && (typeof page !== 'number' || !Number.isInteger(page) || page < 1)) {
    throw new AgentToolError('page must be a whole number from 1.');
  }
  const work = await ctx.repository.getWork(sourceId);
  if (!work || !(work.projectIds ?? []).includes(projectId)) throw new AgentToolError('Unknown sourceId in this project. Call list_sources.');
  await requireRoom(ctx, projectId);

  const assets = await ctx.repository.listWorkAssetsForWork(work.id);
  const pdf = assets.find((a) => a.kind !== 'oa-url');
  const now = nowIso();
  const locator: ResearchSourceLocator =
    pdf && typeof page === 'number'
      ? { kind: 'paper-page', workId: work.id, assetId: pdf.id, pageNumber: page, capturedAt: now }
      : { kind: 'paper-work', workId: work.id, ...(typeof page === 'number' ? { pageNumber: page } : {}), capturedAt: now };

  const thread = await agentThread(ctx, projectId);
  const message = await record(
    ctx,
    thread,
    `Proposed an excerpt from ${work.title}${typeof page === 'number' ? `, p. ${page}` : ''}: “${quote}”${why ? `\n\nWhy: ${why}` : ''}\n\nIt is unchecked until you verify it at the source.`,
  );
  // An unchecked excerpt: the researcher's interpretation is empty, so it
  // cannot back anything until they verify it.
  const draft = await createEvidenceDraft(ctx.repository, {
    projectId,
    workId: work.id,
    locator,
    exactQuote: quote,
    evidenceType: 'finding',
  });
  const evidence: Evidence = {
    ...draft,
    draftId: `${AGENT_DRAFT_PREFIX}${message.id}`,
    note: `Proposed by ${ctx.agentName}${why ? `: ${why}` : ''}`.slice(0, 2000),
    ...(why ? { aiCandidateInterpretation: why } : {}),
  };
  await ctx.repository.transact(async (tx) => tx.putEvidence(evidence));
  return {
    excerptId: evidence.id,
    checked: false,
    message: 'Saved as an unchecked excerpt. The researcher has to verify it at the source before it can back anything.',
  };
}

export async function proposePoint(ctx: AgentContext, args: Record<string, unknown>): Promise<unknown> {
  const projectId = await requireShared(ctx, args.projectId);
  const title = text(args.title, 'title', MAX_TITLE_CHARS);
  const why = text(args.why, 'why', MAX_WHY_CHARS);
  await requireRoom(ctx, projectId);
  const existing: Claim[] = await ctx.repository.listClaims({ projectId });
  if (existing.some((c) => c.title.trim().toLowerCase() === title.toLowerCase())) {
    throw new AgentToolError('The argument already has a point with that title.');
  }
  const thread = await agentThread(ctx, projectId);
  await record(ctx, thread, why, {
    drafts: [
      {
        draftId: newId(ctx, 'draft'),
        actionId: 'add-point',
        target: { kind: 'argument', id: projectId },
        summary: title.length > 200 ? `${title.slice(0, 200)}…` : title,
        args: { title },
      },
    ],
  });
  return {
    message: `Proposed. The researcher sees it in the project AI panel under “From ${ctx.agentName}” and decides whether to add it.`,
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly readOnly: boolean;
  readonly run: (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;
}

const projectIdProp = { projectId: { type: 'string', description: 'From list_projects.' } };

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'list_projects',
    description: 'Research projects the researcher shared with AI agents.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    run: (ctx) => listProjects(ctx),
  },
  {
    name: 'get_project',
    description:
      'The research question and the argument: each point with its status (supported, single-source, contested, no-support), the checked excerpts for, against and limiting it, and what is still missing. Also open disagreements.',
    inputSchema: { type: 'object', properties: projectIdProp, required: ['projectId'] },
    readOnly: true,
    run: getProject,
  },
  {
    name: 'list_sources',
    description: 'Papers and other sources in the project.',
    inputSchema: { type: 'object', properties: projectIdProp, required: ['projectId'] },
    readOnly: true,
    run: listSources,
  },
  {
    name: 'list_excerpts',
    description: 'Excerpts (quotes with page). checked: true means the researcher verified it at the source; anything else is unconfirmed.',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp, checkedOnly: { type: 'boolean', description: 'Only excerpts the researcher checked.' } },
      required: ['projectId'],
    },
    readOnly: true,
    run: listExcerpts,
  },
  {
    name: 'propose_excerpt',
    description:
      'Propose a quote from one of the project’s sources. It is saved as an unchecked excerpt; it cannot back any point until the researcher verifies it at the source page. Quote word for word; give the page.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        sourceId: { type: 'string', description: 'From list_sources.' },
        quote: { type: 'string', description: 'Exact words from the source.' },
        page: { type: 'integer', minimum: 1 },
        why: { type: 'string', description: 'Why it matters for the project.' },
      },
      required: ['projectId', 'sourceId', 'quote'],
    },
    readOnly: false,
    run: proposeExcerpt,
  },
  {
    name: 'propose_point',
    description:
      'Propose a new point for the argument. The researcher sees it as a suggestion and decides whether to add it; nothing changes until they do.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        title: { type: 'string', description: 'The point, in one sentence.' },
        why: { type: 'string', description: 'Why you suggest it, citing excerptIds where you can.' },
      },
      required: ['projectId', 'title', 'why'],
    },
    readOnly: false,
    run: proposePoint,
  },
];
