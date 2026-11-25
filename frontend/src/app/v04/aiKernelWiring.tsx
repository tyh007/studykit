/**
 * StudyKit v0.4 — `AiKernelWiring` composition component
 *
 * The single, production-side wiring of the AI Interaction
 * Kernel. The kernel ships a `registerSafeActions(deps)` seam
 * (see `features/ai/kernel/actions/safeActions.ts`); this
 * component calls it ONCE, at the v04 composition root, when
 * the `v04Assistant` feature flag is on.
 *
 * Why a side-effect component and not a module-load
 * `registerSafeActions(...)` call? Two reasons:
 *
 *   1. The flag default is off. A module-load registration
 *      would wire AI actions into the v0.3 surface, defeating
 *      the "WP-03 ships behind a flag, no leakage into v0.3"
 *      rule.
 *   2. The dependencies need the live dataApi. The dataApi
 *      only exists after the React tree has mounted; a
 *      `useEffect` is the right place.
 *
 * The component itself returns `null`; its only job is to
 * register / unregister the four safe actions as the
 * `v04Assistant` flag flips at runtime.
 *
 * The `noteWriter` is the *minimum real adapter* for the
 * `create-free-note-draft` Accept path. It MUST persist the
 * user's content (per WP-03 Gate §2: "no AI 时 create note
 * 仍可用" — the action is not gated on AI). The kernel
 * itself never imports the dataApi; the wiring here is the
 * only place that knows the course → module mapping.
 *
 *   - `course` (v04 container) → `moduleId` on `Lecture`.
 *   - Title + body → existing `Lecture.title` (the only
 *     field the v0.3 Lecture model exposes for free text;
 *     body is appended with a clear separator so the user
 *     can find their content when re-opening the lecture).
 *   - `local` flavour and `sync` flavour both go through
 *     `getDataApi().lectures.create` — the gateway is the
 *     only place that knows which backend is active. WP-04
 *     can replace this with a richer Note model without
 *     changing the kernel seam.
 *
 * Out of scope (WP-04+):
 *   - A canonical Note model (the WP-04 work). For WP-03
 *     the user's "free note" lands as a real, findable
 *     Lecture under the course module.
 *   - WP-04 / WP-05 / WP-06 actions. They register here
 *     too, behind the same `flagOn` effect.
 */

import React, { useEffect } from 'react';
import {
  buildProviderRouter,
  registerSafeActions,
  unregisterSafeActions,
  type ProviderChatResponse,
  type ProviderRouter,
} from '../../features/ai';
import { getDataApi, literatureAiApi } from '../../application/dataApi';
import { isFeatureEnabled } from '../feature-flags';
import { useDesktopWorkspace } from './desktopWorkspaceContext';

/**
 * Build the real `noteWriter` adapter. Pulled out of the
 * `useEffect` body so the function reference is stable
 * across the effect's dependency array (the effect only
 * depends on `flagOn`).
 *
 * The kernel calls this exactly once per Accept; Reject
 * and Cancel never reach the writer (the kernel's
 * `acceptNoteDraft` is the only path that invokes it).
 * On failure the function throws and the kernel's draft
 * stays in the registry for retry; the UI shows the
 * error from `session.error` and the user can re-Accept
 * without losing the prompt, selection, scope, or focus.
 */
function buildNoteWriter(): (input: { title: string; body: string; moduleId?: string }) => Promise<{ id: string }> {
  return async ({ title, body, moduleId }) => {
    if (!moduleId) {
      // `create-free-note-draft` is gated by the permission
      // system to require a course container. If the gate is
      // bypassed (a future bug, a bad packet) we refuse
      // rather than silently create a note in global scope.
      throw new Error('create-free-note-draft requires a course container (moduleId).');
    }
    // Existing v0.3 safe mapping: a course is a Module, and
    // a free note attached to a course is a Lecture with the
    // user's title. The body is the free-form prompt the
    // user typed in the Capsule; the Lecture model has no
    // dedicated body field, so we append it to the title
    // with a clear separator. The user can find the content
    // by re-opening the lecture, and the lecture id is
    // canonical (`getDataApi().lectures.list(moduleId)`
    // returns it).
    const composedTitle = body.trim().length > 0
      ? `${title}\n\n${body}`
      : title;
    // `getDataApi()` dispatches to the local Dexie port in
    // `local` flavour and the v0.3 `/api` backend in `sync`
    // flavour. Both ports implement `lectures.create` with
    // the same `{ module_id, title }` shape; the gateway
    // is the only place that knows the difference.
    const lecture = await getDataApi().lectures.create({
      module_id: moduleId,
      title: composedTitle,
    });
    return { id: lecture.id };
  };
}

