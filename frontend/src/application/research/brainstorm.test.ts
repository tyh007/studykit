import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import {
  addGroup,
  addIdea,
  addPosition,
  attachEvidence,
  convertToArgument,
  detachEvidence,
  editIdea,
  moveGroup,
  moveIdea,
  openDisagreement,
  removeGroup,
  revealIdeas,
  setBrainstormMode,
  settleDisagreement,
  startBrainstorm,
  suggestDirections,
  unpickedIdeas,
  updatePrompt,
  visibleIdeas,
} from './brainstorm';
import { addPoint, orderPoints } from './argument';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import { makeEvidence, makeResearchLocator, makeResearchProject } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
let repo: MemoryResearchRepository;
let n = 0;
const deps = { userId: 'u-1', idFactory: (p: string) => `${p}-${++n}` };

beforeEach(async () => {
  n = 0;
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P }));
    tx.putEvidence(makeEvidence({ id: 'e-ok', projectId: P, workId: 'w-1', status: 'verified', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 3 }) }));
    tx.putEvidence(makeEvidence({ id: 'e-cand', projectId: P, workId: 'w-1', status: 'candidate', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 4 }) }));
  });
});

describe('brainstorm', () => {
  it('collects ideas, groups them, and turns groups into argument points in one step', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: ' Why might sleep help memory? ' }, deps);
    expect(b.prompt).toBe('Why might sleep help memory?');
    const a = await addIdea(repo, { brainstormId: b.id, text: 'Replay during slow-wave sleep' }, deps);
    const c = await addIdea(repo, { brainstormId: b.id, text: 'Less interference while asleep' }, deps);
    const d = await addIdea(repo, { brainstormId: b.id, text: 'Naps show it too' }, deps);
    await expect(addIdea(repo, { brainstormId: b.id, text: '  ' }, deps)).rejects.toThrow(/needs some words/);

    const mech = await addGroup(repo, { brainstormId: b.id, title: 'Sleep actively consolidates', ideaIds: [a.id] }, deps);
    const passive = await addGroup(repo, { brainstormId: b.id, title: 'Sleep protects from interference' }, deps);
    await moveIdea(repo, { brainstormId: b.id, ideaId: c.id, groupId: passive.id });
    await addGroup(repo, { brainstormId: b.id, title: 'Empty group' }, deps);
    await moveGroup(repo, b.id, passive.id, -1);
    void d; // stays ungrouped

    // An existing point stays first.
    await addPoint(repo, { projectId: P, title: 'Existing point' });
    const claims = await convertToArgument(repo, b.id, deps);
    expect(claims.map((x) => x.title)).toEqual(['Sleep protects from interference', 'Sleep actively consolidates']);
    expect(orderPoints(await repo.listClaims({ projectId: P })).map((x) => x.title)).toEqual([
      'Existing point',
      'Sleep protects from interference',
      'Sleep actively consolidates',
    ]);
    const after = await repo.getBrainstorm(b.id);
    expect(after?.groups.find((g) => g.id === mech.id)?.claimId).toBe(claims[1]!.id);

    // Running it again adds only new groups.
    await expect(convertToArgument(repo, b.id, deps)).rejects.toThrow(/name a group/);
    const late = await addGroup(repo, { brainstormId: b.id, title: 'Timing matters', ideaIds: [d.id] }, deps);
    expect((await convertToArgument(repo, b.id, deps)).map((x) => x.title)).toEqual([late.title]);
  });

  it('edits, empties and ungroups ideas', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: '' }, deps);
    const i = await addIdea(repo, { brainstormId: b.id, text: 'x' }, deps);
    const g = await addGroup(repo, { brainstormId: b.id, title: 'G', ideaIds: [i.id] }, deps);
    await editIdea(repo, i.id, 'y', b.id);
    expect((await repo.listIdeas({ brainstormId: b.id }))[0]).toMatchObject({ text: 'y', groupId: g.id });
    await removeGroup(repo, b.id, g.id);
    expect((await repo.listIdeas({ brainstormId: b.id }))[0]?.groupId).toBeNull();
    await editIdea(repo, i.id, '   ', b.id);
    expect(await repo.listIdeas({ brainstormId: b.id })).toHaveLength(0);
  });

  it('suggests directions only after three own ideas, unless asked early (recorded)', async () => {
    const chat = vi.fn(async () => ({ content: '1. Circadian timing\n- Emotional memories\n\nAge differences\nExtra line', provider: 'cloud' as const }));
    const router: ProviderRouter = { probe: async () => ({ aiAvailable: true, providerName: 'cloud' }), chat };
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why?' }, deps);
    await addIdea(repo, { brainstormId: b.id, text: 'Replay' }, deps);
    await expect(suggestDirections(repo, router, { brainstormId: b.id, early: false })).rejects.toThrow(/write 3 ideas/);
    expect(chat).not.toHaveBeenCalled();

    expect(await suggestDirections(repo, router, { brainstormId: b.id, early: true })).toEqual([
      'Circadian timing',
      'Emotional memories',
      'Age differences',
    ]);
    expect((await repo.getBrainstorm(b.id))?.askedAiEarly).toBe(true);

    await addIdea(repo, { brainstormId: b.id, text: 'Interference' }, deps);
    await addIdea(repo, { brainstormId: b.id, text: 'Naps' }, deps);
    await suggestDirections(repo, router, { brainstormId: b.id, early: false });
    const sent = (chat.mock.calls[1] as unknown as [{ messages: { content: string }[] }])[0].messages[1]!.content;
    expect(sent).toContain('- Naps');
    // An accepted suggestion is marked as the AI's.
    const ai = await addIdea(repo, { brainstormId: b.id, text: 'Circadian timing', fromAi: true }, deps);
    expect(ai.authorType).toBe('ai');
  });
});

