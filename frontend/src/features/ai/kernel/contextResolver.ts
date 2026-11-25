/**
 * StudyKit v0.4 — AI Interaction Kernel: `ContextResolver`
 *
 * Pure function. Builds the *minimum* `ContextPacket` the AI
 * Interaction Kernel needs to dispatch an action. Two rules
 * drive every choice below:
 *
 *   1. **Smallest viable scope wins.** A user selection on
 *      the current surface ALWAYS beats the current view;
 *      a current view ALWAYS beats the full container; the
 *      full container is the *last* thing the resolver
 *      reaches for, and only when nothing else applies.
 *   2. **Never widen across containers automatically.** A
 *      selection inside `Course A` is never silently
 *      attached to `Project B` (or vice versa) just because
 *      the user opened a second tab. The resolver returns
 *      a `scopePolicy` of `selection` and an empty
 *      `relatedObjectIds` so the gate / preview can show
 *      exactly that.
 *
 * This module is **pure**. It has no React, no Dexie, no
 * network, no globals. The kernel stitches together a
 * `ContextPacket` from the inputs the calling surface
 * already has. Tests are deterministic.
 *
 * Out of scope for WP-03 (kept tiny on purpose):
 *   - real `SourceLocator` decoding (lives in `domain/` later)
 *   - background indexer integration
 *   - cross-project search
 *
 * The exposed `deriveScope(...)` helper is the only thing
 * the rest of the kernel imports from this file.
 */

import type { AppLocation, ContainerRef, WorkspaceMode } from '../../../domain/workspace';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Where the user invoked the Intent Capsule from. This is
 * surfaced to the user in the Context Chip and recorded in
 * the draft's provenance. The list is the minimum WP-03
 * needs; later packets may add to it.
 */
export type InvocationSurface =
  | 'selection'           // user picked a text/object span
  | 'object'              // right-click on a single object
  | 'intent-capsule'      // explicit ⌘K / Ctrl+K open
  | 'transition'          // (reserved) a soft transition prompt
  | 'workspace'           // (reserved) AI workspace panel
  | 'desktop-quick-access'; // (reserved) global hotkey outside the app

export const INVOCATION_SURFACES: readonly InvocationSurface[] = [
  'selection',
  'object',
  'intent-capsule',
  'transition',
  'workspace',
  'desktop-quick-access',
] as const;

export function isInvocationSurface(value: unknown): value is InvocationSurface {
  return (
    value === 'selection' ||
    value === 'object' ||
    value === 'intent-capsule' ||
    value === 'transition' ||
    value === 'workspace' ||
    value === 'desktop-quick-access'
  );
}

/** The four scope levels the resolver can produce. */
export type ScopePolicy = 'selection' | 'current-view' | 'container' | 'explicit-set';

export const SCOPE_POLICIES: readonly ScopePolicy[] = [
  'selection',
  'current-view',
  'container',
  'explicit-set',
] as const;

/** Visibility for cloud-bound scopes (D-002). */
export type Visibility = 'private' | 'project';

/**
 * The provider the resolver thinks will serve this request.
 * `none` means: do not call an AI. The Action Registry may
 * still offer local-only actions (navigate, search-local,
 * create-free-note-draft).
 */
export type ProviderHint = 'none' | 'ollama' | 'cloud' | 'unknown';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A single object in the user's selection. Kept small on
 * purpose: a stable id, a kind, and an optional text excerpt
 * the resolver hands to the gate / preview. The actual
 * `KnowledgeObject` lives in `domain/repository` and is *not*
 * dragged into the kernel.
 */
export interface SelectionObject {
  readonly id: string;
  readonly kind: 'text' | 'note' | 'paper' | 'claim' | 'evidence' | 'task' | 'canvas-node' | 'other';
  /** A short preview (≤ 240 chars) the user can see in the chip. */
  readonly preview?: string;
}

/**
 * A context object the user explicitly pinned to the session.
 * Pinned items survive navigation; ordinary selections do not.
 */
