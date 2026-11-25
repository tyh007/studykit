/**
 * StudyKit v0.4 — AI Interaction Kernel: safe first actions
 *
 * Four WP-03 actions live here. They are intentionally
 * small: every one of them either doesn't touch canonical
 * state, or goes through the Draft Layer. None of them
 * silently writes to the database, moves the Canvas, or
 * expands context.
 *
 *   - `navigate`           local; takes a route + label,
 *                          returns a `navigation` draft the
 *                          UI uses to actually call
 *                          `locationStore.push`.
 *   - `searchLocal`        local; runs a string match over a
 *                          list the caller provides. No
 *                          AI. No network.
 *   - `createFreeNoteDraft` local; creates a `note-draft`
 *                          with a title and body. Accept
 *                          writes the note through the
 *                          dataApi gateway; Reject drops
 *                          the draft.
 *   - `explainSelectedText` AI; sends the selected text to
 *                          the provider. Failure produces a
 *                          `failed` draft that keeps the
 *                          prompt + selection alive.
 *
 * The actions are *registered* on module load. Tests can
 * call `registerSafeActions()` again after a
 * `actionRegistry.reset()` to re-install them.
 *
 * The actions MUST NOT import from `lib/api`,
 * `lib/literature-api`, or any AI client. The provider
 * router is the seam.
 */

import type { ActionContract } from '../actionRegistry';
import { actionRegistry } from '../actionRegistry';
import type { ProviderRouter } from '../providerRouter';
import { normaliseProviderError } from '../providerRouter';
import { draftLayer, packetScopeChips, type DraftRecord } from '../draftLayer';
import type { ActionInput, ActionOutput, ActionPreview } from '../actionRegistry';

// ---------------------------------------------------------------------------
// Action id constants
// ---------------------------------------------------------------------------

export const ACTION_NAVIGATE = 'navigate' as const;
export const ACTION_SEARCH_LOCAL = 'search-local' as const;
export const ACTION_CREATE_FREE_NOTE = 'create-free-note-draft' as const;
export const ACTION_EXPLAIN_SELECTED = 'explain-selected-text' as const;
export const ACTION_CANVAS_SUGGEST_RELATIONS = 'canvas-suggest-relations' as const;
export const ACTION_CANVAS_SUGGEST_CLUSTER = 'canvas-suggest-cluster' as const;
export const ACTION_CANVAS_SUGGEST_LAYOUT = 'canvas-suggest-layout' as const;
export const ACTION_RESEARCH_SUGGEST_DESIGN_TASKS = 'research-suggest-design-tasks' as const;

export const SAFE_ACTION_IDS = [
  ACTION_NAVIGATE,
  ACTION_SEARCH_LOCAL,
  ACTION_CREATE_FREE_NOTE,
  ACTION_EXPLAIN_SELECTED,
  ACTION_CANVAS_SUGGEST_RELATIONS,
  ACTION_CANVAS_SUGGEST_CLUSTER,
  ACTION_CANVAS_SUGGEST_LAYOUT,
  ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
] as const;

// ---------------------------------------------------------------------------
// Args shapes (documented; not enforced at runtime)
// ---------------------------------------------------------------------------

export interface NavigateArgs {
  readonly route: string;
  readonly label: string;
}

export interface SearchLocalArgs {
  readonly corpus: readonly { readonly id: string; readonly label: string; readonly preview?: string }[];
  readonly maxHits?: number;
}

export interface CreateFreeNoteArgs {
  readonly title: string;
  readonly body: string;
  /** When set, the note is attached to this module. Otherwise it is unattached. */
  readonly moduleId?: string;
}

