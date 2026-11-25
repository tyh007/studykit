import { beforeEach, describe, expect, it } from 'vitest';

import {
  actionRegistry,
  type ActionContract,
  type ActionInput,
  type ActionOutput,
  scopeMeets,
} from './actionRegistry';
import type { ContextPacket } from './contextResolver';
import { draftLayer } from './draftLayer';

const PACKET_SELECTION: ContextPacket = Object.freeze({
  mode: 'study',
  route: '/',
  container: null,
  focus: null,
  selectedText: 'hello',
  selectedObjectIds: Object.freeze(['o-1']),
  selectionPreview: Object.freeze([{ id: 'o-1', label: 'o-1' }]),
  pinnedContextIds: Object.freeze([]),
  scopePolicy: 'selection',
  provider: 'unknown',
  visibility: 'private',
  invocationSurface: 'intent-capsule',
  snapshotHash: '00000000',
});

function localAction(id: string, requiredScope: 'selection' | 'current-view' | 'container' | 'explicit-set' = 'current-view'): ActionContract {
  return {
    id,
    label: id,
    description: id,
    category: 'local',
    intent: 'other',
    requiredScope,
    permission: { kind: 'always' },
    preview: () => ({ summary: id, reads: [], writes: [], needsAi: false, providerLabel: 'local' }),
    execute: async (input: ActionInput): Promise<ActionOutput> => {
      const d = draftLayer.create({
        id: `${id}-1`,
        title: id,
        body: { kind: 'text', text: input.prompt },
        target: { targetId: 't', kind: 'other' },
        provenance: {
          provider: 'local',
          actionId: id,
          contextSnapshotHash: input.packet.snapshotHash,
          sourceScope: [],
          invocationSurface: input.packet.invocationSurface,
        },
      });
      return { draft: d };
    },
  };
}

describe('ActionRegistry', () => {
  beforeEach(() => {
    actionRegistry.reset();
  });

  it('scopeMeets follows the documented rank', () => {
    expect(scopeMeets('selection', 'selection')).toBe(true);
    expect(scopeMeets('current-view', 'selection')).toBe(true);
    expect(scopeMeets('container', 'selection')).toBe(true);
    expect(scopeMeets('selection', 'current-view')).toBe(false);
    expect(scopeMeets('current-view', 'current-view')).toBe(true);
    expect(scopeMeets('selection', 'container')).toBe(false);
    expect(scopeMeets('explicit-set', 'container')).toBe(true);
  });

  it('register / get / list', () => {
    actionRegistry.register(localAction('alpha'));
    actionRegistry.register(localAction('beta'));
    expect(actionRegistry.get('alpha')?.id).toBe('alpha');
    expect(actionRegistry.list().map((a) => a.id).sort()).toEqual(['alpha', 'beta']);
  });

  it('registering the same id overwrites the previous contract', () => {
    actionRegistry.register(localAction('dup', 'selection'));
    actionRegistry.register(localAction('dup', 'current-view'));
    expect(actionRegistry.get('dup')?.requiredScope).toBe('current-view');
  });

  it('available() filters by required scope', () => {
    actionRegistry.register(localAction('a', 'selection'));
    actionRegistry.register(localAction('b', 'container'));
    const selection = actionRegistry.available(PACKET_SELECTION);
    const names = selection.map((a) => a.id).sort();
    expect(names).toContain('a');
    expect(names).not.toContain('b');
  });

  it('run() returns the draft produced by the contract', async () => {
    actionRegistry.register(localAction('echo'));
    const out = await actionRegistry.run('echo', {
      packet: PACKET_SELECTION,
      prompt: 'hi',
    });
    expect(out.draft.title).toBe('echo');
    expect(out.draft.body.kind).toBe('text');
  });

  it('run() throws on unknown action', async () => {
    await expect(actionRegistry.run('nope', { packet: PACKET_SELECTION, prompt: '' })).rejects.toThrow(
      /Unknown action/,
    );
  });
});
