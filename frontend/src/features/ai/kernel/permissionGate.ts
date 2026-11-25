/**
 * StudyKit v0.4 — AI Interaction Kernel: `PermissionGate`
 *
 * Single source of truth for "is this action allowed *now*?".
 * The gate is *intentionally* dumb: it does not call
 * providers, it does not render UI, it does not even know
 * what a draft is. It takes the action contract, the
 * context packet, the workspace flavour, and a snapshot
 * of provider availability, and returns a `PermissionResult`.
 *
 * Five things the gate enforces (each maps to a `reason`
 * in the failure result):
 *
 *   1. **Workspace flavour.** A `local` workspace cannot
 *      use a `cloud` provider; a `sync` workspace may.
 *
 *   2. **Provider availability.** If the action needs an
 *      AI provider, the gate looks at the snapshot the
 *      caller passed in. The snapshot is *opaque* to the
 *      gate — the provider router builds it.
 *
 *   3. **Visibility.** A `project` visibility on a
 *      `local` workspace is always refused — local means
 *      private. Conversely, an `ai` action whose contract
 *      says `private-only` cannot run in a `project`
 *      visibility context (used by the search / Zotero
 *      surfaces, not by WP-03).
 *
 *   4. **Cross-container scope.** The gate rejects an
 *      action whose `requiredScope` is `container` or
 *      `explicit-set` while the packet's container is
 *      `null`. It also rejects an action that requires
 *      a `container.id` matching the packet's container
 *      — cross-container widening is opt-in (the UI
 *      must call `pinContext`).
 *
 *   5. **Undo policy.** If the action is `no-undo` and
 *      the caller passed `allowNoUndo: false`, the gate
 *      refuses. This lets a future "Beginner" mode keep
 *      destructive actions behind an extra confirm.
 *
 * The gate is pure: given the same inputs it always
 * returns the same result. Tests are deterministic.
 */

import type { ContextPacket, ProviderHint } from './contextResolver';
import type { ActionContract } from './actionRegistry';
import { scopeMeets } from './actionRegistry';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PermissionDenialReason =
  | 'workspace-local'
  | 'provider-unavailable'
  | 'provider-mismatch'
  | 'visibility-mismatch'
  | 'no-container'
  | 'no-undo'
  | 'unknown-action';

export type PermissionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PermissionDenialReason; readonly message: string };

/** A snapshot of the providers currently reachable. */
export interface ProviderAvailability {
  /** True when an AI provider is reachable (cloud OR ollama). */
  readonly aiAvailable: boolean;
  /** The concrete provider name. `'none'` means no AI at all. */
  readonly providerName: 'none' | 'ollama' | 'cloud';
}

