/**
 * StudyKit v0.4 — `domain/researchDesign`
 *
 * Canonical contracts for the **Research Design + Project
 * Management** slice (WP-07). Sits beside `domain/research.ts`
 * (the Evidence slice) and mirrors its rules:
 *
 *   - Every persisted object carries `projectId`, `createdAt`,
 *     `updatedAt`, and `authorType: 'user' | 'ai' | 'imported'`.
 *   - AI never writes canonical state. Use cases refuse
 *     `authorType: 'ai'`; AI suggestions go through the
 *     Draft Layer and the host Accepts a draft into canonical.
 *   - Decision history is *immutable and append-only* — every
 *     revision is a new `MethodDecision` row with `supersedes`
 *     and a `supersedesLineage` chain. The previous row is
 *     never mutated.
 *   - `Task` is the user's self-explaining contract. A Task
 *     must always carry a `sourceRef` (where it came from),
 *     a `why` (why it exists), and a `definitionOfDone`
 *     (how the user knows it is finished). Completing a Task
 *     without a `completionRef` is rejected.
 *
 * Why a separate file (not a new section in `domain/research.ts`)?
 * WP-05's file is already >1300 lines; the Design + PM slice
 * adds seven more kinds and a substantial use-case surface
 * (progressive sections, versioned decisions, cycle-safe
 * dependencies). Splitting the file by slice keeps the
 * `domain/` boundary honest and the import cycles obvious.
 *
 * Design rules (enforced by type guards + use cases):
 *
 *   1. **One concept, one truth.** A `MethodDecision` is the
 *      only object that knows about its history; `Evidence`,
 *      `Claim` and the AI Draft Layer reference it by id.
 *   2. **Author / AI distinction is explicit.** AI suggestions
 *      for new tasks live in `DraftBody.kind: 'task-suggestions'`
 *      until the user Accepts. The accept path produces a
 *      canonical `ResearchTask` with `authorType: 'user'`
 *      (the user picked it; provenance is recorded in the
 *      `sourceNote` / `aiSuggested: true` flag if desired).
 *   3. **Tasks are not numbers.** There is no `priority`,
 *      no auto-assignee, no deadline. The `Milestone` may
 *      carry a `targetDate` (user-supplied); a Task may
 *      link to a Milestone but never inherits a date.
 *   4. **Dependencies are explicit + cycle-safe.** The use
 *      case that adds a dependency reads the existing graph
 *      and refuses any edge that would form a cycle. A Task
 *      may not depend on itself.
 *   5. **Completion requires a real artifact.** `status: 'done'`
 *      requires `completionRef` pointing at an Output, a
 *      Decision, or verified Evidence. "I closed it in my
 *      head" is not an artifact.
 *   6. **Blockers are typed but free-form.** A blocker has
 *      a `kind` (`data | supervisor | ethics | access |
 *      analysis | other`) and a `note`; the user can name
 *      any other dependency. The Task stays `blocked` until
 *      the user clears the blocker.
 *   7. **Design sections are progressive, not monolithic.**
 *      A `DesignSpec` carries a list of `sections`, each
 *      with a `kind` from the research-design section list
 *      and a `body`. The workspace shows only the sections
 *      the user has touched; the rest stay collapsed.
 *   8. **Timestamps are mandatory.** Every persisted Design
 *      + PM object has `createdAt` and `updatedAt`.
 */

// ---------------------------------------------------------------------------
// Section kind
// ---------------------------------------------------------------------------

/**
 * The ordered kinds of section a `DesignSpec` can carry. The
 * workspace shows them progressively (Rationale / Gap →
 * Hypotheses → Constructs → Design type → Sample → Measures
 * → Procedure → Analysis → Ethics → Risks → Deviations) so
 * the user is never asked to fill all eleven at once.
 */
export type DesignSectionKind =
  | 'rationale'
  | 'hypotheses'
  | 'constructs'
  | 'design-type'
  | 'sample'
  | 'measures'
  | 'procedure'
  | 'analysis'
  | 'ethics'
  | 'risks'
  | 'deviations';

export const DESIGN_SECTION_KINDS: readonly DesignSectionKind[] = [
  'rationale',
  'hypotheses',
  'constructs',
  'design-type',
  'sample',
  'measures',
  'procedure',
  'analysis',
  'ethics',
  'risks',
  'deviations',
] as const;

export function isDesignSectionKind(value: unknown): value is DesignSectionKind {
  return (
    value === 'rationale' ||
    value === 'hypotheses' ||
    value === 'constructs' ||
    value === 'design-type' ||
    value === 'sample' ||
    value === 'measures' ||
    value === 'procedure' ||
    value === 'analysis' ||
    value === 'ethics' ||
    value === 'risks' ||
    value === 'deviations'
  );
}

