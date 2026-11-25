import { describe, expect, it } from 'vitest';

import { checkPermission, type ProviderAvailability } from './permissionGate';
import type { ActionContract, ActionInput, ActionOutput } from './actionRegistry';
import type { ContextPacket } from './contextResolver';

const SELECTION_PACKET: ContextPacket = Object.freeze({
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

const PROJECT_PACKET: ContextPacket = Object.freeze({
  ...SELECTION_PACKET,
  mode: 'research',
  provider: 'cloud',
  visibility: 'project',
  container: { workspaceId: 'ws-1', mode: 'research' as const, kind: 'project' as const, id: 'p-1' },
  scopePolicy: 'current-view',
});

const CLOUD_AVAILABLE: ProviderAvailability = { aiAvailable: true, providerName: 'cloud' };
const CLOUD_UNAVAILABLE: ProviderAvailability = { aiAvailable: false, providerName: 'none' };

function localAction(overrides: Partial<ActionContract> = {}): ActionContract {
  return {
    id: 'local',
    label: 'Local',
    description: 'local',
    category: 'local',
    intent: 'other',
    requiredScope: 'current-view',
    permission: { kind: 'always' },
    preview: () => ({ summary: 'l', reads: [], writes: [], needsAi: false, providerLabel: 'local' }),
    execute: async (_input: ActionInput): Promise<ActionOutput> => {
      throw new Error('not used in tests');
    },
    ...overrides,
  };
}

describe('PermissionGate', () => {
  it('always-allowed action passes regardless of provider', () => {
    const result = checkPermission({
      action: localAction(),
      packet: SELECTION_PACKET,
      workspaceFlavour: 'local',
      provider: CLOUD_UNAVAILABLE,
    });
    expect(result.ok).toBe(true);
  });

  it('local workspace cannot reach a cloud provider (visibility mismatch is a sub-case)', () => {
    const cloudAction = localAction({ permission: { kind: 'needs-ai' } });
    const result = checkPermission({
      action: cloudAction,
      packet: SELECTION_PACKET,
      workspaceFlavour: 'local',
      provider: CLOUD_UNAVAILABLE,
    });
    // The provider is unavailable; that reason wins.
    expect(result).toEqual({
      ok: false,
      reason: 'provider-unavailable',
      message: expect.stringContaining('AI provider'),
    });
  });

  it('needs-ai fails when no provider is available', () => {
    const ai = localAction({ permission: { kind: 'needs-ai' } });
    const r = checkPermission({
      action: ai,
      packet: SELECTION_PACKET,
      workspaceFlavour: 'sync',
      provider: CLOUD_UNAVAILABLE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('provider-unavailable');
  });

  it('needs-ai passes when AI is available', () => {
    const ai = localAction({ permission: { kind: 'needs-ai' } });
    const r = checkPermission({
      action: ai,
      packet: PROJECT_PACKET,
      workspaceFlavour: 'sync',
      provider: CLOUD_AVAILABLE,
    });
    expect(r.ok).toBe(true);
  });

  it('a local workspace cannot have project visibility', () => {
    const ai = localAction({ permission: { kind: 'needs-ai' } });
    const r = checkPermission({
      action: ai,
      packet: { ...SELECTION_PACKET, visibility: 'project' },
      workspaceFlavour: 'local',
      provider: CLOUD_AVAILABLE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('visibility-mismatch');
  });

  it('container-scope action fails when packet has no container', () => {
    const action = localAction({ requiredScope: 'container' });
    const r = checkPermission({
      action,
      packet: SELECTION_PACKET,
      workspaceFlavour: 'sync',
      provider: CLOUD_AVAILABLE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-container');
  });

  it('container-scope action passes when the packet has a matching container', () => {
    const action = localAction({ requiredScope: 'container' });
    const r = checkPermission({
      action,
      packet: {
        ...SELECTION_PACKET,
        container: { workspaceId: 'ws-1', mode: 'study' as const, kind: 'course' as const, id: 'c-1' },
        selectedObjectIds: Object.freeze([]),
        selectedText: null,
        scopePolicy: 'container' as const,
      },
      workspaceFlavour: 'sync',
      provider: CLOUD_AVAILABLE,
    });
    expect(r.ok).toBe(true);
  });

  it('provider-mismatch when needs-provider=ollama but only cloud is reachable', () => {
    const action = localAction({ permission: { kind: 'needs-provider', provider: 'ollama' } });
    const r = checkPermission({
      action,
      packet: SELECTION_PACKET,
      workspaceFlavour: 'sync',
      provider: CLOUD_AVAILABLE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('provider-mismatch');
  });
});
