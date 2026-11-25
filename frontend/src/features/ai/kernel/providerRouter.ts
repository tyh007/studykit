/**
 * StudyKit v0.4 — AI Interaction Kernel: `ProviderRouter`
 *
 * Thin wrapper that turns the kernel's `needs-ai` /
 * `needs-provider` action shape into an actual call to
 * the **application dataApi**. The router is the *only*
 * place the kernel talks to `application/dataApi`; UI code
 * never imports `lib/api` or `lib/literature-api` or any
 * AI client directly.
 *
 * Why a router at all? Two reasons:
 *
 *   1. The kernel needs to know whether an AI provider is
 *      actually reachable right now (so the gate can
 *      refuse an action up front). The router is where
 *      the reachability probe lives.
 *   2. The router gives the kernel a single seam to mock
 *      in tests. The dataApi itself is well-tested
 *      elsewhere; the kernel only needs to know that
 *      "the AI replied with text X" or "the AI failed
 *      with error Y".
 *
 * The router does NOT cache the reachability answer. The
 * AI Capability notice already does the right thing on a
 * per-action basis; caching here would create two
 * different "is AI available?" answers in the same
 * session.
 */

import type { Capability } from '../../../application/dataApi';
import { UnsupportedInLocalWorkspaceError } from '../../../application/dataApi';
import type { ProviderAvailability } from './permissionGate';
import type { ProviderHint } from './contextResolver';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ProviderRouter {
  /**
   * Probe whether an AI provider is reachable. Returns a
   * snapshot suitable for `checkPermission`. Never throws.
   */
  probe(): Promise<ProviderAvailability>;

  /**
   * Send a chat request to the configured AI provider. The
   * function MUST throw `UnsupportedInLocalWorkspaceError`
   * when the workspace flavour is `local` (the dataApi
   * already does that — we just re-state the contract here
   * so the kernel is self-documenting).
   *
   * The function may throw any other error; the action
   * registry will catch it and convert it to a failed
   * draft.
   */
  chat(request: ProviderChatRequest): Promise<ProviderChatResponse>;
}

export interface ProviderChatRequest {
  readonly messages: readonly { readonly role: 'user' | 'system' | 'assistant'; readonly content: string }[];
  /** Optional: a free-form "scope summary" the model can echo back. */
  readonly scopeSummary?: string;
  /** Optional: a model name override. */
  readonly model?: string;
}

export interface ProviderChatResponse {
  readonly content: string;
  readonly provider: 'ollama' | 'cloud';
  readonly model?: string;
  /** Optional: ids the provider claims it actually used. */
  readonly sources?: readonly string[];
}

// ---------------------------------------------------------------------------
// Default implementation — talks to the application dataApi
// ---------------------------------------------------------------------------

/**
 * Build a router from a function that knows the current
 * workspace flavour. The flavour is captured at call time
 * (not construction time) so flavour switches are picked
 * up automatically. This is the small piece of glue that
 * keeps the kernel from holding a stale reference to the
 * flavour.
 *
 * `flavourProbe` returns the current flavour; the router
 * uses it to refuse the call when `local`.
 */
export function buildProviderRouter(deps: {
  readonly flavourProbe: () => 'local' | 'sync';
  readonly capabilityProbe: (cap: Capability) => boolean;
  /**
   * The actual chat call. Production wires this to
   * `literatureAiApi.chat` via the dataApi gateway. Tests
   * inject a fake.
   */
  readonly chat: (req: ProviderChatRequest) => Promise<ProviderChatResponse>;
  readonly localAi?: {
    probe(): ProviderAvailability;
    chat(req: ProviderChatRequest): Promise<ProviderChatResponse>;
  };
}): ProviderRouter {
  return {
    async probe(): Promise<ProviderAvailability> {
      const flavour = deps.flavourProbe();
      if (flavour === 'local') {
        return deps.localAi?.probe() ?? { aiAvailable: false, providerName: 'none' };
      }
      const hasAi = deps.capabilityProbe('ai.chat');
      if (!hasAi) {
        return { aiAvailable: false, providerName: 'none' };
      }
      // We don't know the actual provider name without an
      // extra round-trip. The router returns `cloud` as the
      // best-effort default; the AI status indicator in the
      // existing UI will tell the user which one is wired up.
      return { aiAvailable: true, providerName: 'cloud' };
    },
    async chat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
      const flavour = deps.flavourProbe();
      if (flavour === 'local') {
        if (deps.localAi) return deps.localAi.chat(request);
        throw new UnsupportedInLocalWorkspaceError(
          'providerRouter.chat',
          'Start Ollama with a local model, or sign in to use cloud AI.',
        );
      }
      return deps.chat(request);
    },
  };
}

// ---------------------------------------------------------------------------
// Failure normalisation
// ---------------------------------------------------------------------------

/**
 * Convert a thrown error from the provider into a stable
 * `(message, kind)` pair the UI can show. The kernel calls
 * this when wrapping an AI failure into a `failed` draft.
 */
export function normaliseProviderError(err: unknown): { readonly message: string; readonly kind: string } {
  if (err instanceof UnsupportedInLocalWorkspaceError) {
    return { message: err.message, kind: 'local-workspace' };
  }
  if (err instanceof Error) {
    return { message: err.message, kind: err.name || 'error' };
  }
  return { message: 'Unknown AI error', kind: 'unknown' };
}

/**
 * Re-export the `ProviderHint` so callers can import the
 * router types and `ProviderHint` from a single place.
 */
export type { ProviderHint };
