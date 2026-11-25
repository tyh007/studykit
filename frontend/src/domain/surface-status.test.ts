import { describe, expect, it } from 'vitest';

import {
  SURFACE_STATUS_KINDS,
  SurfaceStatus,
  isSurfaceStatus,
} from './surface-status';

describe('surface-status contract', () => {
  it('exposes the five canonical status kinds', () => {
    expect([...SURFACE_STATUS_KINDS].sort()).toEqual(
      ['empty', 'error', 'loading', 'offline', 'ready'],
    );
  });

  it('round-trips every kind through JSON', () => {
    const samples = [
      SurfaceStatus.loading(),
      SurfaceStatus.ready(),
      SurfaceStatus.empty(),
      SurfaceStatus.empty('No courses yet'),
      SurfaceStatus.offline(),
      SurfaceStatus.offline('2026-07-20T03:00:00.000Z'),
      SurfaceStatus.error({ code: 'E_NET', message: 'Network lost', recoverable: true }),
    ];
    for (const sample of samples) {
      const restored = JSON.parse(JSON.stringify(sample));
      expect(isSurfaceStatus(restored)).toBe(true);
      expect(restored).toEqual(sample);
    }
  });

  it('isSurfaceStatus accepts well-formed payloads', () => {
    expect(isSurfaceStatus({ kind: 'loading' })).toBe(true);
    expect(isSurfaceStatus({ kind: 'ready' })).toBe(true);
    expect(isSurfaceStatus({ kind: 'empty' })).toBe(true);
    expect(isSurfaceStatus({ kind: 'empty', reason: 'nothing here' })).toBe(true);
    expect(isSurfaceStatus({ kind: 'offline' })).toBe(true);
    expect(isSurfaceStatus({ kind: 'offline', lastSyncedAt: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(
      isSurfaceStatus({
        kind: 'error',
        code: 'E_FOO',
        message: 'boom',
        recoverable: false,
      }),
    ).toBe(true);
  });

  it('isSurfaceStatus rejects malformed payloads', () => {
    expect(isSurfaceStatus(null)).toBe(false);
    expect(isSurfaceStatus({})).toBe(false);
    expect(isSurfaceStatus({ kind: 'mystery' })).toBe(false);
    expect(isSurfaceStatus({ kind: 'empty', reason: 42 })).toBe(false);
    expect(isSurfaceStatus({ kind: 'offline', lastSyncedAt: 123 })).toBe(false);
    expect(
      isSurfaceStatus({ kind: 'error', code: 'E_FOO', message: 'boom' }),
    ).toBe(false); // missing `recoverable`
    expect(
      isSurfaceStatus({
        kind: 'error',
        code: 42,
        message: 'boom',
        recoverable: true,
      }),
    ).toBe(false);
  });
});