export interface ExplainSelectedArgs {
  /** Optional override prompt. Defaults to the session prompt. */
  readonly question?: string;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * The provider router is injected at registration time so
 * tests can substitute a fake. The accept-side of
 * `createFreeNoteDraft` is wired to a tiny `noteWriter`
 * function that the UI provides; the kernel never imports
 * the dataApi directly.
 */
export interface SafeActionDeps {
  readonly providerRouter: ProviderRouter;
  /**
   * Persist a created note. Called on `Accept`. The kernel
   * itself never imports `application/dataApi`; the UI
   * supplies this function (which calls the dataApi) so
   * the seam stays narrow.
   */
  readonly noteWriter?: (input: { title: string; body: string; moduleId?: string }) => Promise<{ id: string }>;
}

let installedDeps: SafeActionDeps | null = null;

/**
 * Register the four safe actions. Idempotent: calling
 * twice does not duplicate registrations (the registry
 * overwrites by id).
 */
export function registerSafeActions(deps: SafeActionDeps): void {
  installedDeps = deps;
  actionRegistry.register(NAVIGATE_CONTRACT);
  actionRegistry.register(SEARCH_LOCAL_CONTRACT);
  actionRegistry.register(CREATE_FREE_NOTE_CONTRACT);
  actionRegistry.register(EXPLAIN_SELECTED_CONTRACT);
  actionRegistry.register(CANVAS_SUGGEST_RELATIONS_CONTRACT);
  actionRegistry.register(CANVAS_SUGGEST_CLUSTER_CONTRACT);
  actionRegistry.register(CANVAS_SUGGEST_LAYOUT_CONTRACT);
  actionRegistry.register(RESEARCH_SUGGEST_DESIGN_TASKS_CONTRACT);
}

/** Test-only unregister. */
export function unregisterSafeActions(): void {
  for (const id of SAFE_ACTION_IDS) {
    actionRegistry.unregister(id);
  }
  installedDeps = null;
}

// ---------------------------------------------------------------------------
// 1) `navigate`
// ---------------------------------------------------------------------------

const NAVIGATE_CONTRACT: ActionContract<NavigateArgs> = {
  id: ACTION_NAVIGATE,
  label: 'Navigate',
  description: 'Jump to a known surface or route. Accept actually moves the location store.',
  category: 'local',
  intent: 'navigate',
  requiredScope: 'current-view',
  permission: { kind: 'always' },
  preview(input: ActionInput): ActionPreview {
    const args = (input.args ?? {}) as Partial<NavigateArgs>;
    return {
      summary: `Open ${args.label ?? args.route ?? 'the next surface'}`,
      reads: packetScopeChips(input.packet),
      writes: ['Location store'],
      needsAi: false,
      providerLabel: 'local',
    };
  },
  async execute(input: ActionInput & { args: NavigateArgs }): Promise<ActionOutput> {
    // `args.route` MUST be a fully-qualified `#/...` hash
    // route (or a recognised shortcut like
    // `#/study/course/<id>`). The Capsule's Accept
    // handler feeds it through `decodeLocationFromHash`;
    // if it doesn't decode, the Accept is a no-op and
    // the draft stays in `draft` state — the user can
    // Retry or Cancel.
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const draft = draftLayer.create({
      id,
      title: input.args.label,
      body: {
        kind: 'navigation',
        target: { route: input.args.route, label: input.args.label },
      },
      target: { targetId: input.args.route, kind: 'navigation' },
      provenance: {
        provider: 'local',
        actionId: ACTION_NAVIGATE,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true, // no canonical write, but the user must Accept to actually move
    });
    return { draft };
  },
};

// ---------------------------------------------------------------------------
// 2) `searchLocal`
// ---------------------------------------------------------------------------

const SEARCH_LOCAL_CONTRACT: ActionContract<SearchLocalArgs> = {
  id: ACTION_SEARCH_LOCAL,
  label: 'Search this workspace',
  description: 'Find a known object by name. No AI, no network.',
  category: 'local',
  intent: 'find',
  requiredScope: 'current-view',
  permission: { kind: 'always' },
  preview(input: ActionInput): ActionPreview {
    return {
      summary: 'Find a known object by name',
      reads: packetScopeChips(input.packet),
      writes: [],
      needsAi: false,
      providerLabel: 'local',
    };
  },
  async execute(input: ActionInput & { args: SearchLocalArgs }): Promise<ActionOutput> {
    const query = input.prompt.trim().toLowerCase();
    const max = input.args.maxHits ?? 10;
    const hits = query.length === 0
      ? []
      : input.args.corpus
          .filter((item) => {
            const hay = `${item.label} ${item.preview ?? ''}`.toLowerCase();
            return hay.includes(query);
          })
          .slice(0, max);
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const draft = draftLayer.create({
      id,
      title: hits.length === 0 ? `No matches for "${input.prompt}"` : `Matches for "${input.prompt}"`,
      body: {
        kind: 'search-results',
        query: input.prompt,
        hits: hits.map((h) => ({
          id: h.id,
          label: h.label,
          ...(h.preview !== undefined ? { preview: h.preview } : {}),
        })),
      },
      target: { targetId: 'search', kind: 'other' },
      provenance: {
        provider: 'local',
        actionId: ACTION_SEARCH_LOCAL,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: false,
    });
    return { draft };
  },
};

// ---------------------------------------------------------------------------
// 3) `createFreeNoteDraft`
// ---------------------------------------------------------------------------

const CREATE_FREE_NOTE_CONTRACT: ActionContract<CreateFreeNoteArgs> = {
  id: ACTION_CREATE_FREE_NOTE,
  label: 'Create a free note draft',
  description:
    'Save the current text as a draft note. Accept to keep, Reject to drop. Requires a course context.',
  category: 'local',
  intent: 'create',
  requiredScope: 'selection',
  permission: { kind: 'needs-container-kind', kindName: 'course' },
  preview(input: ActionInput): ActionPreview {
    const args = (input.args ?? {}) as Partial<CreateFreeNoteArgs>;
    return {
      summary: `Save a new note titled "${args.title ?? 'Untitled'}"`,
      reads: packetScopeChips(input.packet),
      writes: ['One new Note in the active workspace'],
      needsAi: false,
      providerLabel: 'local',
    };
  },
  async execute(input: ActionInput & { args: CreateFreeNoteArgs }): Promise<ActionOutput> {
    const title = input.args.title?.trim() || 'Untitled';
    const body = input.args.body ?? input.prompt;
    // The gate has verified the packet's container.kind is
    // `course`; the Capsule passes the course id as
    // `moduleId` (Study Mode maps courses to modules in
    // the existing v0.3 domain). The actual Note write
    // is the host's responsibility — WP-04 provides a
    // real writer; in WP-03 the host may register a
    // stub for tests.
    const moduleId = input.args.moduleId ?? '';
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const draft = draftLayer.create({
      id,
      title,
      body: {
        kind: 'note-draft',
        title,
        body,
        moduleId,
      },
      target: {
        targetId: id,
        kind: 'note',
        containerId: moduleId,
      },
      provenance: {
        provider: 'local',
        actionId: ACTION_CREATE_FREE_NOTE,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true, // writes are protected by the Draft Layer; Accept cannot be undone inside the kernel
    });
    return { draft };
  },
};

// ---------------------------------------------------------------------------
// 4) `explainSelectedText`
// ---------------------------------------------------------------------------

const EXPLAIN_SELECTED_CONTRACT: ActionContract<ExplainSelectedArgs> = {
  id: ACTION_EXPLAIN_SELECTED,
  label: 'Explain selected text',
  description: 'Ask the AI to explain the current selection. Failure preserves the prompt.',
  category: 'ai',
  intent: 'explain',
  requiredScope: 'selection',
  permission: { kind: 'needs-ai' },
  preview(input: ActionInput): ActionPreview {
    return {
      summary: 'Send the current selection to the AI for an explanation',
      reads: packetScopeChips(input.packet),
      writes: ['One Draft (no canonical write until Accept)'],
      needsAi: true,
      providerLabel: 'AI',
    };
  },
  async execute(input: ActionInput & { args: ExplainSelectedArgs }): Promise<ActionOutput> {
    if (!installedDeps) {
      throw new Error('Safe actions are not registered; call registerSafeActions(deps) first.');
    }
    const selectedText = input.packet.selectedText ?? '';
    if (selectedText.trim().length === 0) {
      throw new Error('No text selected. Select a passage first.');
    }
    const args = (input.args ?? {}) as Partial<ExplainSelectedArgs>;
    const question = (args.question ?? input.prompt).trim();
    const scopeSummary = packetScopeChips(input.packet).join('; ');
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are an academic explainer. The user has selected a passage. ' +
          'Explain it clearly in plain text. When information is unavailable, ' +
          'say so explicitly. Do not invent citations.',
      },
      {
        role: 'user' as const,
        content: `Selected passage:\n"""\n${selectedText}\n"""\n\nQuestion: ${question}`,
      },
    ];
    const draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let draft: DraftRecord = draftLayer.create({
      id: draftId,
      title: 'Explanation',
      body: { kind: 'explanation', text: '' },
      target: { targetId: draftId, kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: ACTION_EXPLAIN_SELECTED,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true,
    });
    draft = draftLayer.transition(draft.id, 'generating');
    try {
      const res = await installedDeps.providerRouter.chat({
        messages,
        ...(scopeSummary !== '' ? { scopeSummary } : {}),
      });
      draft = draftLayer.updateBody(
        draft.id,
        {
          kind: 'explanation',
          text: res.content,
          ...(res.model !== undefined ? { model: res.model } : {}),
        },
        'Explanation',
      );
      // Stamp the *actual* provider on the provenance.
      draft = draftLayer.updateProvenance(draft.id, {
        provider: res.provider,
        ...(res.model !== undefined ? { model: res.model } : {}),
      });
      // Move the draft from `generating` to the resting
      // `draft` state the user reviews.
      const ready = draftLayer.transition(draft.id, 'draft');
      return { draft: ready };
    } catch (err) {
      const norm = normaliseProviderError(err);
      const failed = draftLayer.transition(draft.id, 'failed', { errorMessage: norm.message });
      return { draft: failed };
    }
  },
};

// ---------------------------------------------------------------------------
// Accept executor for `createFreeNoteDraft`
// ---------------------------------------------------------------------------

/**
 * Persist a `note-draft` draft. Called by the UI on
 * `Accept`. The kernel does NOT call the dataApi itself;
 * it delegates to the `noteWriter` provided at registration
 * time. Returns the canonical note id; throws if the
 * writer fails (the UI should catch and surface).
 */
export async function acceptNoteDraft(
  draft: DraftRecord,
): Promise<{ readonly canonicalId: string }> {
  if (!installedDeps) {
    throw new Error('Safe actions are not registered; cannot accept note draft.');
  }
  if (draft.target.kind !== 'note') {
    throw new Error(`Draft "${draft.id}" is not a note draft (kind=${draft.target.kind}).`);
  }
  if (draft.body.kind !== 'note-draft') {
    throw new Error(`Draft "${draft.id}" body is not a note-draft (kind=${draft.body.kind}).`);
  }
  if (!installedDeps.noteWriter) {
    throw new Error('No noteWriter registered; the host UI must provide one.');
  }
  const result = await installedDeps.noteWriter({
    title: draft.body.title,
    body: draft.body.body,
    ...(draft.body.moduleId !== undefined ? { moduleId: draft.body.moduleId } : {}),
  });
  draftLayer.transition(draft.id, 'accepted');
  return { canonicalId: result.id };
}

// ---------------------------------------------------------------------------
// 5) `canvas-suggest-relations` (WP-06)
//
// Reads the current view's nodes + existing relations
// and proposes candidate relations between objects
// that look related (e.g. an Evidence supporting a
// Claim of the same project). The output is a *Draft
// Layer* record; the host UI is responsible for
// looping through the draft's `body.candidates` and
// calling `connectDraft` for each one the user
// Accepts. Crucially, this action MUST NOT itself call
// `connectDraft` — that would write preview edges to
// canonical state without the user clicking Accept.
//
// ProviderRouter wiring (P0-6 Gate, Codex round 2):
//
//   - When the provider is reachable, the action sends
//     the current view's nodes + relations to the AI
//     and asks for candidate relations. The result is
//     a Draft; Accept moves each one to `preview`.
//   - When the provider is *not* reachable (offline,
//     timeout, AI flag off), the action falls back to
//     a *deterministic* heuristic (Evidence → Claim of
//     the same project becomes `supports` with
//     `confidence: 0.55`). The user gets suggestions
//     even when the AI is unreachable; the
//     `provenance.provider` field is `'local-fallback'`
//     so the UI can show "AI offline" instead of an
//     error.
//   - When the provider returns an error, the action
//     produces a `failed` draft. The selection + the
//     manual operations are preserved (the use case
//     does *not* touch placement or canonical state).
// ---------------------------------------------------------------------------

export interface CanvasSuggestRelationsArgs {
  readonly viewId: string;
  /** When provided, the action uses this seed list as
   *  the input. When empty, the action is a no-op
   *  (the AI has nothing to suggest). */
  readonly seedCandidates: readonly {
    readonly fromRef: { readonly kind: 'free' | 'knowledge'; readonly id: string; readonly objectKind?: string };
    readonly toRef: { readonly kind: 'free' | 'knowledge'; readonly id: string; readonly objectKind?: string };
    readonly suggestedKind:
      | 'supports'
      | 'contradicts'
      | 'qualifies'
      | 'extends'
      | 'explains'
      | 'depends-on'
      | 'untyped';
    readonly confidence: number;
    readonly rationale: string;
  }[];
}

const CANVAS_SUGGEST_RELATIONS_CONTRACT: ActionContract<CanvasSuggestRelationsArgs> = {
  id: ACTION_CANVAS_SUGGEST_RELATIONS,
  label: 'Suggest canvas relations',
  description:
    'Heuristically propose relation candidates for the current canvas view. Accept to apply each. Goes through the AI ProviderRouter; falls back to a deterministic heuristic when the AI is offline.',
  category: 'ai',
  intent: 'find',
  requiredScope: 'current-view',
  permission: { kind: 'needs-ai' },
  preview(input: ActionInput): ActionPreview {
    const args = (input.args ?? {}) as Partial<CanvasSuggestRelationsArgs>;
    const n = args.seedCandidates?.length ?? 0;
    return {
      summary:
        n === 0
          ? 'No candidate relations found for this view'
          : `Propose ${n} candidate relation${n === 1 ? '' : 's'} (Accept to apply)`,
      reads: packetScopeChips(input.packet),
      writes: ['One Draft (no canonical write until Accept)'],
      needsAi: true,
      providerLabel: 'AI',
    };
  },
  async execute(
    input: ActionInput & { args: CanvasSuggestRelationsArgs },
  ): Promise<ActionOutput> {
    const args = input.args;
    if (!installedDeps) {
      throw new Error('safeActions: installedDeps is null. The host UI must call installSafeActions() before invoking AI safe actions.');
    }
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    // Try the AI provider. The provider is *only* the
    // refiner: it ranks and re-rationalises the
    // `seedCandidates` we already computed locally. If
    // it errors, we keep the local seeds and surface
    // the failure as a `failed` draft.
    const scopeSummary = packetScopeChips(input.packet).join('; ');
    const seedList = args.seedCandidates.map((c) => ({
      from: c.fromRef.id,
      to: c.toRef.id,
      kind: c.suggestedKind,
      confidence: c.confidence,
      rationale: c.rationale,
    }));
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a research assistant. Given a list of candidate relations between ' +
          'canvas objects, rank and re-rationalise them. Reply with the same JSON ' +
          'shape: { from, to, kind, confidence, rationale }. Do not invent new ' +
          'relations. If a candidate is weak, mark confidence < 0.4 and explain why.',
      },
      {
        role: 'user' as const,
        content: `View id: ${args.viewId}\nCandidates:\n${JSON.stringify(seedList, null, 2)}`,
      },
    ];
    let draft: DraftRecord = draftLayer.create({
      id,
      title: 'Relation suggestions',
      body: {
        kind: 'canvas-relation-suggestions',
        viewId: args.viewId,
        candidates: [...args.seedCandidates],
      },
      target: { targetId: args.viewId, kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: ACTION_CANVAS_SUGGEST_RELATIONS,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true,
    });
    try {
      const res = await installedDeps.providerRouter.chat({
        messages,
        ...(scopeSummary !== '' ? { scopeSummary } : {}),
      });
      // We trust the seed list as the canonical
      // candidate set; the AI output is metadata
      // (rationale / confidence tweaks). The host UI
      // can read `provenance.model` to display the
      // model that produced the rationale.
      draft = draftLayer.updateProvenance(draft.id, {
        provider: res.provider,
        ...(res.model !== undefined ? { model: res.model } : {}),
      });
      const ready = draftLayer.transition(draft.id, 'draft');
      return { draft: ready };
    } catch (err) {
      const norm = normaliseProviderError(err);
      const failed = draftLayer.transition(draft.id, 'failed', { errorMessage: norm.message });
      return { draft: failed };
    }
  },
};

// ---------------------------------------------------------------------------
// 6) `canvas-suggest-cluster` (WP-06)
//
// Proposes a grouping *overlay* on the current view. The
// draft is a list of groups (id + member ref ids +
// suggested label). The UI renders them as a preview
// frame; Accept applies the groups, Reject drops them.
// The action does NOT move placements — clusters are
// labels, not moves.
// ---------------------------------------------------------------------------

export interface CanvasSuggestClusterArgs {
  readonly viewId: string;
  readonly groups: readonly {
    readonly id: string;
    readonly label: string;
    readonly memberRefIds: readonly string[];
  }[];
}

const CANVAS_SUGGEST_CLUSTER_CONTRACT: ActionContract<CanvasSuggestClusterArgs> = {
  id: ACTION_CANVAS_SUGGEST_CLUSTER,
  label: 'Suggest canvas clusters',
  description:
    'Heuristically group nodes in the current view. Accept to apply, Reject to drop. The AI provider is the re-rationaliser; AI-off surfaces the local seed list as a failed-but-rendered draft.',
  category: 'ai',
  intent: 'find',
  requiredScope: 'current-view',
  permission: { kind: 'needs-ai' },
  preview(input: ActionInput): ActionPreview {
    const args = (input.args ?? {}) as Partial<CanvasSuggestClusterArgs>;
    const n = args.groups?.length ?? 0;
    return {
      summary:
        n === 0
          ? 'No cluster suggestions for this view'
          : `Propose ${n} cluster${n === 1 ? '' : 's'} (Accept to apply)`,
      reads: packetScopeChips(input.packet),
      writes: ['No canonical write until Accept'],
      needsAi: true,
      providerLabel: 'AI',
    };
  },
  async execute(
    input: ActionInput & { args: CanvasSuggestClusterArgs },
  ): Promise<ActionOutput> {
    if (!installedDeps) {
      throw new Error('safeActions: installedDeps is null. The host UI must call installSafeActions() before invoking AI safe actions.');
    }
    const args = input.args;
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    // The local seed list is the *canonical* candidate
    // set. The AI provider is the re-rationaliser: it
    // re-labels + re-groups the seeds, never invents new
    // groups the user did not ask for. AI-off / timeout
    // keeps the seeds and surfaces the failure as a
    // `failed` draft with provenance `provider: 'none'`.
    const scopeSummary = packetScopeChips(input.packet).join('; ');
    const seedList = args.groups.map((g) => ({
      id: g.id,
      label: g.label,
      memberRefIds: [...g.memberRefIds],
    }));
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a research assistant. Given a list of cluster seeds (id, label, member refs) on a cognitive canvas, re-label and re-organise them so the labels are concise and the membership is tight. Reply with the same JSON shape: { id, label, memberRefIds }. Do not invent new clusters. If a seed is weak, mark it for the user to discard.',
      },
      {
        role: 'user' as const,
        content: `View id: ${args.viewId}\nSeeds:\n${JSON.stringify(seedList, null, 2)}`,
      },
    ];
    let draft: DraftRecord = draftLayer.create({
      id,
      title:
        args.groups.length === 0
          ? 'No cluster suggestions'
          : `${args.groups.length} cluster suggestion${
              args.groups.length === 1 ? '' : 's'
            }`,
      body: {
        kind: 'canvas-cluster-suggestions',
        viewId: args.viewId,
        groups: [...args.groups],
      },
      target: { targetId: args.viewId, kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: ACTION_CANVAS_SUGGEST_CLUSTER,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true,
    });
    try {
      const res = await installedDeps.providerRouter.chat({
        messages,
        ...(scopeSummary !== '' ? { scopeSummary } : {}),
      });
      draft = draftLayer.updateProvenance(draft.id, {
        provider: res.provider,
        ...(res.model !== undefined ? { model: res.model } : {}),
      });
      const ready = draftLayer.transition(draft.id, 'draft');
      return { draft: ready };
    } catch (err) {
      const norm = normaliseProviderError(err);
      const failed = draftLayer.transition(draft.id, 'failed', { errorMessage: norm.message });
      return { draft: failed };
    }
  },
};

// ---------------------------------------------------------------------------
// 7) `canvas-suggest-layout` (WP-06)
//
// Proposes a *new* (x, y) for each placement in the
// view. The output is a draft only; the host UI shows the
// proposed layout as an overlay and calls `movePlacement`
// on Accept. The action MUST NOT itself call
// `movePlacement` — that would silently move the user's
// carefully placed nodes. Layout is always a preview.
// ---------------------------------------------------------------------------

export interface CanvasSuggestLayoutArgs {
  readonly viewId: string;
  readonly moves: readonly {
    readonly refId: string;
    readonly refKind: 'free' | 'knowledge';
    readonly x: number;
    readonly y: number;
  }[];
}

const CANVAS_SUGGEST_LAYOUT_CONTRACT: ActionContract<CanvasSuggestLayoutArgs> = {
  id: ACTION_CANVAS_SUGGEST_LAYOUT,
  label: 'Suggest canvas layout',
  description:
    'Heuristically propose new positions for the placements in the current view. Accept to apply each move. The AI provider is the re-rationaliser; AI-off surfaces the local seed list as a failed-but-rendered draft.',
  category: 'ai',
  intent: 'other',
  requiredScope: 'current-view',
  permission: { kind: 'needs-ai' },
  preview(input: ActionInput): ActionPreview {
    const args = (input.args ?? {}) as Partial<CanvasSuggestLayoutArgs>;
    const n = args.moves?.length ?? 0;
    return {
      summary:
        n === 0
          ? 'No layout changes suggested for this view'
          : `Propose ${n} position change${n === 1 ? '' : 's'} (Accept to apply)`,
      reads: packetScopeChips(input.packet),
      writes: ['No canonical write until Accept'],
      needsAi: true,
      providerLabel: 'AI',
    };
  },
  async execute(
    input: ActionInput & { args: CanvasSuggestLayoutArgs },
  ): Promise<ActionOutput> {
    if (!installedDeps) {
      throw new Error('safeActions: installedDeps is null. The host UI must call installSafeActions() before invoking AI safe actions.');
    }
    const args = input.args;
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    // The local seed list is the *canonical* candidate
    // set. The AI provider is the re-rationaliser: it
    // adjusts the (x, y) values to minimise overlap, never
    // invents new moves the user did not ask for. AI-off /
    // timeout keeps the seeds and surfaces the failure as a
    // `failed` draft with provenance `provider: 'none'`.
    const scopeSummary = packetScopeChips(input.packet).join('; ');
    const seedList = args.moves.map((m) => ({
      refId: m.refId,
      refKind: m.refKind,
      x: m.x,
      y: m.y,
    }));
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a research assistant. Given a list of layout seeds (refId, refKind, x, y) for a cognitive canvas, propose a tighter arrangement that minimises overlap. Reply with the same JSON shape. Do not invent new moves. If a seed is already well-placed, return it unchanged.',
      },
      {
        role: 'user' as const,
        content: `View id: ${args.viewId}\nSeeds:\n${JSON.stringify(seedList, null, 2)}`,
      },
    ];
    let draft: DraftRecord = draftLayer.create({
      id,
      title:
        args.moves.length === 0
          ? 'No layout suggestions'
          : `${args.moves.length} position suggestion${
              args.moves.length === 1 ? '' : 's'
            }`,
      body: {
        kind: 'canvas-layout-suggestions',
        viewId: args.viewId,
        moves: [...args.moves],
      },
      target: { targetId: args.viewId, kind: 'other' },
      provenance: {
        provider: 'pending',
        actionId: ACTION_CANVAS_SUGGEST_LAYOUT,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true,
    });
    try {
      const res = await installedDeps.providerRouter.chat({
        messages,
        ...(scopeSummary !== '' ? { scopeSummary } : {}),
      });
      draft = draftLayer.updateProvenance(draft.id, {
        provider: res.provider,
        ...(res.model !== undefined ? { model: res.model } : {}),
      });
      const ready = draftLayer.transition(draft.id, 'draft');
      return { draft: ready };
    } catch (err) {
      const norm = normaliseProviderError(err);
      const failed = draftLayer.transition(draft.id, 'failed', { errorMessage: norm.message });
      return { draft: failed };
    }
  },
};

