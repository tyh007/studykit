import { describe, expect, it } from 'vitest';

import { buildProviderRouter, normaliseProviderError } from './providerRouter';
import { UnsupportedInLocalWorkspaceError } from '../../../application/dataGateway';

describe('ProviderRouter', () => {
  it('probe() returns aiAvailable=false in a local flavour', async () => {
    const r = buildProviderRouter({
      flavourProbe: () => 'local',
      capabilityProbe: () => true,
      chat: async () => ({ content: 'x', provider: 'cloud' as const }),
    });
    const p = await r.probe();
    expect(p).toEqual({ aiAvailable: false, providerName: 'none' });
  });

  it('probe() returns aiAvailable=true when capability holds in sync', async () => {
    const r = buildProviderRouter({
      flavourProbe: () => 'sync',
      capabilityProbe: () => true,
      chat: async () => ({ content: 'x', provider: 'cloud' as const }),
    });
    const p = await r.probe();
    expect(p.aiAvailable).toBe(true);
    expect(p.providerName).toBe('cloud');
  });

  it('probe() returns aiAvailable=false when capability is missing', async () => {
    const r = buildProviderRouter({
      flavourProbe: () => 'sync',
      capabilityProbe: () => false,
      chat: async () => ({ content: 'x', provider: 'cloud' as const }),
    });
    const p = await r.probe();
    expect(p).toEqual({ aiAvailable: false, providerName: 'none' });
  });

  it('chat() refuses to run in a local flavour with UnsupportedInLocalWorkspaceError', async () => {
    const r = buildProviderRouter({
      flavourProbe: () => 'local',
      capabilityProbe: () => false,
      chat: async () => ({ content: 'x', provider: 'cloud' as const }),
    });
    await expect(r.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(
      UnsupportedInLocalWorkspaceError,
    );
  });

  it('chat() delegates to the provided function in sync', async () => {
    const r = buildProviderRouter({
      flavourProbe: () => 'sync',
      capabilityProbe: () => true,
      chat: async (req) => ({
        content: `echo(${req.messages.length})`,
        provider: 'cloud' as const,
      }),
    });
    const res = await r.chat({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    });
    expect(res.content).toBe('echo(2)');
    expect(res.provider).toBe('cloud');
  });

  it('normaliseProviderError maps Error to a stable pair', () => {
    const e = new Error('boom');
    expect(normaliseProviderError(e)).toEqual({ message: 'boom', kind: 'Error' });
    expect(normaliseProviderError('string-only')).toEqual({ message: 'Unknown AI error', kind: 'unknown' });
    const localErr = new UnsupportedInLocalWorkspaceError('chat', 'hint');
    const n = normaliseProviderError(localErr);
    expect(n.kind).toBe('local-workspace');
  });
});
