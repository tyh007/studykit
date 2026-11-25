/**
 * StudyKit v0.4 — `features/canvas/__tests__/cognitiveCanvasAi`
 *
 * Real UI integration test for the cognitive canvas's
 * Intent Capsule integration (WP-06 Round 6 P0-4,
 * refined in the Round 6 audit).
 *
 * The test exercises the *real* UI integration:
 *
 *   1. Mount the real `CognitiveCanvasView` with a
 *      seeded `MemoryCanvasRepository` + 2 evidence
 *      + 1 claim already placed.
 *   2. Click the *real* `Ask AI` button.
 *   3. Assert the `IntentCapsule` opens with the 3
 *      `canvas-suggest-*` action chips visible.
 *   4. Click `canvas-suggest-relations` and assert
 *      the `ProviderRouter.chat()` was called with
 *      the *typed* `seedCandidates`:
 *        - the user message JSON includes the
 *          evidence + claim ids
 *        - a `supports` candidate between
 *          evidence and claim is in the seed list
 *   5. Assert the canonical view has *no* relations
 *      yet (the AI action only produces a draft;
 *      the user has to Accept).
 *   6. AI-off path: the draft must end up in
 *      `failed` status with the real error
 *      message; the Retry button must be visible
 *      and, when clicked, re-call `chat`.
 *   7. Close-and-reopen: after `closeCapsule`, the
 *      `actionArgsById` map must be empty. A
 *      generic `openCapsule({ surface: 'intent-capsule' })`
 *      (no `precomputedActionArgs`) must NOT show
 *      stale cognitive-canvas chips.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import React from 'react';

import { CognitiveCanvasView } from '../CognitiveCanvasView';
import { CanvasRepositoryProvider } from '../canvasRepositoryContext';
import {
  MemoryResearchRepository,
} from '../../../application/research/researchRepository';
import {
  MemoryStudyRepository,
} from '../../../application/study/studyRepository';
import { MemoryCanvasRepository } from '../../../repositories/memoryCanvasRepository';
import {
  createCanvasUseCases,
} from '../../../application/canvas/canvasGateway';
import {
  ShimStudyKitRepository,
} from '../../../repositories/shimStudyKitRepository';
import {
  registerSafeActions,
  unregisterSafeActions,
  type SafeActionDeps,
  type ProviderChatRequest,
  type ProviderChatResponse,
} from '../../ai/kernel';
import {
  IntentCapsuleProvider,
} from '../../ai/ui/IntentCapsuleProvider';
import {
  assistantSession,
  __resetAiKernelForTests,
} from '../../ai/kernel';
import { closeCapsule, openCapsule } from '../../ai/ui/openCapsule';
import type { Evidence as DomainEvidence, Claim as DomainClaim } from '../../../domain/research';
import { knowledgeRef } from '../../../domain/canvas';
import { locationStore } from '../../../app/v04/locationStore';
import { makeAppLocation } from '../../../domain/workspace';
import { __setFeatureFlagForTests, __resetFeatureFlagsForTests } from '../../../app/feature-flags';

// ---------------------------------------------------------------------------
// Seed helpers
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

interface AiOptions {
  /** When set, the ProviderRouter's `chat` rejects
   *  (simulates the AI-off / timeout path). */
  failChat?: boolean;
  /** When set, the ProviderRouter's `chat` returns
   *  this content. */
  chatContent?: string;
}

function setupTestEnv(opts: AiOptions = {}) {
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
  const objects = new ShimStudyKitRepository({
    research,
    study,
    notes,
    sources,
    listPapers,
    getPaper,
  });
  let n = 0;
  const useCases = createCanvasUseCases({
    repository: canvas,
    objects,
    now: () => new Date(2026, 6, 22, 12, 0, n++).toISOString(),
    newId: () => `id_${n}_${Math.random().toString(36).slice(2, 8)}`,
  });

  const chatMock = vi.fn(async (req: ProviderChatRequest): Promise<ProviderChatResponse> => {
    if (opts.failChat) {
      throw new Error('AI offline: provider unreachable');
    }
    return {
      provider: 'cloud',
      content: opts.chatContent ?? 'AI response: relations ranked by support score.',
      ...(req.scopeSummary ? { model: 'test-model' } : {}),
    };
  });
  const safeActionDeps: SafeActionDeps = {
    providerRouter: {
      probe: async () => ({ kind: 'available' as const, provider: 'cloud' as const, aiAvailable: true, providerName: 'cloud' as const }),
      chat: chatMock,
    },
  };
  return { canvas, research, study, useCases, chatMock, safeActionDeps };
}

