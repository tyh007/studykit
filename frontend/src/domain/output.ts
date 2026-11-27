/**
 * StudyKit v0.4 — `domain/output`
 *
 * Canonical domain contracts for the **Evidence-backed
 * Output** slice (WP-10 Round 1). Mirrors the shape of
 * `domain/research` so the Output slice feels like a
 * sibling of the Research Evidence slice:
 *
 *   - `OutputDocument`  — the user's research output.
 *     `outline | draft | final`. AI is never the author
 *     of a `final` output.
 *   - `OutputSection`   — a labelled section inside the
 *     document. Stable order is `order → createdAt → id`.
 *   - `OutputStatement` — a body of text in a section.
 *     `draft | accepted`. Canonical store NEVER persists
 *     an empty body. AI text lives in the Draft Layer
 *     until the user Accepts.
 *   - `StatementSupport`— a typed link from a Statement
 *     to exactly one canonical Claim or Evidence record.
 *     The link does NOT duplicate the Claim / Evidence
 *     body. Deleting the canonical object leaves the
 *     link as a `broken` lineage so the audit can show
 *     it instead of silently deleting it.
 *   - `StatementAudit`  — derived, NOT persisted.
 *     Returns the strongest of `supported |
 *     conflicted | unsupported | broken` plus a list of
 *     reasons and refs. The UI never relies on a single
 *     boolean.
 *
 * Design rules (enforced by type guards):
 *
 *   1. **AI never authors a `final` document.** The
 *      `isOutputDocument` guard throws on
 *      `status === 'final'` when `authorType === 'ai'`.
 *   2. **No empty bodies.** The repository rejects an
 *      `OutputStatement` whose trimmed body is empty
 *      before it reaches the canonical store.
 *   3. **One support, one canonical object.** A
 *      `StatementSupport` carries a `StatementRef`
 *      discriminated union — exactly one of
 *      `{ kind: 'claim'; id }` or
 *      `{ kind: 'evidence'; id }`. The duplicate tuple
 *      `(statementId, ref.kind, ref.id, relation)` is
 *      rejected by the use case (the audit and the
 *      repository agree on this key).
 *   4. **Project-scoped.** Every Output / Section /
 *      Statement / Support carries `projectId`. The
 *      repository's read paths enforce it. The audit
 *      treats a cross-project ref as `broken`, not
 *      `supported`.
 *   5. **No cascading deletes.** Deleting a Claim or
 *      Evidence record does NOT delete its Support.
 *      The Support survives; the audit recomputes its
 *      state to `broken` so the user can see *what*
 *      was lost.
 *   6. **No timestamps in the future.** `createdAt`
 *      and `updatedAt` are RFC 3339 timestamps.
 *   7. **`order` is finite and non-negative.** The
 *      stable-sort tiebreak handles collisions so the
 *      repository never needs to enforce uniqueness on
 *      `order` itself.
 */

// ---------------------------------------------------------------------------
// OutputDocument
// ---------------------------------------------------------------------------

import { isStatementOrigin, type StatementOrigin } from './provenance';

export type OutputStatus = 'outline' | 'draft' | 'final';

export const OUTPUT_STATUSES: readonly OutputStatus[] = [
  'outline',
  'draft',
  'final',
] as const;

export function isOutputStatus(value: unknown): value is OutputStatus {
  return value === 'outline' || value === 'draft' || value === 'final';
}

export type OutputAuthorType = 'user' | 'ai' | 'imported';

export const OUTPUT_AUTHOR_TYPES: readonly OutputAuthorType[] = [
  'user',
  'ai',
  'imported',
] as const;

export function isOutputAuthorType(value: unknown): value is OutputAuthorType {
  return value === 'user' || value === 'ai' || value === 'imported';
}

