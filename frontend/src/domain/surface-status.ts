/**
 * StudyKit v0.4 — `SurfaceStatus`
 *
 * A small discriminated union every renderable surface can be in.
 *
 * Per the v0.4 system design (§10), every surface must handle
 * Loading / Empty / Offline / Error without losing user content.
 * This type is the canonical shape the future App Shell will consume.
 *
 * Discriminated unions are used (not plain strings) so that exhaustive
 * `switch` checks in UI components are statically enforced by `tsc`.
 */

export type SurfaceStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'empty'; readonly reason?: string }
  | { readonly kind: 'offline'; readonly lastSyncedAt?: string }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly message: string;
      readonly recoverable: boolean;
    };

export type SurfaceStatusKind = SurfaceStatus['kind'];

export const SURFACE_STATUS_KINDS: readonly SurfaceStatusKind[] = [
  'loading',
  'ready',
  'empty',
  'offline',
  'error',
] as const;

export function isSurfaceStatus(value: unknown): value is SurfaceStatus {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'loading':
    case 'ready':
      return true;
    case 'empty':
      return v.reason === undefined || typeof v.reason === 'string';
    case 'offline':
      return v.lastSyncedAt === undefined || typeof v.lastSyncedAt === 'string';
    case 'error':
      return (
        typeof v.code === 'string' &&
        typeof v.message === 'string' &&
        typeof v.recoverable === 'boolean'
      );
    default:
      return false;
  }
}

/** Convenience constructors — keep call sites short and intent-revealing. */
export const SurfaceStatus = {
  loading(): SurfaceStatus {
    return { kind: 'loading' };
  },
  ready(): SurfaceStatus {
    return { kind: 'ready' };
  },
  empty(reason?: string): SurfaceStatus {
    return reason === undefined ? { kind: 'empty' } : { kind: 'empty', reason };
  },
  offline(lastSyncedAt?: string): SurfaceStatus {
    return lastSyncedAt === undefined
      ? { kind: 'offline' }
      : { kind: 'offline', lastSyncedAt };
  },
  error(input: { code: string; message: string; recoverable: boolean }): SurfaceStatus {
    return { kind: 'error', ...input };
  },
} as const;