describe('disagreements', () => {
  it('records positions backed by checked excerpts and settles with a written outcome', async () => {
    const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    const d = await openDisagreement(repo, { projectId: P, claimId: point.id, question: 'Does it hold for older adults?' }, deps);
    const yes = await addPosition(repo, { disagreementId: d.id, stance: 'Yes, the mechanism is general' }, deps);
    const no = await addPosition(repo, { disagreementId: d.id, stance: 'No, only tested in students', holder: 'Supervisor' }, deps);
    expect(no.holder).toBe('Supervisor');

    await expect(attachEvidence(repo, { disagreementId: d.id, positionId: no.id, evidenceId: 'e-cand' })).rejects.toThrow(/only checked/);
    await attachEvidence(repo, { disagreementId: d.id, positionId: no.id, evidenceId: 'e-ok' });
    await attachEvidence(repo, { disagreementId: d.id, positionId: no.id, evidenceId: 'e-ok' });
    expect((await repo.listDisagreementPositions({ disagreementId: d.id })).find((p) => p.id === no.id)?.evidenceIds).toEqual(['e-ok']);

    await expect(settleDisagreement(repo, { disagreementId: d.id, summary: 'Yes', positionId: yes.id }, deps)).rejects.toThrow(/only prevail with evidence/);
    await expect(settleDisagreement(repo, { disagreementId: d.id, summary: ' ', positionId: no.id }, deps)).rejects.toThrow(/write down/);
    const settled = await settleDisagreement(repo, { disagreementId: d.id, summary: 'Narrow the claim to young adults.', positionId: no.id }, deps);
    expect(settled).toMatchObject({ status: 'settled', outcome: { positionId: no.id, settledBy: 'u-1', summary: 'Narrow the claim to young adults.' } });

    // Settled is a record: no more edits.
    await expect(addPosition(repo, { disagreementId: d.id, stance: 'Late view' }, deps)).rejects.toThrow(/kept as a record/);
    await expect(detachEvidence(repo, { disagreementId: d.id, positionId: no.id, evidenceId: 'e-ok' })).rejects.toThrow(/kept as a record/);
  });

  it('settles as “neither / both in part” with only a summary, but never without positions', async () => {
    const d = await openDisagreement(repo, { projectId: P, question: 'Which measure?' }, deps);
    await expect(settleDisagreement(repo, { disagreementId: d.id, summary: 'x', positionId: null }, deps)).rejects.toThrow(/at least one position/);
    await addPosition(repo, { disagreementId: d.id, stance: 'Recall' }, deps);
    expect((await settleDisagreement(repo, { disagreementId: d.id, summary: 'Use both.', positionId: null }, deps)).outcome?.positionId).toBeNull();
    await expect(openDisagreement(repo, { projectId: P, question: ' ' }, deps)).rejects.toThrow(/what is in dispute/);
  });
});

