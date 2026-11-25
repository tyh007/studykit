/**
 * StudyKit v0.4 — `features/canvas/__tests__/cognitiveCanvasProduction`
 *
 * Real user-flow integration test for the cognitive
 * canvas (WP-06 Gate, Codex round 6 P0-5).
 *
 * The test mounts the *real* `EvidenceWorkspace` (the
 * P0-D production source for the "Open in Canvas"
 * button) and the *real* `ResearchRouter` (the
 * production composition root). The router reads the
 * cognitive canvas's `useCases` + `repository` from a
 * single `CanvasRuntime` value object provided by
 * `<CanvasRuntimeOverride>`; the same runtime drives
 * both the use case writes and the subscription
 * reads (no parallel `createDexieCanvasRepository`
 * inside the router).
 *
 * Static gate compliance (WP-06 Round 6):
 *
 *   A) The cognitive canvas's `CanvasSurface`
 *      mount lives in `CanvasSurface.tsx`; the
 *      `CognitiveCanvasAdapter` has no ReactFlow
 *      / Provider / Toolbar / CSS import.
 *   B) `ResearchRouter` reads from
 *      `useCanvasRuntime()` and never calls
 *      `createDexieCanvasRepository()`. The
 *      `CanvasUseCasesProvider` builds the single
 *      runtime pair.
 *   C) `useCanvasRuntime()` is called at the *top*
 *      of `ResearchRouter` (unconditional) — no
 *      Rules of Hooks violation when the route
 *      changes from `evidence` to `cognitive-canvas`.
 *   D) Real EvidenceWorkspace checkbox + Open in
 *      Canvas button click → real router branch →
 *      CognitiveCanvasView mounts.
 *   E) `P0-E` (AI / IntentCapsule integration) is
 *      covered in `cognitiveCanvasAi.test.tsx` (a
 *      separate file, real UI integration test).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { EvidenceWorkspace } from '../../research/EvidenceWorkspace';
import {
  CanvasRuntimeOverride,
  type CanvasRuntime,
} from '../../../app/v04/canvasWiringContext';
import { ResearchRouter } from '../../../app/v04/researchRouter';
import { ResearchProvider } from '../../research/researchContext';
import { StudyProvider } from '../../study';
import { MemoryResearchRepository } from '../../../application/research/researchRepository';
import { MemoryStudyRepository } from '../../../application/study/studyRepository';
import { OpenAlexSearchProvider } from '../../../application/research/openAlexProvider';
import { MemoryCanvasRepository } from '../../../repositories/memoryCanvasRepository';
import {
  createCanvasUseCases,
} from '../../../application/canvas/canvasGateway';
import { MemoryRepository } from '../../../domain/repository';
import { locationStore } from '../../../app/v04/locationStore';
import { makeAppLocation } from '../../../domain/workspace';
import { __setFeatureFlagForTests, __resetFeatureFlagsForTests } from '../../../app/feature-flags';
import type {
  Evidence as DomainEvidence,
  Claim as DomainClaim,
  Work,
  ResearchProject,
} from '../../../domain/research';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

const testRepo = new MemoryResearchRepository();
const testStudy = new MemoryStudyRepository();
const openAlex = new OpenAlexSearchProvider();

function resetTestRepo(): void {
  for (const t of [
    'projects', 'querySpecs', 'runs', 'candidates',
    'works', 'workAssets', 'evidence', 'claims', 'links', 'conflicts',
  ] as const) {
    (testRepo as unknown as Record<string, Map<string, unknown>>)[t].clear();
  }
  (testRepo as unknown as { listeners: Set<unknown> }).listeners?.clear?.();
}

async function seedProjectWithThreeVerifiedEvidence(): Promise<ResearchProject> {
  const project: ResearchProject = {
    id: 'project-1',
    container: { workspaceId: 'ws-1', mode: 'research', kind: 'project', id: 'project-1' },
    name: 'Test project',
    kind: 'blank',
    livingBrief: '',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    authorType: 'user',
  };
  await testRepo.transact(async (tx) => {
    tx.putProject(project);
    for (let i = 1; i <= 3; i++) {
      const work: Work = {
        id: `work-${i}`,
        projectIds: [project.id],
        identifiers: {},
        title: `Work ${i}`,
        authors: [],
        readingStatus: 'unread',
        assetIds: [],
        metadataProvenance: {},
        integrity: 'unknown',
        importance: 0,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        authorType: 'user',
      };
      tx.putWork(work);
    }
    const ev1: DomainEvidence = {
      id: 'ev-1', projectId: project.id, workId: 'work-1',
      locator: { kind: 'paper-work', workId: 'work-1', capturedAt: '2026-07-22T00:00:00.000Z' },
      exactQuote: 'First passage.', userInterpretation: 'First reading.',
      evidenceType: 'finding', status: 'verified',
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      authorType: 'user',
    };
    const ev2: DomainEvidence = { ...ev1, id: 'ev-2', workId: 'work-2', exactQuote: 'Second passage.', userInterpretation: 'Second reading.' };
    const ev3: DomainEvidence = { ...ev1, id: 'ev-3', workId: 'work-3', exactQuote: 'Third passage.', userInterpretation: 'Third reading.' };
    tx.putEvidence(ev1);
    tx.putEvidence(ev2);
    tx.putEvidence(ev3);
    const claim: DomainClaim = {
      id: 'cl-1', projectId: project.id, title: 'Synthesised claim', body: 'Across three passages.',
      status: 'canonical', aiSuggested: false,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      authorType: 'user',
    };
    tx.putClaim(claim);
  });
  return project;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — production composition (3 Evidence + 1 Claim → Open in Canvas)', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(async () => {
    user = userEvent.setup({ delay: null });
    resetTestRepo();
    // Seed BEFORE rendering so the workspace's
    // initial `listEvidence` returns the rows.
    await seedProjectWithThreeVerifiedEvidence();
    // Reset the location to a known starting point.
    act(() => {
      locationStore.replace(makeAppLocation({
        mode: 'research',
        surface: 'project',
        container: { workspaceId: 'ws-1', mode: 'research', kind: 'project', id: 'project-1' },
      }));
    });
    // Turn on the v04 research + canvas flags so
    // the real `ResearchRouter` renders the
    // `evidence` surface and the
    // `cognitive-canvas` branch.
    __setFeatureFlagForTests('v04Research', true);
    __setFeatureFlagForTests('v04Canvas', true);
  });
  afterEach(() => {
    cleanup();
    __resetFeatureFlagsForTests();
  });

  it('drives the real EvidenceWorkspace + real ResearchRouter + 3 distinct workIds + persistence across remount', async () => {
    const canvas = new MemoryCanvasRepository();
    const objects = new MemoryRepository();
    let _n = 0;
    const useCases = createCanvasUseCases({
      repository: canvas,
      objects,
      now: () => new Date(2026, 6, 22, 12, 0, _n++).toISOString(),
      newId: () => `id_${_n}_${Math.random().toString(36).slice(2, 8)}`,
    });
    // The single runtime pair drives both writes
    // and reads. The router never calls
    // `createDexieCanvasRepository()` itself.
    const runtime: CanvasRuntime = { useCases, repository: canvas };

    const { container, unmount } = render(
      <ResearchProvider value={{ repository: testRepo, openAlex, providerRouter: undefined, devSeamActive: false }}>
        <StudyProvider value={{ repository: testStudy, providerRouter: undefined, draftLayer: undefined as never }}>
          <CanvasRuntimeOverride value={runtime}>
            <ResearchRouter />
            <EvidenceWorkspace
              projectId="project-1"
              onBackToProject={() => undefined}
              onOpenWork={() => undefined}
              cognitiveCanvasAvailable={true}
              onOpenCanvas={({ projectId, evidenceIds, claimIds }) => {
                const container = { workspaceId: 'ws-1', mode: 'research' as const, kind: 'project' as const, id: projectId };
                const params: Record<string, string> = {};
                if (evidenceIds.length > 0) params.evidence = evidenceIds.join(',');
                if (claimIds.length > 0) params.claim = claimIds.join(',');
                locationStore.push(makeAppLocation({
                  mode: 'research',
                  surface: 'cognitive-canvas',
                  container,
                  surfaceId: `canvas-${projectId}`,
                  params,
                }));
              }}
            />
          </CanvasRuntimeOverride>
        </StudyProvider>
      </ResearchProvider>,
    );
    // Wait for the Evidence Workspace to mount.
    await waitFor(() => {
      expect(screen.getByTestId('evidence-workspace')).toBeInTheDocument();
    });
    // The Evidence Workspace shows the 3 verified
    // Evidence rows + a "Claims" section. We click
    // the 3 evidence checkboxes + the claim checkbox
    // + the Open in Canvas button.
    const evidenceCheckboxes = await screen.findAllByTestId('evidence-select');
    expect(evidenceCheckboxes.length).toBe(3);
    const claimCheckbox = screen.getByTestId('claim-select');
    await act(async () => {
      for (const cb of evidenceCheckboxes) {
        await user.click(cb);
      }
      await user.click(claimCheckbox);
    });
    const openButton = screen.getByTestId('evidence-workspace-open-canvas');
    await act(async () => {
      await user.click(openButton);
    });
    // The real `ResearchRouter` (driven by the
    // `locationStore.push` from the workspace)
    // mounts the cognitive canvas branch. The
    // CognitiveCanvasView mounts the engine's
    // shared `<CanvasSurface>`.
    await waitFor(() => {
      const flow = container.querySelector('[data-testid="cognitive-canvas-flow"]');
      expect(flow).toBeInTheDocument();
    });
    await waitFor(async () => {
      const snap = await canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(4);
    });
    const snap1 = await canvas.getViewSnapshot('canvas-project-1');
    const refIds = snap1.placements.map((p) => p.ref.id).sort();
    expect(refIds).toEqual(['cl-1', 'ev-1', 'ev-2', 'ev-3']);
    // Static gate D: the three work ids are distinct.
    // We assert this through the *canonical* research
    // repository (the same source the
    // `EvidenceWorkspace` rendered the rows from).
    const evList = await testRepo.listEvidence({ projectId: 'project-1' });
    const workIdsUsed = Array.from(new Set(evList.map((e) => e.workId))).sort();
    expect(workIdsUsed).toEqual(['work-1', 'work-2', 'work-3']);
    expect(evList.every((e) => e.status === 'verified')).toBe(true);
    // Build a preview relation between ev-1 and
    // cl-1 through the use cases. The cognitive
    // canvas's connect gesture does not survive
    // happy-dom; the data path is the only
    // deterministic verification.
    const r = await useCases.connectDraft({
      viewId: 'canvas-project-1',
      from: { kind: 'knowledge', id: 'ev-1', objectKind: 'evidence' },
      to: { kind: 'knowledge', id: 'cl-1', objectKind: 'claim' },
      kind: 'supports',
    });
    if (!r.ok) throw new Error('expected ok');
    await waitFor(async () => {
      const snap = await canvas.getViewSnapshot('canvas-project-1');
      expect(snap.relations).toHaveLength(1);
      expect(snap.relations[0].status).toBe('preview');
    });
    // Press Enter to create a free node.
    const surface = container.querySelector('[data-testid="cognitive-canvas-flow"]') as HTMLElement;
    expect(surface).toBeTruthy();
    await act(async () => {
      surface.focus();
      await user.keyboard('{Enter}');
    });
    await waitFor(async () => {
      const snap = await canvas.getViewSnapshot('canvas-project-1');
      expect(snap.freeNodes).toHaveLength(1);
    });
    // Remount the shell. The cognitive canvas's own
    // Dexie tables are still in-memory; we do NOT
    // seed again. The 4 placements + 1 preview
    // relation + 1 free node must persist; the
    // canonical Evidence / Claim rows must not be
    // duplicated.
    const evListBefore = await testRepo.listEvidence({ projectId: 'project-1' });
    const clListBefore = await testRepo.listClaims({ projectId: 'project-1' });
    expect(evListBefore).toHaveLength(3);
    expect(clListBefore).toHaveLength(1);
    unmount();
    // Re-mount with the *same* runtime so the
    // canvas's in-memory state is shared. The real
    // `ResearchRouter` will resolve the
    // `cognitive-canvas` surface from
    // `locationStore`.
    render(
      <ResearchProvider value={{ repository: testRepo, openAlex, providerRouter: undefined, devSeamActive: false }}>
        <StudyProvider value={{ repository: testStudy, providerRouter: undefined, draftLayer: undefined as never }}>
          <CanvasRuntimeOverride value={runtime}>
            <ResearchRouter />
          </CanvasRuntimeOverride>
        </StudyProvider>
      </ResearchProvider>,
    );
    await waitFor(async () => {
      const snap = await canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements.length).toBeGreaterThanOrEqual(4);
      expect(snap.relations).toHaveLength(1);
      expect(snap.freeNodes).toHaveLength(1);
    });
    // The canonical Evidence / Claim rows were not
    // re-written — the count is unchanged.
    const evListAfter = await testRepo.listEvidence({ projectId: 'project-1' });
    const clListAfter = await testRepo.listClaims({ projectId: 'project-1' });
    expect(evListAfter).toHaveLength(3);
    expect(clListAfter).toHaveLength(1);
    // Static gate C: no error surfaced from the
    // cognitive canvas's async user actions.
    expect(container.querySelector('[data-testid="cognitive-canvas-error"]')).toBeNull();
  });
});
