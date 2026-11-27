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
import { addPosition, openDisagreement, startBrainstorm } from '../../application/research/brainstorm';
import { addPoint, orderPoints } from '../../application/research/argument';
import type { ProviderRouter } from '../ai/kernel/providerRouter';
import { makeEvidence, makeResearchLocator, makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
let repo: MemoryResearchRepository;

function wrap(ui: React.ReactElement, router?: ProviderRouter) {
  const value: ResearchContextValue = {
    repository: repo,
    openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}', { status: 200 }) }),
    ...(router ? { providerRouter: router } : {}),
  };
  return render(<ResearchProvider value={value}>{ui}</ResearchProvider>);
}

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
