import { beforeEach, describe, expect, it } from 'vitest';

import { draftLayer, packetScopeChips, isTerminalStatus } from './draftLayer';
import type { ContextPacket } from './contextResolver';

const BASE_PACKET: ContextPacket = Object.freeze({
  mode: 'study',
  route: '/',
  container: null,
  focus: null,
  selectedText: 'a passage',
  selectedObjectIds: Object.freeze(['a', 'b']),
  selectionPreview: Object.freeze([{ id: 'a', label: 'a' }]),
  pinnedContextIds: Object.freeze([]),
  scopePolicy: 'selection',
  provider: 'unknown',
  visibility: 'private',
  invocationSurface: 'intent-capsule',
  snapshotHash: 'abc12345',
});

describe('DraftLayer', () => {
  beforeEach(() => {
    draftLayer.__resetForTests();
  });

  it('creates a draft in the resting `draft` state', () => {
    const d = draftLayer.create({
      id: 'd-1',
      title: 'Hello',
      body: { kind: 'text', text: 'world' },
      target: { targetId: 'd-1', kind: 'note' },
      provenance: {
        provider: 'local',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    expect(d.status).toBe('draft');
    expect(isTerminalStatus(d.status)).toBe(false);
  });

  it('moves generating → draft', () => {
    const d = draftLayer.create({
      id: 'd-2',
      title: 'Explain',
      body: { kind: 'explanation', text: '' },
      target: { targetId: 'd-2', kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    const g = draftLayer.transition(d.id, 'generating');
    expect(g.status).toBe('generating');
    const r = draftLayer.transition(d.id, 'draft');
    expect(r.status).toBe('draft');
  });

  it('terminal states are frozen (no further transitions)', () => {
    const d = draftLayer.create({
      id: 'd-3',
      title: 'Note',
      body: { kind: 'text', text: '' },
      target: { targetId: 'd-3', kind: 'note' },
      provenance: {
        provider: 'local',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    draftLayer.transition(d.id, 'accepted');
    expect(() => draftLayer.transition(d.id, 'rejected')).toThrow(/cannot transition/);
  });

  it('failed carries the error message and freezes the record', () => {
    const d = draftLayer.create({
      id: 'd-4',
      title: 'AI',
      body: { kind: 'explanation', text: '' },
      target: { targetId: 'd-4', kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    const f = draftLayer.transition(d.id, 'failed', { errorMessage: 'no network' });
    expect(f.status).toBe('failed');
    expect(f.provenance.errorMessage).toBe('no network');
    expect(f.provenance.resolvedAt).toBeDefined();
    // updateBody refuses on terminal states.
    expect(() => draftLayer.updateBody(d.id, { kind: 'text', text: 'x' })).toThrow();
  });

  it('updateBody on a live draft', () => {
    const d = draftLayer.create({
      id: 'd-5',
      title: 'Title',
      body: { kind: 'text', text: '' },
      target: { targetId: 'd-5', kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    const u = draftLayer.updateBody(d.id, { kind: 'text', text: 'now it has content' }, 'New');
    expect(u.body).toEqual({ kind: 'text', text: 'now it has content' });
    expect(u.title).toBe('New');
  });

  it('updateProvenance patches provider/model on a live draft', () => {
    const d = draftLayer.create({
      id: 'd-6',
      title: 'AI',
      body: { kind: 'explanation', text: '...' },
      target: { targetId: 'd-6', kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    const u = draftLayer.updateProvenance(d.id, { provider: 'ollama', model: 'llama3' });
    expect(u.provenance.provider).toBe('ollama');
    expect(u.provenance.model).toBe('llama3');
  });

  it('create() throws on duplicate id', () => {
    draftLayer.create({
      id: 'dup',
      title: 't',
      body: { kind: 'text', text: '' },
      target: { targetId: 'dup', kind: 'other' },
      provenance: {
        provider: 'local',
        actionId: 'a',
        contextSnapshotHash: 'abc',
        sourceScope: [],
        invocationSurface: 'intent-capsule',
      },
    });
    expect(() =>
      draftLayer.create({
        id: 'dup',
        title: 't',
        body: { kind: 'text', text: '' },
        target: { targetId: 'dup', kind: 'other' },
        provenance: {
          provider: 'local',
          actionId: 'a',
          contextSnapshotHash: 'abc',
          sourceScope: [],
          invocationSurface: 'intent-capsule',
        },
      }),
    ).toThrow(/already exists/);
  });

  it('packetScopeChips lists the human-readable scope', () => {
    const chips = packetScopeChips(BASE_PACKET);
    expect(chips).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Selected text'),
        expect.stringContaining('2 selected object'),
      ]),
    );
  });
});
