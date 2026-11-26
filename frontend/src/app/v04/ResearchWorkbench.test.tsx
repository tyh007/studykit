/**
 * v0.5 P1 — Research workbench wiring (ADR-003).
 *
 * The Research surfaces are stubbed: this file tests the workbench
 * itself (explorer, tabs, URL ⇄ tab sync, persistence), not the
 * surfaces, which keep their own suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../features/research/ProjectHome', () => ({
  ProjectHome: (p: { onOpenReader: (i: { projectId: string; workId: string }) => void; projectId: string }) => (
    <div data-testid="stub-overview">
      <button type="button" onClick={() => p.onOpenReader({ projectId: p.projectId, workId: 'w-2' })}>
        open w-2 from overview
      </button>
    </div>
  ),
}));
vi.mock('../../features/research/Sources', () => ({
  Sources: (p: { initialAdd?: boolean }) => <div data-testid="stub-sources">{p.initialAdd ? 'add-open' : 'list'}</div>,
}));
vi.mock('../../features/research/Discovery', () => ({ Discovery: () => <div data-testid="stub-search" /> }));
vi.mock('../../features/research/ResearchReader', () => ({
  ResearchReader: (p: { workId: string; initialPageNumber?: number }) => (
    <div data-testid="stub-reader">
      {p.workId}
      {p.initialPageNumber ? ` @p${p.initialPageNumber}` : ''}
    </div>
  ),
}));
vi.mock('../../features/research/EvidenceWorkspace', () => ({
  EvidenceWorkspace: () => <div data-testid="stub-evidence" />,
}));
vi.mock('../../features/research/OutputWorkspace', () => ({ OutputWorkspace: () => <div data-testid="stub-output" /> }));
vi.mock('../../features/research/ArgumentEditor', () => ({
  ArgumentEditor: (p: { focusPointId?: string }) => <div data-testid="stub-argument">{p.focusPointId ?? ''}</div>,
}));
vi.mock('../../features/research/ProjectAiPanel', () => ({
  ProjectAiPanel: (p: { context: { label: string }[]; onClose: () => void }) => (
    <div data-testid="stub-ai">
      {p.context.map((c) => c.label).join(', ')}
      <button type="button" onClick={p.onClose}>
        close ai
      </button>
    </div>
  ),
}));
vi.mock('../../features/research/DesignWorkspace', () => ({ DesignWorkspace: () => <div data-testid="stub-design" /> }));
vi.mock('../../features/research/TaskDetail', () => ({ TaskDetail: () => <div data-testid="stub-task" /> }));

import { ResearchWorkbench } from './ResearchWorkbench';
import { locationStore } from './locationStore';
import { __resetFeatureFlagsForTests, __setFeatureFlagForTests } from '../feature-flags';
import { makeAppLocation, type AppLocation } from '../../domain/workspace';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { ResearchProvider, type ResearchContextValue } from '../../features/research/researchContext';
import {
  makeClaim,
  makeClaimEvidenceLink,
  makeEvidence,
  makeResearchLocator,
  makeResearchProject,
  makeWork,
} from '../../domain/__fixtures__/domain-fixtures';
import { WORKBENCH_STORAGE_PREFIX } from '../../features/workbench/useWorkbenchState';
import { openCapsule } from '../../features/ai/ui/openCapsule';

const P = 'p-001';
const container = { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: P };

async function seed(works: number): Promise<MemoryResearchRepository> {
  const repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P, name: 'Sleep and memory' }));
    for (let i = 1; i <= works; i += 1) {
      tx.putWork(makeWork({ id: `w-${i}`, title: `Paper ${i}`, projectIds: [P], identifiers: { doi: `10.1/${i}` } }));
    }
  });
  return repo;
}

function mount(repo: MemoryResearchRepository, location: AppLocation) {
  act(() => locationStore.replace(location));
  const value: ResearchContextValue = {
    repository: repo,
    openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}', { status: 200 }) }),
  };
  return render(
    <ResearchProvider value={value}>
      <ResearchWorkbench projectId={P} />
    </ResearchProvider>,
  );
}

const tabKinds = (): string[] => screen.queryAllByTestId('workbench-tab').map((t) => t.dataset.editorKind ?? '');

beforeEach(() => {
  __setFeatureFlagForTests('v04Research', true);
  __setFeatureFlagForTests('v05Workbench', true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
  localStorage.clear();
});

describe('Research workbench', () => {
  it('opens a brand-new project on the two-action start screen', async () => {
    mount(await seed(0), makeAppLocation({ mode: 'research', surface: 'project', container }));
    expect(await screen.findByTestId('workbench-start')).toBeInTheDocument();
    expect(await screen.findByText('Sleep and memory', { selector: '[data-testid="workbench-project-name"]' })).toBeInTheDocument();
    expect(screen.getByText(/Add a PDF or search for papers/)).toBeInTheDocument();
    // Groups with nothing in them stay hidden.
    expect(screen.queryByText('Writing')).not.toBeInTheDocument();
    expect(screen.queryByText('Excerpts and points')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('workbench-start-add-sources'));
    expect(await screen.findByTestId('stub-sources')).toHaveTextContent('add-open');
    expect(tabKinds()).toEqual(['library']);
  });

  it('lists sources, previews on single click and keeps the tab on double click', async () => {
    mount(await seed(2), makeAppLocation({ mode: 'research', surface: 'project', container }));
    // A project with content opens on its overview.
    expect(await screen.findByTestId('stub-overview')).toBeInTheDocument();
    const sources = await screen.findByTestId('workbench-explorer-sources');
    expect(within(sources).getAllByRole('button').map((b) => b.textContent)).toEqual(['Paper 1', 'Paper 2']);

    fireEvent.click(within(sources).getByText('Paper 1'));
    expect(await screen.findByTestId('stub-reader')).toHaveTextContent('w-1');
    const previewTab = screen.getAllByTestId('workbench-tab')[1]!;
    expect(previewTab.className).toContain('is-preview');

    // Another single click replaces the preview instead of piling up tabs.
    fireEvent.click(within(sources).getByText('Paper 2'));
    await waitFor(() => expect(screen.getByTestId('stub-reader')).toHaveTextContent('w-2'));
    expect(tabKinds()).toEqual(['overview', 'work']);

    fireEvent.doubleClick(within(sources).getByText('Paper 2'));
    await waitFor(() => expect(screen.getAllByTestId('workbench-tab')[1]!.className).not.toContain('is-preview'));
  });

  it('turns in-editor navigation into a new tab and keeps the URL on the active editor', async () => {
    mount(await seed(2), makeAppLocation({ mode: 'research', surface: 'project', container }));
    fireEvent.click(await screen.findByText('open w-2 from overview'));
    expect(await screen.findByTestId('stub-reader')).toHaveTextContent('w-2');
    expect(tabKinds()).toEqual(['overview', 'work']);
    await waitFor(() => {
      const loc = locationStore.getSnapshot();
      expect(loc.surface).toBe('workbench');
      expect(loc.params?.open).toBe('work:w-2');
    });
  });

  it('redirects a legacy page link to the matching tab', async () => {
    mount(await seed(1), makeAppLocation({ mode: 'research', surface: 'evidence', container }));
    expect(await screen.findByTestId('stub-evidence')).toBeInTheDocument();
    await waitFor(() => {
      const loc = locationStore.getSnapshot();
      expect(loc.surface).toBe('workbench');
      expect(loc.params?.open).toBe(`evidence:${P}`);
    });
  });

  it('opens what a later location asks for (e.g. the Add menu) without a loop', async () => {
    mount(await seed(1), makeAppLocation({ mode: 'research', surface: 'project', container }));
    await screen.findByTestId('stub-overview');
    act(() => locationStore.push(makeAppLocation({ mode: 'research', surface: 'library', container, params: { add: '1' } })));
    expect(await screen.findByTestId('stub-sources')).toHaveTextContent('add-open');
    expect(tabKinds()).toEqual(['overview', 'library']);
    await waitFor(() => expect(locationStore.getSnapshot().params?.open).toBe(`library:${P}`));
  });

  it('restores tabs after a remount but not one-shot requests', async () => {
    const repo = await seed(1);
    const first = mount(repo, makeAppLocation({ mode: 'research', surface: 'library', container, params: { add: '1' } }));
    expect(await screen.findByTestId('stub-sources')).toHaveTextContent('add-open');
    first.unmount();
    expect(localStorage.getItem(WORKBENCH_STORAGE_PREFIX + P)).not.toBeNull();

    mount(repo, makeAppLocation({ mode: 'research', surface: 'workbench', container }));
    expect(await screen.findByTestId('stub-sources')).toHaveTextContent('list');
    expect(tabKinds()).toEqual(['library']);
  });

  it('closes tabs from the tab bar', async () => {
    mount(await seed(1), makeAppLocation({ mode: 'research', surface: 'project', container }));
    await screen.findByTestId('stub-overview');
    fireEvent.click(screen.getByRole('button', { name: 'Close Overview' }));
    await waitFor(() => expect(tabKinds()).toEqual([]));
  });

  it('shows “What’s missing” once there are points or excerpts, and jumps to the excerpt’s page', async () => {
    const repo = await seed(1);
    mount(repo, makeAppLocation({ mode: 'research', surface: 'project', container }));
    await screen.findByTestId('stub-overview');
    // Nothing to report yet: no panel.
    expect(screen.queryByTestId('workbench-panel')).not.toBeInTheDocument();

    await act(async () => {
      await repo.transact(async (tx) => {
        tx.putClaim(makeClaim({ id: 'c-1', projectId: P, title: 'Sleep helps memory' }));
        tx.putEvidence(
          makeEvidence({
            id: 'e-1',
            projectId: P,
            workId: 'w-1',
            status: 'verified',
            locator: makeResearchLocator({ workId: 'w-1', pageNumber: 2 }),
          }),
        );
        tx.putEvidence(
          makeEvidence({
            id: 'e-2',
            projectId: P,
            workId: 'w-1',
            status: 'candidate',
            exactQuote: 'An unconnected passage',
            locator: makeResearchLocator({ workId: 'w-1', pageNumber: 5 }),
          }),
        );
        tx.putLink(makeClaimEvidenceLink({ id: 'l-1', projectId: P, claimId: 'c-1', evidenceId: 'e-1' }));
      });
    });

    const panel = await screen.findByTestId('workbench-panel');
    expect(within(panel).getByTestId('workbench-panel-toggle')).toHaveTextContent(
      'What’s missing1 point · 0 well supported · 2 things to look at',
    );
    const gaps = within(panel).getAllByTestId('ledger-gap');
    expect(gaps.map((g) => g.dataset.gapKind)).toEqual(['single-source', 'unconnected-excerpt']);
    expect(gaps[1]).toHaveTextContent('Excerpt from Paper 1, p. 5 isn’t connected to a point');

    fireEvent.click(gaps[1]!);
    expect(await screen.findByTestId('stub-reader')).toHaveTextContent('w-1 @p5');

    // The panel folds away and stays folded.
    fireEvent.click(within(panel).getByTestId('workbench-panel-toggle'));
    expect(within(panel).queryAllByTestId('ledger-gap')).toHaveLength(0);
    expect(within(panel).getByTestId('workbench-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('lists the argument under Writing and sends a point’s gap to it', async () => {
    const repo = await seed(1);
    mount(repo, makeAppLocation({ mode: 'research', surface: 'project', container }));
    await screen.findByTestId('stub-overview');
    expect(screen.queryByTestId('workbench-explorer-argument')).not.toBeInTheDocument();

    await act(async () => {
      await repo.transact(async (tx) => {
        tx.putClaim(makeClaim({ id: 'c-1', projectId: P, title: 'Sleep helps memory' }));
      });
    });
    const gap = await screen.findByTestId('ledger-gap');
    expect(gap.dataset.gapKind).toBe('no-support');
    fireEvent.click(gap);
    expect(await screen.findByTestId('stub-argument')).toHaveTextContent('c-1');
    expect(screen.getByTestId('workbench-explorer-argument')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(locationStore.getSnapshot().params?.open).toBe(`argument:${P}`));
  });

  it('opens the project AI from Ask, with the open editor as context, and remembers it', async () => {
    const repo = await seed(1);
    await act(async () => {
      await repo.transact(async (tx) => {
        tx.putProject(makeResearchProject({ id: P, name: 'Sleep and memory', livingBrief: 'Does sleep help memory?' }));
      });
    });
    const first = mount(repo, makeAppLocation({ mode: 'research', surface: 'project', container }));
    await screen.findByTestId('stub-overview');
    expect(screen.queryByTestId('workbench-aside')).not.toBeInTheDocument();

    act(() => openCapsule({ surface: 'intent-capsule' }));
    expect(await screen.findByTestId('stub-ai')).toHaveTextContent('Your question');
    fireEvent.click(within(screen.getByTestId('workbench-explorer-sources')).getByText('Paper 1'));
    await waitFor(() => expect(screen.getByTestId('stub-ai')).toHaveTextContent('Paper 1, Your question'));

    first.unmount();
    mount(repo, makeAppLocation({ mode: 'research', surface: 'workbench', container }));
    expect(await screen.findByTestId('stub-ai')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close ai'));
    await waitFor(() => expect(screen.queryByTestId('workbench-aside')).not.toBeInTheDocument());
  });
});
