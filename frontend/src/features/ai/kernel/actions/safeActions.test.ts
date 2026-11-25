import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetAiKernelForTests,
  actionRegistry,
  checkPermission,
  draftLayer,
  type ContextPacket,
} from '../index';
import {
  ACTION_CANVAS_SUGGEST_CLUSTER,
  ACTION_CANVAS_SUGGEST_LAYOUT,
  ACTION_CANVAS_SUGGEST_RELATIONS,
  ACTION_CREATE_FREE_NOTE,
  ACTION_EXPLAIN_SELECTED,
  ACTION_NAVIGATE,
  ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
  ACTION_SEARCH_LOCAL,
  acceptNoteDraft,
  registerSafeActions,
  unregisterSafeActions,
} from './safeActions';
import type { ProviderRouter, ProviderChatResponse } from '../providerRouter';

const PACKET: ContextPacket = Object.freeze({
  mode: 'study',
  route: '/',
  container: null,
  focus: null,
  selectedText: 'a passage',
  selectedObjectIds: Object.freeze(['o-1']),
  selectionPreview: Object.freeze([{ id: 'o-1', label: 'o-1' }]),
  pinnedContextIds: Object.freeze([]),
  scopePolicy: 'selection',
  provider: 'unknown',
  visibility: 'private',
  invocationSurface: 'selection',
  snapshotHash: '00000000',
});

// `create-free-note-draft` requires a course container.
// The unit tests below pass this packet to bypass the
// gate; integration tests assert the gate refusal in
// the UI layer.
const COURSE_PACKET: ContextPacket = Object.freeze({
  ...PACKET,
  container: { workspaceId: 'ws-1', mode: 'study' as const, kind: 'course' as const, id: 'course-1' },
});

function fakeRouter(chatImpl: (req: { messages: { role: string; content: string }[] }) => Promise<ProviderChatResponse>): ProviderRouter {
  return {
    probe: async () => ({ aiAvailable: true, providerName: 'cloud' }),
    chat: async (req) => chatImpl(req as unknown as { messages: { role: string; content: string }[] }),
  };
}

