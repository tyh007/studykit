/**
 * v0.5 P5 — brainstorm → groups → argument in one step; disagreements
 * with evidence, settled in writing and kept on record.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { BrainstormEditor } from './BrainstormEditor';
import { DisagreementEditor } from './DisagreementEditor';
import { ResearchProvider, type ResearchContextValue } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { addIdea, addPosition, openDisagreement, revealIdeas, setBrainstormMode, startBrainstorm } from '../../application/research/brainstorm';
import { AgendaEditor } from './AgendaEditor';
import { ThinkingCollabProvider, type ThinkingCollab } from './thinkingCollab';
import { addPoint, orderPoints } from '../../application/research/argument';
import type { ProviderRouter } from '../ai/kernel/providerRouter';
import { makeEvidence, makeResearchLocator, makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
let repo: MemoryResearchRepository;

function wrap(ui: React.ReactElement, router?: ProviderRouter, collab?: ThinkingCollab) {
  const value: ResearchContextValue = {
    repository: repo,
    openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}', { status: 200 }) }),
    ...(router ? { providerRouter: router } : {}),
  };
  const inner = collab ? <ThinkingCollabProvider value={collab}>{ui}</ThinkingCollabProvider> : ui;
  return render(<ResearchProvider value={value}>{inner}</ResearchProvider>);
}

const names = { 'u-1': 'Ana', 'u-2': 'Ben' };

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

afterEach(cleanup);

async function typeIdea(text: string): Promise<void> {
  const input = screen.getByTestId('brainstorm-idea-input');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(input).toHaveValue(''));
}

describe('BrainstormEditor', () => {
  it('goes from cards to named groups to argument points in one step', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why might sleep help memory?' }, { userId: 'u-1' });
    const onOpenArgument = vi.fn();
    wrap(<BrainstormEditor brainstormId={b.id} userId="u-1" onOpenArgument={onOpenArgument} />);
    expect(await screen.findByTestId('brainstorm-prompt')).toHaveValue('Why might sleep help memory?');

    await typeIdea('Replay during slow-wave sleep');
    await typeIdea('Less interference while asleep');
    expect(screen.getAllByTestId('brainstorm-idea')).toHaveLength(2);
    // Nothing to convert until there is a group.
    expect(screen.queryByTestId('brainstorm-convert')).not.toBeInTheDocument();

    for (const name of ['Sleep consolidates actively', 'Sleep protects passively']) {
      fireEvent.change(screen.getByTestId('brainstorm-group-input'), { target: { value: name } });
      fireEvent.submit(screen.getByTestId('brainstorm-group-input').closest('form')!);
      await waitFor(() => expect(screen.getByTestId('brainstorm-group-input')).toHaveValue(''));
    }
    expect(screen.getByTestId('brainstorm-convert')).toBeDisabled();

    const [replay, interference] = screen.getAllByTestId('brainstorm-idea');
    const groups = await repo.getBrainstorm(b.id);
    fireEvent.change(within(replay!).getByTestId('brainstorm-idea-group'), { target: { value: groups!.groups[0]!.id } });
    fireEvent.change(within(interference!).getByTestId('brainstorm-idea-group'), { target: { value: groups!.groups[1]!.id } });
    await waitFor(() => expect(screen.getByText('Every idea is in a group.')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('brainstorm-convert'));
    expect(await screen.findByTestId('brainstorm-converted')).toHaveTextContent('Added 2 points to your argument.');
    expect(orderPoints(await repo.listClaims({ projectId: P })).map((c) => c.title)).toEqual([
      'Sleep consolidates actively',
      'Sleep protects passively',
    ]);
    expect(screen.getAllByText('In argument')).toHaveLength(2);
    fireEvent.click(screen.getByText('Open the argument'));
    expect(onOpenArgument).toHaveBeenCalled();
  });

  it('keeps back-to-back ideas separate when typing fast', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: '' }, { userId: 'u-1' });
    wrap(<BrainstormEditor brainstormId={b.id} userId="u-1" onOpenArgument={() => undefined} />);
    const input = await screen.findByTestId('brainstorm-idea-input');
    for (const t of ['First idea', 'Second idea']) {
      fireEvent.change(input, { target: { value: t } });
      fireEvent.submit(input.closest('form')!);
      expect(input).toHaveValue('');
    }
    await waitFor(async () => expect((await repo.listIdeas({ brainstormId: b.id })).map((i) => i.text).sort()).toEqual(['First idea', 'Second idea']));
  });

  it('asks for three own ideas before the AI weighs in, and takes AI ideas only on Add', async () => {
    const chat = vi.fn(async () => ({ content: 'Circadian timing\nEmotional memories', provider: 'cloud' as const }));
    const router: ProviderRouter = { probe: async () => ({ aiAvailable: true, providerName: 'cloud' }), chat };
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why?' }, { userId: 'u-1' });
    wrap(<BrainstormEditor brainstormId={b.id} userId="u-1" onOpenArgument={() => undefined} />, router);
    await screen.findByTestId('brainstorm-idea-input');
    expect(screen.getByTestId('brainstorm-ai')).toHaveTextContent('Write 3 more ideas of your own');
    expect(screen.queryByTestId('brainstorm-ai-ask')).not.toBeInTheDocument();
    for (const t of ['Replay', 'Interference', 'Naps']) await typeIdea(t);
    fireEvent.click(await screen.findByTestId('brainstorm-ai-ask'));
    const suggestions = await screen.findAllByTestId('brainstorm-suggestion');
    expect(suggestions.map((s) => s.textContent)).toEqual(['Circadian timingAddDismiss', 'Emotional memoriesAddDismiss']);
    expect(await repo.listIdeas({ brainstormId: b.id })).toHaveLength(3);
    fireEvent.click(within(suggestions[0]!).getByText('Add'));
    await waitFor(() => expect(screen.getAllByTestId('brainstorm-suggestion')).toHaveLength(1));
    const ideas = await repo.listIdeas({ brainstormId: b.id });
    expect(ideas.find((i) => i.text === 'Circadian timing')?.authorType).toBe('ai');
    expect((await repo.getBrainstorm(b.id))?.askedAiEarly).toBeUndefined();
  });
});

describe('DisagreementEditor', () => {
  it('backs views with excerpts, refuses an unbacked winner, and keeps the settled record', async () => {
    const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    const d = await openDisagreement(repo, { projectId: P, claimId: point.id, question: 'Does it hold for older adults?' }, { userId: 'u-1' });
    await addPosition(repo, { disagreementId: d.id, stance: 'Yes, the mechanism is general' }, { userId: 'u-1' });
    const onOpenSource = vi.fn();
    const onOpenPoint = vi.fn();
    wrap(
      <DisagreementEditor disagreementId={d.id} userId="u-1" onOpenSource={onOpenSource} onOpenPoint={onOpenPoint} onOpenSources={() => undefined} />,
    );
    expect(await screen.findByText('Does it hold for older adults?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sleep helps memory'));
    expect(onOpenPoint).toHaveBeenCalledWith(point.id);

    fireEvent.change(screen.getByTestId('disagreement-stance'), { target: { value: 'No, only students were tested' } });
    fireEvent.change(screen.getByTestId('disagreement-holder'), { target: { value: 'Supervisor' } });
    fireEvent.click(screen.getByTestId('disagreement-add-position'));
    await waitFor(() => expect(screen.getAllByTestId('disagreement-position')).toHaveLength(2));

    // A view without evidence can't be chosen as the one that holds up.
    expect(screen.getByLabelText(/Yes, the mechanism is general/)).toBeDisabled();
    const no = screen.getAllByTestId('disagreement-position')[1]!;
    fireEvent.click(within(no).getByTestId('disagreement-back'));
    fireEvent.click(await within(no).findByTestId('argument-picker-option'));
    expect(await within(no).findByTestId('disagreement-evidence')).toHaveTextContent('Walker 2004, p. 11');
    fireEvent.click(within(within(no).getByTestId('disagreement-evidence')).getByText(/Only students were tested/));
    expect(onOpenSource).toHaveBeenCalledWith({ workId: 'w-1', pageNumber: 11 });

    fireEvent.click(screen.getByLabelText(/No, only students were tested — Supervisor/));
    expect(screen.getByTestId('disagreement-settle-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('disagreement-summary'), { target: { value: 'Narrow the claim to young adults.' } });
    fireEvent.click(screen.getByTestId('disagreement-settle-button'));

    expect(await screen.findByTestId('disagreement-outcome')).toHaveTextContent('Narrow the claim to young adults.');
    expect(screen.getByTestId('disagreement-outcome')).toHaveTextContent('The view that held up: No, only students were tested — Supervisor');
    expect(screen.getByTestId('disagreement-status')).toHaveTextContent('Settled');
    // The record is read-only.
    expect(screen.queryByTestId('disagreement-stance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('disagreement-back')).not.toBeInTheDocument();
  });
});

describe('P5b: with project members', () => {
  it('brainwriting: a member sees only how many ideas others wrote until the host reveals them', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why?' }, { userId: 'u-1' });
    await setBrainstormMode(repo, b.id, 'group', { userId: 'u-1' });
    await addIdea(repo, { brainstormId: b.id, text: 'Host secret' }, { userId: 'u-1' });
    wrap(<BrainstormEditor brainstormId={b.id} userId="u-2" onOpenArgument={() => undefined} />, undefined, {
      access: 'contribute',
      hasMembers: true,
      memberNames: names,
    });
    expect(await screen.findByTestId('brainstorm-reveal-counts')).toHaveTextContent('You: 0 ideas · Ana: 1 idea');
    expect(screen.getByTestId('brainstorm-reveal')).toHaveTextContent('Ana will reveal all the ideas at once.');
    expect(screen.queryByText('Host secret')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-reveal-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-prompt-readonly')).toHaveTextContent('Why?');

    await typeIdea('My own idea');
    expect(screen.getAllByTestId('brainstorm-idea')).toHaveLength(1);

    await revealIdeas(repo, b.id, { userId: 'u-1' });
    await waitFor(() => expect(screen.getAllByTestId('brainstorm-idea')).toHaveLength(2));
    const host = screen.getAllByTestId('brainstorm-idea').find((c) => within(c).queryByTestId('brainstorm-idea-author'))!;
    expect(within(host).getByTestId('brainstorm-idea-author')).toHaveTextContent('Ana');
    expect(within(host).getByLabelText('Idea')).toHaveAttribute('readonly');
    // Only the host groups and converts.
    expect(screen.queryByTestId('brainstorm-group-input')).not.toBeInTheDocument();
  });

  it('the host chooses group mode before the first idea and reveals', async () => {
    const b = await startBrainstorm(repo, { projectId: P, prompt: 'Why?' }, { userId: 'u-1' });
    wrap(<BrainstormEditor brainstormId={b.id} userId="u-1" onOpenArgument={() => undefined} />, undefined, {
      access: 'manage',
      hasMembers: true,
      memberNames: names,
    });
    fireEvent.click(await screen.findByTestId('brainstorm-mode-group'));
    expect(await screen.findByTestId('brainstorm-reveal-button')).toBeDisabled();
    await typeIdea('Replay');
    expect(screen.queryByTestId('brainstorm-mode')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('brainstorm-reveal-button'));
    await waitFor(() => expect(screen.queryByTestId('brainstorm-reveal')).not.toBeInTheDocument());
    expect(screen.getByTestId('brainstorm-group-input')).toBeInTheDocument();
  });

  it('a commenter adds a view but cannot settle; excerpts they lack show from the kept copy', async () => {
    const d = await openDisagreement(repo, { projectId: P, question: 'Older adults?' }, { userId: 'u-1' });
    await repo.transact(async (tx) =>
      tx.putDisagreementPosition({
        id: 'v-remote',
        projectId: P,
        disagreementId: d.id,
        stance: 'No, only students',
        evidenceIds: ['e-elsewhere'],
        citations: [{ evidenceId: 'e-elsewhere', quote: 'Participants were 18–25.', source: 'Mander 2013', pageNumber: 4 }],
        authorId: 'u-1',
        holder: 'Supervisor',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      }),
    );
    wrap(
      <DisagreementEditor disagreementId={d.id} userId="u-2" onOpenSource={() => undefined} onOpenPoint={() => undefined} onOpenSources={() => undefined} />,
      undefined,
      { access: 'contribute', hasMembers: true, memberNames: names },
    );
    const [remote] = await screen.findAllByTestId('disagreement-position');
    expect(within(remote!).getByTestId('disagreement-evidence')).toHaveTextContent('Participants were 18–25.');
    expect(within(remote!).getByTestId('disagreement-evidence')).toHaveTextContent('Mander 2013, p. 4');
    expect(within(remote!).getByTestId('disagreement-position-byline')).toHaveTextContent('— Supervisor · added by Ana');
    expect(within(remote!).queryByTestId('disagreement-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('disagreement-settle')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('disagreement-stance'), { target: { value: 'Yes, the mechanism is general' } });
    fireEvent.click(screen.getByTestId('disagreement-add-position'));
    await waitFor(() => expect(screen.getAllByTestId('disagreement-position')).toHaveLength(2));
    expect(within(screen.getAllByTestId('disagreement-position')[1]!).getByTestId('disagreement-back')).toBeInTheDocument();
  });

  it('the moderator summarises the views on request, labelled as not part of the record', async () => {
    const d = await openDisagreement(repo, { projectId: P, question: 'Older adults?' }, { userId: 'u-1' });
    await addPosition(repo, { disagreementId: d.id, stance: 'Yes' }, { userId: 'u-1' });
    await addPosition(repo, { disagreementId: d.id, stance: 'No' }, { userId: 'u-1' });
    const chat = vi.fn(async () => ({ content: 'Neither view has evidence yet.', provider: 'cloud' as const }));
    const router: ProviderRouter = { probe: async () => ({ aiAvailable: true, providerName: 'cloud' }), chat };
    wrap(
      <DisagreementEditor disagreementId={d.id} userId="u-1" onOpenSource={() => undefined} onOpenPoint={() => undefined} onOpenSources={() => undefined} />,
      router,
    );
    fireEvent.click(await screen.findByTestId('disagreement-moderate'));
    expect(await screen.findByTestId('disagreement-moderator-text')).toHaveTextContent('Neither view has evidence yet.');
    expect(screen.getByTestId('disagreement-moderator')).toHaveTextContent('not part of the record');
    expect((await repo.getDisagreement(d.id))?.outcome).toBeUndefined();
  });
});

describe('AgendaEditor', () => {
  it('lists open disagreements, opens them, and marks the meeting held', async () => {
    const d = await openDisagreement(repo, { projectId: P, question: 'Does it hold for older adults?' }, { userId: 'u-1' });
    const onOpen = vi.fn();
    wrap(<AgendaEditor projectId={P} onOpen={onOpen} />);
    const section = await screen.findByTestId('agenda-section-decide');
    fireEvent.click(within(section).getByText('Does it hold for older adults?'));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'disagreement', id: d.id });
    fireEvent.click(screen.getByTestId('agenda-held'));
    expect(await screen.findByText('Marked as held. The next agenda counts from now.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('agenda-since')).toHaveTextContent('since the last meeting'));
  });
});
