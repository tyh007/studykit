/**
 * v0.5 P3 — argument editor: gaps are visible, slots fill from checked
 * excerpts, sources open beside the argument, and a finished argument
 * writes up into a draft.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('./ResearchReader', () => ({
  ResearchReader: (p: { workId: string; initialPageNumber?: number }) => (
    <div data-testid="stub-reader">
      {p.workId}
      {p.initialPageNumber ? ` @p${p.initialPageNumber}` : ''}
    </div>
  ),
}));

import { ArgumentEditor } from './ArgumentEditor';
import { ResearchProvider, type ResearchContextValue } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { addPoint } from '../../application/research/argument';
import {
  makeEvidence,
  makeResearchLocator,
  makeResearchProject,
  makeWork,
} from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';

async function mount(opts: { focusPointId?: string } = {}) {
  const repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P, livingBrief: 'Does sleep help memory?' }));
    tx.putWork(makeWork({ id: 'w-1', title: 'Walker 2004', projectIds: [P] }));
    tx.putEvidence(
      makeEvidence({
        id: 'e-1',
        projectId: P,
        workId: 'w-1',
        status: 'verified',
        exactQuote: 'Recall improved after sleep.',
        locator: makeResearchLocator({ workId: 'w-1', pageNumber: 4 }),
      }),
    );
    tx.putEvidence(
      makeEvidence({
        id: 'e-cand',
        projectId: P,
        workId: 'w-1',
        status: 'candidate',
        exactQuote: 'An unchecked passage.',
        locator: makeResearchLocator({ workId: 'w-1', pageNumber: 6 }),
      }),
    );
  });
  const onOpenOutput = vi.fn();
  const onOpenSource = vi.fn();
  const value: ResearchContextValue = {
    repository: repo,
    openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}', { status: 200 }) }),
  };
  render(
    <ResearchProvider value={value}>
      <ArgumentEditor
        projectId={P}
        {...opts}
        onOpenOutput={onOpenOutput}
        onOpenSource={onOpenSource}
        onOpenSources={() => undefined}
      />
    </ResearchProvider>,
  );
  return { repo, onOpenOutput, onOpenSource };
}

afterEach(cleanup);

describe('ArgumentEditor', () => {
  it('starts with one obvious step and shows a new point’s empty slots as gaps', async () => {
    await mount();
    expect(await screen.findByTestId('argument-empty')).toBeInTheDocument();
    expect(screen.getByTestId('argument-question')).toHaveTextContent('Does sleep help memory?');
    expect(screen.queryByTestId('argument-write-up')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('argument-add-point'), { target: { value: 'Sleep helps memory' } });
    fireEvent.click(screen.getByTestId('argument-add-point-submit'));

    const point = await screen.findByTestId('argument-point');
    expect(within(point).getByTestId('argument-point-title')).toHaveValue('Sleep helps memory');
    expect(within(point).getByTestId('argument-point-status')).toHaveTextContent('4 empty');
    for (const slot of ['evidence', 'reasoning', 'counter', 'limits']) {
      expect(within(point).getByTestId(`argument-slot-${slot}`)).toHaveAttribute('data-gap', 'true');
    }
    expect(screen.getByTestId('argument-progress')).toHaveTextContent('4 empty slots · 0 of 1 point ready');
    expect(screen.getByTestId('argument-write-up')).toBeDisabled();
  });

  it('fills every slot, then writes the argument up into a draft', async () => {
    const { repo, onOpenOutput } = await mount();
    await act(() => addPoint(repo, { projectId: P, title: 'Sleep helps memory' }));
    const point = await screen.findByTestId('argument-point');

    // Evidence: only checked excerpts are offered.
    fireEvent.click(within(point).getByTestId('argument-add-evidence'));
    const picker = await within(point).findByTestId('argument-picker');
    const options = within(picker).getAllByTestId('argument-picker-option');
    expect(options.map((o) => o.textContent)).toEqual(['“Recall improved after sleep.”Walker 2004, p. 4']);
    fireEvent.click(options[0]!);
    await waitFor(() => expect(within(point).getAllByTestId('argument-cite')).toHaveLength(1));
    expect(within(point).getByTestId('argument-single-source')).toBeInTheDocument();

    // Why it holds: saved on blur.
    const reasoning = within(point).getByTestId('argument-reasoning');
    fireEvent.focus(reasoning);
    fireEvent.change(reasoning, { target: { value: 'People recall more after sleeping than after staying awake.' } });
    fireEvent.blur(reasoning);

    // Against it / limits: “looked, none found” counts as considered.
    fireEvent.click(await within(point).findByTestId('argument-none-counter'));
    fireEvent.click(await within(point).findByTestId('argument-none-limits'));

    await waitFor(() => expect(within(point).getByTestId('argument-point-status')).toHaveTextContent('Ready'));
    expect(screen.getByTestId('argument-progress')).toHaveTextContent('Every slot is filled.');
    const writeUp = screen.getByTestId('argument-write-up');
    expect(writeUp).toBeEnabled();
    fireEvent.click(writeUp);

    await waitFor(() => expect(onOpenOutput).toHaveBeenCalledTimes(1));
    const [output] = await repo.listOutputs({ projectId: P });
    expect(onOpenOutput).toHaveBeenCalledWith(output!.id);
    const supports = await repo.listStatementSupports({ outputId: output!.id });
    expect(supports.map((s) => s.ref)).toEqual([{ kind: 'evidence', id: 'e-1' }]);
  });

  it('opens a cited page beside the argument, and in a tab on request', async () => {
    const { repo, onOpenSource } = await mount();
    await act(() => addPoint(repo, { projectId: P, title: 'Sleep helps memory' }));
    const point = await screen.findByTestId('argument-point');
    fireEvent.click(within(point).getByTestId('argument-add-evidence'));
    fireEvent.click((await within(point).findAllByTestId('argument-picker-option'))[0]!);
    const cite = await within(point).findByTestId('argument-cite');

    fireEvent.click(within(cite).getByTitle('Show this page beside the argument'));
    const peek = await screen.findByTestId('argument-peek');
    expect(await within(peek).findByTestId('stub-reader')).toHaveTextContent('w-1 @p4');
    expect(peek).toHaveAccessibleName('Source: Walker 2004');

    fireEvent.click(within(peek).getByTestId('argument-peek-open'));
    expect(onOpenSource).toHaveBeenCalledWith({ workId: 'w-1', pageNumber: 4 });
    fireEvent.click(within(peek).getByRole('button', { name: 'Close source' }));
    expect(screen.queryByTestId('argument-peek')).not.toBeInTheDocument();
  });

  it('lets you highlight in a source when there is nothing to cite yet', async () => {
    const { repo } = await mount();
    await act(() => addPoint(repo, { projectId: P, title: 'Sleep helps memory' }));
    const point = await screen.findByTestId('argument-point');
    fireEvent.click(within(point).getByTestId('argument-add-counter'));
    // e-1 is the only checked excerpt; it is offered for “against it” too.
    const picker = await within(point).findByTestId('argument-picker');
    fireEvent.click(within(picker).getByTestId('argument-picker-source'));
    expect(await screen.findByTestId('stub-reader')).toHaveTextContent('w-1');
    expect(screen.queryByTestId('argument-picker')).not.toBeInTheDocument();
  });

  it('reorders points', async () => {
    const { repo } = await mount();
    await act(async () => {
      await addPoint(repo, { projectId: P, title: 'First' });
      await addPoint(repo, { projectId: P, title: 'Second' });
    });
    await waitFor(() => expect(screen.getAllByTestId('argument-point')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Move “Second” up' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('argument-point-title').map((i) => (i as HTMLInputElement).value)).toEqual([
        'Second',
        'First',
      ]),
    );
    expect(screen.getByRole('button', { name: 'Move “Second” up' })).toBeDisabled();
  });
});
