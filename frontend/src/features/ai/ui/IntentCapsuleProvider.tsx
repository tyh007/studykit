/**
 * StudyKit v0.4 — `IntentCapsuleProvider`
 *
 * Mount-once wrapper. Renders a single `<IntentCapsule>`
 * and wires the *global* keyboard shortcut:
 *
 *   - `Cmd/Ctrl+K`  open
 *   - `Escape`      handled inside the panel
 *                   (focus restore lives in `closeCapsule`)
 *
 * The provider reads `isFeatureEnabled('v04Assistant')`
 * at the *outer* edge: the keydown listener is
 * attached only when the flag is on, the
 * `useLocationWatch` side effects run only when the
 * flag is on, and the final render returns `null`
 * when the flag is off. **Every hook runs on every
 * render** so a `false → true → false` rerender keeps
 * a stable hook set.
 *
 * The provider does NOT register the safe actions. The
 * host (e.g. an App-level wiring in a future packet)
 * calls `registerSafeActions({...})` once, after the
 * dataApi is wired. The Capsule is purely a consumer.
 */

import React from 'react';
import { isFeatureEnabled } from '../../../app/feature-flags';
import { useLocation } from '../../../app/v04/locationStore';
import { IntentCapsule } from './IntentCapsule';
import { openCapsule, closeCapsule } from './openCapsule';
import { assistantSession } from '../kernel';
import { useLocationWatch } from './useLocationWatch';

export interface IntentCapsuleProviderProps {
  /**
   * The route the user is on. Optional — defaults to
   * `window.location.pathname` (the same value the
   * location store round-trips).
   */
  readonly route?: string;
}

export function IntentCapsuleProvider(
  props: IntentCapsuleProviderProps,
): React.ReactElement | null {
  // ============================================================
  // Hooks — unconditional. The flag is consulted at the
  // effect body and at the final render.
  // ============================================================
  const location = useLocation();
  const flagOn = isFeatureEnabled('v04Assistant');

  // Release transient context (selection + scope intent
  // + draft) when the user navigates to a different
  // route / mode / container. Pinned context and the
  // prompt survive.
  useLocationWatch();

  // Global Cmd/Ctrl+K listener. The effect no-ops when
  // the flag is off, so no keydown handler is attached.
  React.useEffect(() => {
    if (!flagOn) return;
    const onKey = (e: KeyboardEvent): void => {
      // Only trigger when the user is NOT typing in an
      // input / textarea / contenteditable; the
      // browser's native Cmd+K wins otherwise.
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'k') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = (target.tagName ?? '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      if (assistantSession.getSnapshot().isOpen) {
        closeCapsule();
      } else {
        openCapsule({ surface: 'intent-capsule' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [flagOn]);

  // ============================================================
  // Final render decision
  // ============================================================
  if (!flagOn) {
    return null;
  }
  const route = props.route ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return <IntentCapsule route={route} location={location} />;
}
