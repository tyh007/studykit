/**
 * StudyKit v0.4 — AI Interaction Kernel: `DraftLayer`
 *
 * The in-memory Draft Layer sits between the AI / system
 * action and canonical state. Every action that wants to
 * modify a Note, Claim, Evidence or Task MUST go through
 * here. The lifecycle is:
 *
 *   suggested → generating → draft → accepted
 *                                ↘ rejected
 *                                ↘ failed
 *                                ↘ cancelled
 *
 * The `suggested` state exists so a synchronous local
 * action (e.g. `createFreeNoteDraft`) can return a draft
 * the user reviews before Accept. `generating` is the AI
 * running. `draft` is the resting state with body +
 * preview + provenance. The three terminal states are
 * `accepted`, `rejected`, and `failed`/`cancelled` — they
 * all freeze the draft and record who resolved it.
 *
 * `failed` and `cancelled` were added on top of the WP-00
 * `DraftStatus` (`pending | accepted | rejected |
 * superseded`) because the Capsule UI needs to distinguish
 * "AI could not answer" from "user pressed Cancel". The
 * session store maps `pending` ↔ `suggested|generating|draft`
 * (the three "live" states) so older consumers still see
 * a single `pending` value when they ask "is this done?".
 *
 * The layer is **append-only with terminal transitions**.
 * Once a draft is `accepted` / `rejected` / `failed` /
 * `cancelled`, the body and provenance are frozen and
 * cannot be edited through the registry. The session may
 * still be inspected / displayed.
 *
 * The store is pure JS (no React). Tests use
 * `__resetDraftLayerForTests` to wipe it between cases.
 */

import type { ContextPacket } from './contextResolver';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type DraftLiveStatus = 'suggested' | 'generating' | 'draft';
export type DraftTerminalStatus = 'accepted' | 'rejected' | 'failed' | 'cancelled';
export type DraftStatus = DraftLiveStatus | DraftTerminalStatus;

export const DRAFT_LIVE_STATUSES: readonly DraftLiveStatus[] = [
  'suggested',
  'generating',
  'draft',
] as const;

export const DRAFT_TERMINAL_STATUSES: readonly DraftTerminalStatus[] = [
  'accepted',
  'rejected',
  'failed',
  'cancelled',
] as const;