/**
 * Pure side-effect component. Mounted once at the v04
 * composition root; never renders anything. When the
 * `v04Assistant` flag flips off (or the component
 * unmounts) it tears down every action it registered.
 */
export function AiKernelWiring(): null {
  const flagOn = isFeatureEnabled('v04Assistant');
  const desktop = useDesktopWorkspace();
  const desktopRef = React.useRef(desktop);
  desktopRef.current = desktop;

  useEffect(() => {
    if (!flagOn) return;
    const router = buildProviderRouter({
      // Capture the flavour + capability at call time so a
      // workspace switch (Local ↔ Sync) is picked up
      // automatically without rebuilding the router.
      flavourProbe: () => (getDataApi().flavour === 'local' ? 'local' : 'sync'),
      capabilityProbe: (cap) => getDataApi().supports(cap),
      async chat(req): Promise<ProviderChatResponse> {
        const r = await literatureAiApi.chat({ messages: [...req.messages] });
        return { content: r?.message?.content ?? '', provider: 'cloud' };
      },
      localAi: {
        probe: () => ({
          aiAvailable: desktopRef.current.system.localAi?.reachable === true &&
            (desktopRef.current.system.localAi?.models.length ?? 0) > 0,
          providerName: desktopRef.current.system.localAi?.reachable ? 'ollama' : 'none',
        }),
        async chat(req): Promise<ProviderChatResponse> {
          const response = await desktopRef.current.localAiChat(req.messages, req.model);
          return response;
        },
      },
    });
    registerSafeActions({
      providerRouter: router,
      noteWriter: buildNoteWriter(),
    });
    // Expose the router so other features (e.g. the
    // Research slice's AI Claim Draft) can drive
    // the same AI provider. The reference is
    // cleared on tear-down so a flag flip never
    // leaves a stale handle behind.
    setSharedProviderRouter(router);
    return () => {
      unregisterSafeActions();
      setSharedProviderRouter(null);
    };
  }, [flagOn]);

  return null;
}

/**
 * A tiny handle the AI Kernel hands to the rest of
 * the v04 composition. The Kernel is the only place
 * that knows how to build the router; the Research
 * slice consumes it through `useSharedProviderRouter`.
 *
 * The handle is a *pub/sub* so consumers can react to
 * the router becoming available *after* the AI Kernel's
 * mount effect has run. The Research slice's wiring
 * subscribes to it and rebuilds its context value the
 * moment the router appears.
 */
let sharedProviderRouter: ProviderRouter | null = null;
const sharedProviderRouterListeners = new Set<(router: ProviderRouter | null) => void>();

function setSharedProviderRouter(router: ProviderRouter | null): void {
  sharedProviderRouter = router;
  for (const l of sharedProviderRouterListeners) {
    try {
      l(router);
    } catch {
      // A listener is allowed to throw; the rest of
      // the chain still runs.
    }
  }
}

export function getSharedProviderRouter(): ProviderRouter | null {
  return sharedProviderRouter;
}

/**
 * Subscribe to changes of the shared provider router.
 * Returns the unsubscribe function. The callback
 * receives the current router immediately so callers
 * can use a one-liner `useEffect`.
 */
export function subscribeSharedProviderRouter(
  listener: (router: ProviderRouter | null) => void,
): () => void {
  sharedProviderRouterListeners.add(listener);
  // Replay the current value so the consumer doesn't
  // need a separate `getSharedProviderRouter` call.
  listener(sharedProviderRouter);
  return () => {
    sharedProviderRouterListeners.delete(listener);
  };
}