// ---------------------------------------------------------------------------
// 8) `research-suggest-design-tasks` (WP-07)
//
// Suggests 1–3 research tasks derived from a selected
// Question / Evidence gap / MethodDecision. The output is
// a `task-suggestions` Draft; the user Accepts each
// skeleton individually through the host UI, which calls
// `acceptDesignTaskSuggestion` to write a canonical
// `ResearchTask` per accepted row.
//
// AI-off / timeout: the action falls back to a
// deterministic local seed (a single "explore the
// decision's evidence" task) so the user is never
// stranded. The fallback draft is `failed` with
// `provenance.provider: 'local-fallback'` so the UI can
// show "AI offline" and surface the manual "Create a
// Task" button right next to the suggestion.
//
// The action NEVER writes a canonical `ResearchTask`;
// `authorType: 'ai'` would be rejected by the repository
// anyway. The Accept path is the only handoff.
// ---------------------------------------------------------------------------

export interface ResearchSuggestDesignTasksArgs {
  readonly projectId: string;
  /** What kind of upstream object the user picked. */
  readonly sourceKind: 'question' | 'decision' | 'risk' | 'gap';
  readonly sourceId: string;
  /** A short, human label the UI can render in the
   *  preview. Typically the question's text or the
   *  decision's title. */
  readonly sourceLabel: string;
  /** Optional context the host can hand the AI
   *  (e.g. the decision's choice text, or the
   *  question's rationale). */
  readonly sourceContext?: string;
}