/**
 * Default progression order: the workspace shows sections in
 * this order. The user can collapse any of them; a section
 * that has a non-empty `body` stays visible.
 */
export const DEFAULT_SECTION_ORDER: readonly DesignSectionKind[] = [
  'rationale',
  'hypotheses',
  'constructs',
  'design-type',
  'sample',
  'measures',
  'procedure',
  'analysis',
  'ethics',
  'risks',
  'deviations',
] as const;

export function isDesignSectionKindList(value: unknown): value is readonly DesignSectionKind[] {
  if (!Array.isArray(value)) return false;
  for (const v of value) if (!isDesignSectionKind(v)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ResearchQuestion
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a `ResearchQuestion`. A question can be
 * `open`, `closed` (the user is done with it), or
 * `superseded` (a newer question replaced it; the lineage
 * chain is `supersededBy`).
 */
export type ResearchQuestionStatus = 'open' | 'closed' | 'superseded';

export const RESEARCH_QUESTION_STATUSES: readonly ResearchQuestionStatus[] = [
  'open',
  'closed',
  'superseded',
] as const;

export function isResearchQuestionStatus(value: unknown): value is ResearchQuestionStatus {
  return value === 'open' || value === 'closed' || value === 'superseded';
}

export interface ResearchQuestion {
  readonly id: string;
  readonly projectId: string;
  /** The user-facing question text. Required. */
  readonly question: string;
  /** Free-form rationale / gap that motivated the question. */
  readonly rationale: string;
  /** Optional scope narrowing (population, setting, time window). */
  readonly scope: string;
  readonly status: ResearchQuestionStatus;
  /** When the user marks the question `superseded`, this
   *  points to the new question. Lineage stays. */
  readonly supersededBy: string | null;
  /** Optional run that surfaced the question (search). */
  readonly lineageRunId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isResearchQuestion(value: unknown): value is ResearchQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.question !== 'string' || v.question.trim().length === 0) return false;
  if (typeof v.rationale !== 'string') return false;
  if (typeof v.scope !== 'string') return false;
  if (!isResearchQuestionStatus(v.status)) return false;
  if (v.supersededBy !== null && typeof v.supersededBy !== 'string') return false;
  if (v.lineageRunId !== null && typeof v.lineageRunId !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Hypothesis
// ---------------------------------------------------------------------------

export type HypothesisKind = 'hypothesis' | 'objective';

export const HYPOTHESIS_KINDS: readonly HypothesisKind[] = ['hypothesis', 'objective'] as const;

export function isHypothesisKind(value: unknown): value is HypothesisKind {
  return value === 'hypothesis' || value === 'objective';
}

export interface Hypothesis {
  readonly id: string;
  readonly projectId: string;
  /** Optional ResearchQuestion this hypothesis answers. */
  readonly questionId: string | null;
  readonly kind: HypothesisKind;
  /** The hypothesis / objective statement. */
  readonly text: string;
  /** Optional rationale (why this hypothesis, what predicts it). */
  readonly rationale: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isHypothesis(value: unknown): value is Hypothesis {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (v.questionId !== null && typeof v.questionId !== 'string') return false;
  if (!isHypothesisKind(v.kind)) return false;
  if (typeof v.text !== 'string' || v.text.trim().length === 0) return false;
  if (typeof v.rationale !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// DesignSpec
// ---------------------------------------------------------------------------

/**
 * One section inside a `DesignSpec`. The body is free text
 * (markdown is allowed but never rendered as HTML); the
 * workspace hides sections whose body is empty.
 */
export interface DesignSection {
  readonly kind: DesignSectionKind;
  readonly body: string;
  /** When `true`, the user explicitly opened the section in
   *  the workspace (vs. a freshly-painted empty section). */
  readonly expanded: boolean;
}

export function isDesignSection(value: unknown): value is DesignSection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isDesignSectionKind(v.kind)) return false;
  if (typeof v.body !== 'string') return false;
  if (typeof v.expanded !== 'boolean') return false;
  return true;
}

/**
 * The user's structured design for a project. The spec
 * carries *progressive* sections — the user never has to
 * fill all eleven at once. A blank start (no template) is
 * valid and supported.
 *
 * `templateEnabled` is a soft hint; the user can flip it
 * off and start blank. The workspace never auto-fills a
 * section based on the project kind.
 */
export interface DesignSpec {
  readonly id: string;
  readonly projectId: string;
  /** Optional ResearchQuestion this spec answers. */
  readonly questionId: string | null;
  /** User-facing name (default "Design"). */
  readonly name: string;
  /** Soft default; the user can change it. */
  readonly kind: 'explore' | 'review' | 'empirical' | 'thesis' | 'blank';
  /** When `true`, the workspace previews the default
   *  template. When `false`, the user chose a blank start. */
  readonly templateEnabled: boolean;
  /** Sections in display order. Missing sections are simply
   *  absent from the array. The workspace derives the next
   *  empty section from `DEFAULT_SECTION_ORDER`. */
  readonly sections: readonly DesignSection[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isDesignSpec(value: unknown): value is DesignSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (v.questionId !== null && typeof v.questionId !== 'string') return false;
  if (typeof v.name !== 'string') return false;
  if (
    v.kind !== 'explore' &&
    v.kind !== 'review' &&
    v.kind !== 'empirical' &&
    v.kind !== 'thesis' &&
    v.kind !== 'blank'
  ) {
    return false;
  }
  if (typeof v.templateEnabled !== 'boolean') return false;
  if (!Array.isArray(v.sections)) return false;
  for (const s of v.sections) if (!isDesignSection(s)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// MethodDecision
// ---------------------------------------------------------------------------

/**
 * One alternative the user considered for a `MethodDecision`.
 * The `body` is the user's free-form note. The decision
 * itself carries the picked choice + rationale; the
 * alternatives are preserved so future revisions can re-open
 * the discussion without losing the prior deliberation.
 */
export interface MethodAlternative {
  readonly id: string;
  readonly label: string;
  readonly body: string;
  readonly evidenceIds: readonly string[];
}

export function isMethodAlternative(value: unknown): value is MethodAlternative {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.label !== 'string') return false;
  if (typeof v.body !== 'string') return false;
  if (!Array.isArray(v.evidenceIds)) return false;
  for (const e of v.evidenceIds) if (typeof e !== 'string') return false;
  return true;
}

/**
 * A versioned design decision. The decision answers a
 * *single* design-section question (e.g. "primary outcome"
 * is a `measures` decision).
 *
 * The chain model (WP-07 Round 2):
 *
 *   - Every decision belongs to a *chain*. The chain id
 *     is the id of the *first* decision in the chain
 *     (the `chainId` is stable; new revisions keep the
 *     same `chainId`).
 *   - Multiple *independent* decisions (different
 *     `chainId`s) can coexist in the same section.
 *     Real research often needs parallel decisions
 *     (e.g. "sample size" and "recruitment channel" are
 *     two independent choices that happen to live in
 *     the `sample` section).
 *   - A *revision* of chain C creates a new row with
 *     `supersedes = <previous id in C>` and a
 *     `supersedesLineage` extended with that previous
 *     id. The chain id stays C.
 *   - The previous row is **byte-for-byte unchanged**;
 *     head / superseded state is **derived from links**
 *     (incoming `supersedes` arrow), never stored.
 *     A row is the *head* of its chain iff no other
 *     decision has `supersedes === this.id`. A row is
 *     *superseded* iff any other decision has
 *     `supersedes === this.id`.
 *
 *   The persisted record carries the *minimum* truth
 *   (the row + its single outgoing link + the chain id);
 *   the view layer (`deriveMethodDecisionViews`) computes
 *   the head / superseded / chainLength fields the UI
 *   needs. There is no `superseded: boolean` field on the
 *   stored record — storing it would force every revision
 *   to mutate the previous row, breaking the immutability
 *   invariant.
 */
export interface MethodDecision {
  readonly id: string;
  readonly projectId: string;
  readonly specId: string;
  /** The design section this decision lives in. */
  readonly sectionKind: DesignSectionKind;
  /**
   * The chain this decision belongs to. The first
   * decision in a chain sets `chainId === id`. Every
   * subsequent revision keeps the same `chainId`. Two
   * independent decisions in the same section have
   * different `chainId`s.
   */
  readonly chainId: string;
  /** A short human label ("primary outcome = sleep efficiency"). */
  readonly title: string;
  /** The picked choice. */
  readonly choice: string;
  /** Why the user picked this option. */
  readonly rationale: string;
  /** The other options the user considered. */
  readonly alternatives: readonly MethodAlternative[];
  /** Evidence ids the user weighed (verified Evidence by
   *  preference, but not enforced — older links may be
   *  to candidates that have since moved on). */
  readonly evidenceIds: readonly string[];
  /** Free-form impacts ("sample plan", "preregistration",
   *  "analysis plan"). The Project Home shows these next
   *  to the decision. */
  readonly impacts: readonly string[];
  /** id of the immediate previous decision in this chain,
   *  or `null` for the head of a new chain. */
  readonly supersedes: string | null;
  /** Full chain of supersedes ids, oldest first, NOT
   *  including the current decision's own id. Empty
   *  when `supersedes === null`. */
  readonly supersedesLineage: readonly string[];
  readonly createdAt: string;
  /** `authorType: 'user' | 'imported'`. The use case
   *  refuses `'ai'`. The Draft Layer is the AI path. */
  readonly authorType: 'user' | 'imported';
}

export function isMethodDecision(value: unknown): value is MethodDecision {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.specId !== 'string' || v.specId.length === 0) return false;
  if (!isDesignSectionKind(v.sectionKind)) return false;
  if (typeof v.chainId !== 'string' || v.chainId.length === 0) return false;
  if (typeof v.title !== 'string' || v.title.trim().length === 0) return false;
  if (typeof v.choice !== 'string' || v.choice.trim().length === 0) return false;
  if (typeof v.rationale !== 'string') return false;
  if (!Array.isArray(v.alternatives)) return false;
  for (const a of v.alternatives) if (!isMethodAlternative(a)) return false;
  if (!Array.isArray(v.evidenceIds)) return false;
  for (const e of v.evidenceIds) if (typeof e !== 'string') return false;
  if (!Array.isArray(v.impacts)) return false;
  for (const i of v.impacts) if (typeof i !== 'string') return false;
  if (v.supersedes !== null && typeof v.supersedes !== 'string') return false;
  if (!Array.isArray(v.supersedesLineage)) return false;
  for (const s of v.supersedesLineage) if (typeof s !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// ResearchRisk / Assumption
// ---------------------------------------------------------------------------

export type ResearchRiskKind = 'risk' | 'assumption';

export const RESEARCH_RISK_KINDS: readonly ResearchRiskKind[] = ['risk', 'assumption'] as const;

export function isResearchRiskKind(value: unknown): value is ResearchRiskKind {
  return value === 'risk' || value === 'assumption';
}

export type ResearchRiskSeverity = 'low' | 'medium' | 'high';

export const RESEARCH_RISK_SEVERITIES: readonly ResearchRiskSeverity[] = [
  'low',
  'medium',
  'high',
] as const;

export function isResearchRiskSeverity(value: unknown): value is ResearchRiskSeverity {
  return value === 'low' || value === 'medium' || value === 'high';
}

export type ResearchRiskStatus = 'open' | 'mitigated' | 'closed';

export const RESEARCH_RISK_STATUSES: readonly ResearchRiskStatus[] = [
  'open',
  'mitigated',
  'closed',
] as const;

export function isResearchRiskStatus(value: unknown): value is ResearchRiskStatus {
  return value === 'open' || value === 'mitigated' || value === 'closed';
}

export interface ResearchRisk {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ResearchRiskKind;
  readonly title: string;
  readonly body: string;
  /** Required when `kind === 'risk'`; `null` for assumptions. */
  readonly severity: ResearchRiskSeverity | null;
  /** Free-form mitigation (e.g. "pilot reliability check"). */
  readonly mitigation: string;
  readonly status: ResearchRiskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isResearchRisk(value: unknown): value is ResearchRisk {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (!isResearchRiskKind(v.kind)) return false;
  if (typeof v.title !== 'string' || v.title.trim().length === 0) return false;
  if (typeof v.body !== 'string') return false;
  if (v.severity !== null && !isResearchRiskSeverity(v.severity)) return false;
  if (typeof v.mitigation !== 'string') return false;
  if (!isResearchRiskStatus(v.status)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Milestone
// ---------------------------------------------------------------------------

/**
 * The set of research kinds the milestone supports. A custom
 * milestone carries `label` instead of a kind, so users can
 * add their own ("Chapter 1 draft", "Supervisor sign-off").
 */
export type MilestoneKind =
  | 'proposal'
  | 'pilot'
  | 'ethics'
  | 'data-collection'
  | 'analysis'
  | 'chapter'
  | 'submission'
  | 'custom';

export const MILESTONE_KINDS: readonly MilestoneKind[] = [
  'proposal',
  'pilot',
  'ethics',
  'data-collection',
  'analysis',
  'chapter',
  'submission',
  'custom',
] as const;

export function isMilestoneKind(value: unknown): value is MilestoneKind {
  return (
    value === 'proposal' ||
    value === 'pilot' ||
    value === 'ethics' ||
    value === 'data-collection' ||
    value === 'analysis' ||
    value === 'chapter' ||
    value === 'submission' ||
    value === 'custom'
  );
}

export type MilestoneStatus = 'planned' | 'in-progress' | 'completed' | 'cancelled';

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  'planned',
  'in-progress',
  'completed',
  'cancelled',
] as const;

export function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return (
    value === 'planned' ||
    value === 'in-progress' ||
    value === 'completed' ||
    value === 'cancelled'
  );
}

export interface Milestone {
  readonly id: string;
  readonly projectId: string;
  readonly kind: MilestoneKind;
  /** Required when `kind === 'custom'`; empty otherwise. */
  readonly label: string;
  /** Optional user-supplied target date (ISO). Never assigned
   *  by AI. */
  readonly targetDate: string | null;
  readonly completedAt: string | null;
  readonly status: MilestoneStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isMilestone(value: unknown): value is Milestone {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (!isMilestoneKind(v.kind)) return false;
  if (typeof v.label !== 'string') return false;
  if (v.targetDate !== null && typeof v.targetDate !== 'string') return false;
  if (v.completedAt !== null && typeof v.completedAt !== 'string') return false;
  if (!isMilestoneStatus(v.status)) return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

// ---------------------------------------------------------------------------
// ResearchTask
// ---------------------------------------------------------------------------

/**
 * Where a Task came from. A `manual` task has no upstream
 * object — the user wrote it from scratch. The other kinds
 * carry the upstream id so the Project Home can render a
 * "Why this exists" chip with a deep link.
 */
export type TaskSourceKind =
  | 'question'
  | 'evidence-gap'
  | 'decision'
  | 'output'
  | 'risk'
  | 'manual';

export const TASK_SOURCE_KINDS: readonly TaskSourceKind[] = [
  'question',
  'evidence-gap',
  'decision',
  'output',
  'risk',
  'manual',
] as const;

export function isTaskSourceKind(value: unknown): value is TaskSourceKind {
  return (
    value === 'question' ||
    value === 'evidence-gap' ||
    value === 'decision' ||
    value === 'output' ||
    value === 'risk' ||
    value === 'manual'
  );
}

export interface TaskSourceRef {
  readonly kind: TaskSourceKind;
  /** The id of the upstream object. For `manual` tasks this
   *  is `null` (the user wrote the task from scratch). */
  readonly id: string | null;
}

export function isTaskSourceRef(value: unknown): value is TaskSourceRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isTaskSourceKind(v.kind)) return false;
  if (v.id !== null && typeof v.id !== 'string') return false;
  return true;
}

export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'done' | 'cancelled';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'in-progress',
  'blocked',
  'done',
  'cancelled',
] as const;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === 'open' ||
    value === 'in-progress' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'cancelled'
  );
}

/**
 * A typed blocker the user attaches to a Task. The `note`
 * is the user's free-form explanation; the Project Home
 * shows it under "Blocked by".
 */
export type TaskBlockerKind =
  | 'data'
  | 'supervisor'
  | 'ethics'
  | 'access'
  | 'analysis'
  | 'other';

export const TASK_BLOCKER_KINDS: readonly TaskBlockerKind[] = [
  'data',
  'supervisor',
  'ethics',
  'access',
  'analysis',
  'other',
] as const;

export function isTaskBlockerKind(value: unknown): value is TaskBlockerKind {
  return (
    value === 'data' ||
    value === 'supervisor' ||
    value === 'ethics' ||
    value === 'access' ||
    value === 'analysis' ||
    value === 'other'
  );
}

export interface TaskBlocker {
  readonly kind: TaskBlockerKind;
  readonly note: string;
  readonly createdAt: string;
}

export function isTaskBlocker(value: unknown): value is TaskBlocker {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isTaskBlockerKind(v.kind)) return false;
  if (typeof v.note !== 'string') return false;
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  return true;
}

/**
 * What artifact a Task points at on completion. The use case
 * rejects `status: 'done'` when `completionRef` is missing.
 * The id must point at a real Output, MethodDecision, or
 * verified Evidence (the use case re-checks the link).
 */
export type TaskCompletionRefKind = 'output' | 'decision' | 'evidence';

export const TASK_COMPLETION_REF_KINDS: readonly TaskCompletionRefKind[] = [
  'output',
  'decision',
  'evidence',
] as const;

export function isTaskCompletionRefKind(value: unknown): value is TaskCompletionRefKind {
  return value === 'output' || value === 'decision' || value === 'evidence';
}

export interface TaskCompletionRef {
  readonly kind: TaskCompletionRefKind;
  readonly id: string;
  readonly note: string;
}

export function isTaskCompletionRef(value: unknown): value is TaskCompletionRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isTaskCompletionRefKind(v.kind)) return false;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.note !== 'string') return false;
  return true;
}

/**
 * Where a canonical ResearchTask came from. Three
 * shapes cover WP-07:
 *
 *   - `{ kind: 'user' }` — the user wrote the task
 *     themselves (manual creation, "Create task
 *     from this decision", etc.). The canonical
 *     `authorType` is `'user'`.
 *   - `{ kind: 'imported' }` — the task came from a
 *     future import / migration path. `authorType`
 *     is `'imported'`.
 *   - `{ kind: 'ai-accepted', draftId, provider,
 *     model?, actionId, contextSnapshotHash,
 *     acceptedAt }` — the user Accepted a Draft
 *     produced by an AI safe action. The canonical
 *     `authorType` is `'user'` (the user picked
 *     the suggestion; this record preserves the
 *     full Draft Layer provenance so the lineage
 *     survives).
 *
 * The previous shape encoded this as JSON embedded
 * in `sourceNote`; that violated the "human-readable
 * only" contract on `sourceNote`. The new field is
 * additive and backward-compatible: legacy rows
 * without an `origin` field are read as
 * `{ kind: 'user' }` and the type guard accepts the
 * missing field.
 */
export type TaskOrigin =
  | { readonly kind: 'user' }
  | { readonly kind: 'imported' }
  | {
      readonly kind: 'ai-accepted';
      readonly draftId: string;
      readonly provider: string;
      readonly model: string | null;
      readonly actionId: string;
      readonly contextSnapshotHash: string;
      readonly acceptedAt: string;
    };

export const TASK_ORIGIN_KINDS: readonly TaskOrigin['kind'][] = [
  'user',
  'imported',
  'ai-accepted',
] as const;

export function isTaskOrigin(value: unknown): value is TaskOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'user' || v.kind === 'imported') return true;
  if (v.kind === 'ai-accepted') {
    if (typeof v.draftId !== 'string' || v.draftId.length === 0) return false;
    if (typeof v.provider !== 'string' || v.provider.length === 0) return false;
    if (v.model !== null && typeof v.model !== 'string') return false;
    if (typeof v.actionId !== 'string' || v.actionId.length === 0) return false;
    if (typeof v.contextSnapshotHash !== 'string' || v.contextSnapshotHash.length === 0) {
      return false;
    }
    if (typeof v.acceptedAt !== 'string' || v.acceptedAt.length === 0) return false;
    return true;
  }
  return false;
}

