/**
 * StudyKit v0.4 — `features/canvas/canvasActionArgs`
 *
 * The typed action-args seam for the cognitive canvas's
 * three AI safe actions. The cognitive canvas owns
 * these args; the `IntentCapsule` consumes them
 * through the `assistantSession.actionArgsById` map
 * (WP-06 Round 6 P0-4).
 *
 * Why a builder instead of inline construction in
 * `CognitiveCanvasAdapter`?
 *
 *   - The three actions need the same snapshot read
 *     (`viewId`, placements, relations) but they
 *     produce *different* shapes. Centralising the
 *     construction here keeps the adapter focused on
 *     UI, and keeps the typed-args contract in one
 *     file.
 *   - The builder returns a discriminated
 *     `{ args, preview, requiresAi }` so a future
 *     shell can preview the action before the user
 *     accepts.
 *   - The builder is pure (input → output, no I/O).
 *     Tests can call it directly with a fake
 *     `CanvasViewSnapshot` and assert the args
 *     shape; the existing
 *     `cognitiveCanvas.test.tsx` unit test
 *     covers this.
 *
 * The intent of the three actions (from
 * `features/ai/kernel/actions/safeActions.ts`):
 *
 *   - `canvas-suggest-relations` — rank candidate
 *     relations between the canvas's current
 *     placements.
 *   - `canvas-suggest-cluster` — re-label existing
 *     group seeds (the AI re-organises, never
 *     invents).
 *   - `canvas-suggest-layout` — propose tighter
 *     (x, y) for the current placements.
 *
 * The AI re-rationalises the seed list. The seed
 * list is computed locally from the snapshot; if the
 * AI is offline / times out, the seed list is
 * surfaced as a `failed` draft with provenance
 * `provider: 'none'` so the user can retry.
 */

import {
  refKey,
  type CanvasViewSnapshot,
  type CanvasObjectRef,
  type CanvasRelation,
  type ObjectPlacement,
} from '../../domain/canvas';
import type {
  CanvasSuggestRelationsArgs,
  CanvasSuggestClusterArgs,
  CanvasSuggestLayoutArgs,
} from '../ai/kernel/actions/safeActions';

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface CanvasActionArgsInput {
  readonly surface: 'intent-capsule';
  readonly viewId: string;
  /** The current canvas view snapshot. The builder
   *  walks `snapshot.placements` and `snapshot.relations`
   *  to build the seed list. */
  readonly snapshot: CanvasViewSnapshot;
  /**
   * The refs the user selected on the canvas. The
   * builder prefers these over the snapshot's
   * `placements`; when the selection is empty, every
   * placement participates.
   */
  readonly selectedRefIds?: readonly string[];
}

export interface CanvasActionArgsOutput {
  readonly args: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly preview: Readonly<Record<string, string>>;
  readonly requiresAi: boolean;
}

/**
 * Build the per-action typed args for the cognitive
 * canvas's three AI safe actions. The returned map is
 * the input to `openCapsule({ precomputedActionArgs })`
 * — the `IntentCapsule.buildArgsForAction` reads from
 * it first.
 *
 * The function is pure: it does not touch the
 * `useCases` or the `CanvasRepository`. A test can
 * build a snapshot in-memory, call this builder, and
 * assert the args shape.
 */