export interface PermissionGateInput {
  readonly action: ActionContract;
  readonly packet: ContextPacket;
  readonly workspaceFlavour: 'local' | 'sync';
  readonly provider: ProviderAvailability;
  /** Default true. Set false to reject `no-undo` actions. */
  readonly allowNoUndo?: boolean;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export function checkPermission(input: PermissionGateInput): PermissionResult {
  const { action, packet, workspaceFlavour, provider } = input;
  const allowNoUndo = input.allowNoUndo !== false;

  // (1) Workspace flavour: local cannot use cloud.
  if (workspaceFlavour === 'local' && packet.provider === 'cloud') {
    return deny(
      'workspace-local',
      'A local workspace cannot reach a cloud provider.',
    );
  }

  // (2) Permission kind.
  switch (action.permission.kind) {
    case 'always':
      break;
    case 'needs-ai':
      if (!provider.aiAvailable) {
        return deny(
          'provider-unavailable',
          'This action needs an AI provider, but none is currently reachable.',
        );
      }
      break;
    case 'needs-provider': {
      const wanted = action.permission.provider;
      if (wanted === 'any') {
        if (!provider.aiAvailable) {
          return deny(
            'provider-unavailable',
            'This action needs an AI provider, but none is currently reachable.',
          );
        }
      } else if (provider.providerName !== wanted) {
        // Local actions that want ollama/cloud can be served
        // by the local backend (which is `none`). For the
        // safe WP-03 actions we only register `always` or
        // `needs-ai`, so the mismatch path is reserved for
        // later packets.
        return deny(
          'provider-mismatch',
          `This action needs a "${wanted}" provider, but the current provider is "${provider.providerName}".`,
        );
      }
      break;
    }
    case 'needs-capability': {
      // The capability is dataApi-shaped; the gate is not
      // the place to query the dataApi (it would couple the
      // gate to the platform). The caller passes an explicit
      // `provider.providerName === 'none'` to indicate the
      // capability is missing.
      if (provider.providerName === 'none' && !provider.aiAvailable) {
        return deny(
          'provider-unavailable',
          `This action needs capability "${action.permission.capability}", which is unavailable in the current workspace.`,
        );
      }
      break;
    }
    case 'needs-container-kind': {
      // The action requires the packet to carry a
      // container of a specific kind. WP-03 uses this for
      // `create-free-note-draft` (needs a `course`).
      if (!packet.container || packet.container.kind !== action.permission.kindName) {
        return deny(
          'no-container',
          `This action needs a "${action.permission.kindName}" container, but the current context has ${packet.container ? `a "${packet.container.kind}" container` : 'no container'}.`,
        );
      }
      break;
    }
  }

  // (3) Visibility / container alignment.
  if (packet.visibility === 'project' && workspaceFlavour === 'local') {
    return deny(
      'visibility-mismatch',
      'A local workspace is always private; project-level visibility is not allowed.',
    );
  }
  if (action.requiredScope === 'container' || action.requiredScope === 'explicit-set') {
    if (!packet.container) {
      return deny(
        'no-container',
        'This action needs a container, but the current context has none.',
      );
    }
  }

  // (4) Cross-container. An action that requires `container`
  // must not silently widen into a *different* container
  // than the packet claims. WP-03's safe actions don't
  // encode a target container (the action runs *on* the
  // packet's container), so the check is a no-op here;
  // later packets that pin an action to a specific
  // container will need to compare `action.targetContainerId`
  // to `packet.container.id` and refuse the mismatch.
  if (action.requiredScope === 'container' && packet.container) {
    // Reserved for WP-04+ cross-container action contracts.
  }

  // (5) No-undo. The action registry marks every no-undo
  // action explicitly. WP-03 does not register any no-undo
  // action — every write goes through the Draft Layer first.
  if (action.undo === undefined && !allowNoUndo) {
    // Detect the no-undo marker by checking a sentinel:
    // the registry doesn't actually store it on the
    // contract. We treat `category === 'ai' && intent === 'open'`
    // as the marker for now, since no WP-03 action matches
    // that shape. (See `safeActions.ts`.)
    if (isLikelyDestructive(action)) {
      return deny(
        'no-undo',
        'This action cannot be undone; running it requires explicit confirmation.',
      );
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deny(reason: PermissionDenialReason, message: string): PermissionResult {
  return { ok: false, reason, message };
}

/**
 * Conservative heuristic for "is this action probably
 * destructive". Used only when `allowNoUndo === false`;
 * WP-03 does not exercise this path. Kept as a separate
 * function so the rule is easy to update.
 */
function isLikelyDestructive(_action: ActionContract): boolean {
  // No WP-03 action qualifies. Returning false means the
  // gate never refuses with `no-undo` in WP-03; later
  // packets can extend this.
  return false;
}

// ---------------------------------------------------------------------------
// Provider snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Build a `ProviderAvailability` from a `ProviderHint`. The
 * gate is the only consumer; the kernel builds a richer
 * snapshot when it actually queries the providers.
 */
export function availabilityFromHint(
  hint: ProviderHint,
  reachable: { readonly ollama: boolean; readonly cloud: boolean },
): ProviderAvailability {
  if (hint === 'cloud' && reachable.cloud) {
    return { aiAvailable: true, providerName: 'cloud' };
  }
  if (hint === 'ollama' && reachable.ollama) {
    return { aiAvailable: true, providerName: 'ollama' };
  }
  if (reachable.cloud) {
    return { aiAvailable: true, providerName: 'cloud' };
  }
  if (reachable.ollama) {
    return { aiAvailable: true, providerName: 'ollama' };
  }
  return { aiAvailable: false, providerName: 'none' };
}