export interface ResearchTask {
  readonly id: string;
  readonly projectId: string;
  /** Short user-facing title. */
  readonly title: string;
  /** Why the task exists. Required, non-empty. The Project
   *  Home and the Task detail surface both show it verbatim. */
  readonly why: string;
  /** What "done" means for this task. Required, non-empty. */
  readonly definitionOfDone: string;
  /** Where the task came from. `manual` for user-authored
   *  tasks. The use case checks the upstream id exists when
   *  `kind !== 'manual'`. */
  readonly sourceRef: TaskSourceRef;
  /** Optional free-form note attached to the source. The
   *  note is human-readable only — AI provenance lives on
   *  the structured `origin` field. */
  readonly sourceNote: string;
  /** Provenance of the canonical record. Replaces the
   *  older "JSON in sourceNote" hack. The default for
   *  legacy rows and user-authored rows is
   *  `{ kind: 'user' }`; `acceptDesignTaskSuggestion`
   *  writes `{ kind: 'ai-accepted', ... }` when the user
   *  Accepts an AI Draft. */
  readonly origin: TaskOrigin;
  /** Optional milestone the task belongs to. */
  readonly milestoneId: string | null;
  readonly status: TaskStatus;
  /** Other task ids this task depends on. Cycle-safe by
   *  use-case invariant. Never includes self. */
  readonly dependencies: readonly string[];
  /** When `status === 'blocked'`, the blocker. */
  readonly blocker: TaskBlocker | null;
  /** Required when `status === 'done'`. */
  readonly completionRef: TaskCompletionRef | null;
  /**
   * WP-08 Round 2: the project member assigned to
   * this task. `null` while the task is unassigned
   * (the default for new tasks). The assignee is a
   * snapshot — the canonical `Collaborator` row
   * may change or be removed without breaking the
   * task. The use case `assignTask` requires
   * `task.assign` capability; the AI does NOT
   * auto-assign (the Draft Layer path writes
   * `assignee: null`).
   */
  readonly assignee: { readonly userId: string; readonly displayName: string } | null;
  /**
   * WP-08 Round 2: when a task was published from a
   * `PrivateScratch`, this carries the source
   * scratch id. The Project Home / Task detail can
   * use it to render a "from scratch" link back to
   * the publish preview / activity. `null` for
   * tasks not published from a scratch.
   */
  readonly publishedFromScratchId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorType: 'user' | 'imported';
}

