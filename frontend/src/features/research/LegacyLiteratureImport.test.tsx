import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ResearchHome } from './ResearchHome';
import { ResearchProvider } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import type { LegacyLiteratureSource } from '../../application/research/importLegacyLiterature';
import type { LiteraturePaper } from '../../types';

afterEach(cleanup);

const T = '2025-03-01T10:00:00.000Z';

function source(): LegacyLiteratureSource {
  return {
    listProjects: async () => [{ id: 'L1', workspace_id: 'ws', name: 'Sleep review', created_at: T, updated_at: T }],
    listPapers: async () =>
      [
        { id: 'P1', project_id: 'L1', workspace_id: 'ws', file_name: 'a.pdf', file_size: 1, file_type: 'pdf', uploaded_at: T, title: 'Walker 2004', processing_status: 'completed', in_trash: false, created_at: T, updated_at: T },
        { id: 'P2', project_id: 'L1', workspace_id: 'ws', file_name: 'b.pdf', file_size: 1, file_type: 'pdf', uploaded_at: T, title: 'Old', processing_status: 'completed', in_trash: true, created_at: T, updated_at: T },
      ] as LiteraturePaper[],
  };
}

describe('Research home: from the old literature hub', () => {
  it('brings a legacy project in, says what came and what was left out, then opens it', async () => {
    const repo = new MemoryResearchRepository();
    const onOpenProject = vi.fn();
    render(
      <ResearchProvider value={{ repository: repo, openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}') }) }}>
        <ResearchHome onOpenProject={onOpenProject} legacySource={source()} />
      </ResearchProvider>,
    );
    expect(await screen.findByTestId('legacy-import-project')).toHaveTextContent('Sleep review');
    fireEvent.click(screen.getByTestId('legacy-import-bring'));
    const report = await screen.findByTestId('legacy-import-report');
    expect(report).toHaveTextContent('Brought in 1 paper.');
    expect(report).toHaveTextContent('Left out: 1 paper in the trash; notes, highlights, relations, summary columns (sign in to a sync workspace to bring these too).');
    expect(await screen.findAllByText('Sleep review')).not.toHaveLength(0);
    fireEvent.click(await screen.findByTestId('legacy-import-open'));
    expect(onOpenProject).toHaveBeenCalledWith('lp_L1');
  });

  it('shows nothing when there is no old hub here', async () => {
    const repo = new MemoryResearchRepository();
    render(
      <ResearchProvider value={{ repository: repo, openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}') }) }}>
        <ResearchHome onOpenProject={() => undefined} legacySource={{ listProjects: async () => Promise.reject(new Error('offline')), listPapers: async () => [] }} />
      </ResearchProvider>,
    );
    await screen.findByTestId('research-home');
    expect(screen.queryByTestId('legacy-import')).not.toBeInTheDocument();
  });
});
