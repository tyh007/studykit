import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { ProvenanceReportView } from './ProvenanceReportView';
import { ResearchProvider } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { addSection, addStatement, attachSupport, createOutput } from '../../application/output/outputUseCases';
import type { OutputStatement } from '../../domain/output';
import { makeEvidence, makeResearchLocator, makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
afterEach(cleanup);

describe('ProvenanceReportView', () => {
  it('shows the AI use statement, sources and coverage, and opens a quote at its page', async () => {
    const repo = new MemoryResearchRepository();
    await repo.transact(async (tx) => {
      tx.putProject(makeResearchProject({ id: P }));
      tx.putWork(makeWork({ id: 'w-1', title: 'Walker 2004', projectIds: [P] }));
      tx.putEvidence(
        makeEvidence({ id: 'e-1', projectId: P, workId: 'w-1', status: 'verified', exactQuote: 'Only students were tested in this study.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 11 }) }),
      );
    });
    const output = await createOutput(repo, { projectId: P, title: 'Essay' });
    const section = await addSection(repo, { outputId: output.id, title: 'Intro' });
    const mine = await addStatement(repo, { sectionId: section.id, body: 'Sleep helps memory, but the samples are narrow.' });
    await attachSupport(repo, { statementId: mine.id, ref: { kind: 'evidence', id: 'e-1' }, relation: 'qualifies' });
    const now = new Date().toISOString();
    const ai: OutputStatement = {
      ...mine,
      id: 'st-ai',
      order: 5,
      body: 'More work is needed.',
      origin: { kind: 'ai', provider: 'cloud', draftedAt: now, acceptedAt: now, aiText: 'More work is needed.' },
    };
    await repo.transact(async (tx) => tx.putOutputStatement(ai));

    const onOpenSource = vi.fn();
    render(
      <ResearchProvider value={{ repository: repo, openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}') }) }}>
        <ProvenanceReportView outputId={output.id} onOpenOutput={() => undefined} onOpenSource={onOpenSource} />
      </ResearchProvider>,
    );
    expect(await screen.findByTestId('provenance-ai-statement')).toHaveTextContent('1 of 2 paragraphs began as AI drafts (1 used as drafted)');
    expect(screen.getByTestId('provenance-by-source')).toHaveTextContent('Your own words: 1');
    expect(screen.getByTestId('provenance-by-source')).toHaveTextContent('AI draft, used as is: 1');
    expect(screen.getByTestId('provenance-coverage')).toHaveTextContent('1 of 2 paragraphs (50%) are backed by checked excerpts.');
    const [first, second] = screen.getAllByTestId('provenance-sentence');
    expect(within(second!).getByText('No checked excerpt behind this paragraph.')).toBeInTheDocument();
    fireEvent.click(within(first!).getByText(/Only students were tested/));
    expect(onOpenSource).toHaveBeenCalledWith({ workId: 'w-1', pageNumber: 11 });
  });
});