export function isResearchTask(value: unknown): value is ResearchTask {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.title !== 'string' || v.title.trim().length === 0) return false;
  if (typeof v.why !== 'string' || v.why.trim().length === 0) return false;
  if (typeof v.definitionOfDone !== 'string' || v.definitionOfDone.trim().length === 0) {
    return false;
  }
  if (!isTaskSourceRef(v.sourceRef)) return false;
  if (typeof v.sourceNote !== 'string') return false;
  // The canonical `ResearchTask` ALWAYS carries a
  // valid `origin` field. Legacy rows (pre-WP-07
  // Round 3) are normalized at the repository read
  // boundary via `normalizeTaskOrigin` before this
  // guard runs; malformed rows are rejected (the
  // read path throws). We do not accept a missing
  // or malformed `origin` here — that would
  // silently weaken the type contract downstream.
  if (!isTaskOrigin(v.origin)) return false;
  if (v.milestoneId !== null && typeof v.milestoneId !== 'string') return false;
  if (!isTaskStatus(v.status)) return false;
  if (!Array.isArray(v.dependencies)) return false;
  for (const d of v.dependencies) if (typeof d !== 'string') return false;
  if (v.blocker !== null && !isTaskBlocker(v.blocker)) return false;
  if (v.completionRef !== null && !isTaskCompletionRef(v.completionRef)) return false;
  if (v.assignee !== null) {
    if (typeof v.assignee !== 'object' || v.assignee === null) return false;
    const a = v.assignee as Record<string, unknown>;
    if (typeof a.userId !== 'string' || a.userId.length === 0) return false;
    if (typeof a.displayName !== 'string' || a.displayName.length === 0) return false;
  }
  if (v.publishedFromScratchId !== null) {
    if (typeof v.publishedFromScratchId !== 'string' || v.publishedFromScratchId.length === 0) {
      return false;
    }
  }
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false;
  if (typeof v.updatedAt !== 'string' || v.updatedAt.length === 0) return false;
  if (v.authorType !== 'user' && v.authorType !== 'imported') return false;
  return true;
}