export interface PinnedContext {
  readonly id: string;
  readonly kind: SelectionObject['kind'];
  readonly label: string;
}

export interface ContextResolverInput {
  /** Current route. Used as a stable label only. */
  readonly route: string;
  /** The current location, used to fill `container` / `mode`. */
  readonly location: AppLocation;
  /** Optional override container (e.g. when a surface knows better). */
  readonly containerOverride?: ContainerRef;
  /** The currently focused object, if any. */
  readonly focus?: { readonly objectId: string; readonly kind: SelectionObject['kind'] } | null;
  /** Plain-text selection (e.g. highlighted passage). */
  readonly selectedText?: string | null;
  /** Structured selection. */
  readonly selectedObjects?: readonly SelectionObject[];
  /** Items the user explicitly pinned to the session. */
  readonly pinnedContext?: readonly PinnedContext[];
  /** Workspace flavour — drives `provider` and `visibility` defaults. */
  readonly workspaceFlavour: 'local' | 'sync';
  /** Visibility the user / context implies (defaults to `private` for local, `project` for sync). */
  readonly visibility?: Visibility;
  /** What surfaced the request. */
  readonly invocationSurface: InvocationSurface;
  /**
   * Optional provider override (UI "Use cloud" etc.). Defaults to `unknown`
   * (let the gate decide).
   */
  readonly providerHint?: ProviderHint;
  /**
   * The user-picked scope (from `assistantSession.scopePolicy`). When
   * present, the resolver does NOT auto-derive the scope from
   * selection/pinned/focus; it uses the user's choice verbatim. This
   * is how `ScopeEditor` widens or narrows the packet.
   *
   * Two rules:
   *   - If the user picked `selection` but there is no selection, the
   *     resolver *demotes* to `current-view` so the gate does not see
   *     a packet that pretends to have a selection it does not.
   *   - If the user picked `explicit-set` but there are no pinned
   *     items, the resolver demotes to `container`.
   *   - `current-view` and `container` are accepted as-is.
   */
  readonly userScope?: ScopePolicy;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ContextPacket {
  readonly mode: WorkspaceMode;
  readonly route: string;
  readonly container: ContainerRef | null;
  readonly focus: { readonly objectId: string; readonly kind: SelectionObject['kind'] } | null;
  readonly selectedText: string | null;
  readonly selectedObjectIds: readonly string[];
  /** Selection summary, capped at 4 entries for the chip strip. */
  readonly selectionPreview: readonly { readonly id: string; readonly label: string }[];
  /** Pinned items the user explicitly kept across the session. */
  readonly pinnedContextIds: readonly string[];
  /** Resolved scope level (always the smallest that makes sense). */
  readonly scopePolicy: ScopePolicy;
  /** Provider the resolver picked — `none` is a valid answer. */
  readonly provider: ProviderHint;
  readonly visibility: Visibility;
  readonly invocationSurface: InvocationSurface;
  /** Stable hash of the packet (used by the Draft Layer provenance). */
  readonly snapshotHash: string;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Build a `ContextPacket` from the surface's input. The
 * function is total: it never throws on a missing field. A
 * missing container becomes `null`; a missing selection
 * becomes an empty list. The caller decides what to do with
 * the result.
 */
export function resolveContext(input: ContextResolverInput): ContextPacket {
  const selectedObjects = input.selectedObjects ?? [];
  const selectedText = input.selectedText ?? null;
  const pinned = input.pinnedContext ?? [];
  const container = input.containerOverride ?? input.location.container ?? null;
  const focus = input.focus ?? null;

  // Scope resolution. Two paths:
  //   - The user picked a scope via `ScopeEditor` → use it
  //     verbatim, with a *demotion* if the underlying state
  //     is empty (e.g. user picked `selection` but cleared
  //     the text).
  //   - The user did NOT pick a scope → auto-derive the
  //     smallest viable scope (selection > pinned > focus >
  //     container).
  let scopePolicy: ScopePolicy;
  if (input.userScope !== undefined) {
    scopePolicy = input.userScope;
    if (scopePolicy === 'selection' && selectedObjects.length === 0 && !selectedText) {
      scopePolicy = focus ? 'current-view' : 'container';
    } else if (scopePolicy === 'explicit-set' && pinned.length === 0) {
      scopePolicy = focus ? 'current-view' : 'container';
    }
  } else {
    scopePolicy =
      selectedObjects.length > 0 || selectedText
        ? 'selection'
        : pinned.length > 0
          ? 'explicit-set'
          : focus
            ? 'current-view'
            : 'container';
  }

  // Provider resolution. Local flavour has NO cloud path.
  // Sync flavour may use `cloud` or `ollama`; we leave that
  // decision to the gate (it knows which models are actually
  // configured). The hint here is just a *default*.
  const provider: ProviderHint =
    input.providerHint ??
    (input.workspaceFlavour === 'local' ? 'none' : 'unknown');

  // Visibility. Private is the safe default in both flavours;
  // the resolver upgrades to `project` only when a sync
  // flavour is on a `project` container (research mode).
  const visibility: Visibility =
    input.visibility ??
    (container && container.mode === 'research' && input.workspaceFlavour === 'sync'
      ? 'project'
      : 'private');

  // Cap the selection preview at 4 chips so the UI doesn't
  // explode when the user select-all's a long page.
  const selectionPreview = selectedObjects.slice(0, 4).map((o) => ({
    id: o.id,
    label: o.preview ?? `${o.kind}#${o.id}`,
  }));

  const packet: ContextPacket = Object.freeze({
    mode: input.location.mode,
    route: input.route,
    container,
    focus,
    selectedText,
    selectedObjectIds: Object.freeze(selectedObjects.map((o) => o.id)),
    selectionPreview: Object.freeze(selectionPreview),
    pinnedContextIds: Object.freeze(pinned.map((p) => p.id)),
    scopePolicy,
    provider,
    visibility,
    invocationSurface: input.invocationSurface,
    snapshotHash: computeSnapshotHash({
      mode: input.location.mode,
      containerId: container?.id ?? null,
      containerMode: container?.mode ?? null,
      focus: focus?.objectId ?? null,
      selectedText,
      selectedObjectIds: selectedObjects.map((o) => o.id).sort(),
      pinnedIds: pinned.map((p) => p.id).sort(),
      provider,
      visibility,
      invocationSurface: input.invocationSurface,
      scopePolicy,
    }),
  });

  return packet;
}

/**
 * True when the resolver's packet can be sent to a *cloud*
 * provider. Used by the gate as a fast pre-check, not as a
 * substitute for the full permission check.
 */
export function packetIsCloudEligible(packet: ContextPacket): boolean {
  if (packet.visibility === 'project' && packet.container?.mode === 'research') {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function computeSnapshotHash(input: {
  mode: WorkspaceMode;
  containerId: string | null;
  containerMode: WorkspaceMode | null;
  focus: string | null;
  selectedText: string | null;
  selectedObjectIds: readonly string[];
  pinnedIds: readonly string[];
  provider: ProviderHint;
  visibility: Visibility;
  invocationSurface: InvocationSurface;
  scopePolicy: ScopePolicy;
}): string {
  // Tiny deterministic hash. NOT cryptographic — it just
  // needs to be stable so two packets with the same inputs
  // produce the same id. FNV-1a on the joined string.
  const pieces = [
    input.mode,
    input.containerMode ?? '-',
    input.containerId ?? '-',
    input.focus ?? '-',
    input.selectedText ?? '-',
    ...input.selectedObjectIds,
    ...input.pinnedIds,
    input.provider,
    input.visibility,
    input.invocationSurface,
    input.scopePolicy,
  ];
  const joined = pieces.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit hex, padded.
  return (hash >>> 0).toString(16).padStart(8, '0');
}