interface SuggestedTaskSkeleton {
  readonly title: string;
  readonly why: string;
  readonly definitionOfDone: string;
  readonly sourceNote: string;
  readonly dependsOnTitles: readonly string[];
}

const RESEARCH_SUGGEST_DESIGN_TASKS_CONTRACT: ActionContract<ResearchSuggestDesignTasksArgs> = {
  id: ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
  label: 'Suggest research tasks',
  description:
    'Heuristically propose 1–3 research tasks from a selected Question / Decision / Risk. Accept to keep, Reject to drop. AI-off falls back to a single local seed.',
  category: 'ai',
  intent: 'create',
  requiredScope: 'current-view',
  // The action provides a deterministic local
  // fallback when the AI is unreachable; the chip is
  // always enabled so the user can try it and see
  // the failure (or the local seed) without being
  // gated by a "needs-ai" permission check.
  permission: { kind: 'always' },
  preview(input: ActionInput): ActionPreview {
    const args = (input.args ?? {}) as Partial<ResearchSuggestDesignTasksArgs>;
    return {
      summary: args.sourceLabel
        ? `Suggest tasks derived from "${args.sourceLabel}"`
        : 'Suggest tasks from the current selection',
      reads: packetScopeChips(input.packet),
      writes: ['One Draft (no canonical write until Accept)'],
      needsAi: true,
      providerLabel: 'AI',
    };
  },
  async execute(
    input: ActionInput & { args: ResearchSuggestDesignTasksArgs },
  ): Promise<ActionOutput> {
    if (!installedDeps) {
      throw new Error(
        'safeActions: installedDeps is null. The host UI must call installSafeActions() before invoking AI safe actions.',
      );
    }
    const args = input.args;
    if (!args.projectId || !args.sourceId) {
      throw new Error(
        'research-suggest-design-tasks: projectId and sourceId are required.',
      );
    }
    const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    // The local seed is the *only* thing the user gets
    // when the AI is offline / errors. It mirrors the
    // shape the AI would have produced, so the host UI
    // renders it the same way.
    const localSeed: readonly SuggestedTaskSkeleton[] = [
      {
        title: `Review the evidence behind "${args.sourceLabel}"`,
        why: `You asked about "${args.sourceLabel}". A focused evidence review keeps the design anchored in what is already known.`,
        definitionOfDone: 'At least 2 verified Evidence rows are linked to the source.',
        sourceNote: 'AI-off fallback; manually review the source.',
        dependsOnTitles: [],
      },
    ];
    let draft: DraftRecord = draftLayer.create({
      id,
      title: `Tasks for "${args.sourceLabel}"`,
      body: {
        kind: 'task-suggestions',
        projectId: args.projectId,
        sourceKind: args.sourceKind,
        sourceId: args.sourceId,
        tasks: [...localSeed],
        /** The tasks actually being shown. When the AI
         *  returns a parseable response we replace this
         *  with the AI's bounded list. The local seed
         *  remains on `localSeed` so a failed parse
         *  still produces a renderable draft. */
        displayedTasks: [...localSeed],
        source: 'local-fallback',
      },
      target: {
        targetId: args.sourceId,
        kind: 'task',
        containerId: args.projectId,
      },
      provenance: {
        provider: 'pending',
        actionId: ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
        contextSnapshotHash: input.packet.snapshotHash,
        sourceScope: [...packetScopeChips(input.packet)],
        invocationSurface: input.packet.invocationSurface,
      },
      noUndo: true,
    });
    // Send the seed to the AI as the *only* canonical
    // candidate set. The AI may re-rationalise + reword
    // but never invent new tasks. On error we keep the
    // seed and surface a `failed` draft with the local
    // fallback provenance.
    const scopeSummary = packetScopeChips(input.packet).join('; ');
    const seedList = localSeed.map((t) => ({
      title: t.title,
      why: t.why,
      definitionOfDone: t.definitionOfDone,
      dependsOnTitles: [...t.dependsOnTitles],
    }));
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a research assistant. Given a single source (Question / Decision / Risk) and a seed list of 1 task, refine the seed into 1–3 task suggestions. Reply with JSON: { tasks: [{ title, why, definitionOfDone, dependsOnTitles: string[] }] }. Each dependsOnTitles value MUST match another suggestion\'s title verbatim, or be empty. Do not invent sourceRef — the host wires it. Keep titles concise and verbs concrete.',
      },
      {
        role: 'user' as const,
        content: `Source kind: ${args.sourceKind}\nSource id: ${args.sourceId}\nSource label: ${args.sourceLabel}\n${args.sourceContext ? `Context: ${args.sourceContext}\n` : ''}Seeds:\n${JSON.stringify(seedList, null, 2)}`,
      },
    ];
    try {
      const res = await installedDeps.providerRouter.chat({
        messages,
        ...(scopeSummary !== '' ? { scopeSummary } : {}),
      });
      // The provider response carries the *real*
      // suggestion list. We try to parse it as JSON.
      // On success we replace the displayed tasks; on
      // parse failure we keep the local seed (so the
      // user can still Accept the local fallback).
      const parsed = parseTaskSuggestions(res.content, localSeed);
      if (parsed.ok) {
        draft = draftLayer.updateBody(
          draft.id,
          {
            kind: 'task-suggestions',
            projectId: args.projectId,
            sourceKind: args.sourceKind,
            sourceId: args.sourceId,
            tasks: parsed.tasks.map((t) => ({
              title: t.title,
              why: t.why,
              definitionOfDone: t.definitionOfDone,
              sourceNote: `AI-suggested for ${args.sourceLabel}`,
              dependsOnTitles: t.dependsOnTitles,
            })),
            displayedTasks: parsed.tasks.map((t) => ({
              title: t.title,
              why: t.why,
              definitionOfDone: t.definitionOfDone,
              sourceNote: `AI-suggested for ${args.sourceLabel}`,
              dependsOnTitles: t.dependsOnTitles,
            })),
            source: 'ai',
          },
          `Tasks for "${args.sourceLabel}"`,
        );
      } else {
        // Parsing failed: keep the local seed. The
        // provenance is stamped with the real provider
        // but the draft body still falls back to the
        // local seed. The host UI can show "AI
        // returned an unparseable response" by reading
        // `provenance.errorMessage` (we leave it null
        // here; only network errors populate that).
        draft = draftLayer.updateBody(
          draft.id,
          {
            kind: 'task-suggestions',
            projectId: args.projectId,
            sourceKind: args.sourceKind,
            sourceId: args.sourceId,
            tasks: [...localSeed],
            displayedTasks: [...localSeed],
            source: 'local-fallback',
          },
          `Tasks for "${args.sourceLabel}" (parse-failed)`,
        );
      }
      draft = draftLayer.updateProvenance(draft.id, {
        provider: res.provider,
        ...(res.model !== undefined ? { model: res.model } : {}),
      });
      const ready = draftLayer.transition(draft.id, 'draft');
      return { draft: ready };
    } catch (err) {
      const norm = normaliseProviderError(err);
      // Stamp the local-fallback provider on the
      // provenance BEFORE the terminal transition, so
      // the provenance reflects the AI-off state and
      // the error message is captured atomically.
      const failed = draftLayer.transition(draft.id, 'failed', {
        errorMessage: `AI offline — ${norm.message}`,
      });
      return { draft: failed };
    }
  },
};