/** Mount the cognitive canvas with the given initial refs. */
function MountedCognitiveCanvas(props: {
  canvas: MemoryCanvasRepository;
  useCases: ReturnType<typeof createCanvasUseCases>;
  readonly initialRefs: ReadonlyArray<ReturnType<typeof knowledgeRef>>;
}): React.ReactElement {
  return (
    <CanvasRepositoryProvider value={props.canvas}>
      <CognitiveCanvasView
        viewId="canvas-project-1"
        useCases={props.useCases}
        initialRefs={props.initialRefs}
      />
    </CanvasRepositoryProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CognitiveCanvas — AI integration (P0-4 + P0-2)', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(async () => {
    user = userEvent.setup({ delay: null });
    __setFeatureFlagForTests('v04Assistant', true);
    __resetAiKernelForTests();
    act(() => {
      locationStore.replace(makeAppLocation({
        mode: 'research',
        surface: 'cognitive-canvas',
        container: { workspaceId: 'ws-1', mode: 'research', kind: 'project', id: 'project-1' },
        surfaceId: 'canvas-project-1',
      }));
    });
  });
  afterEach(() => {
    cleanup();
    unregisterSafeActions();
    __resetFeatureFlagsForTests();
    __resetAiKernelForTests();
  });

  it('Suggest relations builds typed Evidence→Claim supports candidates from the snapshot (P0-2)', async () => {
    const env = setupTestEnv({ chatContent: 'relations ranked' });
    const projectId = 'project-1';
    // P0-2 fix: seed Evidence + Claim. The previous
    // version only re-ranked existing relations; an
    // empty canvas produced an empty seed list and
    // the AI was never called. With this seed, the
    // builder must produce `supports` candidates
    // between every (Evidence, Claim) pair.
    await env.research.transact(async (tx) => {
      tx.putEvidence(makeEvidence('ev-1', 'work-1', 'First passage.', projectId));
      tx.putEvidence(makeEvidence('ev-2', 'work-2', 'Second passage.', projectId));
      tx.putClaim(makeClaim('cl-1', 'Synthesised claim', 'Across two passages.', projectId));
    });
    registerSafeActions(env.safeActionDeps);

    render(
      <>
        <MountedCognitiveCanvas
          canvas={env.canvas}
          useCases={env.useCases}
          initialRefs={[
            knowledgeRef('ev-1', 'evidence'),
            knowledgeRef('ev-2', 'evidence'),
            knowledgeRef('cl-1', 'claim'),
          ]}
        />
        <IntentCapsuleProvider />
      </>,
    );
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(3);
    });
    const askAiButton = await waitFor(
      () => screen.getByTestId('cognitive-canvas-open-capsule'),
      { timeout: 3000 },
    );
    await act(async () => {
      await user.click(askAiButton);
    });
    const capsule = await waitFor(
      () => screen.getByTestId('v04-intent-capsule'),
      { timeout: 3000 },
    );
    // WP-06 Round 8: assert the *precomputed* typed
    // `seedCandidates` BEFORE the action runs. The
    // session's `actionArgsById` map is the single
    // source of truth (the `IntentCapsule.buildArgsForAction`
    // reads it first); a regex on the chat message
    // is too loose.
    const precomputed = assistantSession.getSnapshot()
      .actionArgsById['canvas-suggest-relations'] as
      | { seedCandidates: Array<{ fromRef: { id: string }; toRef: { id: string }; suggestedKind: string }> }
      | undefined;
    expect(precomputed).toBeDefined();
    const cands = precomputed!.seedCandidates;
    // Exact pairs: `ev-1 → cl-1` and `ev-2 → cl-1`
    // must be `supports` candidates (Evidence
    // supports a Claim, not the reverse).
    const ev1cl1 = cands.find(
      (c) => c.fromRef.id === 'ev-1' && c.toRef.id === 'cl-1',
    );
    const ev2cl1 = cands.find(
      (c) => c.fromRef.id === 'ev-2' && c.toRef.id === 'cl-1',
    );
    expect(ev1cl1?.suggestedKind).toBe('supports');
    expect(ev2cl1?.suggestedKind).toBe('supports');
    // The reverse direction (`cl-1 → ev-1` /
    // `cl-1 → ev-2`) MUST NOT be a `supports`
    // candidate — a Claim does not support its
    // Evidence. (Round 8 P0-2: enforce the
    // direction.)
    const cl1ev1 = cands.find(
      (c) => c.fromRef.id === 'cl-1' && c.toRef.id === 'ev-1',
    );
    const cl1ev2 = cands.find(
      (c) => c.fromRef.id === 'cl-1' && c.toRef.id === 'ev-2',
    );
    if (cl1ev1) expect(cl1ev1.suggestedKind).not.toBe('supports');
    if (cl1ev2) expect(cl1ev2.suggestedKind).not.toBe('supports');
    // The relation chip is visible.
    const relationChip = await waitFor(
      () => within(capsule).getByRole('button', { name: /Suggest canvas relations/i }),
      { timeout: 3000 },
    );
    await act(async () => {
      await user.click(relationChip);
    });
    // The ProviderRouter.chat was called once with
    // the *typed* args.
    await waitFor(() => {
      expect(env.chatMock).toHaveBeenCalledTimes(1);
    });
    const chatCall = env.chatMock.mock.calls[0][0] as ProviderChatRequest;
    const userMessage = chatCall.messages.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();
    // Sanity: the user message includes the view id
    // (builder wires it through) and the AI JSON
    // payload includes the evidence + claim ids.
    expect(userMessage?.content).toMatch(/canvas-project-1/);
    expect(userMessage?.content).toMatch(/ev-1/);
    expect(userMessage?.content).toMatch(/ev-2/);
    expect(userMessage?.content).toMatch(/cl-1/);
    expect(userMessage?.content).toMatch(/supports/);
    // The draft is in `draft` (ready) state with
    // provenance `provider: 'cloud'`.
    await waitFor(() => {
      const draft = assistantSession.getSnapshot().draft;
      expect(draft).not.toBeNull();
      expect(draft?.provenance.actionId).toBe('canvas-suggest-relations');
      expect(draft?.provenance.provider).toBe('cloud');
    });
    // The canonical view has *no* relations yet
    // (the AI action produced a draft; the user
    // has not Accepted). Accepting a candidate is
    // the only path to a real relation.
    const snapAfter = await env.canvas.getViewSnapshot('canvas-project-1');
    const accepted = snapAfter.relations.filter((r) => r.status === 'accepted');
    expect(accepted).toHaveLength(0);
  });

  it('AI-off: draft ends in failed status with the real error message + Retry re-calls chat (P0-3)', async () => {
    const env = setupTestEnv({ failChat: true });
    const projectId = 'project-1';
    await env.research.transact(async (tx) => {
      tx.putEvidence(makeEvidence('ev-1', 'work-1', 'First passage.', projectId));
      tx.putClaim(makeClaim('cl-1', 'Claim', 'Body.', projectId));
    });
    registerSafeActions(env.safeActionDeps);

    render(
      <>
        <MountedCognitiveCanvas
          canvas={env.canvas}
          useCases={env.useCases}
          initialRefs={[
            knowledgeRef('ev-1', 'evidence'),
            knowledgeRef('cl-1', 'claim'),
          ]}
        />
        <IntentCapsuleProvider />
      </>,
    );
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(2);
    });
    const askAiButton = await waitFor(
      () => screen.getByTestId('cognitive-canvas-open-capsule'),
      { timeout: 3000 },
    );
    await act(async () => {
      await user.click(askAiButton);
    });
    const capsule = await waitFor(
      () => screen.getByTestId('v04-intent-capsule'),
      { timeout: 3000 },
    );
    const relationChip = await waitFor(
      () => within(capsule).getByRole('button', { name: /Suggest canvas relations/i }),
      { timeout: 3000 },
    );
    await act(async () => {
      await user.click(relationChip);
    });
    // The provider was called once.
    await waitFor(() => {
      expect(env.chatMock).toHaveBeenCalledTimes(1);
    });
    // P0-3 fix: the draft must end in `failed`
    // status with the real error message.
    await waitFor(() => {
      const draft = assistantSession.getSnapshot().draft;
      expect(draft).not.toBeNull();
      expect(draft?.status).toBe('failed');
      expect(draft?.provenance.actionId).toBe('canvas-suggest-relations');
    });
    // The error message is rendered (the
    // `IntentCapsule` shows it in an `aria-live`
    // region).
    await waitFor(() => {
      expect(
        screen.getByText(/AI offline: provider unreachable/i),
      ).toBeInTheDocument();
    });
    // The Retry button is visible and, when
    // clicked, re-calls `chat`. The second call
    // also fails (the mock is unchanged), so the
    // draft stays `failed`.
    const retryButton = await screen.findByRole('button', { name: /retry/i });
    await act(async () => {
      await user.click(retryButton);
    });
    await waitFor(() => {
      expect(env.chatMock).toHaveBeenCalledTimes(2);
    });
  });

  it('close → generic reopen: stale canvas chips do not leak (P0-3)', async () => {
    const env = setupTestEnv();
    const projectId = 'project-1';
    await env.research.transact(async (tx) => {
      tx.putEvidence(makeEvidence('ev-1', 'work-1', 'First passage.', projectId));
      tx.putEvidence(makeEvidence('ev-2', 'work-2', 'Second passage.', projectId));
    });
    registerSafeActions(env.safeActionDeps);

    render(
      <>
        <MountedCognitiveCanvas
          canvas={env.canvas}
          useCases={env.useCases}
          initialRefs={[
            knowledgeRef('ev-1', 'evidence'),
            knowledgeRef('ev-2', 'evidence'),
          ]}
        />
        <IntentCapsuleProvider />
      </>,
    );
    await waitFor(async () => {
      const snap = await env.canvas.getViewSnapshot('canvas-project-1');
      expect(snap.placements).toHaveLength(2);
    });
    // Open from the cognitive canvas.
    const askAiButton = await waitFor(
      () => screen.getByTestId('cognitive-canvas-open-capsule'),
      { timeout: 3000 },
    );
    await act(async () => {
      await user.click(askAiButton);
    });
    const capsule = await waitFor(
      () => screen.getByTestId('v04-intent-capsule'),
      { timeout: 3000 },
    );
    // The 3 canvas-suggest-* chips are visible.
    await waitFor(() => {
      expect(within(capsule).getByRole('button', { name: /Suggest canvas relations/i })).toBeInTheDocument();
    });
    // The session carries the precomputed args.
    expect(Object.keys(assistantSession.getSnapshot().actionArgsById).length).toBeGreaterThan(0);
    // Close the capsule (P0-3: the session's
    // `actionArgsById` must be cleared).
    act(() => {
      closeCapsule();
    });
    expect(assistantSession.getSnapshot().actionArgsById).toEqual({});
    // Open a *generic* capsule (no
    // `precomputedActionArgs`): same route, no
    // cognitive canvas surface. The 3
    // canvas-suggest-* chips must NOT appear.
    act(() => {
      openCapsule({ surface: 'intent-capsule' });
    });
    const capsule2 = await waitFor(
      () => screen.getByTestId('v04-intent-capsule'),
      { timeout: 3000 },
    );
    expect(within(capsule2).queryByRole('button', { name: /Suggest canvas relations/i })).toBeNull();
    expect(within(capsule2).queryByRole('button', { name: /Suggest canvas clusters/i })).toBeNull();
    expect(within(capsule2).queryByRole('button', { name: /Suggest canvas layout/i })).toBeNull();
    // The generic chips ARE visible.
    expect(within(capsule2).getByRole('button', { name: /Explain selection/i })).toBeInTheDocument();
    // Close again, then re-open from the cognitive
    // canvas: the 3 chips must reappear (a fresh
    // snapshot rebuilds the args).
    act(() => {
      closeCapsule();
    });
    await act(async () => {
      await user.click(askAiButton);
    });
    const capsule3 = await waitFor(
      () => screen.getByTestId('v04-intent-capsule'),
      { timeout: 3000 },
    );
    await waitFor(() => {
      expect(within(capsule3).getByRole('button', { name: /Suggest canvas relations/i })).toBeInTheDocument();
    });
  });
});