/**
 * Default origin for legacy rows that pre-date the
 * `origin` field. The read-time helper picks this
 * shape (or `{ kind: 'imported' }`) based on the
 * row's `authorType` so the round-trip is
 * self-consistent.
 */
export function defaultTaskOrigin(): TaskOrigin {
  return { kind: 'user' };
}

/**
 * Canonical read-time normalization for the
 * `ResearchTask.origin` field. Two valid inputs:
 *
 *   - the field is missing (legacy row, pre-WP-07
 *     Round 3) → derive from `authorType`:
 *     `imported` → `{ kind: 'imported' }`,
 *     anything else → `{ kind: 'user' }`.
 *   - the field is present and well-shaped →
 *     return it verbatim.
 *
 * Anything else (a malformed shape, a `null`, a
 * wrong-kind object) is a contract violation.
 * The repository's read path applies this helper
 * BEFORE the type guard so the type guard stays
 * strict (the canonical `ResearchTask` always
 * carries a valid `origin`).
 */
export function normalizeTaskOrigin(
  raw: unknown,
  authorType: 'user' | 'imported',
): TaskOrigin {
  if (raw === undefined || raw === null) {
    return authorType === 'imported'
      ? { kind: 'imported' }
      : { kind: 'user' };
  }
  if (isTaskOrigin(raw)) return raw;
  throw new Error(
    `ResearchTask.origin is malformed: expected a TaskOrigin or undefined, got ${JSON.stringify(raw)}.`,
  );
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Throw if the author type is `'ai'`. Use cases that write
 * canonical state MUST call this on every input. The Draft
 * Layer is the only path the AI has to the user's data.
 */
export function assertUserAuthored(authorType: string): void {
  if (authorType !== 'user' && authorType !== 'imported') {
    throw new Error(
      `Refusing to write canonical state with authorType="${authorType}"; ` +
        'AI must go through the Draft Layer.',
    );
  }
}

/**
 * Throw if a `MethodDecision` revision does not match the
 * previous decision's `chainId` + `supersedesLineage`.
 *
 *   - `chainId` must equal the previous decision's `chainId`
 *     (revisions stay in the same chain).
 *   - `supersedes` must equal the previous id.
 *   - `supersedesLineage` must be the previous lineage
 *     plus the previous id.
 */
export function assertMethodRevisionLineage(args: {
  readonly previous: MethodDecision;
  readonly next: Pick<MethodDecision, 'chainId' | 'supersedes' | 'supersedesLineage'>;
}): void {
  if (args.next.chainId !== args.previous.chainId) {
    throw new Error(
      `MethodDecision revision: chainId (${args.next.chainId}) must equal previous chainId (${args.previous.chainId}).`,
    );
  }
  if (args.next.supersedes !== args.previous.id) {
    throw new Error(
      `MethodDecision revision: supersedes (${args.next.supersedes}) must equal previous id (${args.previous.id}).`,
    );
  }
  const expected = [...args.previous.supersedesLineage, args.previous.id];
  if (
    args.next.supersedesLineage.length !== expected.length ||
    args.next.supersedesLineage.some((id, i) => id !== expected[i])
  ) {
    throw new Error(
      'MethodDecision revision: supersedesLineage must equal the previous lineage plus the previous id.',
    );
  }
}

/**
 * True if adding an edge `from -> to` (a "to depends on
 * from" dependency) would form a cycle in the existing
 * graph. The use case calls this on every dependency write.
 */
export function wouldCreateCycle(
  existing: ReadonlyMap<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  // Walk forward from `to`; if we ever reach `from`, the
  // new edge closes a loop.
  const stack: string[] = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const next = existing.get(node) ?? [];
    for (const n of next) {
      if (!seen.has(n)) stack.push(n);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// View derivation (NOT persisted truth)
// ---------------------------------------------------------------------------

/**
 * A read-side view of a `MethodDecision` that adds the
 * derived `isHead` / `isSuperseded` / `chainLength` fields
 * the UI needs. The view is computed by
 * `deriveMethodDecisionViews`; the underlying row stays
 * immutable.
 */
export interface MethodDecisionView {
  readonly decision: MethodDecision;
  /** True iff no other decision has `supersedes === this.id`. */
  readonly isHead: boolean;
  /** True iff any other decision has `supersedes === this.id`. */
  readonly isSuperseded: boolean;
  /** Total decisions in the chain (1 = root, 2 = one revision, etc.). */
  readonly chainLength: number;
}

/**
 * Compute the head / superseded / chainLength view for
 * every decision in `all`. Walks the supersedes links once;
 * O(n) for the n decisions in the project.
 */
export function deriveMethodDecisionViews(
  all: readonly MethodDecision[],
): readonly MethodDecisionView[] {
  // Build the set of ids that someone supersedes. An
  // id absent from this set is the head of its chain.
  const supersededIds = new Set<string>();
  for (const d of all) {
    if (d.supersedes) supersededIds.add(d.supersedes);
  }
  // Group by chainId for the chain length. A chain with
  // no supersedes links has length 1.
  const chainMembers = new Map<string, MethodDecision[]>();
  for (const d of all) {
    const list = chainMembers.get(d.chainId) ?? [];
    list.push(d);
    chainMembers.set(d.chainId, list);
  }
  return all.map((d) => {
    const isHead = !supersededIds.has(d.id);
    const isSuperseded = supersededIds.has(d.id);
    // chainLength is the count of decisions in this
    // chain; the chain starts at the root (id ===
    // chainId) and grows with each revision.
    const chainLength = chainMembers.get(d.chainId)?.length ?? 1;
    return { decision: d, isHead, isSuperseded, chainLength };
  });
}

/**
 * Return the views that are the *current head* of their
 * chain, sorted newest-first by `createdAt`. The Project
 * Home "Recent decisions" section uses this; the design
 * workspace's "Decisions" rail uses the full
 * `deriveMethodDecisionViews` list.
 */
export function deriveMethodDecisionHeads(
  all: readonly MethodDecision[],
): readonly MethodDecisionView[] {
  return deriveMethodDecisionViews(all)
    .filter((v) => v.isHead)
    .slice()
    .sort((a, b) => b.decision.createdAt.localeCompare(a.decision.createdAt));
}

/**
 * Return the ordered history of a single chain (oldest
 * first → head). The history surface and the design
 * workspace's decision detail use this. The function is
 * safe when `chainId` is unknown: it returns an empty
 * array.
 */
export function deriveMethodDecisionChain(
  all: readonly MethodDecision[],
  chainId: string,
): readonly MethodDecision[] {
  const inChain = all.filter((d) => d.chainId === chainId);
  if (inChain.length === 0) return [];
  // The root is the row whose id === chainId.
  const root = inChain.find((d) => d.id === chainId);
  if (!root) return [];
  // Walk forward from root: at each step, find the
  // decision whose `supersedes` points at the current
  // one. That's the *next* revision in the chain. The
  // walk is O(chainLength).
  const ordered: MethodDecision[] = [root];
  const visited = new Set<string>([root.id]);
  let currentId: string | undefined = root.id;
  while (currentId) {
    const next = inChain.find((d) => d.supersedes === currentId);
    if (!next || visited.has(next.id)) break;
    ordered.push(next);
    visited.add(next.id);
    currentId = next.id;
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Time helper
// ---------------------------------------------------------------------------

/** ISO timestamp at call time. Pure helper. Tests freeze `Date.now`. */
export function nowDesignIso(): string {
  return new Date().toISOString();
}