export interface OutputDocument {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: OutputStatus;
  readonly authorType: OutputAuthorType;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isOutputDocument(value: unknown): value is OutputDocument {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.title !== 'string' || v.title.trim().length === 0) return false;
  if (!isOutputStatus(v.status)) return false;
  if (!isOutputAuthorType(v.authorType)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (Number.isNaN(Date.parse(v.createdAt))) return false;
  if (Number.isNaN(Date.parse(v.updatedAt))) return false;
  // AI may not author a `final` document. The repository
  // runs this guard on every `putOutput`; a buggy use
  // case cannot sneak an AI `final` row into the
  // canonical store.
  if (v.authorType === 'ai' && v.status === 'final') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// OutputSection
// ---------------------------------------------------------------------------

export interface OutputSection {
  readonly id: string;
  readonly projectId: string;
  readonly outputId: string;
  readonly title: string;
  /** Non-negative finite number. Equal `order` values
   *  tiebreak on `createdAt` then `id` so the UI never
   *  depends on the adapter to enforce uniqueness. */
  readonly order: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isOutputSection(value: unknown): value is OutputSection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.outputId !== 'string' || v.outputId.length === 0) return false;
  if (typeof v.title !== 'string' || v.title.trim().length === 0) return false;
  if (!isFiniteOrder(v.order)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (Number.isNaN(Date.parse(v.createdAt))) return false;
  if (Number.isNaN(Date.parse(v.updatedAt))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// OutputStatement
// ---------------------------------------------------------------------------

export type StatementStatus = 'draft' | 'accepted';

export const STATEMENT_STATUSES: readonly StatementStatus[] = [
  'draft',
  'accepted',
] as const;

export function isStatementStatus(value: unknown): value is StatementStatus {
  return value === 'draft' || value === 'accepted';
}

export interface OutputStatement {
  readonly id: string;
  readonly projectId: string;
  readonly outputId: string;
  readonly sectionId: string;
  readonly body: string;
  /** Non-negative finite number. Stable order:
   *  `order → createdAt → id`. */
  readonly order: number;
  readonly authorType: OutputAuthorType;
  readonly status: StatementStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** v0.5 P6: where the sentence came from; set once when it is written. */
  readonly origin?: StatementOrigin;
}

export function isOutputStatement(value: unknown): value is OutputStatement {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.outputId !== 'string' || v.outputId.length === 0) return false;
  if (typeof v.sectionId !== 'string' || v.sectionId.length === 0) return false;
  if (typeof v.body !== 'string') return false;
  if (!isFiniteOrder(v.order)) return false;
  if (!isOutputAuthorType(v.authorType)) return false;
  if (!isStatementStatus(v.status)) return false;
  if (v.origin !== undefined && !isStatementOrigin(v.origin)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (Number.isNaN(Date.parse(v.createdAt))) return false;
  if (Number.isNaN(Date.parse(v.updatedAt))) return false;
  // Canonical store NEVER persists an empty body. The
  // AI text flow goes through the Draft Layer instead,
  // so by the time we Accept a draft the body is
  // already non-empty. A bare empty body slipping into
  // the store would mean a bug in the writer, not user
  // intent, so we refuse at the boundary.
  if (v.body.trim().length === 0) return false;
  // AI text is never canonical directly; the only way
  // AI text reaches an OutputStatement is via
  // `acceptOutputDraft` which writes `authorType =
  // 'user'` (the user is the one who Accepts).
  if (v.authorType === 'ai') return false;
  return true;
}

// ---------------------------------------------------------------------------
// StatementSupport
// ---------------------------------------------------------------------------

export type SupportRelation = 'supports' | 'contradicts' | 'qualifies';

export const SUPPORT_RELATIONS: readonly SupportRelation[] = [
  'supports',
  'contradicts',
  'qualifies',
] as const;

export function isSupportRelation(value: unknown): value is SupportRelation {
  return (
    value === 'supports' || value === 'contradicts' || value === 'qualifies'
  );
}

/**
 * A reference from a Statement to exactly one canonical
 * Claim or Evidence. The discriminated union forces the
 * compiler (and the reader) to check which `kind` is in
 * scope before reading `id`. The runtime guard rejects
 * any object with a missing or unknown `kind`.
 */
export type StatementRef =
  | { readonly kind: 'claim'; readonly id: string }
  | { readonly kind: 'evidence'; readonly id: string };

export function isStatementRef(value: unknown): value is StatementRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'claim' && v.kind !== 'evidence') return false;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  return true;
}

export interface StatementSupport {
  readonly id: string;
  readonly projectId: string;
  readonly outputId: string;
  readonly statementId: string;
  readonly ref: StatementRef;
  readonly relation: SupportRelation;
  readonly authorType: OutputAuthorType;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isStatementSupport(value: unknown): value is StatementSupport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.outputId !== 'string' || v.outputId.length === 0) return false;
  if (typeof v.statementId !== 'string' || v.statementId.length === 0) return false;
  if (!isStatementRef(v.ref)) return false;
  if (!isSupportRelation(v.relation)) return false;
  if (!isOutputAuthorType(v.authorType)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (Number.isNaN(Date.parse(v.createdAt))) return false;
  if (Number.isNaN(Date.parse(v.updatedAt))) return false;
  return true;
}

/**
 * The dedup key the repository and the use case use to
 * detect a duplicate `StatementSupport`. The use case
 * runs `attachSupport` inside a transaction and refuses
 * to write a Support whose key matches an existing
 * Support for the same statement.
 */
export function supportDedupKey(s: {
  readonly statementId: string;
  readonly ref: StatementRef;
  readonly relation: SupportRelation;
}): string {
  return `${s.statementId}::${s.ref.kind}::${s.ref.id}::${s.relation}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO timestamp at call time. Pure helper. The use
 *  cases inject a clock so tests can pin timestamps. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * True when `n` is a non-negative finite number.
 * `NaN`, `Infinity`, and `-Infinity` are all rejected.
 * The domain layer never persists a non-finite `order`
 * so a UI that imports `output` types cannot
 * accidentally put the document in an unsorted state.
 */
export function isFiniteOrder(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Reject `n` if it is not a non-negative finite number.
 * Use cases call this before writing so the boundary
 * catches NaN / negative order before the repository
 * gets to.
 */
export function validateOrder(n: unknown): number {
  if (!isFiniteOrder(n)) {
    throw new Error(`order must be a non-negative finite number (got ${String(n)}).`);
  }
  return n;
}

/**
 * Stable section order. The tiebreak
 * (`order → createdAt → id`) is the single source of
 * truth so the UI, the repository, and the audit agree
 * without coordination. Returns a NEW array — does not
 * mutate `sections`.
 */
export function stableSectionOrder<T extends OutputSection>(sections: readonly T[]): T[] {
  return [...sections].sort(compareByOrder);
}

/**
 * Stable statement order. Same tiebreak as
 * `stableSectionOrder`.
 */
export function stableStatementOrder<T extends OutputStatement>(statements: readonly T[]): T[] {
  return [...statements].sort(compareByOrder);
}

function compareByOrder<
  T extends { readonly order: number; readonly createdAt: string; readonly id: string },
>(a: T, b: T): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
  return a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Audit — derived, never persisted
// ---------------------------------------------------------------------------

export type StatementAuditState =
  | 'supported'
  | 'conflicted'
  | 'unsupported'
  | 'broken';

/**
 * A tagged reason a Statement is in its audit state.
 * The UI renders the list (hover / details panel) so
 * the user can see *why* a Statement is broken vs.
 * unsupported — the two are not the same.
 */
export type AuditReason =
  | { readonly kind: 'no-supports' }
  | { readonly kind: 'only-contradicts' }
  | { readonly kind: 'broken-ref'; readonly ref: StatementRef; readonly why: string }
  | {
      readonly kind: 'claim-not-accepted';
      readonly ref: StatementRef;
    }
  | {
      readonly kind: 'evidence-not-verified';
      readonly ref: StatementRef;
    };

export interface StatementAudit {
  readonly statementId: string;
  readonly state: StatementAuditState;
  readonly reasons: readonly AuditReason[];
  /** Every StatementRef the audit touched, in the order
   *  the supports list produced. The UI uses this to
   *  render clickable chips. */
  readonly refs: readonly StatementRef[];
}

/**
 * Inputs the audit needs to compute a Statement's
 * state. The use case hydrates these maps from the
 * repository before calling the helper so the audit
 * itself is a pure function (testable in isolation).
 *
 * Lookup maps are keyed by canonical object id.
 * `claims` is filtered to `status === 'canonical'` by
 * the use case; `evidence` is filtered to
 * `status === 'verified'`. The audit re-checks these
 * statuses itself so the helper is honest even if the
 * caller forgets the filter.
 */
export interface AuditLookupMaps {
  /** id → Claim (must be `status === 'canonical'`). */
  readonly claims: ReadonlyMap<string, { readonly id: string; readonly projectId: string; readonly status: string }>;
  /** id → Evidence (must be `status === 'verified'`). */
  readonly evidence: ReadonlyMap<string, {
    readonly id: string;
    readonly projectId: string;
    readonly status: string;
  }>;
}

export interface AuditStatementInput {
  readonly statement: { readonly id: string; readonly projectId: string };
  readonly supports: readonly StatementSupport[];
  readonly lookups: AuditLookupMaps;
}

export interface AuditOutputInput {
  readonly output: { readonly id: string; readonly projectId: string };
  readonly statements: readonly OutputStatement[];
  readonly supports: readonly StatementSupport[];
  readonly lookups: AuditLookupMaps;
}

/**
 * Audit a single Statement. The function is pure; the
 * use case reads the snapshot and passes the result
 * here.
 *
 * State priority (strongest wins):
 *
 *   broken          at least one ref is missing /
 *                   cross-project / wrong-status
 *   conflicted      at least one positive AND at least
 *                   one valid contradicts
 *   unsupported     no positive support
 *   supported       at least one positive, no valid
 *                   contradicts
 *
 * `broken` overrides `conflicted` because the user
 * needs to know the ref is broken before they can act
 * on a conflict.
 */
export function auditStatement(input: AuditStatementInput): StatementAudit {
  const supportsForStatement = input.supports.filter(
    (s) => s.statementId === input.statement.id,
  );
  if (supportsForStatement.length === 0) {
    return {
      statementId: input.statement.id,
      state: 'unsupported',
      reasons: [{ kind: 'no-supports' }],
      refs: [],
    };
  }
  const refs: StatementRef[] = [];
  const reasons: AuditReason[] = [];
  let broken = false;
  let positive = 0;
  let contradicts = 0;
  for (const s of supportsForStatement) {
    refs.push(s.ref);
    const verdict = evaluateRef(input.statement, s, input.lookups);
    if (verdict.broken) {
      broken = true;
      reasons.push(verdict.reason);
      continue;
    }
    if (s.relation === 'contradicts') {
      contradicts += 1;
    } else {
      // 'supports' or 'qualifies' both count as positive.
      positive += 1;
    }
  }
  if (broken) {
    return {
      statementId: input.statement.id,
      state: 'broken',
      reasons,
      refs,
    };
  }
  if (positive > 0 && contradicts > 0) {
    return {
      statementId: input.statement.id,
      state: 'conflicted',
      reasons,
      refs,
    };
  }
  if (positive === 0) {
    // Only `contradicts` (or empty) — the statement is
    // opposed but not supported. Distinct from
    // `unsupported` so the user can see why.
    reasons.push({ kind: 'only-contradicts' });
    return {
      statementId: input.statement.id,
      state: 'unsupported',
      reasons,
      refs,
    };
  }
  return {
    statementId: input.statement.id,
    state: 'supported',
    reasons: [],
    refs,
  };
}

/**
 * Audit an entire Output. Returns the per-statement
 * audit plus an overall state. The overall state is
 * the strongest state across all statements
 * (`broken > conflicted > unsupported > supported`).
 */
export function auditOutput(input: AuditOutputInput): {
  readonly overall: StatementAuditState;
  readonly byStatement: ReadonlyMap<string, StatementAudit>;
} {
  const byStatement = new Map<string, StatementAudit>();
  let overall: StatementAuditState = 'supported';
  for (const statement of input.statements) {
    const audit = auditStatement({
      statement,
      supports: input.supports,
      lookups: input.lookups,
    });
    byStatement.set(statement.id, audit);
    overall = strongerAuditState(overall, audit.state);
  }
  return { overall, byStatement };
}

/**
 * Strongest of two states. Centralising the priority
 * here keeps the audit consistent.
 */
export function strongerAuditState(
  a: StatementAuditState,
  b: StatementAuditState,
): StatementAuditState {
  const rank: Record<StatementAuditState, number> = {
    supported: 0,
    unsupported: 1,
    conflicted: 2,
    broken: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Tone the UI uses for a Pill. Kept here so the badge
 * logic is centralised — `broken` and `conflicted` are
 * not visually identical, and `unsupported` is an
 * *information* chip, not an error chip.
 */
export function auditTone(
  state: StatementAuditState,
): 'success' | 'info' | 'warning' | 'error' {
  switch (state) {
    case 'supported':
      return 'success';
    case 'unsupported':
      return 'info';
    case 'conflicted':
      return 'warning';
    case 'broken':
      return 'error';
  }
}

/**
 * Human-readable label per state. The UI shows this in
 * the audit badge.
 */
export function auditLabel(state: StatementAuditState): string {
  switch (state) {
    case 'supported':
      return 'Supported';
    case 'unsupported':
      return 'No evidence linked';
    case 'conflicted':
      return 'Conflicted';
    case 'broken':
      return 'Broken lineage';
  }
}

function evaluateRef(
  statement: { readonly id: string; readonly projectId: string },
  support: StatementSupport,
  lookups: AuditLookupMaps,
): { readonly broken: boolean; readonly reason: AuditReason } | { readonly broken: false } {
  if (support.projectId !== statement.projectId) {
    return {
      broken: true,
      reason: {
        kind: 'broken-ref',
        ref: support.ref,
        why: 'support belongs to a different project',
      },
    };
  }
  if (support.ref.kind === 'claim') {
    const claim = lookups.claims.get(support.ref.id);
    if (!claim) {
      return {
        broken: true,
        reason: { kind: 'broken-ref', ref: support.ref, why: 'claim not found' },
      };
    }
    if (claim.projectId !== statement.projectId) {
      return {
        broken: true,
        reason: {
          kind: 'broken-ref',
          ref: support.ref,
          why: 'claim belongs to a different project',
        },
      };
    }
    if (claim.status !== 'canonical') {
      return {
        broken: true,
        reason: { kind: 'claim-not-accepted', ref: support.ref },
      };
    }
    return { broken: false };
  }
  const evidence = lookups.evidence.get(support.ref.id);
  if (!evidence) {
    return {
      broken: true,
      reason: { kind: 'broken-ref', ref: support.ref, why: 'evidence not found' },
    };
  }
  if (evidence.projectId !== statement.projectId) {
    return {
      broken: true,
      reason: {
        kind: 'broken-ref',
        ref: support.ref,
        why: 'evidence belongs to a different project',
      },
    };
  }
  if (evidence.status !== 'verified') {
    return {
      broken: true,
      reason: { kind: 'evidence-not-verified', ref: support.ref },
    };
  }
  return { broken: false };
}