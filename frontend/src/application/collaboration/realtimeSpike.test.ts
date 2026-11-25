/**
 * StudyKit v0.4 — `application/collaboration/realtimeSpike.test.ts`
 *
 * Tests for the WP-08 presence / realtime spike.
 * The brief:
 *
 *   - Realtime is bonus, async is truth.
 *   - The local store is the durable record.
 *   - When realtime is unavailable (noop channel),
 *     all collaboration operations still work.
 *   - When realtime IS available, two peers (the
 *     "two browser tabs" smoke) see each other's
 *     envelopes.
 *   - A closed channel is a no-op; an envelope to
 *     a closed channel is dropped, the local store
 *     is untouched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryRealtimeChannel,
  NoopRealtimeChannel,
  BroadcastChannelRealtime,
  PresenceProvider,
  setRealtimeChannel,
  getRealtimeChannel,
  __resetRealtimeChannelForTests,
  __setBroadcastAvailableForTests,
  tryRealtimeSync,
} from './realtimeSpike';
import { buildPresenceSnapshot } from './collaborationUseCases';
import type { Collaborator, RealtimeEnvelope } from '../../domain/collaboration';

const NOW = '2026-07-24T12:00:00.000Z';
const PROJECT = 'p_1';

function member(over: Partial<Collaborator> = {}): Collaborator {
  return {
    id: 'c1', projectId: PROJECT, userId: 'u', displayName: 'U',
    role: 'commenter', addedAt: NOW, addedBy: 'u_owner',
    authorType: 'user', createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

function envelope(over: Partial<RealtimeEnvelope> = {}): RealtimeEnvelope {
  return {
    kind: 'comment-posted',
    id: 'env_1',
    actorId: 'u',
    projectId: PROJECT,
    version: 1,
    clientTime: NOW,
    serverTime: null,
    payload: '{}',
    ...over,
  };
}

describe('application/collaboration/realtimeSpike — MemoryRealtimeChannel', () => {
  it('routes an envelope to the right project subscribers', () => {
    const ch = new MemoryRealtimeChannel('test');
    const got: RealtimeEnvelope[] = [];
    const off = ch.subscribeProject(PROJECT, (env) => got.push(env));
    ch.send(envelope({ id: 'env_a' }));
    ch.send(envelope({ id: 'env_b', projectId: 'other' }));
    ch.send(envelope({ id: 'env_c' }));
    expect(got.map((e) => e.id)).toEqual(['env_a', 'env_c']);
    off();
    ch.send(envelope({ id: 'env_d' }));
    // After unsubscribe, the listener does NOT
    // receive further envelopes.
    expect(got.length).toBe(2);
  });

  it('send is a no-op after close', () => {
    const ch = new MemoryRealtimeChannel('test');
    const got: RealtimeEnvelope[] = [];
    ch.subscribeProject(PROJECT, (env) => got.push(env));
    ch.close();
    ch.send(envelope({ id: 'env_x' }));
    expect(got).toEqual([]);
  });

  it('isolates listener errors (one bad listener does not break the channel)', () => {
    const ch = new MemoryRealtimeChannel('test');
    const got: RealtimeEnvelope[] = [];
    ch.subscribeProject(PROJECT, () => {
      throw new Error('boom');
    });
    ch.subscribeProject(PROJECT, (env) => got.push(env));
    ch.send(envelope({ id: 'env_iso' }));
    expect(got.map((e) => e.id)).toEqual(['env_iso']);
  });
});

describe('application/collaboration/realtimeSpike — NoopRealtimeChannel', () => {
  it('drops envelopes silently', () => {
    const ch = new NoopRealtimeChannel();
    const got: RealtimeEnvelope[] = [];
    const off = ch.subscribeProject(PROJECT, (env) => got.push(env));
    ch.send(envelope());
    expect(got).toEqual([]);
    // Unsubscribe is a no-op.
    off();
  });
});

describe('application/collaboration/realtimeSpike — BroadcastChannelRealtime', () => {
  beforeEach(() => {
    __resetRealtimeChannelForTests();
    __setBroadcastAvailableForTests(() => false);
  });

  it('is a no-op when BroadcastChannel is unavailable', () => {
    const ch = new BroadcastChannelRealtime();
    const got: RealtimeEnvelope[] = [];
    ch.subscribeProject(PROJECT, (env) => got.push(env));
    ch.send(envelope());
    expect(got).toEqual([]);
    ch.close();
  });
});

describe('application/collaboration/realtimeSpike — channel registry', () => {
  beforeEach(() => {
    __resetRealtimeChannelForTests();
  });

  it('setRealtimeChannel swaps the current channel and closes the old', () => {
    const a = new MemoryRealtimeChannel('a');
    const b = new MemoryRealtimeChannel('b');
    setRealtimeChannel(a);
    expect(getRealtimeChannel()).toBe(a);
    setRealtimeChannel(b);
    expect(getRealtimeChannel()).toBe(b);
    // a is closed; sending on a is a no-op.
    const got: RealtimeEnvelope[] = [];
    a.subscribeProject(PROJECT, (env) => got.push(env));
    a.send(envelope());
    expect(got).toEqual([]);
  });

  it('setRealtimeChannel(null) is allowed and closes the current channel', () => {
    const a = new MemoryRealtimeChannel('a');
    setRealtimeChannel(a);
    setRealtimeChannel(null);
    expect(getRealtimeChannel()).not.toBe(a);
  });
});

describe('application/collaboration/realtimeSpike — tryRealtimeSync', () => {
  beforeEach(() => {
    __resetRealtimeChannelForTests();
  });

  it('does not throw when no channel is set (auto-select noop)', () => {
    __setBroadcastAvailableForTests(() => false);
    expect(() =>
      tryRealtimeSync({
        kind: 'comment-posted',
        actorId: 'u',
        projectId: PROJECT,
        payload: { foo: 'bar' },
      }),
    ).not.toThrow();
  });

  it('uses the current channel and produces a serialisable payload', () => {
    __setBroadcastAvailableForTests(() => false);
    const ch = new MemoryRealtimeChannel('test');
    setRealtimeChannel(ch);
    const got: RealtimeEnvelope[] = [];
    ch.subscribeProject(PROJECT, (env) => got.push(env));
    tryRealtimeSync({
      kind: 'comment-posted',
      actorId: 'u_a',
      projectId: PROJECT,
      payload: { commentId: 'cmt_1' },
    });
    expect(got.length).toBe(1);
    const env = got[0]!;
    expect(env.kind).toBe('comment-posted');
    expect(env.actorId).toBe('u_a');
    expect(env.projectId).toBe(PROJECT);
    expect(env.payload).toBe('{"commentId":"cmt_1"}');
    expect(env.version).toBeGreaterThan(0);
  });
});

describe('application/collaboration/realtimeSpike — PresenceProvider', () => {
  it('builds presence snapshots from heartbeats', () => {
    const ch = new MemoryRealtimeChannel('test');
    const provider = new PresenceProvider(ch);
    provider.heartbeat({ projectId: PROJECT, peer: { userId: 'u_a', displayName: 'A', role: 'commenter' } });
    provider.heartbeat({ projectId: PROJECT, peer: { userId: 'u_b', displayName: 'B', role: 'editor' } });
    const snap = provider.snapshotsFor(PROJECT, NOW);
    expect(snap.length).toBe(2);
    expect(snap.every((s) => s.online)).toBe(true);
  });

  it('forget removes a peer', () => {
    const ch = new MemoryRealtimeChannel('test');
    const provider = new PresenceProvider(ch);
    provider.heartbeat({ projectId: PROJECT, peer: { userId: 'u_a', displayName: 'A', role: 'commenter' } });
    provider.forget(PROJECT, 'u_a');
    const snap = provider.snapshotsFor(PROJECT, NOW);
    expect(snap.length).toBe(0);
  });

  it('subscribe receives fresh snapshots on every heartbeat', () => {
    const ch = new MemoryRealtimeChannel('test');
    const provider = new PresenceProvider(ch);
    const seen: number[] = [];
    provider.subscribe(PROJECT, (snap) => seen.push(snap.length));
    provider.heartbeat({ projectId: PROJECT, peer: { userId: 'u_a', displayName: 'A', role: 'commenter' } });
    provider.heartbeat({ projectId: PROJECT, peer: { userId: 'u_b', displayName: 'B', role: 'editor' } });
    expect(seen).toEqual([1, 2]);
  });

  it('isolates subscriber errors', () => {
    const ch = new MemoryRealtimeChannel('test');
    const provider = new PresenceProvider(ch);
    const seen: number[] = [];
    provider.subscribe(PROJECT, () => {
      throw new Error('boom');
    });
    provider.subscribe(PROJECT, (snap) => seen.push(snap.length));
    provider.heartbeat({ projectId: PROJECT, peer: { userId: 'u_a', displayName: 'A', role: 'commenter' } });
    expect(seen).toEqual([1]);
  });
});

describe('application/collaboration/realtimeSpike — buildPresenceSnapshot', () => {
  it('sets online=true within the staleness window', () => {
    const m = member();
    const snap = buildPresenceSnapshot({ collaborator: m, lastSeenAt: NOW, now: NOW });
    expect(snap.online).toBe(true);
  });

  it('sets online=false outside the staleness window', () => {
    const m = member();
    const last = '2026-07-24T11:00:00.000Z'; // 1h earlier
    const cur = '2026-07-24T12:00:00.000Z';
    const snap = buildPresenceSnapshot({ collaborator: m, lastSeenAt: last, now: cur });
    expect(snap.online).toBe(false);
  });
});