describe('brainwriting (group brainstorm)', () => {
  const host = { userId: 'u-1', idFactory: (p: string) => `${p}-${++n}` };
  const member = { userId: 'u-2', idFactory: (p: string) => `${p}-${++n}` };

  it('hides other members’ ideas until the host reveals them; only the host runs it', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why?' }, host);
    await expect(setBrainstormMode(repo, b.id, 'group', member)).rejects.toThrow(/only the person who started it/);
    await setBrainstormMode(repo, b.id, 'group', host);
    await addIdea(repo, { brainstormId: b.id, text: 'Host idea' }, host);
    await addIdea(repo, { brainstormId: b.id, text: 'Member idea' }, member);
    await expect(setBrainstormMode(repo, b.id, 'solo', host)).rejects.toThrow(/before the first idea/);

    let group = (await repo.getBrainstorm(b.id))!;
    const ideas = await repo.listIdeas({ brainstormId: b.id });
    expect(visibleIdeas(group, ideas, 'u-2').map((i) => i.text)).toEqual(['Member idea']);
    await expect(addGroup(repo, { brainstormId: b.id, title: 'Early' }, host)).rejects.toThrow(/reveal everyone's ideas first/);
    await expect(updatePrompt(repo, b.id, 'Hijacked', member)).rejects.toThrow(/only the person who started/);
    await expect(revealIdeas(repo, b.id, member)).rejects.toThrow(/only the person who started/);

    group = await revealIdeas(repo, b.id, host);
    expect(visibleIdeas(group, ideas, 'u-2')).toHaveLength(2);
    await expect(addGroup(repo, { brainstormId: b.id, title: 'Theirs' }, member)).rejects.toThrow(/only the person who started/);
    const g = await addGroup(repo, { brainstormId: b.id, title: 'Replay' }, host);
    const mine = ideas.find((i) => i.authorId === 'u-1')!;
    await moveIdea(repo, { brainstormId: b.id, ideaId: mine.id, groupId: g.id });
    expect(unpickedIdeas(await repo.listIdeas({ brainstormId: b.id }), 'u-1')).toEqual({ total: 1, fromOthers: 1 });
  });

  it('lets members change only their own ideas, and the AI sees only theirs before the reveal', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why?' }, host);
    await setBrainstormMode(repo, b.id, 'group', host);
    const theirs = await addIdea(repo, { brainstormId: b.id, text: 'Host idea' }, host);
    await expect(editIdea(repo, theirs.id, 'Changed', b.id, member)).rejects.toThrow(/only change your own ideas/);
    for (const t of ['One', 'Two', 'Three']) await addIdea(repo, { brainstormId: b.id, text: t }, member);
    const chat = vi.fn(async () => ({ content: 'Circadian timing', provider: 'cloud' as const }));
    const router: ProviderRouter = { probe: async () => ({ aiAvailable: true, providerName: 'cloud' }), chat };
    await suggestDirections(repo, router, { brainstormId: b.id, early: false, userId: 'u-2' });
    const sent = JSON.stringify((chat.mock.calls[0] as unknown[])[0]);
    expect(sent).toContain('Three');
    expect(sent).not.toContain('Host idea');
    // Members adding ideas never rewrite the host's brainstorm row.
    expect((await repo.getBrainstorm(b.id))?.updatedAt).toBe((await repo.getBrainstorm(b.id))?.createdAt);
  });
});

describe('disagreement records', () => {
  it('keeps the point title and a copy of each excerpt on the record', async () => {
    const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    const d = await openDisagreement(repo, { projectId: P, claimId: point.id, question: 'Older adults?' }, deps);
    expect(d.pointTitle).toBe('Sleep helps memory');
    const pos = await addPosition(repo, { disagreementId: d.id, stance: 'No' }, deps);
    await attachEvidence(repo, { disagreementId: d.id, positionId: pos.id, evidenceId: 'e-ok' });
    let [p] = await repo.listDisagreementPositions({ disagreementId: d.id });
    expect(p?.citations).toEqual([expect.objectContaining({ evidenceId: 'e-ok', pageNumber: 3 })]);
    await detachEvidence(repo, { disagreementId: d.id, positionId: pos.id, evidenceId: 'e-ok' });
    [p] = await repo.listDisagreementPositions({ disagreementId: d.id });
    expect(p?.citations).toEqual([]);
  });
});
