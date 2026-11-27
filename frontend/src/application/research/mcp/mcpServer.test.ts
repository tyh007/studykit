/**
 * v0.5 P6b — an external agent talking MCP to StudyKit, end to end in
 * JSON-RPC: what it can see, what it can propose, and that nothing it
 * proposes counts until the researcher accepts or checks it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository } from '../researchRepository';
import { McpHost, type McpActivity } from './mcpServer';
import { MAX_PENDING, pendingProposals } from './agentTools';
import { AGENT_DRAFT_PREFIX } from './agentIds';
import { addPoint, citeInSlot } from '../argument';
import { decideDraft } from '../aiPartner';
import { loadProvenanceReport } from '../provenanceReport';
import { verifyEvidence } from '../researchUseCases';
import { createOutput } from '../../output/outputUseCases';
import { makeEvidence, makeResearchLocator, makeResearchProject, makeWork } from '../../../domain/__fixtures__/domain-fixtures';

const P = 'p-shared';
const HIDDEN = 'p-hidden';
let repo: MemoryResearchRepository;
let host: McpHost;
let shared: Set<string>;
let activity: McpActivity[];
let rpcId = 0;

async function call(method: string, params: Record<string, unknown> = {}, session: string | null = 'auto'): Promise<{ status?: number; json: any; sessionId?: string }> {
  rpcId += 1;
  const reply = await host.handle(JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }), session === 'auto' ? sessionId : session);
  return { ...(reply.status ? { status: reply.status } : {}), json: reply.body ? JSON.parse(reply.body) : null, ...(reply.sessionId ? { sessionId: reply.sessionId } : {}) };
}

let sessionId: string | null = null;

async function tool(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: any; text: string }> {
  const { json } = await call('tools/call', { name, arguments: args });
  const r = json.result;
  return { isError: Boolean(r.isError), data: r.structuredContent, text: r.content[0].text };
}

beforeEach(async () => {
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P, name: 'Sleep and memory', livingBrief: 'Does sleep help memory?' }));
    tx.putProject(makeResearchProject({ id: HIDDEN, name: 'Private thesis' }));
    tx.putWork(makeWork({ id: 'w-1', title: 'Walker 2004', projectIds: [P] }));
    tx.putEvidence(
      makeEvidence({ id: 'e-ok', projectId: P, workId: 'w-1', status: 'verified', exactQuote: 'Recall improved after sleep.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 3 }) }),
    );
    tx.putEvidence(
      makeEvidence({ id: 'e-unchecked', projectId: P, workId: 'w-1', status: 'candidate', exactQuote: 'Maybe it lasts years.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 9 }) }),
    );
  });
  const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
  await citeInSlot(repo, { projectId: P, claimId: point.id, slot: 'evidence', evidenceId: 'e-ok' });
  shared = new Set([P]);
  activity = [];
  host = new McpHost({ repository: repo, sharedProjectIds: () => shared, userId: () => 'u-1', onActivity: (a) => activity.push(a) });
  sessionId = null;
  const init = await call('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'Claude Desktop' } }, null);
  sessionId = init.sessionId!;
});

describe('MCP protocol', () => {
  it('initializes with the rules in its instructions, and lists read and propose tools', async () => {
    const init = await call('initialize', { protocolVersion: '1999-01-01', clientInfo: { name: 'X' } }, null);
    expect(init.json.result.protocolVersion).toBe('2025-06-18');
    expect(init.json.result.instructions).toContain('You cannot change the project directly');
    const tools = (await call('tools/list')).json.result.tools;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(['list_projects', 'get_project', 'list_sources', 'list_excerpts', 'propose_excerpt', 'propose_point']);
    expect(tools.find((t: { name: string }) => t.name === 'propose_point').annotations.readOnlyHint).toBe(false);
  });

  it('answers notifications with nothing, rejects bad JSON, and asks for a new session when it lost one', async () => {
    expect((await host.handle('{"jsonrpc":"2.0","method":"notifications/initialized"}', sessionId)).body).toBeNull();
    expect(JSON.parse((await host.handle('{oops', sessionId)).body!).error.code).toBe(-32700);
    const lost = await call('tools/list', {}, 'not-a-session');
    expect(lost.status).toBe(404);
  });
});

describe('what an agent can see', () => {
  it('sees only shared projects; every excerpt says whether the researcher checked it', async () => {
    expect((await tool('list_projects')).data.projects).toEqual([{ projectId: P, name: 'Sleep and memory', question: 'Does sleep help memory?' }]);
    const hidden = await tool('get_project', { projectId: HIDDEN });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toContain('has not shared it');

    const project = (await tool('get_project', { projectId: P })).data;
    expect(project.points[0]).toMatchObject({ title: 'Sleep helps memory', status: 'single-source', evidence: [{ excerptId: 'e-ok', page: 3 }] });
    const excerpts = (await tool('list_excerpts', { projectId: P })).data.excerpts;
    expect(excerpts.map((e: { excerptId: string; checked: boolean }) => [e.excerptId, e.checked])).toEqual([
      ['e-ok', true],
      ['e-unchecked', false],
    ]);
    expect((await tool('list_excerpts', { projectId: P, checkedOnly: true })).data.excerpts).toHaveLength(1);
    expect(activity.map((a) => [a.agent, a.tool, a.ok])).toContainEqual(['Claude Desktop', 'get_project', false]);
  });
});

describe('what an agent can propose', () => {
  it('an excerpt arrives unchecked, marked as the agent’s, and backs nothing until verified', async () => {
    const r = await tool('propose_excerpt', { projectId: P, sourceId: 'w-1', quote: 'Naps also helped.', page: 7, why: 'Shorter sleep works too' });
    expect(r.data).toMatchObject({ checked: false });
    const e = await repo.getEvidence(r.data.excerptId);
    expect(e).toMatchObject({ status: 'candidate', authorType: 'ai', userInterpretation: '', note: 'Proposed by Claude Desktop: Shorter sleep works too' });
    expect(e!.draftId!.startsWith(AGENT_DRAFT_PREFIX)).toBe(true);
    await expect(citeInSlot(repo, { projectId: P, claimId: (await repo.listClaims({ projectId: P }))[0]!.id, slot: 'evidence', evidenceId: e!.id })).rejects.toThrow();
    expect(await pendingProposals(repo, P)).toEqual({ excerpts: 1, points: 0 });

    expect((await tool('propose_excerpt', { projectId: P, sourceId: 'nope', quote: 'x' })).text).toContain('Unknown sourceId');
    expect((await tool('propose_excerpt', { projectId: P, sourceId: 'w-1', quote: 'x', page: 0 })).text).toContain('page must be');
  });

  it('a point waits as a card in a conversation named after the agent; nothing changes until accepted', async () => {
    const r = await tool('propose_point', { projectId: P, title: 'Naps consolidate memory too', why: 'See e-ok and the nap studies.' });
    expect(r.isError).toBe(false);
    expect(await repo.listClaims({ projectId: P })).toHaveLength(1);
    const [thread] = await repo.listAiThreads({ projectId: P });
    expect(thread).toMatchObject({ title: 'From Claude Desktop', visibility: 'private' });
    const [message] = await repo.listAiMessages({ threadId: thread!.id });
    expect(message).toMatchObject({ role: 'assistant', provider: { id: 'mcp', model: 'Claude Desktop' }, body: 'See e-ok and the nap studies.' });
    expect(await pendingProposals(repo, P)).toEqual({ excerpts: 0, points: 1 });

    expect((await tool('propose_point', { projectId: P, title: 'Sleep helps memory', why: 'dup' })).text).toContain('already has a point');

    await decideDraft(repo, { message: message!, draftId: message!.drafts[0]!.draftId, decision: 'applied' }, { userId: 'u-1' });
    expect((await repo.listClaims({ projectId: P })).map((c) => c.title)).toContain('Naps consolidate memory too');
    expect(await pendingProposals(repo, P)).toEqual({ excerpts: 0, points: 0 });

    // The provenance report credits the agent separately from the built-in AI.
    const proposed = await tool('propose_excerpt', { projectId: P, sourceId: 'w-1', quote: 'Naps also helped.', page: 7 });
    await verifyEvidence(repo, { evidenceId: proposed.data.excerptId, userInterpretation: 'Checked on p. 7' });
    const output = await createOutput(repo, { projectId: P, title: 'Essay' });
    const report = await loadProvenanceReport(repo, output.id);
    expect(report.ai.agents).toEqual({ names: ['Claude Desktop'], excerptsProposed: 1, excerptsChecked: 1, pointsProposed: 1, pointsAccepted: 1 });
    expect(report.ai.suggestionsApplied).toBe(0);
    expect(report.ai.excerptsSuggested).toBe(0);
    expect(report.aiStatement).toContain(
      'External AI agents connected to StudyKit (Claude Desktop) proposed 1 excerpt (1 checked and kept by the author) and proposed 1 point (1 accepted by the author); they could not change the project directly.',
    );
  });

  it('stops at the pending limit so an agent cannot flood the researcher', async () => {
    for (let i = 0; i < MAX_PENDING; i += 1) {
      expect((await tool('propose_point', { projectId: P, title: `Point ${i}`, why: 'w' })).isError).toBe(false);
    }
    const over = await tool('propose_point', { projectId: P, title: 'One more', why: 'w' });
    expect(over.isError).toBe(true);
    expect(over.text).toContain('already waiting');
  });

  it('cannot reach a project after the researcher stops sharing it', async () => {
    shared.delete(P);
    expect((await tool('propose_point', { projectId: P, title: 'T', why: 'w' })).isError).toBe(true);
    expect((await tool('list_projects')).data.projects).toEqual([]);
  });
});
