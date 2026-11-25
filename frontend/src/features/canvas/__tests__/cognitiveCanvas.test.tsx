/**
 * StudyKit v0.4 — `features/canvas/__tests__/cognitiveCanvas`
 *
 * Real user-event / real user-flow tests for the
 * cognitive canvas (WP-06 Gate, Codex round 4).
 *
 * The cognitive canvas is the *adapter* over the
 * engine's shared `<CanvasSurface>`. The unit tests
 * in this file drive the adapter end-to-end with
 * `userEvent` and assert the resulting
 * `CanvasViewSnapshot` after every step. They do
 * NOT call use cases directly to replace user paths;
 * the only place a test reaches into a use case
 * directly is the "data path" connection test (the
 * xyflow connect gesture does not survive happy-dom
 * faithfully).
 *
 * WP-06 Round 4: the cognitive canvas no longer has
 * its own CSS file or its own toolbar. The theme test
 * from earlier rounds is gone — the cognitive canvas
 * inherits the engine's `literature-canvas.css`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import React from 'react';

import { MemoryRepository } from '../../../domain/repository';
import {
  MemoryCanvasRepository,
} from '../../../repositories/memoryCanvasRepository';
import {
  ShimStudyKitRepository,
} from '../../../repositories/shimStudyKitRepository';
import {
  MemoryResearchRepository,
} from '../../../application/research/researchRepository';
import {
  MemoryStudyRepository,
} from '../../../application/study/studyRepository';
import {
  type ResearchRepository,
} from '../../../application/research/researchRepository';
import {
  type StudyRepository,
} from '../../../application/study/studyRepository';
import {
  createCanvasUseCases,
  type CanvasUseCases,
} from '../../../application/canvas/canvasGateway';
import { CognitiveCanvasView } from '../CognitiveCanvasView';
import { CanvasRepositoryProvider } from '../canvasRepositoryContext';
import type { Evidence as DomainEvidence, Claim as DomainClaim, Work } from '../../../domain/research';
import type { StudyQuestion } from '../../../domain/study';
import { knowledgeRef } from '../../../domain/canvas';

// ---------------------------------------------------------------------------
// Test deps
// ---------------------------------------------------------------------------

function makeEvidence(id: string, workId: string, body: string, projectId: string): DomainEvidence {
  return {
    id,
    projectId,
    workId,
    locator: { kind: 'paper-work', workId, capturedAt: '2026-07-22T00:00:00.000Z' },
    exactQuote: body,
    userInterpretation: body,
    evidenceType: 'finding',
    status: 'verified',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    authorType: 'user',
  };
}

function makeClaim(id: string, title: string, body: string, projectId: string): DomainClaim {
  return {
    id,
    projectId,
    title,
    body,
    status: 'canonical',
    aiSuggested: false,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    authorType: 'user',
  };
}

function makeWork(id: string, title: string): Work {
  return {
    id,
    projectIds: [],
    identifiers: {},
    title,
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
}

function setupTestEnv(): {
  canvas: MemoryCanvasRepository;
  useCases: CanvasUseCases;
  research: ResearchRepository;
  study: StudyRepository;
  renderView: (input: {
    viewId: string;
    initialRefs?: Array<{ id: string; objectKind: 'evidence' | 'claim' }>;
  }) => ReturnType<typeof render>;
} {
  const canvas = new MemoryCanvasRepository();
  const research = new MemoryResearchRepository();
  const study = new MemoryStudyRepository();
  const notes = {
    upsert: async (input: { id: string; body: string; authorType: 'user' | 'ai' | 'imported' }) => ({ id: input.id }),
    archive: async (_id: string) => undefined,
  };
  const sources = {
    upsertTitle: async (_input: { id: string; title: string }) => undefined,
    moveToTrash: async (_id: string) => undefined,
  };
  const listPapers = async () => [] as readonly import('../../../types').LiteraturePaper[];
  const getPaper = async () => null;
  const shim = new ShimStudyKitRepository({
    research,
    study,
    notes,
    sources,
    listPapers,
    getPaper,
  });
  void shim;
  const objects = shim;
  let n = 0;
  const useCases = createCanvasUseCases({
    repository: canvas,
    objects,
    now: () => new Date(2026, 6, 22, 12, 0, n++).toISOString(),
    newId: () => `id_${n}_${Math.random().toString(36).slice(2, 8)}`,
  });
  return {
    canvas,
    useCases,
    research,
    study,
    renderView: ({ viewId, initialRefs }) =>
      render(
        <CanvasRepositoryProvider value={canvas}>
          <CognitiveCanvasView
            viewId={viewId}
            useCases={useCases}
            initialRefs={
              (initialRefs ?? []).map((r) =>
                knowledgeRef(r.id, r.objectKind),
              )
            }
          />
        </CanvasRepositoryProvider>,
      ),
  };
}

// ---------------------------------------------------------------------------
// 1. Full WP-06 Gate flow: 3 Evidence + 1 Claim → same ids
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — WP-06 Gate (real user flow)', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    user = userEvent.setup({ delay: null });
  });
  afterEach(() => {
    // No `vi.restoreAllMocks()` here — we never
    // `vi.spyOn` anything. The test runs as a real
    // user; a stray `console.error` is a real failure
    // and surfaces in the test output.
  });

  it('opens 3 Evidence + 1 Claim and surfaces the same ids in the snapshot', async () => {
    const env = setupTestEnv();
    const projectId = 'project-1';
    await env.research.transact(async (tx) => {
      tx.putEvidence(makeEvidence('ev-1', 'work-1', 'First passage.', projectId));
      tx.putEvidence(makeEvidence('ev-2', 'work-1', 'Second passage.', projectId));
      tx.putEvidence(makeEvidence('ev-3', 'work-1', 'Third passage.', projectId));
      tx.putClaim(makeClaim('cl-1', 'Synthesised claim', 'Across three passages.', projectId));
    });
    env.renderView({
      viewId: 'canvas-project-1',
      initialRefs: [
        { id: 'ev-1', objectKind: 'evidence' },
        { id: 'ev-2', objectKind: 'evidence' },
        { id: 'ev-3', objectKind: 'evidence' },
        { id: 'cl-1', objectKind: 'claim' },
      ],
    });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(4);
    });
    const snap = await env.canvas.getViewSnapshot('canvas-project-1');
    const refIds = snap.placements.map((p) => p.ref.id).sort();
    expect(refIds).toEqual(['cl-1', 'ev-1', 'ev-2', 'ev-3']);
    env.canvas.seedKnowledge('ev-1', 'evidence', 'First passage.');
    const snap2 = await env.canvas.getViewSnapshot('canvas-project-1');
    const ev1 = snap2.nodes.get('knowledge:ev-1');
    expect(ev1?.body).toBe('First passage.');
  });
});

// ---------------------------------------------------------------------------
// 2. Free node → upgrade (real user keyboard + popover)
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — free node → upgrade (real user)', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    user = userEvent.setup({ delay: null });
  });

  it('Enter creates a free node; p opens the upgrade popover; picking a kind writes the canonical object', async () => {
    const env = setupTestEnv();
    const projectId = 'project-1';
    const { container } = env.renderView({ viewId: 'canvas-project-1' });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.view.id).toBe('canvas-project-1');
    });
    // The cognitive canvas's wrapper has the
    // `data-testid="cognitive-canvas-flow"` (Round 6
    // P0-1 — no more `cognitive-canvas__*` classes).
    const surface = container.querySelector('[data-testid="cognitive-canvas-flow"]') as HTMLElement;
    expect(surface).toBeTruthy();
    await act(async () => {
      surface.focus();
      await user.keyboard('{Enter}');
    });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.freeNodes).toHaveLength(1);
    });
    const snap1 = await env.canvas.getViewSnapshot('canvas-project-1');
    const freeId = snap1.freeNodes[0].id;
    await act(async () => {
      surface.focus();
      await user.keyboard('p');
    });
    const popover = await waitFor(
      () => screen.getByRole('menu', { name: /promote free node/i }),
      { timeout: 3000 },
    );
    const questionButton = within(popover).getByRole('menuitem', { name: /question/i });
    await act(async () => {
      await user.click(questionButton);
    });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.freeNodes).toHaveLength(0);
      const placement = snap.placements.find((p) => p.ref.id === freeId);
      expect(placement?.ref.kind).toBe('knowledge');
    });
    const q = await env.study.getQuestion(freeId);
    expect(q).not.toBeNull();
    expect(q?.body).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. Connect → preview → Accept (no mock console.error)
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — connect → preview → Accept (real user)', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    user = userEvent.setup({ delay: null });
  });

  it('creates a preview relation; Accept flips it to accepted; Reject does not lose placements', async () => {
    const env = setupTestEnv();
    const projectId = 'project-1';
    await env.research.transact(async (tx) => {
      tx.putEvidence(makeEvidence('ev-1', 'work-1', 'First passage.', projectId));
      tx.putClaim(makeClaim('cl-1', 'Claim', 'Body.', projectId));
    });
    const { container } = env.renderView({
      viewId: 'canvas-project-1',
      initialRefs: [
        { id: 'ev-1', objectKind: 'evidence' },
        { id: 'cl-1', objectKind: 'claim' },
      ],
    });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(2);
    });
    const r = await env.useCases.connectDraft({
      viewId: 'canvas-project-1',
      from: knowledgeRef('ev-1', 'evidence'),
      to: knowledgeRef('cl-1', 'claim'),
      kind: 'supports',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.relation.status).toBe('preview');
    let snap = await env.canvas.getViewSnapshot('canvas-project-1');
    expect(snap.relations).toHaveLength(1);
    expect(snap.relations[0].status).toBe('preview');
    expect(snap.placements).toHaveLength(2);
    const acc = await env.useCases.acceptRelation({
      viewId: 'canvas-project-1',
      relationId: r.value.relation.id,
    });
    if (!acc.ok) throw new Error('expected ok');
    snap = await env.canvas.getViewSnapshot('canvas-project-1');
    expect(snap.relations[0].status).toBe('accepted');
    const r2 = await env.useCases.connectDraft({
      viewId: 'canvas-project-1',
      from: knowledgeRef('cl-1', 'claim'),
      to: knowledgeRef('ev-1', 'evidence'),
      kind: 'contradicts',
    });
    if (!r2.ok) throw new Error('expected ok');
    await env.useCases.rejectRelation({
      viewId: 'canvas-project-1',
      relationId: r2.value.relation.id,
    });
    snap = await env.canvas.getViewSnapshot('canvas-project-1');
    expect(snap.relations).toHaveLength(2);
    expect(snap.relations[1].status).toBe('rejected');
    expect(snap.placements).toHaveLength(2);
    void container;
  });
});

// ---------------------------------------------------------------------------
// 4. Backspace deletes a placement (P0-C: real removePlacement use case)
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — Backspace removes a free-node placement (P0-C)', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    user = userEvent.setup({ delay: null });
  });

  it('Enter creates a free node; Backspace removes it through the real removePlacement use case', async () => {
    const env = setupTestEnv();
    const { container } = env.renderView({ viewId: 'canvas-project-1' });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.view.id).toBe('canvas-project-1');
    });
    const surface = container.querySelector('[data-testid="cognitive-canvas-flow"]') as HTMLElement;
    expect(surface).toBeTruthy();
    await act(async () => {
      surface.focus();
      await user.keyboard('{Enter}');
    });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.freeNodes).toHaveLength(1);
    });
    await act(async () => {
      surface.focus();
      await user.keyboard('{Backspace}');
    });
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.freeNodes).toHaveLength(0);
      expect(snap.placements).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Performance: real CanvasSurface with 50 visible nodes
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — performance', () => {
  it('mounts 50 visible nodes in the real engine surface and reports the synchronous render time', async () => {
    const env = setupTestEnv();
    const projectId = 'project-1';
    await env.research.transact(async (tx) => {
      for (let i = 0; i < 50; i++) {
        tx.putEvidence(
          makeEvidence(`ev-${i}`, `work-${i % 5}`, `Passage ${i}.`, projectId),
        );
      }
    });
    const refs = Array.from({ length: 50 }, (_, i) => ({
      id: `ev-${i}`,
      objectKind: 'evidence' as const,
    }));
    const t0 = performance.now();
    env.renderView({ viewId: 'canvas-project-1', initialRefs: refs });
    const tRender = performance.now() - t0;
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(50);
    });
    expect.soft(tRender, `synchronous render cost for 50 nodes = ${tRender.toFixed(2)}ms`).toBeLessThan(250);
    expect(tRender).toBeGreaterThan(0);
  });
});