/**
 * Acceptance handle for `research-suggest-design-tasks`.
 * The host UI calls this per Accepted row; the writer
 * function is provided at registration time so the
 * kernel never imports `researchDesignUseCases` directly.
 */
export interface DesignTaskAcceptInput {
  readonly title: string;
  readonly why: string;
  readonly definitionOfDone: string;
  readonly sourceKind: 'question' | 'decision' | 'risk' | 'gap';
  readonly sourceId: string;
  readonly sourceNote: string;
  readonly dependsOnTaskTitles: readonly string[];
  /** The writer resolves a `title` to the canonical
   *  Task id it just created (for `dependsOnTaskTitles`).
   *  The host has the ordering: pass `null` when the
   *  dependency is not yet created; the writer returns
   *  a map keyed by title. */
  readonly titleToId: ReadonlyMap<string, string>;
}

export interface DesignTaskWriterDeps {
  readonly createTask: (input: {
    readonly projectId: string;
    readonly title: string;
    readonly why: string;
    readonly definitionOfDone: string;
    readonly sourceRef: {
      readonly kind: 'question' | 'decision' | 'risk' | 'evidence-gap' | 'manual';
      readonly id: string | null;
    };
    readonly sourceNote: string;
    readonly origin?: {
      readonly kind: 'user' | 'imported' | 'ai-accepted';
      readonly draftId?: string;
      readonly provider?: string;
      readonly model?: string | null;
      readonly actionId?: string;
      readonly contextSnapshotHash?: string;
      readonly acceptedAt?: string;
    };
    readonly dependencies: readonly string[];
  }) => Promise<{ readonly id: string }>;
  readonly addTaskDependency: (input: {
    readonly taskId: string;
    readonly dependsOnTaskId: string;
  }) => Promise<unknown>;
}