describe('Safe actions', () => {
  beforeEach(() => {
    __resetAiKernelForTests();
  });

  it('registerSafeActions installs all eight actions (WP-06 added 3 canvas, WP-07 added research-suggest-design-tasks)', () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    const ids = actionRegistry.list().map((a) => a.id).sort();
    expect(ids).toEqual(
      [
        ACTION_NAVIGATE,
        ACTION_SEARCH_LOCAL,
        ACTION_CREATE_FREE_NOTE,
        ACTION_EXPLAIN_SELECTED,
        ACTION_CANVAS_SUGGEST_RELATIONS,
        ACTION_CANVAS_SUGGEST_CLUSTER,
        ACTION_CANVAS_SUGGEST_LAYOUT,
        ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
      ].sort(),
    );
  });

  it('canvas-suggest-relations produces a draft without writing canonical state', async () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    const out = await actionRegistry.run(ACTION_CANVAS_SUGGEST_RELATIONS, {
      packet: PACKET,
      prompt: 'suggest',
      args: {
        viewId: 'view-1',
        seedCandidates: [
          {
            fromRef: { kind: 'knowledge', id: 'ev-1', objectKind: 'evidence' },
            toRef: { kind: 'knowledge', id: 'cl-1', objectKind: 'claim' },
            suggestedKind: 'supports',
            confidence: 0.85,
            rationale: 'Same project, same Work lineage.',
          },
        ],
      },
    });
    expect(out.draft.body.kind).toBe('canvas-relation-suggestions');
    expect(out.draft.provenance.actionId).toBe(ACTION_CANVAS_SUGGEST_RELATIONS);
    // The action is `category: 'ai'` now (P0-6 round 2):
    // it goes through the ProviderRouter. The fake
    // router returns `provider: 'cloud'`, so the
    // provenance reflects that.
    expect(out.draft.provenance.provider).toBe('cloud');
  });

  it('canvas-suggest-relations: AI-off produces a failed draft and preserves the seed list', async () => {
    const failingRouter = {
      probe: async () => ({ aiAvailable: false, providerName: 'none' as const }),
      chat: async () => {
        throw new Error('AI offline');
      },
    };
    registerSafeActions({ providerRouter: failingRouter });
    const out = await actionRegistry.run(ACTION_CANVAS_SUGGEST_RELATIONS, {
      packet: PACKET,
      prompt: 'suggest',
      args: {
        viewId: 'view-1',
        seedCandidates: [
          {
            fromRef: { kind: 'knowledge', id: 'ev-1', objectKind: 'evidence' },
            toRef: { kind: 'knowledge', id: 'cl-1', objectKind: 'claim' },
            suggestedKind: 'supports',
            confidence: 0.85,
            rationale: 'Heuristic-only seed.',
          },
        ],
      },
    });
    expect(out.draft.status).toBe('failed');
    // The seed list is preserved (the user can still
    // see the local suggestion in the failed draft).
    const body = out.draft.body;
    if (body.kind === 'canvas-relation-suggestions') {
      expect(body.candidates).toHaveLength(1);
    } else {
      throw new Error(`unexpected body kind: ${body.kind}`);
    }
  });

  it('canvas-suggest-cluster produces a draft', async () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    const out = await actionRegistry.run(ACTION_CANVAS_SUGGEST_CLUSTER, {
      packet: PACKET,
      prompt: 'cluster',
      args: {
        viewId: 'view-1',
        groups: [{ id: 'g1', label: 'Method', memberRefIds: ['ev-1', 'ev-2'] }],
      },
    });
    expect(out.draft.body.kind).toBe('canvas-cluster-suggestions');
  });

  it('canvas-suggest-layout produces a draft without moving placements', async () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    const out = await actionRegistry.run(ACTION_CANVAS_SUGGEST_LAYOUT, {
      packet: PACKET,
      prompt: 'layout',
      args: {
        viewId: 'view-1',
        moves: [{ refId: 'ev-1', refKind: 'knowledge', x: 100, y: 200 }],
      },
    });
    expect(out.draft.body.kind).toBe('canvas-layout-suggestions');
  });

  it('navigate produces a navigation draft (no AI)', async () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    const out = await actionRegistry.run(ACTION_NAVIGATE, {
      packet: PACKET,
      prompt: 'go to canvas',
      args: { route: '#/research/reader', label: 'Open reader' },
    });
    expect(out.draft.body).toEqual({ kind: 'navigation', target: { route: '#/research/reader', label: 'Open reader' } });
    expect(out.draft.target.kind).toBe('navigation');
    expect(out.draft.provenance.provider).toBe('local');
  });

  it('searchLocal filters the corpus case-insensitively', async () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    const out = await actionRegistry.run(ACTION_SEARCH_LOCAL, {
      packet: PACKET,
      prompt: 'Smith',
      args: {
        corpus: [
          { id: 'p1', label: 'Smith 2024' },
          { id: 'p2', label: 'Doe 2023', preview: 'no match here' },
          { id: 'p3', label: 'SMITHSONIAN 2025' },
        ],
      },
    });
    expect(out.draft.body.kind).toBe('search-results');
    if (out.draft.body.kind === 'search-results') {
      const ids = out.draft.body.hits.map((h) => h.id);
      expect(ids).toContain('p1');
      expect(ids).toContain('p3');
      expect(ids).not.toContain('p2');
    }
  });

  it('createFreeNoteDraft is no-undo and stays in draft state until Accept', async () => {
    const noteWriter = vi.fn(async () => ({ id: 'note-1' }));
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })), noteWriter });
    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: COURSE_PACKET,
      prompt: 'free text the user typed',
      args: { title: 'My note', body: 'free text the user typed', moduleId: 'course-1' },
    });
    expect(out.draft.target.kind).toBe('note');
    expect(out.draft.noUndo).toBe(true);
    expect(out.draft.status).toBe('draft');
    // Reject is a no-op for the kernel — Accept calls the writer.
    draftLayer.transition(out.draft.id, 'rejected');
    expect(draftLayer.get(out.draft.id)?.status).toBe('rejected');
    // The writer was not called for Reject.
    expect(noteWriter).not.toHaveBeenCalled();
  });

  it('createFreeNoteDraft Accept persists through the noteWriter', async () => {
    const noteWriter = vi.fn(async () => ({ id: 'note-99' }));
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })), noteWriter });
    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: COURSE_PACKET,
      prompt: 'body',
      args: { title: 't', body: 'b', moduleId: 'course-1' },
    });
    const result = await acceptNoteDraft(out.draft);
    expect(result.canonicalId).toBe('note-99');
    expect(noteWriter).toHaveBeenCalledWith({ title: 't', body: 'b', moduleId: 'course-1' });
    expect(draftLayer.get(out.draft.id)?.status).toBe('accepted');
  });

  it('createFreeNoteDraft: gate refuses when the packet has no course container', async () => {
    const noteWriter = vi.fn(async () => ({ id: 'note-x' }));
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })), noteWriter });
    // The action's `execute` does not re-check the gate;
    // the gate is `checkPermission`. We assert the gate
    // refusal here; the action itself is the UI's
    // contract to skip the run.
    const action = actionRegistry.get(ACTION_CREATE_FREE_NOTE);
    expect(action).toBeDefined();
    const perm = checkPermission({
      action: action!,
      packet: PACKET, // no container
      workspaceFlavour: 'sync',
      provider: { aiAvailable: false, providerName: 'none' },
    });
    expect(perm.ok).toBe(false);
    if (!perm.ok) {
      expect(perm.reason).toBe('no-container');
      expect(perm.message).toMatch(/course/);
    }
    expect(noteWriter).not.toHaveBeenCalled();
  });

  it('explainSelectedText: success stamps provider/model and yields a ready draft', async () => {
    registerSafeActions({
      providerRouter: fakeRouter(async () => ({
        content: 'a clear explanation',
        provider: 'cloud',
        model: 'claude-x',
      })),
    });
    const out = await actionRegistry.run(ACTION_EXPLAIN_SELECTED, {
      packet: PACKET,
      prompt: 'what does this mean?',
    });
    expect(out.draft.status).toBe('draft');
    expect(out.draft.body.kind).toBe('explanation');
    if (out.draft.body.kind === 'explanation') {
      expect(out.draft.body.text).toBe('a clear explanation');
    }
    expect(out.draft.provenance.provider).toBe('cloud');
    expect(out.draft.provenance.model).toBe('claude-x');
  });

  it('explainSelectedText: failure produces a `failed` draft (prompt and selection preserved on the session side)', async () => {
    registerSafeActions({
      providerRouter: fakeRouter(async () => {
        throw new Error('cloud error: no network');
      }),
    });
    const out = await actionRegistry.run(ACTION_EXPLAIN_SELECTED, {
      packet: PACKET,
      prompt: 'why?',
    });
    expect(out.draft.status).toBe('failed');
    expect(out.draft.provenance.errorMessage).toContain('cloud error');
  });

  it('explainSelectedText: empty selection rejects synchronously', async () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    await expect(
      actionRegistry.run(ACTION_EXPLAIN_SELECTED, {
        packet: { ...PACKET, selectedText: null },
        prompt: 'why?',
      }),
    ).rejects.toThrow(/No text selected/);
  });

  it('unregisterSafeActions removes the eight actions from the registry', () => {
    registerSafeActions({ providerRouter: fakeRouter(async () => ({ content: 'x', provider: 'cloud' })) });
    expect(actionRegistry.list().length).toBe(8);
    unregisterSafeActions();
    expect(actionRegistry.list().length).toBe(0);
  });
});
