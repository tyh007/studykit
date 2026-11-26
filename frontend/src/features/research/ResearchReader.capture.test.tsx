/**
 * v0.5 P2 — highlight → excerpt → point, end to end in the Reader.
 * The PDF viewer is stubbed with selectable text; everything else
 * (use case, repository, picker) is real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../components/literature/LiteraturePDFViewer', () => ({
  default: () => <p data-testid="stub-pdf-text">Sleep after learning strengthens declarative memory.</p>,
}));
vi.mock('../../application/research/workReaderSource', () => ({
  resolveWorkReaderSource: async () => ({ kind: 'ok', source: { kind: 'local-blob', assetId: 'asset-1' } }),
}));

import { ResearchReader } from './ResearchReader';
import { ResearchProvider, type ResearchContextValue } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { createClaim } from '../../application/research/researchUseCases';
import { makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';

async function mount(): Promise<MemoryResearchRepository> {
  const repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P }));
    tx.putWork(makeWork({ id: 'w-1', projectIds: [P], title: 'Walker 2004' }));
  });
  const value: ResearchContextValue = {
    repository: repo,
    openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}', { status: 200 }) }),
  };
  render(
    <ResearchProvider value={value}>
      <ResearchReader projectId={P} workId="w-1" onBackToLibrary={() => undefined} onOpenEvidence={() => undefined} />
    </ResearchProvider>,
  );
  await screen.findByTestId('stub-pdf-text');
  return repo;
}

function select(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const text = el.textContent ?? '';
  const original = sel.toString.bind(sel);
  sel.toString = () => original() || text;
  fireEvent.mouseUp(document);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe('Reader: highlight → excerpt → point', () => {
  it('creates a point and a verified, linked excerpt in two actions', async () => {
    const repo = await mount();
    select(screen.getByTestId('stub-pdf-text'));
    fireEvent.click(await screen.findByTestId('selection-action-point'));
    const picker = await screen.findByTestId('point-picker');
    fireEvent.change(within(picker).getByTestId('point-picker-input'), { target: { value: 'Sleep helps memory' } });
    fireEvent.keyDown(within(picker).getByTestId('point-picker-input'), { key: 'Enter' });

    expect(await screen.findByTestId('research-reader-capture-notice')).toHaveTextContent(
      'Excerpt from page 1 added to “Sleep helps memory”.',
    );
    expect(screen.queryByTestId('point-picker')).not.toBeInTheDocument();
    const [claim] = await repo.listClaims({ projectId: P });
    const [evidence] = await repo.listEvidence({ projectId: P });
    const [link] = await repo.listLinks({ projectId: P });
    expect(claim?.title).toBe('Sleep helps memory');
    expect(evidence).toMatchObject({
      status: 'verified',
      exactQuote: 'Sleep after learning strengthens declarative memory.',
      locator: { kind: 'paper-page', workId: 'w-1', assetId: 'asset-1', pageNumber: 1 },
    });
    expect(link).toMatchObject({ claimId: claim?.id, evidenceId: evidence?.id, relation: 'supports' });
  });

  it('adds to an existing point as counter-evidence with one click', async () => {
    const repo = await mount();
    const claim = await act(() => createClaim(repo, { projectId: P, title: 'Sleep helps memory', body: '' }));
    select(screen.getByTestId('stub-pdf-text'));
    fireEvent.click(await screen.findByTestId('selection-action-point'));
    fireEvent.click(await screen.findByTestId('point-picker-relation-contradicts'));
    fireEvent.click(await screen.findByText('Sleep helps memory'));
    await screen.findByText(/added against “Sleep helps memory”/);
    const [link] = await repo.listLinks({ projectId: P });
    expect(link).toMatchObject({ claimId: claim.id, relation: 'contradicts' });
  });

  it('saves an excerpt on its own, unverified, with one click', async () => {
    const repo = await mount();
    select(screen.getByTestId('stub-pdf-text'));
    fireEvent.click(await screen.findByTestId('selection-action-save'));
    await screen.findByText(/saved\. Connect it to a point when you’re ready\./);
    const [evidence] = await repo.listEvidence({ projectId: P });
    expect(evidence?.status).toBe('candidate');
    expect(await repo.listLinks({ projectId: P })).toHaveLength(0);
  });

  it('ignores selections outside the PDF', async () => {
    await mount();
    select(screen.getByRole('heading', { name: 'Walker 2004' }));
    await waitFor(() => expect(screen.queryByTestId('selection-action-bar')).not.toBeInTheDocument());
  });
});