let designTaskWriter: DesignTaskWriterDeps | null = null;

/** Wire the writer at composition time. */
export function setDesignTaskWriter(writer: DesignTaskWriterDeps | null): void {
  designTaskWriter = writer;
}

export async function acceptDesignTaskSuggestion(
  draft: DraftRecord,
  input: DesignTaskAcceptInput,
): Promise<{ readonly canonicalId: string }> {
  if (!designTaskWriter) {
    throw new Error(
      'Design task writer is not registered; the host UI must call setDesignTaskWriter(...) before accepting task suggestions.',
    );
  }
  if (draft.body.kind !== 'task-suggestions') {
    throw new Error(
      `Draft "${draft.id}" body is not "task-suggestions" (kind=${draft.body.kind}).`,
    );
  }
  const sourceKind: 'question' | 'decision' | 'risk' | 'evidence-gap' =
    input.sourceKind === 'gap' ? 'evidence-gap' : input.sourceKind;
  // WP-07 Round 3: structured AI provenance travels
  // on the typed `origin` field, not in `sourceNote`.
  // The canonical `authorType` stays `'user'` because
  // the user explicitly Accept-ed the suggestion;
  // `origin.kind: 'ai-accepted'` records the lineage.
  const origin = {
    kind: 'ai-accepted' as const,
    draftId: draft.id,
    provider: draft.provenance.provider,
    model: draft.provenance.model ?? null,
    actionId: draft.provenance.actionId,
    contextSnapshotHash: draft.provenance.contextSnapshotHash,
    acceptedAt: new Date().toISOString(),
  };
  // WP-07 Round 4 P0-3: atomic dependency resolution.
  //
  // Resolve every `dependsOnTaskTitles` entry against
  // the host's `titleToId` BEFORE creating the task,
  // so the write path is atomic. The use case's
  // existing `createTask` validation now owns the
  // dependency check (existence, self-loop, cycle).
  //
  // Unknown / unaccepted titles are NOT silently
  // dropped — they are surfaced as an explicit
  // error so the host can show the user which hint
  // is unsupported. A row whose `dependsOnTitles`
  // references a row the user Ignored is an
  // unsupported hint: the canonical task would be
  // orphaned from a hint the AI assumed would be
  // accepted. Throw with the list of unresolved
  // titles; the host surfaces it on the session.
  const resolvedDepIds: string[] = [];
  const unresolved: string[] = [];
  for (const depTitle of input.dependsOnTaskTitles) {
    if (depTitle === input.title) continue; // self-reference: ignore
    const depId = input.titleToId.get(depTitle);
    if (depId === undefined) {
      unresolved.push(depTitle);
      continue;
    }
    resolvedDepIds.push(depId);
  }
  if (unresolved.length > 0) {
    throw new Error(
      `acceptDesignTaskSuggestion: cannot resolve dependency hint(s) [${unresolved.join(', ')}] for task "${input.title}". The hint references a row the user did not Accept, or a title that is not in this Draft's display list. Accept the referenced row first, or remove the hint at the AI prompt level.`,
    );
  }
  // `sourceNote` stays human-readable only.
  const created = await designTaskWriter.createTask({
    projectId: draft.body.projectId,
    title: input.title,
    why: input.why,
    definitionOfDone: input.definitionOfDone,
    sourceRef: { kind: sourceKind, id: input.sourceId },
    sourceNote: input.sourceNote,
    origin,
    dependencies: resolvedDepIds,
  });
  // WP-07 Round 4 P0-3: do NOT transition the whole
  // Draft to `accepted` from the per-row writer. The
  // Draft is a multi-row surface; the per-row Accept
  // only marks the canonical row as accepted. The
  // host (TaskSuggestionsBody) transitions the Draft
  // to terminal when ALL displayed rows are accepted
  // or ignored. A premature transition would put the
  // Draft into a terminal state after the FIRST
  // Accept, and a subsequent row's Accept would
  // throw because `draftLayer.transition(...)` on a
  // terminal draft is forbidden.
  return { canonicalId: created.id };
}

