import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { agendaToText, buildAgenda, loadAgenda, markMeetingHeld, type AgendaInput } from './agenda';
import { moderateDisagreement } from './moderator';
import { addPosition, attachEvidence, openDisagreement } from './brainstorm';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import type { Brainstorm, Disagreement, DisagreementPosition } from '../../domain/brainstorm';
import {
  makeClaim,
  makeClaimEvidenceLink,
  makeEvidence,
  makeResearchLocator,
  makeResearchProject,
  makeWork,
} from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';

const disagreement = (over: Partial<Disagreement>): Disagreement => ({
  id: 'd-1',
  projectId: P,
  claimId: null,
  question: 'Older adults?',
  status: 'open',
  createdBy: 'u-1',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

function input(over: Partial<AgendaInput> = {}): AgendaInput {
  const claimA = makeClaim({ id: 'c-a', title: 'Sleep helps memory' });
  const claimB = makeClaim({ id: 'c-b', title: 'Naps help too' });
  return {
    since: null,
    claims: [claimA, claimB],
    evidence: [
      makeEvidence({ id: 'e-1', projectId: P, workId: 'w-1', status: 'verified', exactQuote: 'Only students were tested.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 11 }) }),
      makeEvidence({ id: 'e-2', projectId: P, workId: 'w-1', status: 'verified', exactQuote: 'Recall improved.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 3 }) }),
    ],
    links: [
      makeClaimEvidenceLink({ id: 'l-1', claimId: 'c-a', evidenceId: 'e-2', relation: 'supports' }),
      makeClaimEvidenceLink({ id: 'l-2', claimId: 'c-a', evidenceId: 'e-1', relation: 'contradicts', createdAt: '2026-11-20T00:00:00.000Z' }),
    ],
    works: [{ id: 'w-1', title: 'Walker 2004' }],
    disagreements: [
      disagreement({ id: 'd-open', claimId: 'c-a' }),
      disagreement({
        id: 'd-settled',
        question: 'Is one study enough?',
        status: 'settled',
        outcome: { summary: 'No: find a second source.', positionId: null, settledBy: 'u-1', settledAt: '2026-11-21T00:00:00.000Z' },
      }),
    ],
    positions: [
      { id: 'v-1', projectId: P, disagreementId: 'd-open', stance: 'Yes', evidenceIds: [], authorId: 'u-1', holder: '', createdAt: 'x', updatedAt: 'x' } as DisagreementPosition,
    ],
    brainstorms: [
      { id: 'bs-1', projectId: P, prompt: 'Why?', groups: [], mode: 'group', createdBy: 'u-1', createdAt: 'x', updatedAt: 'x' } as Brainstorm,
      { id: 'bs-solo', projectId: P, prompt: 'Mine', groups: [], createdBy: 'u-1', createdAt: 'x', updatedAt: 'x' } as Brainstorm,
    ],
    ideas: [],
    ...over,
  };
}

describe('meeting agenda', () => {
  it('lists what to decide, evidence against a point, what was settled, waiting brainstorms and gaps', () => {
    const agenda = buildAgenda(input());
    expect(agenda.sections.map((s) => s.kind)).toEqual(['decide', 'counter', 'settled', 'brainstorms', 'gaps']);
    const [decide, counter, settled, brainstorms, gaps] = agenda.sections;
    expect(decide!.items[0]).toMatchObject({ title: 'Older adults?', detail: '1 view · 1 without evidence · about “Sleep helps memory”' });
    expect(counter!.items[0]).toMatchObject({
      title: 'Against “Sleep helps memory”',
      detail: '“Only students were tested.” — Walker 2004, p. 11',
      target: { kind: 'source', workId: 'w-1', pageNumber: 11 },
    });
    expect(settled!.items[0]!.detail).toBe('Decided: No: find a second source.');
    expect(brainstorms!.items.map((i) => i.target)).toEqual([{ kind: 'brainstorm', id: 'bs-1' }]);
    // “Sleep helps memory” is contested (listed above as evidence against it), not a gap.
    expect(gaps!.items.map((i) => i.title)).toEqual(['Naps help too']);
  });

  it('after a meeting, counts only what is new since then', () => {
    const agenda = buildAgenda(input({ since: '2026-11-22T00:00:00.000Z' }));
    // The open disagreement is still to decide; older counter-evidence and the earlier settlement drop off.
    expect(agenda.sections.map((s) => s.kind)).toEqual(['decide', 'brainstorms', 'gaps']);
    expect(agendaToText(agenda, 'Sleep project')).toContain('Since the last meeting (2026-11-22).');
  });

  it('says plainly when there is nothing to discuss', () => {
    const empty = buildAgenda({ ...input(), claims: [], links: [], disagreements: [], positions: [], brainstorms: [] });
    expect(empty.itemCount).toBe(0);
    expect(agendaToText(empty, 'P')).toContain('Nothing open');
  });
});

describe('meeting held and the moderator', () => {
  let repo: MemoryResearchRepository;
  beforeEach(async () => {
    repo = new MemoryResearchRepository();
    await repo.transact(async (tx) => {
      tx.putProject(makeResearchProject({ id: P }));
      tx.putWork(makeWork({ id: 'w-1', title: 'Walker 2004', projectIds: [P] }));
      tx.putEvidence(
        makeEvidence({ id: 'e-1', projectId: P, workId: 'w-1', status: 'verified', exactQuote: 'Only students were tested.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 11 }) }),
      );
    });
  });

  it('marks a meeting held, and the next agenda counts from then', async () => {
    expect((await loadAgenda(repo, P)).agenda.since).toBeNull();
    const at = await markMeetingHeld(repo, P);
    expect((await loadAgenda(repo, P)).agenda.since).toBe(at);
  });

  it('restates the views with their evidence and never decides', async () => {
    const d = await openDisagreement(repo, { projectId: P, question: 'Older adults?' }, { userId: 'u-1' });
    await expect(moderateDisagreement(repo, {} as ProviderRouter, d.id)).rejects.toThrow(/at least two views/);
    await addPosition(repo, { disagreementId: d.id, stance: 'Yes, it is general' }, { userId: 'u-1' });
    const no = await addPosition(repo, { disagreementId: d.id, stance: 'No', holder: 'Supervisor' }, { userId: 'u-1' });
    await attachEvidence(repo, { disagreementId: d.id, positionId: no.id, evidenceId: 'e-1' });
    const chat = vi.fn(async () => ({ content: ' View 1 has no evidence. ', provider: 'cloud' as const }));
    const text = await moderateDisagreement(repo, { probe: async () => ({ aiAvailable: true, providerName: 'cloud' }), chat }, d.id);
    expect(text).toBe('View 1 has no evidence.');
    const [system, user] = (chat.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages;
    expect(system!.content).toContain('Do not say which view is right');
    expect(user!.content).toContain('View 2 (Supervisor): No');
    expect(user!.content).toContain('"Only students were tested." (Walker 2004, p. 11)');
    expect(user!.content).toContain('(no evidence yet)');
  });
});