export function buildCanvasActionArgs(
  input: CanvasActionArgsInput,
): CanvasActionArgsOutput {
  const { viewId, snapshot, selectedRefIds } = input;
  const selected = resolveSelected(snapshot, selectedRefIds);
  // Relations
  const relationsArgs: CanvasSuggestRelationsArgs = {
    viewId,
    seedCandidates: buildRelationCandidates(snapshot, selected),
  };
  // Cluster seeds: every relation pair becomes a
  // candidate cluster. The AI re-labels; we never
  // invent groups. (The cognitive canvas has no
  // `groups` concept yet — WP-06 ships the seed
  // shape so the AI can do useful work; WP-07 may
  // extend `CanvasViewSnapshot` with a `groups`
  // field.)
  const clusterArgs: CanvasSuggestClusterArgs = {
    viewId,
    groups: buildClusterSeeds(snapshot),
  };
  // Layout seeds: every placement becomes a
  // candidate move. The current (x, y) is the seed;
  // the AI tightens the layout.
  const layoutArgs: CanvasSuggestLayoutArgs = {
    viewId,
    moves: buildLayoutMoves(snapshot, selected),
  };
  return {
    args: Object.freeze({
      'canvas-suggest-relations': relationsArgs as unknown as Readonly<Record<string, unknown>>,
      'canvas-suggest-cluster': clusterArgs as unknown as Readonly<Record<string, unknown>>,
      'canvas-suggest-layout': layoutArgs as unknown as Readonly<Record<string, unknown>>,
    }),
    preview: Object.freeze({
      'canvas-suggest-relations': relationsArgs.seedCandidates.length === 0
        ? 'No candidate relations in the current selection'
        : `Propose ${relationsArgs.seedCandidates.length} candidate relation${
            relationsArgs.seedCandidates.length === 1 ? '' : 's'
          }`,
      'canvas-suggest-cluster': clusterArgs.groups.length === 0
        ? 'No cluster suggestions for the current view'
        : `Propose ${clusterArgs.groups.length} cluster${clusterArgs.groups.length === 1 ? '' : 's'}`,
      'canvas-suggest-layout': layoutArgs.moves.length === 0
        ? 'No layout changes suggested for the current selection'
        : `Propose ${layoutArgs.moves.length} position change${layoutArgs.moves.length === 1 ? '' : 's'}`,
    }),
    requiresAi: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveSelected(
  snapshot: CanvasViewSnapshot,
  selectedRefIds: readonly string[] | undefined,
): ReadonlySet<string> {
  if (selectedRefIds && selectedRefIds.length > 0) {
    return new Set(selectedRefIds);
  }
  return new Set(snapshot.placements.map((p) => refKey(p.ref)));
}

/**
 * Build a `seedCandidates` list for
 * `canvas-suggest-relations`. WP-06 Round 6 P0-2
 * fix: the previous version only walked the
 * *existing* relations (so an empty canvas produced
 * an empty seed list and the AI never had anything
 * to do). The cognitive canvas's "Suggest
 * relations" action should propose *new* candidate
 * relations from the *current placements*; the AI
 * re-ranks / re-rationalises them. The kinds are
 * picked by a deterministic rule (Evidence → Claim
 * becomes `supports`; Question ↔ Evidence /
 * Claim becomes `qualifies`; free ↔ knowledge
 * becomes `untyped`); the AI may change the
 * kind and rationale but the seed set is
 * reproducible.
 *
 * Deduplication: a relation is skipped when the
 * snapshot already has an `accepted` or `preview`
 * relation between the same `(from, to, kind)` —
 * we never propose duplicating an in-flight
 * relation. Self-pairs are skipped. The candidate
 * list is capped at `MAX_CANDIDATES` to avoid
 * combinatorial explosion (a 10-placement canvas
 * with mixed kinds is otherwise 100+ candidates).
 */
const MAX_CANDIDATES = 24;

function buildRelationCandidates(
  snapshot: CanvasViewSnapshot,
  selected: ReadonlySet<string>,
): CanvasSuggestRelationsArgs['seedCandidates'] {
  // We build with a mutable array; the
  // `CanvasSuggestRelationsArgs['seedCandidates']`
  // type is `readonly` but the action's
  // `execute(...)` reads via `.map(...)` /
  // spread, so a fresh mutable array is fine.
  const out: Array<{
    fromRef: { kind: 'free' | 'knowledge'; id: string; objectKind?: string };
    toRef: { kind: 'free' | 'knowledge'; id: string; objectKind?: string };
    suggestedKind: CanvasSuggestRelationsArgs['seedCandidates'][number]['suggestedKind'];
    confidence: number;
    rationale: string;
  }> = [];
  // The set of *existing* (fromKey, toKey, kind)
  // tuples — accepted + preview relations. We use
  // this to skip candidates the user is already
  // reviewing.
  const existing = new Set<string>();
  for (const r of snapshot.relations) {
    if (r.status === 'rejected') continue;
    existing.add(`${refKey(r.from)}::${refKey(r.to)}::${r.kind}`);
  }
  // Walk the placements in the current selection;
  // emit at most one candidate per (from, to) pair
  // (the strongest kind), skip pairs that already
  // have a matching relation, and cap the list.
  const seenPairs = new Set<string>();
  for (let i = 0; i < snapshot.placements.length; i++) {
    const a = snapshot.placements[i];
    const aKey = refKey(a.ref);
    if (!selected.has(aKey)) continue;
    for (let j = 0; j < snapshot.placements.length; j++) {
      if (i === j) continue;
      const b = snapshot.placements[j];
      const bKey = refKey(b.ref);
      if (!selected.has(bKey)) continue;
      const pairKey = `${aKey}::${bKey}`;
      if (seenPairs.has(pairKey)) continue;
      const kind = pickKind(a.ref, b.ref);
      const dedupeKey = `${aKey}::${bKey}::${kind}`;
      if (existing.has(dedupeKey)) continue;
      seenPairs.add(pairKey);
      out.push({
        fromRef: refToSeedRef(a.ref),
        toRef: refToSeedRef(b.ref),
        suggestedKind: kind,
        confidence: 0.55,
        rationale: rationaleFor(a.ref, b.ref, kind),
      });
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}

/**
 * Deterministic kind picker. The cognitive canvas
 * never invents kinds the action contract does not
 * support; the AI may re-rank + re-rationalise.
 */
function pickKind(
  from: CanvasObjectRef,
  to: CanvasObjectRef,
): CanvasSuggestRelationsArgs['seedCandidates'][number]['suggestedKind'] {
  const f = kindKey(from);
  const t = kindKey(to);
  // WP-06 Round 6 P0-2 fix: the cognitive meaning of
  // `supports` is *directional* — an Evidence
  // supports a Claim (the evidence backs the
  // claim), not the other way around. The
  // `claim → evidence` direction is meaningless
  // (a claim does not "support" its evidence),
  // so we fall through to `untyped`; the user can
  // rename the kind before Accept.
  if (f === 'evidence' && t === 'claim') {
    return 'supports';
  }
  // Question ↔ Evidence / Claim becomes `qualifies`
  // (a question sharpens an evidence / claim).
  if (f === 'question' || t === 'question') {
    return 'qualifies';
  }
  // Free nodes (no canonical backing) connect to
  // anything via `untyped`. The user can rename
  // the kind before Accept.
  if (f === 'free' || t === 'free') {
    return 'untyped';
  }
  return 'untyped';
}

function kindKey(ref: CanvasObjectRef): string {
  if (ref.kind === 'free') return 'free';
  return ref.objectKind;
}

function rationaleFor(
  from: CanvasObjectRef,
  to: CanvasObjectRef,
  kind: CanvasSuggestRelationsArgs['seedCandidates'][number]['suggestedKind'],
): string {
  const f = kindKey(from);
  const t = kindKey(to);
  return `${f} ${kind} ${t} (local seed; AI re-ranks)`;
}

function refToSeedRef(ref: CanvasObjectRef): {
  kind: 'free' | 'knowledge';
  id: string;
  objectKind?: string;
} {
  if (ref.kind === 'knowledge') {
    return { kind: 'knowledge', id: ref.id, objectKind: ref.objectKind };
  }
  return { kind: 'free', id: ref.id };
}

/**
 * Build the cluster seeds for `canvas-suggest-cluster`.
 * The cognitive canvas has no first-class `groups`
 * field yet; the simplest deterministic seed is one
 * cluster per relation pair, labelled by the
 * `from + to` ref ids. The AI re-labels.
 */
function buildClusterSeeds(
  snapshot: CanvasViewSnapshot,
): CanvasSuggestClusterArgs['groups'] {
  const out: Array<{ id: string; label: string; memberRefIds: string[] }> = [];
  for (const r of snapshot.relations) {
    if (r.status === 'rejected') continue;
    out.push({
      id: `cluster-seed-${r.id}`,
      label: `${r.from.id} → ${r.to.id}`,
      memberRefIds: [refKey(r.from), refKey(r.to)],
    });
  }
  if (out.length === 0 && snapshot.placements.length > 0) {
    // Fallback: one seed per placement so the AI has
    // *something* to re-organise. The user can
    // Accept / Reject as usual.
    for (const p of snapshot.placements) {
      out.push({
        id: `cluster-seed-${p.id}`,
        label: p.ref.id,
        memberRefIds: [refKey(p.ref)],
      });
    }
  }
  return out;
}

/**
 * Build the layout moves for `canvas-suggest-layout`.
 * The current (x, y) is the seed; the AI tightens.
 */
function buildLayoutMoves(
  snapshot: CanvasViewSnapshot,
  selected: ReadonlySet<string>,
): CanvasSuggestLayoutArgs['moves'] {
  const out: Array<{ refId: string; refKind: 'free' | 'knowledge'; x: number; y: number }> = [];
  for (const p of snapshot.placements) {
    if (!selected.has(refKey(p.ref))) continue;
    out.push({
      refId: p.ref.id,
      refKind: p.ref.kind,
      x: p.x,
      y: p.y,
    });
  }
  return out;
}

// Re-export the snapshot type so the action consumer
// doesn't have to import from `domain/canvas` separately
// (and so the test file's import surface is short).
export type { CanvasViewSnapshot, CanvasObjectRef, CanvasRelation, ObjectPlacement };
