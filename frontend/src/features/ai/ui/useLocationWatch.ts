/**
 * StudyKit v0.4 — `useLocationWatch`
 *
 * A tiny hook that watches the location store and
 * releases the *transient* context (selection + draft
 * + the user's *scope intent* when it was `selection`
 * pointing at a now-vanished selection) when the user
 * navigates to a different route, mode, or container.
 *
 * What survives a route change:
 *   - The prompt (typed intent).
 *   - Pinned context (explicitly chosen by the user).
 *
 * What does NOT survive:
 *   - The transient text / object selection.
 *   - The active draft (if any).
 *   - A scope intent of `selection` when the selection
 *     is now empty. The packet's resolver would
 *     demote the displayed scope to `current-view` /
 *     `container` automatically, but the *user's
 *     intent* (session.scopePolicy) is also reset to
 *     `current-view` so the next time the user makes a
 *     new selection they don't accidentally re-scope
 *     to the previous one.
 *
 * The hook is idempotent: same location twice in a
 * row → no release. Implemented via
 * `sameAppLocation` from the domain contract.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from '../../../app/v04/locationStore';
import { assistantSession } from '../kernel';
import { sameAppLocation, type AppLocation } from '../../../domain/workspace';

export function useLocationWatch(): void {
  const location = useLocation();
  const prev = useRef<AppLocation | null>(null);

  useEffect(() => {
    const before = prev.current;
    if (before === null) {
      prev.current = location;
      return;
    }
    if (sameAppLocation(before, location)) {
      prev.current = location;
      return;
    }
    // Route / mode / container changed → release the
    // transient part of the session. The prompt +
    // pinned context survive; the selection + draft
    // are dropped; a stale `selection` scope intent is
    // reset so the user doesn't re-target the old
    // context on the new surface.
    const snap = assistantSession.getSnapshot();
    if (snap.scopePolicy === 'selection' && snap.selectedObjectIds.length === 0 && !snap.selectedText) {
      assistantSession.setScope('current-view');
    }
    assistantSession.clearTransient();
    prev.current = location;
  }, [location]);
}
