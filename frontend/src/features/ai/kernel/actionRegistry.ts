/**
 * StudyKit v0.4 — AI Interaction Kernel: `ActionRegistry`
 *
 * A typed registry of *product actions* the AI can take.
 * An action is not a chat message; it's a contract that
 * says "given this input and this context, I will read
 * X, do Y, and (if you ask me to undo) I can roll it back
 * to Z". Each action has:
 *
 *   - `id`            stable kebab-case name
 *   - `label`         human-readable name shown in chip / preview
 *   - `category`      AI vs local — drives routing
 *   - `requiredScope` minimum scope policy that must hold
 *   - `permission`    additional permission check the gate enforces
 *   - `preview`       describes what the action will read / write
 *   - `execute`       runs the action; returns a `DraftResult`
 *   - `undo?`         optional undo; if absent, the action is
 *                     marked `no-undo` and `Accept` becomes
 *                     the only path to canonical state
 *
 * Why a registry (not a switch in the UI)? Three reasons:
 *
 *   1. WP-03 only registers *safe* actions. Later packets
 *      (WP-04 / WP-05 / WP-07) can register more without
 *      touching the kernel or the UI shell.
 *   2. The UI can list *available* actions for a context
 *      (chips) without knowing how they run.
 *   3. Tests can call `registry.run('id', input)` directly,
 *      so unit tests don't need a React tree.
 *
 * The registry is a *pure* module. There is exactly one
 * instance exported (`actionRegistry`). Tests can `reset()`
 * to a clean state.
 */

import type { ContextPacket } from './contextResolver';

// ---------------------------------------------------------------------------
// Action contract
// ---------------------------------------------------------------------------

/** The minimum scope a packet must meet for the action to run. */
export type RequiredScope = 'selection' | 'current-view' | 'container' | 'explicit-set';

export type ActionCategory = 'ai' | 'local';

export type ActionPermission =
  | { readonly kind: 'always' } // no extra check
  | { readonly kind: 'needs-ai' } // an AI provider must be available
  | { readonly kind: 'needs-capability'; readonly capability: string } // dataApi.supports(name)
  | { readonly kind: 'needs-provider'; readonly provider: 'ollama' | 'cloud' | 'any' }
  | { readonly kind: 'needs-container-kind'; readonly kindName: 'course' | 'project' }; // the packet's container.kind must match `kindName`

/** A description of the read / write surface for the preview. */
export interface ActionPreview {
  /** Short human-readable description. */
  readonly summary: string;
  /** Bullet list of things the action will read. */
  readonly reads: readonly string[];
  /** Bullet list of things the action will create / modify. */
  readonly writes: readonly string[];
  /** True if the action needs a network round-trip to an AI provider. */
  readonly needsAi: boolean;
  /** Provider label, when applicable (`ollama`, `cloud`, or `'local'`). */
  readonly providerLabel: string;
  /** Optional: what the undo path would do. Empty when `noUndo: true`. */
  readonly undoNote?: string;
}

/** The input passed to `execute(...)`. `args` is action-specific. */
export interface ActionInput {
  readonly packet: ContextPacket;
  readonly prompt: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/** A successful or failed execution. */
export interface ActionOutput {
  readonly draft: import('./draftLayer').DraftRecord;
}

/** A single action contract. */
export interface ActionContract<A = unknown> {
  readonly id: string;
  readonly label: string;
  readonly category: ActionCategory;
  /** Longer helper text shown in the chip / preview. */
  readonly description: string;
  /** Tells the UI which buttons to show. `true` for chips; `false` for advanced. */
  readonly intent: 'explain' | 'find' | 'create' | 'check' | 'navigate' | 'open' | 'other';
  readonly requiredScope: RequiredScope;
  readonly permission: ActionPermission;
  /** Static / dynamic preview. The args is the same as the execute args. */
  readonly preview: (input: ActionInput) => ActionPreview;
  /** Run the action. Must NEVER throw without producing a failed draft. */
  readonly execute: (input: ActionInput & { args: A }) => Promise<ActionOutput>;
  /**
   * If present, rolls back an `accepted` draft. If absent, the
   * action is `no-undo`: it is allowed, but the contract must
   * not write to canonical state without going through the
   * Draft Layer (i.e. the user must `Accept` first).
   */
  readonly undo?: (draft: import('./draftLayer').DraftRecord) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class ActionRegistry {
  private readonly actions = new Map<string, ActionContract>();

  /** Register a new action. Overwrites any previous action with the same id. */
  register<A>(contract: ActionContract<A>): void {
    if (!contract.id) throw new Error('Action id is required');
    if (!contract.label) throw new Error('Action label is required');
    this.actions.set(contract.id, contract as ActionContract);
  }

  /** Remove an action. Useful for tests. */
  unregister(id: string): void {
    this.actions.delete(id);
  }

  /** Get a single action by id. */
  get(id: string): ActionContract | undefined {
    return this.actions.get(id);
  }

  /** All registered actions. The returned array is a fresh copy. */
  list(): readonly ActionContract[] {
    return Array.from(this.actions.values());
  }

  /** List actions whose `requiredScope` is satisfied by `packet`. */
  available(packet: import('./contextResolver').ContextPacket): readonly ActionContract[] {
    const out: ActionContract[] = [];
    for (const a of this.actions.values()) {
      if (scopeMeets(packet.scopePolicy, a.requiredScope)) {
        out.push(a);
      }
    }
    return out;
  }

  /**
   * Run an action. Returns the resulting draft (or a failed
   * draft on error). The registry NEVER throws — the gate
   * (caller) is responsible for refusing to run an action
   * that violates the contract. The action itself catches
   * its own errors and converts them into a failed draft.
   */
  async run(
    id: string,
    input: ActionInput,
  ): Promise<ActionOutput> {
    const contract = this.actions.get(id);
    if (!contract) {
      throw new Error(`Unknown action: ${id}`);
    }
    // Cast through `unknown` so the registry can pass the
    // action-specific args type through without forcing the
    // registry itself to know about every action's shape.
    return (contract.execute as (i: typeof input) => Promise<ActionOutput>)(input);
  }

  /** Reset the registry. Tests only. */
  reset(): void {
    this.actions.clear();
  }
}

export const actionRegistry: ActionRegistry = new ActionRegistry();

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

const SCOPE_RANK: Readonly<Record<RequiredScope, number>> = {
  'selection': 0,
  'current-view': 1,
  'container': 2,
  'explicit-set': 3,
};

/**
 * True when the resolver's actual `policy` is *at least* as wide as
 * the action's `required`. `selection` satisfies everything; an
 * action that requires `container` cannot run on a packet that only
 * has `selection`.
 */
export function scopeMeets(policy: RequiredScope, required: RequiredScope): boolean {
  return SCOPE_RANK[policy] >= SCOPE_RANK[required];
}
