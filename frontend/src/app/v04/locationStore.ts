/**
 * StudyKit v0.4 — `locationStore` (converged)
 *
 * Tiny, hash-based location store for WP-02. Mirrors the
 * `AppLocation` from `domain/workspace` into `location.hash`
 * and back, so back / forward / reload all work without
 * introducing a router dependency (see ADR-001).
 *
 * The store is *pure* — no React, no Dexie, no auth. It is
 * consumed by `useLocation()` (a `useSyncExternalStore` wrapper)
 * and by the shell's `navigate()` helper.
 *
 * Workspace id is intentionally NOT in the URL (D-004: local is
 * the default; server-issued ids never leak into the URL).
 */

import { useSyncExternalStore } from 'react';
import {
  isAppLocation,
  makeAppLocation,
  sameAppLocation,
  type AppLocation,
  type WorkspaceMode,
} from '../../domain/workspace';

// ---------------------------------------------------------------------------
// Hash codec (URL → location, location → URL)
// ---------------------------------------------------------------------------

const HASH_PREFIX = '#/';

export function encodeLocationToHash(loc: AppLocation): string {
  const query = new URLSearchParams();
  if (loc.surfaceId) query.set('__sid', loc.surfaceId);
  for (const [key, value] of Object.entries(loc.params ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    query.set(key, value);
  }
  const encodedQuery = query.toString();
  const tail = encodedQuery ? `?${encodedQuery}` : '';
  const container = loc.container?.id;
  if (container) {
    return `${HASH_PREFIX}${loc.mode}/${loc.surface}/${container}${tail}`;
  }
  return `${HASH_PREFIX}${loc.mode}/${loc.surface}${tail}`;
}

export function decodeLocationFromHash(rawHash: string): AppLocation | null {
  if (!rawHash || rawHash === '#' || rawHash === '#/') return null;
  const body = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!body.startsWith('/')) return null;
  const segments = body.slice(1).split('?')[0]!.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const [mode, surface, containerId] = segments as [string, string, string?];
  if (mode !== 'study' && mode !== 'research') return null;
  const query = new URLSearchParams(body.split('?')[1] ?? '');
  const surfaceId = query.get('__sid') ?? undefined;
  query.delete('__sid');
  const params = Object.fromEntries(query.entries());
  try {
    const candidate = makeAppLocation({
      mode: mode as WorkspaceMode,
      surface: surface as AppLocation['surface'],
      ...(containerId
        ? {
            container: {
              workspaceId: null,
              mode: mode as WorkspaceMode,
              kind: mode === 'study' ? ('course' as const) : ('project' as const),
              id: containerId,
            },
          }
        : {}),
      ...(surfaceId ? { surfaceId } : {}),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
    return isAppLocation(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const DEFAULT_LOCATION: AppLocation = makeAppLocation({
  mode: 'study',
  surface: 'study-home',
});

const SESSION_KEY = 'studykit.v04.location';

function readSessionLocation(): AppLocation | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAppLocation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionLocation(loc: AppLocation): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(loc));
  } catch {
    /* ignore */
  }
}

let current: AppLocation = (() => {
  if (typeof window === 'undefined') return DEFAULT_LOCATION;
  const fromHash = decodeLocationFromHash(window.location.hash);
  if (fromHash) return fromHash;
  return readSessionLocation() ?? DEFAULT_LOCATION;
})();

const listeners = new Set<() => void>();

function emit(): void {
  writeSessionLocation(current);
  for (const l of listeners) l();
}

function applyHashChange(): void {
  if (typeof window === 'undefined') return;
  const next = decodeLocationFromHash(window.location.hash);
  if (!next || sameAppLocation(next, current)) return;
  current = next;
  emit();
}

if (typeof window !== 'undefined') {
  // Always normalise the URL on first load so the address bar
  // matches the resolved location.
  const initial = encodeLocationToHash(current);
  if (window.location.hash !== initial) {
    window.history.replaceState(null, '', initial);
  }
  window.addEventListener('hashchange', applyHashChange);
}

export const locationStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): AppLocation {
    return current;
  },
  replace(next: AppLocation): void {
    if (sameAppLocation(next, current)) return;
    current = next;
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', encodeLocationToHash(next));
    }
    emit();
  },
  push(next: AppLocation): void {
    if (sameAppLocation(next, current)) return;
    current = next;
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', encodeLocationToHash(next));
    }
    emit();
  },
  back(): void {
    if (typeof window !== 'undefined') window.history.back();
  },
  forward(): void {
    if (typeof window !== 'undefined') window.history.forward();
  },
};

export function useLocation(): AppLocation {
  return useSyncExternalStore(
    locationStore.subscribe,
    locationStore.getSnapshot,
    locationStore.getSnapshot,
  );
}