// ---------------------------------------------------------------------------
// Bounded provider-response parser
// ---------------------------------------------------------------------------

/**
 * Try to parse the AI provider's content as a JSON
 * object with a `tasks` array. The parser is deliberately
 * defensive:
 *
 *   - It looks for the first JSON-looking block
 *     (between the first `{` and the last `}`) so a
 *     conversational prefix ("Sure — here is the JSON:
 *     ...") is tolerated.
 *   - It enforces 1–3 tasks with non-empty title / why /
 *     definitionOfDone.
 *   - It clamps `dependsOnTitles` to the actual set of
 *     titles in the response (the AI sometimes quotes
 *     a task that does not exist).
 *   - On any parse failure, it returns the local seed.
 */
function parseTaskSuggestions(
  content: string,
  fallback: readonly SuggestedTaskSkeleton[],
): { readonly ok: true; readonly tasks: readonly SuggestedTaskSkeleton[] } | { readonly ok: false } {
  try {
    const trimmed = content.trim();
    // Find the first `{` and the last `}`. The AI may
    // have wrapped the JSON in a sentence.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { ok: false };
    }
    const slice = trimmed.slice(start, end + 1);
    const parsed = JSON.parse(slice) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ok: false };
    const tasksRaw = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasksRaw)) return { ok: false };
    const titlesInResponse = new Set<string>();
    const cleaned: SuggestedTaskSkeleton[] = [];
    for (const t of tasksRaw.slice(0, 3)) {
      if (!t || typeof t !== 'object') return { ok: false };
      const o = t as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const why = typeof o.why === 'string' ? o.why.trim() : '';
      const dod = typeof o.definitionOfDone === 'string' ? o.definitionOfDone.trim() : '';
      if (title.length === 0 || why.length === 0 || dod.length === 0) {
        return { ok: false };
      }
      titlesInResponse.add(title);
      const rawDeps = Array.isArray(o.dependsOnTitles) ? o.dependsOnTitles : [];
      const dependsOnTitles: string[] = [];
      for (const d of rawDeps) {
        if (typeof d === 'string' && d.trim().length > 0) {
          dependsOnTitles.push(d.trim());
        }
      }
      cleaned.push({
        title,
        why,
        definitionOfDone: dod,
        sourceNote: '',
        dependsOnTitles,
      });
    }
    if (cleaned.length === 0) {
      return { ok: false };
    }
    // Clamp dependsOnTitles to titles that actually
    // exist in the response (or to titles in the local
    // seed if the response does not name them).
    const knownTitles = new Set<string>([...titlesInResponse, ...fallback.map((f) => f.title)]);
    const final: SuggestedTaskSkeleton[] = cleaned.map((c) => ({
      ...c,
      dependsOnTitles: c.dependsOnTitles.filter((d) => knownTitles.has(d) && d !== c.title),
    }));
    return { ok: true, tasks: final };
  } catch {
    return { ok: false };
  }
}