export function isDraftStatus(value: unknown): value is DraftStatus {
  return (
    value === 'suggested' ||
    value === 'generating' ||
    value === 'draft' ||
    value === 'accepted' ||
    value === 'rejected' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

export function isTerminalStatus(value: DraftStatus): value is DraftTerminalStatus {
  return value === 'accepted' || value === 'rejected' || value === 'failed' || value === 'cancelled';
}

/** WP-00 used `pending`; map it onto our `suggested` so older code keeps working. */
export function toLegacyStatus(s: DraftStatus): 'pending' | DraftTerminalStatus {
  if (s === 'suggested' || s === 'generating' || s === 'draft') return 'pending';
  return s;
}

// ---------------------------------------------------------------------------
// Target — what the draft wants to do in canonical state
// ---------------------------------------------------------------------------

export type DraftTargetKind =
  | 'note'
  | 'claim'
  | 'evidence'
  | 'task'
  | 'concept'
  | 'question'
  | 'output'
  | 'navigation'
  | 'other';

export interface DraftTarget {
  /** Stable id the action chose. For `note` it is a new id; for `evidence` it is the source object id. */
  readonly targetId: string;
  /** What kind of canonical object this draft represents. */
  readonly kind: DraftTargetKind;
  /** Optional: the parent container (e.g. module id, project id). */
  readonly containerId?: string;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export type DraftBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'navigation'; readonly target: { readonly route: string; readonly label: string } }
  | { readonly kind: 'search-results'; readonly query: string; readonly hits: readonly { readonly id: string; readonly label: string; readonly preview?: string }[] }
  | { readonly kind: 'note-draft'; readonly title: string; readonly body: string; readonly moduleId?: string }
  | { readonly kind: 'explanation'; readonly text: string; readonly model?: string }
  | {
      /**
       * WP-07: a list of `ResearchTask` skeletons the AI
       * suggested for a selected Question / Gap / Decision.
       * The user Accepts each one individually; the host
       * UI calls `createTask` for the accepted rows. The
       * draft body is read-only until Accept / Reject.
       *
       * `tasks` is the canonical seed (the local fallback
       * the user gets on AI-off). `displayedTasks` is
       * what the host actually shows — it is the AI's
       * bounded list on success, or the local seed on
       * provider/parse failure. `source` distinguishes
       * the two so the host can label the suggestions
       * accurately.
       */
      readonly kind: 'task-suggestions';
      readonly projectId: string;
      readonly sourceKind: 'question' | 'decision' | 'risk' | 'gap';
      readonly sourceId: string;
      readonly tasks: ReadonlyArray<{
        readonly title: string;
        readonly why: string;
        readonly definitionOfDone: string;
        readonly sourceNote: string;
        /** Optional dependency hints the user can Accept
         *  (within the same draft) or ignore. The use
         *  case resolves them by index. */
        readonly dependsOnTitles: readonly string[];
      }>;
      /** The tasks actually shown in the renderer. */
      readonly displayedTasks: ReadonlyArray<{
        readonly title: string;
        readonly why: string;
        readonly definitionOfDone: string;
        readonly sourceNote: string;
        readonly dependsOnTitles: readonly string[];
      }>;
      /** Where the displayed tasks came from. */
      readonly source: 'ai' | 'local-fallback';
    }
  | {
      readonly kind: 'canvas-relation-suggestions';
      readonly viewId: string;
      readonly candidates: readonly {
        readonly fromRef: { readonly kind: 'free' | 'knowledge'; readonly id: string; readonly objectKind?: string };
        readonly toRef: { readonly kind: 'free' | 'knowledge'; readonly id: string; readonly objectKind?: string };
        readonly suggestedKind: string;
        readonly confidence: number;
        readonly rationale: string;
      }[];
    }
  | {
      readonly kind: 'canvas-cluster-suggestions';
      readonly viewId: string;
      readonly groups: readonly {
        readonly id: string;
        readonly label: string;
        readonly memberRefIds: readonly string[];
      }[];
    }
  | {
      readonly kind: 'canvas-layout-suggestions';
      readonly viewId: string;
      readonly moves: readonly {
        readonly refId: string;
        readonly refKind: 'free' | 'knowledge';
        readonly x: number;
        readonly y: number;
      }[];
    }
  | { readonly kind: 'none' };

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface DraftProvenance {
  readonly provider: string;
  readonly model?: string;
  readonly actionId: string;
  readonly contextSnapshotHash: string;
  /** Scope tokens the user was shown in the preview. */
  readonly sourceScope: readonly string[];
  readonly invocationSurface: import('./contextResolver').InvocationSurface;
  readonly createdAt: string;
  /** When the draft resolved into a terminal state. */
  readonly resolvedAt?: string;
  /** Optional human-readable error message when `status === 'failed'`. */
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export interface DraftRecord {
  readonly id: string;
  readonly status: DraftStatus;
  readonly title: string;
  readonly body: DraftBody;
  readonly target: DraftTarget;
  readonly provenance: DraftProvenance;
  /** True when this action is `no-undo` (Accept cannot be undone). */
  readonly noUndo: boolean;
  /** When set, the user explicitly pinned this draft to the session. */
  readonly pinned?: boolean;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class DraftLayer {
  private readonly records = new Map<string, DraftRecord>();

  /**
   * Create a new draft. The `id` must be unique; the layer
   * will throw if it collides. The caller (the action
   * registry) generates the id; this keeps the layer
   * deterministic for tests.
   */
  create(input: {
    id: string;
    title: string;
    body: DraftBody;
    target: DraftTarget;
    provenance: Omit<DraftProvenance, 'createdAt'> & { readonly createdAt?: string };
    noUndo?: boolean;
  }): DraftRecord {
    if (this.records.has(input.id)) {
      throw new Error(`Draft id "${input.id}" already exists`);
    }
    const provenance: DraftProvenance = {
      provider: input.provenance.provider,
      ...(input.provenance.model !== undefined ? { model: input.provenance.model } : {}),
      actionId: input.provenance.actionId,
      contextSnapshotHash: input.provenance.contextSnapshotHash,
      sourceScope: Object.freeze([...input.provenance.sourceScope]),
      invocationSurface: input.provenance.invocationSurface,
      createdAt: input.provenance.createdAt ?? new Date().toISOString(),
    };
    const record: DraftRecord = Object.freeze({
      id: input.id,
      status: 'draft',
      title: input.title,
      body: input.body,
      target: input.target,
      provenance,
      noUndo: input.noUndo === true,
    });
    this.records.set(record.id, record);
    return record;
  }

  get(id: string): DraftRecord | undefined {
    return this.records.get(id);
  }

  list(): readonly DraftRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Transition a draft to a new status. The state machine
   * is enforced: live states can move to other live states
   * (e.g. `generating` → `draft`) or to any terminal state;
   * terminal states are frozen.
   */
  transition(
    id: string,
    next: DraftStatus,
    extras?: { readonly errorMessage?: string },
  ): DraftRecord {
    const current = this.records.get(id);
    if (!current) throw new Error(`Draft "${id}" not found`);
    if (isTerminalStatus(current.status)) {
      throw new Error(
        `Draft "${id}" is already ${current.status}; cannot transition to ${next}`,
      );
    }
    if (next === current.status) return current;
    const provenance: DraftProvenance = isTerminalStatus(next)
      ? Object.freeze({
          ...current.provenance,
          resolvedAt: new Date().toISOString(),
          ...(extras?.errorMessage !== undefined ? { errorMessage: extras.errorMessage } : {}),
        })
      : current.provenance;
    const updated: DraftRecord = Object.freeze({
      ...current,
      status: next,
      provenance,
    });
    this.records.set(id, updated);
    return updated;
  }

  /**
   * Replace the body of a `generating` / `suggested` draft.
   * Used by AI actions that want to stream partial output
   * in WP-03 we don't actually stream, but the seam exists
   * for later packets.
   */
  updateBody(id: string, body: DraftBody, title?: string): DraftRecord {
    const current = this.records.get(id);
    if (!current) throw new Error(`Draft "${id}" not found`);
    if (isTerminalStatus(current.status)) {
      throw new Error(`Cannot edit a terminal draft (${current.status})`);
    }
    const updated: DraftRecord = Object.freeze({
      ...current,
      body,
      ...(title !== undefined ? { title } : {}),
    });
    this.records.set(id, updated);
    return updated;
  }

  /**
   * Patch the provenance block on a non-terminal draft. AI
   * actions use this to stamp the *actual* provider name
   * (the draft is created with `provider: 'pending'` so the
   * registry has something to write before the call).
   */
  updateProvenance(
    id: string,
    patch: { readonly provider?: string; readonly model?: string },
  ): DraftRecord {
    const current = this.records.get(id);
    if (!current) throw new Error(`Draft "${id}" not found`);
    if (isTerminalStatus(current.status)) {
      throw new Error(`Cannot edit a terminal draft (${current.status})`);
    }
    const updated: DraftRecord = Object.freeze({
      ...current,
      provenance: Object.freeze({
        ...current.provenance,
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
      }),
    });
    this.records.set(id, updated);
    return updated;
  }

  /**
   * Drop a draft without recording a terminal status. Used
   * when the session is closed cleanly (e.g. user dismissed
   * the Capsule without reviewing). The record is wiped
   * from memory; the audit trail is *not* persisted in
   * WP-03 (no IndexedDB) — see WP-10 for the canonical log.
   */
  drop(id: string): void {
    this.records.delete(id);
  }

  /** All drafts in a given status. */
  byStatus(status: DraftStatus): readonly DraftRecord[] {
    return this.list().filter((d) => d.status === status);
  }

  /** Test-only reset. */
  __resetForTests(): void {
    this.records.clear();
  }
}

export const draftLayer: DraftLayer = new DraftLayer();

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/**
 * Compute a list of human-readable "what the action will read"
 * chips from a `ContextPacket`. Used by the `ActionPreview`
 * builder and the UI to render the same scope chips.
 */
export function packetScopeChips(packet: ContextPacket): readonly string[] {
  const chips: string[] = [];
  if (packet.selectedText) chips.push(`Selected text (${packet.selectedText.length} chars)`);
  if (packet.selectedObjectIds.length > 0) {
    chips.push(`${packet.selectedObjectIds.length} selected object(s)`);
  }
  if (packet.container) chips.push(`Container: ${packet.container.kind}#${packet.container.id}`);
  if (packet.focus) chips.push(`Focus: ${packet.focus.kind}#${packet.focus.objectId}`);
  if (packet.pinnedContextIds.length > 0) {
    chips.push(`${packet.pinnedContextIds.length} pinned`);
  }
  if (chips.length === 0) chips.push('No context — running in current view');
  return chips;
}
