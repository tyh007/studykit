/**
 * StudyKit v0.4 — `features/collaboration/localIdentity`
 *
 * Stable per-device identity for the local workspace.
 *
 * The v0.4 first Beta does not require an account for
 * the local workspace; the user starts the app and
 * immediately has a working study / research surface.
 * For the Collaboration Foundation (WP-08) we still
 * need a *stable* identity to:
 *
 *   - bootstrap a `Collaborator` row for the local
 *     user (so the project has an owner);
 *   - route realtime envelopes to the right peer;
 *   - record activity / comments with a stable
 *     `authorId`;
 *   - filter the private-scratch list by
 *     `ownerId`.
 *
 * The id is generated once, on first read, and
 * persisted in `localStorage` under a namespaced
 * key. The display name defaults to "You (local)";
 * a future settings page may let the user pick a
 * real name. Two devices on the same account
 * currently have *different* ids; this is OK for
 * the v0.4 first Beta because the local workspace
 * is single-device by contract. Cross-device
 * collaboration happens through the sync
 * workspace.
 *
 * The sync workspace does NOT use this module: the
 * `useAuth()` hook returns the real `User` row,
 * and the wiring hands the real id to the
 * `CollaborationProvider`.
 */

const STORAGE_KEY = 'studykit.collab.localIdentity.v1';

interface LocalIdentity {
  readonly userId: string;
  readonly displayName: string;
}

function randomId(): string {
  // 16 bytes → 32 hex chars. Cryptographically
  // random when the browser supports
  // `crypto.getRandomValues`; the fallback is
  // still unique enough for the local-workspace
  // identity.
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(16);
    globalThis.crypto.getRandomValues(arr);
    return `local_${Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `local_${t}${r}${Math.random().toString(36).slice(2, 10)}`;
}

export function getLocalIdentity(): LocalIdentity {
  if (typeof globalThis === 'undefined' || typeof globalThis.localStorage === 'undefined') {
    // SSR / no-storage: a non-persistent identity.
    return { userId: randomId(), displayName: 'You (local)' };
  }
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalIdentity>;
      if (typeof parsed.userId === 'string' && parsed.userId.length > 0) {
        return {
          userId: parsed.userId,
          displayName:
            typeof parsed.displayName === 'string' && parsed.displayName.length > 0
              ? parsed.displayName
              : 'You (local)',
        };
      }
    }
  } catch {
    // fall through to create
  }
  const fresh: LocalIdentity = { userId: randomId(), displayName: 'You (local)' };
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // ignore: the in-memory value is still good for the session
  }
  return fresh;
}

export function setLocalDisplayName(name: string): void {
  if (typeof globalThis === 'undefined' || typeof globalThis.localStorage === 'undefined') return;
  const id = getLocalIdentity();
  try {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId: id.userId, displayName: name }),
    );
  } catch {
    // ignore
  }
}
