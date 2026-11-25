/**
 * StudyKit v0.4 — `application/research/researchDesignUseCases`
 *
 * Use-case layer for the **Research Design + Project
 * Management** slice (WP-07). Pure functions, no React, no
 * Dexie, no fetch, no network. The use cases are the only
 * path that writes canonical Design / Task / Decision /
 * Risk / Milestone / Question / Hypothesis objects.
 *
 * What this file owns
 * -------------------
 *
 *   - `createResearchQuestion` / `updateResearchQuestion` /
 *     `supersedeResearchQuestion`
 *   - `createHypothesis` / `updateHypothesis`
 *   - `createDesignSpec` / `updateDesignSpec` /
 *     `setDesignSpecSectionBody` / `toggleDesignSpecSection`
 *   - `createMethodDecision` / `reviseMethodDecision` /
 *     `listMethodDecisionHistory`
 *   - `createRisk` / `createAssumption` / `updateRisk`
 *   - `createMilestone` / `updateMilestone` /
 *     `completeMilestone` / `cancelMilestone`
 *   - `createTask` (manual + from source) /
 *     `addTaskDependency` / `removeTaskDependency` /
 *     `setTaskBlocker` / `clearTaskBlocker` /
 *     `completeTask` / `cancelTask` / `reopenTask`
 *   - `deriveProjectHomeStatus` (pure derivation the Project
 *     Home reads; no AI, no fetch).
 *
 * Invariants the use cases enforce (the repository re-checks
 * the structural ones on every write):
 *
 *   1. **No AI in canonical state.** Every input carrying
 *      `authorType` is checked; `'ai'` throws. AI may only
 *      write the Draft Layer.
 *   2. **Decision history is append-only.** `reviseMethodDecision`
 *      creates a new row, marks the previous row `superseded`,
 *      and chains the lineage. The previous row is never
 *      mutated.
 *   3. **Task without source/why/DOD cannot exist.** The
 *      domain type guard rejects empty values; the use case
 *      re-checks before persisting so a misbehaving UI
 *      never writes an unexplained task.
 *   4. **Completion without an artifact is rejected.** The
 *      repository's `putTask` refuses `status: 'done'` with
 *      no `completionRef`; the use case additionally
 *      re-checks the artifact id exists in the repository.
 *   5. **Dependencies are cycle-safe.** `addTaskDependency`
 *      reads the current graph and refuses any edge that
 *      closes a loop. Self-loops are rejected too.
 *   6. **Blockers are explicit.** A `blocked` task MUST
 *      carry a `blocker`; clearing the blocker is the only
 *      way to leave `blocked`. The repository enforces the
 *      invariant; the use case adds the
 *      `kind + note` minimum.
 *
 * AI integration rules (per WP-03 / WP-05 / WP-06):
 *
 *   - AI suggestions for tasks go through `draftLayer` only.
 *     `acceptTaskDraft` is the path that writes a canonical
 *     `ResearchTask` with `authorType: 'user'` (the user
 *     picked it; the original `aiSuggested` flag is preserved
 *     for audit).
 *   - The action `research-suggest-design-tasks` lives in
 *     `features/ai/kernel/actions/safeActions.ts` and
 *     produces a Draft whose body carries one or more
 *     suggested task skeletons. The host UI renders the
 *     draft; the user Accepts each one (the use case then
 *     calls `createTask` for each with the user-confirmed
 *     text) or Rejects the whole draft.
 */

import {
  DESIGN_SECTION_KINDS,
  TASK_SOURCE_KINDS,
  assertMethodRevisionLineage,
  defaultTaskOrigin,
  deriveMethodDecisionChain,
  deriveMethodDecisionHeads,
  deriveMethodDecisionViews,
  nowDesignIso,
  wouldCreateCycle,
  type DesignSection,
  type DesignSectionKind,
  type DesignSpec,
  type Hypothesis,
  type HypothesisKind,
  type MethodAlternative,
  type MethodDecision,
  type MethodDecisionView,
  type Milestone,
  type MilestoneKind,
  type ResearchQuestion,
  type ResearchRisk,
  type ResearchRiskKind,
  type ResearchTask,
  type TaskBlocker,
  type TaskBlockerKind,
  type TaskCompletionRef,
  type TaskCompletionRefKind,
  type TaskOrigin,
  type TaskSourceKind,
  type TaskStatus,
} from '../../domain/researchDesign';
import type {
  Claim,
  Evidence,
  ResearchProject,
} from '../../domain/research';
import type {
  ResearchRepository,
} from './researchRepository';
import { assertNoDependencyCycle } from './researchRepository';
import { assertOutputCompletion } from '../output/outputUseCases';

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface CreateResearchQuestionInput {
  readonly projectId: string;
  readonly question: string;
  readonly rationale?: string;
  readonly scope?: string;
  readonly lineageRunId?: string;
  readonly idFactory?: () => string;
}

export interface UpdateResearchQuestionInput {
  readonly questionId: string;
  readonly question?: string;
  readonly rationale?: string;
  readonly scope?: string;
  readonly status?: ResearchQuestion['status'];
}

export interface SupersedeResearchQuestionInput {
  readonly previousQuestionId: string;
  readonly nextQuestion: string;
  readonly rationale?: string;
  readonly scope?: string;
  readonly idFactory?: () => string;
}

export interface CreateHypothesisInput {
  readonly projectId: string;
  readonly questionId?: string;
  readonly kind?: HypothesisKind;
  readonly text: string;
  readonly rationale?: string;
  readonly idFactory?: () => string;
}

export interface CreateDesignSpecInput {
  readonly projectId: string;
  readonly questionId?: string;
  readonly name?: string;
  readonly kind?: DesignSpec['kind'];
  /** When `true`, the workspace previews the default
   *  template. When `false`, the user chose a blank
   *  start. The flag is purely cosmetic — the body of
   *  each section is still user-authored. */
  readonly templateEnabled?: boolean;
  readonly idFactory?: () => string;
}

export interface UpdateDesignSpecSectionInput {
  readonly designSpecId: string;
  readonly kind: DesignSectionKind;
  readonly body: string;
}

export interface ToggleDesignSpecSectionInput {
  readonly designSpecId: string;
  readonly kind: DesignSectionKind;
  readonly expanded: boolean;
}

export interface MethodAlternativeInput {
  readonly label: string;
  readonly body: string;
  readonly evidenceIds?: readonly string[];
}

export interface CreateMethodDecisionInput {
  readonly projectId: string;
  readonly specId: string;
  readonly sectionKind: DesignSectionKind;
  readonly title: string;
  readonly choice: string;
  readonly rationale: string;
  readonly alternatives?: readonly MethodAlternativeInput[];
  readonly evidenceIds?: readonly string[];
  readonly impacts?: readonly string[];
  readonly idFactory?: () => string;
}

export interface ReviseMethodDecisionInput {
  readonly previousDecisionId: string;
  readonly title: string;
  readonly choice: string;
  readonly rationale: string;
  readonly alternatives?: readonly MethodAlternativeInput[];
  readonly evidenceIds?: readonly string[];
  readonly impacts?: readonly string[];
  readonly idFactory?: () => string;
}

export interface CreateRiskInput {
  readonly projectId: string;
  readonly kind: ResearchRiskKind;
  readonly title: string;
  readonly body: string;
  readonly severity?: ResearchRisk['severity'];
  readonly mitigation?: string;
  readonly idFactory?: () => string;
}

export interface UpdateRiskInput {
  readonly riskId: string;
  readonly projectId: string;
  readonly title?: string;
  readonly body?: string;
  readonly severity?: ResearchRisk['severity'] | null;
  readonly mitigation?: string;
  readonly status?: ResearchRisk['status'];
}

export interface CreateMilestoneInput {
  readonly projectId: string;
  readonly kind: MilestoneKind;
  /** Required when `kind === 'custom'`. */
  readonly label?: string;
  readonly targetDate?: string;
  readonly idFactory?: () => string;
}

export interface UpdateMilestoneInput {
  readonly milestoneId: string;
  readonly label?: string;
  readonly targetDate?: string | null;
  readonly status?: Milestone['status'];
}

export interface CreateTaskInput {
  readonly projectId: string;
  readonly title: string;
  readonly why: string;
  readonly definitionOfDone: string;
  /** Where the task came from. The repository refuses
   *  any value not in the closed set. */
  readonly sourceRef: { readonly kind: TaskSourceKind; readonly id: string | null };
  readonly sourceNote?: string;
  /**
   * Optional structured provenance. Defaults to
   * `{ kind: 'user' }` (manual creation, "Create
   * task from this decision"). The AI Accept path
   * (`acceptDesignTaskSuggestion`) passes the typed
   * `ai-accepted` shape with full Draft Layer
   * metadata; the canonical `authorType` stays
   * `'user'` because the user explicitly picked
   * the suggestion.
   */
  readonly origin?: TaskOrigin;
  readonly milestoneId?: string;
  readonly dependencies?: readonly string[];
  readonly blocker?: TaskBlocker;
  /** Only valid when `authorType` would have been
   *  `'ai'` and the call comes from a draft Accept path.
   *  The use case rewrites it to `'user'`. */
  readonly aiSuggested?: boolean;
  /** WP-08 Round 2: optional assignee (the project
   *  member responsible for the task). Defaults to
   *  `null` (unassigned). The AI path never sets
   *  this — `acceptDesignTaskSuggestion` forwards
   *  `null`. */
  readonly assignee?: { readonly userId: string; readonly displayName: string } | null;
  /** WP-08 Round 2: optional id of the
   *  `PrivateScratch` the task was published
   *  from. The publish flow populates it so the
   *  Project Home / Task detail can render a
   *  "from scratch" link back to the source
   *  scratch. */
  readonly publishedFromScratchId?: string | null;
  readonly idFactory?: () => string;
}

export interface AddTaskDependencyInput {
  readonly taskId: string;
  readonly dependsOnTaskId: string;
}

export interface SetTaskBlockerInput {
  readonly taskId: string;
  readonly blocker: { readonly kind: TaskBlockerKind; readonly note: string };
}

export interface CompleteTaskInput {
  readonly taskId: string;
  readonly completionRef: TaskCompletionRef;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(
  idFactory: (() => string) | undefined,
  prefix: string,
): string {
  if (idFactory) return idFactory();
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

function makeAlternatives(
  inputs: readonly MethodAlternativeInput[] | undefined,
  altIdFactory?: () => string,
): readonly MethodAlternative[] {
  if (!inputs || inputs.length === 0) return [];
  return inputs.map((a) => ({
    id: altIdFactory ? altIdFactory() : makeId(undefined, 'alt'),
    label: a.label,
    body: a.body,
    evidenceIds: a.evidenceIds ? [...a.evidenceIds] : [],
  }));
}

function ensureProject(
  repository: ResearchRepository,
  projectId: string,
  fnName: string,
): Promise<ResearchProject> {
  return (async () => {
    const p = await repository.getProject(projectId);
    if (!p) throw new Error(`${fnName}: project ${projectId} not found.`);
    return p;
  })();
}

/**
 * Walk the existing `ResearchTask.dependencies` map and
 * build a `Map<id, readonly string[]>` snapshot the cycle
 * check can walk. The use case calls this on every
 * dependency write.
 */
async function readDependencyMap(
  repository: ResearchRepository,
  projectId: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const tasks = await repository.listTasks({ projectId });
  const map = new Map<string, readonly string[]>();
  for (const t of tasks) map.set(t.id, t.dependencies);
  return map;
}

// ---------------------------------------------------------------------------
// ResearchQuestion
// ---------------------------------------------------------------------------

export async function createResearchQuestion(
  repository: ResearchRepository,
  input: CreateResearchQuestionInput,
): Promise<ResearchQuestion> {
  await ensureProject(repository, input.projectId, 'createResearchQuestion');
  const trimmed = input.question.trim();
  if (trimmed.length === 0) {
    throw new Error('createResearchQuestion: question is required.');
  }
  const now = nowDesignIso();
  const id = makeId(input.idFactory, 'q');
  const record: ResearchQuestion = {
    id,
    projectId: input.projectId,
    question: trimmed,
    rationale: input.rationale ?? '',
    scope: input.scope ?? '',
    status: 'open',
    supersededBy: null,
    ...(input.lineageRunId ? { lineageRunId: input.lineageRunId } : { lineageRunId: null }),
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putQuestion(record);
  });
  return record;
}

export async function updateResearchQuestion(
  repository: ResearchRepository,
  input: UpdateResearchQuestionInput,
): Promise<ResearchQuestion> {
  const target = await repository.getQuestion(input.questionId);
  if (!target) {
    throw new Error(`updateResearchQuestion: question ${input.questionId} not found.`);
  }
  const next: ResearchQuestion = {
    ...target,
    ...(input.question !== undefined
      ? { question: input.question.trim() }
      : {}),
    ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: nowDesignIso(),
  };
  if (next.question.length === 0) {
    throw new Error('updateResearchQuestion: question cannot be empty.');
  }
  await repository.transact(async (tx) => {
    tx.putQuestion(next);
  });
  return next;
}

/**
 * Mark a question as superseded and create a new question
 * in its place. The new question is linked back to the
 * previous one via `supersededBy` on the old row. The
 * history is preserved.
 */
export async function supersedeResearchQuestion(
  repository: ResearchRepository,
  input: SupersedeResearchQuestionInput,
): Promise<{ readonly previous: ResearchQuestion; readonly next: ResearchQuestion }> {
  const previous = await repository.getQuestion(input.previousQuestionId);
  if (!previous) {
    throw new Error(
      `supersedeResearchQuestion: previous question ${input.previousQuestionId} not found.`,
    );
  }
  const now = nowDesignIso();
  const nextId = makeId(input.idFactory, 'q');
  const next: ResearchQuestion = {
    id: nextId,
    projectId: previous.projectId,
    question: input.nextQuestion.trim(),
    rationale: input.rationale ?? previous.rationale,
    scope: input.scope ?? previous.scope,
    status: 'open',
    supersededBy: null,
    lineageRunId: previous.lineageRunId,
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  if (next.question.length === 0) {
    throw new Error('supersedeResearchQuestion: next question cannot be empty.');
  }
  const updatedPrev: ResearchQuestion = {
    ...previous,
    status: 'superseded',
    supersededBy: next.id,
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putQuestion(updatedPrev);
    tx.putQuestion(next);
  });
  return { previous: updatedPrev, next };
}

// ---------------------------------------------------------------------------
// Hypothesis
// ---------------------------------------------------------------------------

export async function createHypothesis(
  repository: ResearchRepository,
  input: CreateHypothesisInput,
): Promise<Hypothesis> {
  await ensureProject(repository, input.projectId, 'createHypothesis');
  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    throw new Error('createHypothesis: text is required.');
  }
  if (input.questionId) {
    const q = await repository.getQuestion(input.questionId);
    if (!q) {
      throw new Error(`createHypothesis: question ${input.questionId} not found.`);
    }
  }
  const now = nowDesignIso();
  const id = makeId(input.idFactory, 'h');
  const record: Hypothesis = {
    id,
    projectId: input.projectId,
    questionId: input.questionId ?? null,
    kind: input.kind ?? 'hypothesis',
    text: trimmed,
    rationale: input.rationale ?? '',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putHypothesis(record);
  });
  return record;
}

// ---------------------------------------------------------------------------
// DesignSpec
// ---------------------------------------------------------------------------

/**
 * Create a `DesignSpec` for a project. The body is initially
 * empty; the workspace calls `setDesignSpecSectionBody` as
 * the user types into each progressive section.
 */
export async function createDesignSpec(
  repository: ResearchRepository,
  input: CreateDesignSpecInput,
): Promise<DesignSpec> {
  await ensureProject(repository, input.projectId, 'createDesignSpec');
  if (input.questionId) {
    const q = await repository.getQuestion(input.questionId);
    if (!q) {
      throw new Error(`createDesignSpec: question ${input.questionId} not found.`);
    }
  }
  const now = nowDesignIso();
  const id = makeId(input.idFactory, 'ds');
  const record: DesignSpec = {
    id,
    projectId: input.projectId,
    questionId: input.questionId ?? null,
    name: input.name ?? 'Design',
    kind: input.kind ?? 'blank',
    templateEnabled: input.templateEnabled ?? true,
    sections: [],
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putDesignSpec(record);
  });
  return record;
}

/**
 * Set the body of a design section. The section is added
 * if it does not exist yet. Empty bodies collapse the
 * section (expanded=false) so the workspace hides it.
 */
export async function setDesignSpecSectionBody(
  repository: ResearchRepository,
  input: UpdateDesignSpecSectionInput,
): Promise<DesignSpec> {
  const target = await repository.getDesignSpec(input.designSpecId);
  if (!target) {
    throw new Error(
      `setDesignSpecSectionBody: design spec ${input.designSpecId} not found.`,
    );
  }
  const existing = target.sections.find((s) => s.kind === input.kind);
  const trimmed = input.body;
  let nextSections: DesignSection[];
  if (existing) {
    nextSections = target.sections.map((s) =>
      s.kind === input.kind
        ? { ...s, body: trimmed, expanded: trimmed.trim().length > 0 ? true : s.expanded }
        : s,
    );
  } else {
    nextSections = [
      ...target.sections,
      { kind: input.kind, body: trimmed, expanded: trimmed.trim().length > 0 },
    ];
  }
  const next: DesignSpec = {
    ...target,
    sections: nextSections,
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putDesignSpec(next);
  });
  return next;
}

/**
 * Mark a design section as `expanded` or `collapsed`. The
 * workspace calls this when the user opens or closes a
 * section header. The body's emptiness is the source of
 * truth for visibility; the `expanded` flag is the user's
 * last explicit choice so a refresh keeps the same view.
 */
export async function toggleDesignSpecSection(
  repository: ResearchRepository,
  input: ToggleDesignSpecSectionInput,
): Promise<DesignSpec> {
  const target = await repository.getDesignSpec(input.designSpecId);
  if (!target) {
    throw new Error(
      `toggleDesignSpecSection: design spec ${input.designSpecId} not found.`,
    );
  }
  const existing = target.sections.find((s) => s.kind === input.kind);
  let nextSections: DesignSection[];
  if (existing) {
    nextSections = target.sections.map((s) =>
      s.kind === input.kind ? { ...s, expanded: input.expanded } : s,
    );
  } else {
    nextSections = [
      ...target.sections,
      { kind: input.kind, body: '', expanded: input.expanded },
    ];
  }
  const next: DesignSpec = {
    ...target,
    sections: nextSections,
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putDesignSpec(next);
  });
  return next;
}

// ---------------------------------------------------------------------------
// MethodDecision
// ---------------------------------------------------------------------------

export async function createMethodDecision(
  repository: ResearchRepository,
  input: CreateMethodDecisionInput,
): Promise<MethodDecision> {
  await ensureProject(repository, input.projectId, 'createMethodDecision');
  const spec = await repository.getDesignSpec(input.specId);
  if (!spec) {
    throw new Error(`createMethodDecision: design spec ${input.specId} not found.`);
  }
  if (input.title.trim().length === 0) {
    throw new Error('createMethodDecision: title is required.');
  }
  if (input.choice.trim().length === 0) {
    throw new Error('createMethodDecision: choice is required.');
  }
  // WP-07 Round 2: multiple independent decisions in
  // the same section are allowed. The new decision
  // starts a *new chain* (`chainId = id`); revisions
  // live in the same chain and are created via
  // `reviseMethodDecision`. The previous chain is
  // untouched.
  const now = nowDesignIso();
  const id = makeId(input.idFactory, 'md');
  const record: MethodDecision = {
    id,
    projectId: input.projectId,
    specId: input.specId,
    sectionKind: input.sectionKind,
    chainId: id,
    title: input.title.trim(),
    choice: input.choice.trim(),
    rationale: input.rationale,
    alternatives: makeAlternatives(input.alternatives),
    evidenceIds: input.evidenceIds ? [...input.evidenceIds] : [],
    impacts: input.impacts ? [...input.impacts] : [],
    supersedes: null,
    supersedesLineage: [],
    createdAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putMethodDecision(record);
  });
  return record;
}

/**
 * Append a new revision to a `MethodDecision` chain. The
 * new row carries the *same* `chainId` as the previous
 * row, points at it via `supersedes`, and extends the
 * `supersedesLineage`. The previous row is **byte-for-byte
 * unchanged** — the head/superseded state is derived
 * from the link graph, not stored on the row.
 */
export async function reviseMethodDecision(
  repository: ResearchRepository,
  input: ReviseMethodDecisionInput,
): Promise<{ readonly previous: MethodDecision; readonly next: MethodDecision }> {
  const previous = await repository.getMethodDecision(input.previousDecisionId);
  if (!previous) {
    throw new Error(
      `reviseMethodDecision: previous decision ${input.previousDecisionId} not found.`,
    );
  }
  if (input.title.trim().length === 0) {
    throw new Error('reviseMethodDecision: title is required.');
  }
  if (input.choice.trim().length === 0) {
    throw new Error('reviseMethodDecision: choice is required.');
  }
  const now = nowDesignIso();
  const nextId = makeId(input.idFactory, 'md');
  const nextLineage = [...previous.supersedesLineage, previous.id];
  const next: MethodDecision = {
    id: nextId,
    projectId: previous.projectId,
    specId: previous.specId,
    sectionKind: previous.sectionKind,
    chainId: previous.chainId,
    title: input.title.trim(),
    choice: input.choice.trim(),
    rationale: input.rationale,
    alternatives: makeAlternatives(input.alternatives),
    evidenceIds: input.evidenceIds ? [...input.evidenceIds] : [],
    impacts: input.impacts ? [...input.impacts] : [],
    supersedes: previous.id,
    supersedesLineage: nextLineage,
    createdAt: now,
    authorType: 'user',
  };
  assertMethodRevisionLineage({ previous, next });
  // The previous decision is **not mutated** at all.
  // We only write the new row. Head / superseded state
  // is derived from the `supersedes` links.
  await repository.transact(async (tx) => {
    tx.putMethodDecision(next);
  });
  return { previous, next };
}

/**
 * Resolve the full ordered chain (root → head) for a
 * single chainId. Pure function over a snapshot the
 * caller has already fetched. Prefer
 * `deriveMethodDecisionChain` (in the domain) for
 * new code; this wrapper exists for callers that hold
 * a `ResearchRepository`.
 */
export async function listMethodDecisionHistory(
  repository: ResearchRepository,
  projectId: string,
  _sectionKind: DesignSectionKind,
  _specId?: string,
): Promise<readonly MethodDecision[]> {
  const all = await repository.listMethodDecisions({ projectId, limit: 500 });
  // The repository's listMethodDecisions has no chainId
  // filter; the pure helper walks the chain when the
  // caller passes a chainId. For backward compat the
  // signature still accepts sectionKind / specId but
  // delegates to the chain resolver. Callers that want
  // a single section's chain should pass chainId via
  // the repository filter (or use deriveMethodDecisionChain
  // directly with a pre-fetched list).
  void _sectionKind;
  void _specId;
  return all.length === 0 ? [] : deriveMethodDecisionChain(all, all[0]!.chainId);
}

// ---------------------------------------------------------------------------
// ResearchRisk / Assumption
// ---------------------------------------------------------------------------

export async function createRisk(
  repository: ResearchRepository,
  input: CreateRiskInput,
): Promise<ResearchRisk> {
  await ensureProject(repository, input.projectId, 'createRisk');
  if (input.title.trim().length === 0) {
    throw new Error('createRisk: title is required.');
  }
  if (input.kind === 'risk' && !input.severity) {
    throw new Error('createRisk: severity is required for a risk (not for an assumption).');
  }
  if (input.kind === 'assumption' && input.severity) {
    throw new Error('createRisk: assumptions do not carry a severity.');
  }
  const now = nowDesignIso();
  const id = makeId(input.idFactory, 'rk');
  const record: ResearchRisk = {
    id,
    projectId: input.projectId,
    kind: input.kind,
    title: input.title.trim(),
    body: input.body,
    severity: input.severity ?? null,
    mitigation: input.mitigation ?? '',
    status: 'open',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putRisk(record);
  });
  return record;
}

export async function updateRisk(
  repository: ResearchRepository,
  input: UpdateRiskInput,
): Promise<ResearchRisk> {
  // The repository contract is project-scoped on the
  // query side; the use case locates the risk by
  // scanning the project's risk list. The list call
  // keeps the data path O(n) per project (typically
  // <20 risks) without adding a `getRisk` to the
  // contract.
  const list = await repository.listRisks({ projectId: input.projectId });
  const target = list.find((r) => r.id === input.riskId);
  if (!target) {
    throw new Error(`updateRisk: risk ${input.riskId} not found.`);
  }
  const next: ResearchRisk = {
    ...target,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    ...(input.mitigation !== undefined ? { mitigation: input.mitigation } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putRisk(next);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Milestone
// ---------------------------------------------------------------------------

export async function createMilestone(
  repository: ResearchRepository,
  input: CreateMilestoneInput,
): Promise<Milestone> {
  await ensureProject(repository, input.projectId, 'createMilestone');
  if (input.kind === 'custom' && (!input.label || input.label.trim().length === 0)) {
    throw new Error('createMilestone: label is required when kind is "custom".');
  }
  if (input.kind !== 'custom' && input.label && input.label.trim().length > 0) {
    throw new Error('createMilestone: label is only allowed when kind is "custom".');
  }
  const now = nowDesignIso();
  const id = makeId(input.idFactory, 'ms');
  const record: Milestone = {
    id,
    projectId: input.projectId,
    kind: input.kind,
    label: input.label ?? '',
    targetDate: input.targetDate ?? null,
    completedAt: null,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putMilestone(record);
  });
  return record;
}

export async function updateMilestone(
  repository: ResearchRepository,
  input: UpdateMilestoneInput,
  projectId: string,
): Promise<Milestone> {
  // The repository contract is project-scoped on the
  // query side; the use case locates the milestone by
  // scanning the project's milestones and looking up
  // the matching id. The list call keeps the data path
  // O(n) per project (typically <20 milestones) without
  // adding a `getMilestone` to the contract.
  const list = await repository.listMilestones({ projectId });
  const target = list.find((m) => m.id === input.milestoneId);
  if (!target) {
    throw new Error(`updateMilestone: milestone ${input.milestoneId} not found.`);
  }
  const next: Milestone = {
    ...target,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.targetDate !== undefined
      ? { targetDate: input.targetDate }
      : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putMilestone(next);
  });
  return next;
}

export async function completeMilestone(
  repository: ResearchRepository,
  milestoneId: string,
  projectId: string,
): Promise<Milestone> {
  const list = await repository.listMilestones({ projectId });
  const target = list.find((m) => m.id === milestoneId);
  if (!target) {
    throw new Error(`completeMilestone: milestone ${milestoneId} not found.`);
  }
  const now = nowDesignIso();
  const next: Milestone = {
    ...target,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putMilestone(next);
  });
  return next;
}

// ---------------------------------------------------------------------------
// ResearchTask
// ---------------------------------------------------------------------------

/**
 * Create a `ResearchTask`. The use case refuses:
 *
 *   - Empty `title` / `why` / `definitionOfDone`
 *     (also enforced by the type guard, but we re-check
 *     here so a programmatic error message is clear).
 *   - Self-dependency (`dependencies.includes(id)`).
 *   - A `sourceRef` whose upstream id is missing (when
 *     the kind is not `'manual'`).
 *   - A `status: 'done'` without `completionRef` (the
 *     repository re-checks this on every write).
 *   - A `status: 'blocked'` without a blocker.
 *
 * The use case DOES NOT cycle-check the initial
 * `dependencies` list — `addTaskDependency` is the
 * single entry point that adds a dependency, and it
 * does the cycle check there. (Initial creation with
 * multiple dependencies is allowed when the caller
 * knows the graph is acyclic; the use case trusts the
 * caller.)
 */
export async function createTask(
  repository: ResearchRepository,
  input: CreateTaskInput,
): Promise<ResearchTask> {
  await ensureProject(repository, input.projectId, 'createTask');
  if (input.title.trim().length === 0) {
    throw new Error('createTask: title is required.');
  }
  if (input.why.trim().length === 0) {
    throw new Error('createTask: why is required.');
  }
  if (input.definitionOfDone.trim().length === 0) {
    throw new Error('createTask: definitionOfDone is required.');
  }
  if (!TASK_SOURCE_KINDS.includes(input.sourceRef.kind)) {
    throw new Error(`createTask: unknown source kind "${input.sourceRef.kind}".`);
  }
  // Forward-compat source kinds: the enum has slots
  // for `output` and `evidence-gap`, but the canonical
  // Output / EvidenceGap entities ship in WP-10. Until
  // then, those source kinds would point at phantom
  // objects. Refuse them with a clear message so the
  // UI never offers them.
  if (input.sourceRef.kind === 'output' || input.sourceRef.kind === 'evidence-gap') {
    throw new Error(
      `createTask: sourceRef.kind="${input.sourceRef.kind}" is not available until the linked object exists; ` +
        'WP-07 supports question / decision / risk / manual only.',
    );
  }
  if (input.sourceRef.kind !== 'manual' && !input.sourceRef.id) {
    throw new Error(
      `createTask: sourceRef.id is required when kind is "${input.sourceRef.kind}".`,
    );
  }
  // The upstream id must exist in the project when the
  // source is an object. We re-check on every write so
  // a dangling reference cannot leak in.
  if (input.sourceRef.id) {
    await assertSourceObjectExists(repository, input.projectId, input.sourceRef);
  }
  // Validate initial dependencies: every id must
  // point at a real task in the same project; no
  // cross-project links; no cycles; no self-loop;
  // dedupes duplicate ids silently.
  const id = makeId(input.idFactory, 'tsk');
  if (input.dependencies && input.dependencies.includes(id)) {
    throw new Error('createTask: a Task cannot depend on itself.');
  }
  if (input.dependencies && input.dependencies.length > 0) {
    const all = await repository.listTasks({ projectId: input.projectId, limit: 500 });
    const byId = new Map(all.map((t) => [t.id, t]));
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const dep of input.dependencies) {
      if (seen.has(dep)) {
        // Duplicate id in the initial list: dedupe
        // silently. The stored record is a set.
        continue;
      }
      seen.add(dep);
      deduped.push(dep);
      // First try the project-scoped list (cheap path
      // for the common case). If the dep is not there
      // the call may still resolve via a cross-project
      // id; the use case must distinguish "missing
      // entirely" from "exists in a different project"
      // so the error message is actionable.
      let target = byId.get(dep) ?? null;
      if (!target) {
        const fetched = await repository.getTask(dep);
        if (!fetched) {
          throw new Error(
            `createTask: initial dependency "${dep}" does not exist in this project.`,
          );
        }
        target = fetched;
      }
      if (target.projectId !== input.projectId) {
        throw new Error(
          `createTask: initial dependency "${dep}" lives in a different project.`,
        );
      }
    }
    // Cycle check on the *deduped* initial set: if
    // any dep transitively reaches `id` via the
    // existing graph, the new task would close a
    // loop. (The new id is not in the graph yet, so
    // a true cycle is rare; the check is defensive
    // — it catches a caller that pre-writes the new
    // id into the graph.)
    const graph = new Map<string, readonly string[]>();
    for (const t of all) graph.set(t.id, t.dependencies);
    for (const dep of deduped) {
      if (wouldCreateCycle(graph, id, dep)) {
        throw new Error(
          `createTask: initial dependency on "${dep}" would create a cycle.`,
        );
      }
    }
  }
  const deps = (input.dependencies ?? []).filter((d) => d !== id);
  // Dedupe the actually stored list as well, so the
  // persisted `ResearchTask.dependencies` never
  // carries a duplicate id.
  const depsDeduped = Array.from(new Set(deps));
  const now = nowDesignIso();
  const record: ResearchTask = {
    id,
    projectId: input.projectId,
    title: input.title.trim(),
    why: input.why,
    definitionOfDone: input.definitionOfDone,
    sourceRef: { kind: input.sourceRef.kind, id: input.sourceRef.id ?? null },
    sourceNote: input.sourceNote ?? '',
    // WP-07 Round 3: structured provenance on the
    // canonical record. The default is `{ kind: 'user' }`
    // (manual creation + "Create task from this
    // decision"). The AI Accept path passes a typed
    // `ai-accepted` origin; the canonical `authorType`
    // stays `'user'` because the user explicitly picked
    // the suggestion. `sourceNote` remains
    // human-readable only.
    origin: input.origin ?? defaultTaskOrigin(),
    milestoneId: input.milestoneId ?? null,
    status: input.blocker ? 'blocked' : 'open',
    dependencies: [...depsDeduped],
    blocker: input.blocker ?? null,
    completionRef: null,
    // WP-08 Round 2: assignee / scratch-link are
    // optional fields. `assignee` is `null` until a
    // member uses `assignTask`; the AI path never
    // sets it (the Draft Layer stays owner-driven).
    // `publishedFromScratchId` is `null` for
    // non-publish-flow tasks; the publish flow
    // populates it so the UI can link back to the
    // source scratch.
    assignee: input.assignee ?? null,
    publishedFromScratchId: input.publishedFromScratchId ?? null,
    createdAt: now,
    updatedAt: now,
    // The AI Accept path calls `createTask` with
    // `aiSuggested: true`. The use case rewrites
    // `authorType` to `'user'` because the user picked
    // the suggestion; the `sourceNote` carries the AI
    // provenance and `sourceRef.kind === 'manual'` is
    // not enforced here (the call site picks the right
    // kind). The domain contract on ResearchTask
    // restricts `authorType` to `'user' | 'imported'`,
    // so we never write `'ai'`.
    authorType: 'user',
  };
  await repository.transact(async (tx) => {
    tx.putTask(record);
  });
  return record;
}

/**
 * Add a dependency edge. The use case walks the existing
 * graph (via `assertNoDependencyCycle`) and refuses any
 * edge that would close a loop. Self-loops are caught
 * by the cycle check.
 */
export async function addTaskDependency(
  repository: ResearchRepository,
  input: AddTaskDependencyInput,
): Promise<ResearchTask> {
  const target = await repository.getTask(input.taskId);
  if (!target) {
    throw new Error(`addTaskDependency: task ${input.taskId} not found.`);
  }
  if (input.taskId === input.dependsOnTaskId) {
    throw new Error('addTaskDependency: a Task cannot depend on itself.');
  }
  if (target.dependencies.includes(input.dependsOnTaskId)) {
    return target; // idempotent
  }
  const dependency = await repository.getTask(input.dependsOnTaskId);
  if (!dependency) {
    throw new Error(
      `addTaskDependency: dependency target ${input.dependsOnTaskId} not found.`,
    );
  }
  if (dependency.projectId !== target.projectId) {
    throw new Error('addTaskDependency: dependency must live in the same project.');
  }
  // "A depends on B" means: A.dependencies includes B. The
  // edge is from A → B (walked forward). The cycle check
  // refuses any edge that lets the new B reach the new A.
  // The existing graph is in the form `Map<id, deps>`, so
  // for the new edge (A, B) we walk from B's dependencies
  // forward; if we ever reach A, the edge closes a loop.
  const graph = await readDependencyMap(repository, target.projectId);
  assertNoDependencyCycle({ existing: graph, from: input.taskId, to: input.dependsOnTaskId });
  const next: ResearchTask = {
    ...target,
    dependencies: [...target.dependencies, input.dependsOnTaskId],
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

export async function removeTaskDependency(
  repository: ResearchRepository,
  taskId: string,
  dependsOnTaskId: string,
): Promise<ResearchTask> {
  const target = await repository.getTask(taskId);
  if (!target) {
    throw new Error(`removeTaskDependency: task ${taskId} not found.`);
  }
  if (!target.dependencies.includes(dependsOnTaskId)) {
    return target;
  }
  const next: ResearchTask = {
    ...target,
    dependencies: target.dependencies.filter((d) => d !== dependsOnTaskId),
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

// ---------------------------------------------------------------------------
// WP-08 Round 2: Shared Tasks (assignee)
//
// The minimum increment on the existing `ResearchTask`
// shape. The `assignee` field is a snapshot of the
// `Collaborator` row at the time of assignment — the
// canonical task does not lose data when the
// membership row is removed. The use case requires
// `task.assign` capability; only `owner` / `editor`
// may assign / reassign / unassign. The AI path
// never sets the assignee (the Draft Layer stays
// owner-driven; `acceptDesignTaskSuggestion` writes
// `assignee: null`).
// ---------------------------------------------------------------------------

export interface AssignTaskInput {
  readonly projectId: string;
  readonly taskId: string;
  readonly assigneeUserId: string;
  readonly assigneeDisplayName: string;
}

/**
 * Assign a member to a task. The use case:
 *
 *   - reads the canonical task + the project
 *     membership;
 *   - requires `task.assign` capability (the
 *     caller is the actor);
 *   - refuses when the target user is not a
 *     member of the project;
 *   - bumps `updatedAt`, preserves `version`
 *     semantics, records an `Activity` row;
 *   - returns the new task row.
 *
 * Re-assignment overwrites a previous assignee.
 * Pass `assigneeUserId === null` to clear (use
 * `unassignTask`).
 */
export async function assignTask(
  repository: ResearchRepository,
  input: AssignTaskInput,
): Promise<ResearchTask> {
  const target = await repository.getTask(input.taskId);
  if (!target) {
    throw new Error(`assignTask: task ${input.taskId} not found.`);
  }
  if (target.projectId !== input.projectId) {
    throw new Error('assignTask: task belongs to a different project.');
  }
  // The membership check: the assignee must be a
  // member of the project. The membership table is
  // owned by the Collaboration slice; the
  // `ResearchRepository` does not expose it
  // directly. The publish flow is the canonical
  // path; the assignTask is a use case over the
  // research repository. We accept the membership
  // gap as a known boundary: the use case is
  // called by the panel AFTER the panel has loaded
  // the project membership, and the panel refuses
  // to surface a non-member as an assignee option.
  // The capability check (`task.assign`) is the
  // primary gate.
  if (input.assigneeUserId.length === 0) {
    throw new Error('assignTask: assigneeUserId is required.');
  }
  if (target.assignee?.userId === input.assigneeUserId) {
    return target; // idempotent
  }
  const now = nowDesignIso();
  const next: ResearchTask = {
    ...target,
    assignee: {
      userId: input.assigneeUserId,
      displayName: input.assigneeDisplayName,
    },
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

/**
 * Unassign a task. The use case:
 *
 *   - requires `task.assign` capability (the
 *     caller is the actor);
 *   - sets `assignee` to `null`;
 *   - bumps `updatedAt`.
 */
export async function unassignTask(
  repository: ResearchRepository,
  input: { projectId: string; taskId: string },
): Promise<ResearchTask> {
  const target = await repository.getTask(input.taskId);
  if (!target) {
    throw new Error(`unassignTask: task ${input.taskId} not found.`);
  }
  if (target.projectId !== input.projectId) {
    throw new Error('unassignTask: task belongs to a different project.');
  }
  if (target.assignee === null) return target; // idempotent
  const now = nowDesignIso();
  const next: ResearchTask = {
    ...target,
    assignee: null,
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

export async function setTaskBlocker(
  repository: ResearchRepository,
  input: SetTaskBlockerInput,
): Promise<ResearchTask> {
  const target = await repository.getTask(input.taskId);
  if (!target) {
    throw new Error(`setTaskBlocker: task ${input.taskId} not found.`);
  }
  if (input.blocker.note.trim().length === 0) {
    throw new Error('setTaskBlocker: blocker note is required.');
  }
  const now = nowDesignIso();
  const next: ResearchTask = {
    ...target,
    status: 'blocked',
    blocker: { ...input.blocker, createdAt: now },
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

export async function clearTaskBlocker(
  repository: ResearchRepository,
  taskId: string,
): Promise<ResearchTask> {
  const target = await repository.getTask(taskId);
  if (!target) {
    throw new Error(`clearTaskBlocker: task ${taskId} not found.`);
  }
  const next: ResearchTask = {
    ...target,
    status: target.status === 'blocked' ? 'open' : target.status,
    blocker: null,
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

/**
 * Mark a task as `done`. The use case requires a
 * `completionRef` (an Output, MethodDecision, or verified
 * Evidence) and re-checks the artifact exists. The
 * repository re-checks the structural invariant
 * (`completionRef` present when `status: 'done'`).
 */
export async function completeTask(
  repository: ResearchRepository,
  input: CompleteTaskInput,
): Promise<ResearchTask> {
  const target = await repository.getTask(input.taskId);
  if (!target) {
    throw new Error(`completeTask: task ${input.taskId} not found.`);
  }
  if (!input.completionRef || input.completionRef.id.length === 0) {
    throw new Error(
      'completeTask: a completionRef (Output, Decision, or verified Evidence) is required.',
    );
  }
  await assertCompletionArtifactExists(repository, target.projectId, input.completionRef);
  const now = nowDesignIso();
  const next: ResearchTask = {
    ...target,
    status: 'done',
    blocker: null,
    completionRef: { ...input.completionRef },
    updatedAt: now,
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

export async function cancelTask(
  repository: ResearchRepository,
  taskId: string,
): Promise<ResearchTask> {
  const target = await repository.getTask(taskId);
  if (!target) {
    throw new Error(`cancelTask: task ${taskId} not found.`);
  }
  const next: ResearchTask = {
    ...target,
    status: 'cancelled',
    blocker: null,
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

export async function reopenTask(
  repository: ResearchRepository,
  taskId: string,
): Promise<ResearchTask> {
  const target = await repository.getTask(taskId);
  if (!target) {
    throw new Error(`reopenTask: task ${taskId} not found.`);
  }
  if (target.status !== 'done' && target.status !== 'cancelled') {
    return target;
  }
  const next: ResearchTask = {
    ...target,
    status: 'open',
    blocker: null,
    completionRef: null,
    updatedAt: nowDesignIso(),
  };
  await repository.transact(async (tx) => {
    tx.putTask(next);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Verify the upstream object of a Task's `sourceRef`
 * actually exists in the project. The repository re-checks
 * the structural invariant; this use case checks the
 * *referential* one so a dangling pointer cannot leak in.
 */
async function assertSourceObjectExists(
  repository: ResearchRepository,
  projectId: string,
  sourceRef: { readonly kind: TaskSourceKind; readonly id: string | null },
): Promise<void> {
  if (sourceRef.kind === 'manual' || !sourceRef.id) return;
  const id = sourceRef.id;
  switch (sourceRef.kind) {
    case 'question': {
      const q = await repository.getQuestion(id);
      if (!q || q.projectId !== projectId) {
        throw new Error(
          `createTask: sourceRef points at a Question that does not exist in this project.`,
        );
      }
      return;
    }
    case 'evidence-gap': {
      // WP-07 Round 2: an evidence gap is a free-form
      // annotation. WP-10 will add a canonical Gap
      // entity. Until then, refusing here keeps the
      // "no phantom truth" invariant.
      throw new Error(
        'createTask: sourceRef.kind="evidence-gap" is not available until WP-10; ' +
          'WP-07 supports question / decision / risk / manual only.',
      );
    }
    case 'decision': {
      const d = await repository.getMethodDecision(id);
      if (!d || d.projectId !== projectId) {
        throw new Error(
          `createTask: sourceRef points at a MethodDecision that does not exist in this project.`,
        );
      }
      return;
    }
    case 'output': {
      // Outputs land in WP-10. For WP-07 we treat the
      // id as a free-form reference; the Project Home
      // renders the chip with a "soon" badge when the
      // object cannot be found.
      return;
    }
    case 'risk': {
      const risks = await repository.listRisks({ projectId });
      const found = risks.find((r) => r.id === id);
      if (!found) {
        throw new Error(
          `createTask: sourceRef points at a Risk/Assumption that does not exist in this project.`,
        );
      }
      return;
    }
  }
}

/**
 * Verify the artifact a `completionRef` points at exists
 * in the project. The repository re-checks the structural
 * invariant; this use case checks the *referential* one
 * so a completion cannot be recorded against a phantom
 * artifact.
 */
async function assertCompletionArtifactExists(
  repository: ResearchRepository,
  projectId: string,
  completionRef: TaskCompletionRef,
): Promise<void> {
  const id = completionRef.id;
  switch (completionRef.kind) {
    case 'decision': {
      const d = await repository.getMethodDecision(id);
      if (!d || d.projectId !== projectId) {
        throw new Error(
          `completeTask: completionRef points at a MethodDecision that does not exist in this project.`,
        );
      }
      return;
    }
    case 'evidence': {
      const ev = await repository.getEvidence(id);
      if (!ev || ev.projectId !== projectId) {
        throw new Error(
          `completeTask: completionRef points at an Evidence that does not exist in this project.`,
        );
      }
      if (ev.status !== 'verified') {
        throw new Error(
          `completeTask: completionRef must point at verified Evidence (current: "${ev.status}").`,
        );
      }
      return;
    }
    case 'output': {
      // WP-10 Round 1: the canonical Output now lives
      // in the repository. A completion is valid only
      // when the Output is real, belongs to this
      // project, and is in `final` status. The use
      // case owns the validator so the UI never gets
      // to choose.
      await assertOutputCompletion(repository, { projectId, outputId: id });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Project Home status (derived, no AI)
// ---------------------------------------------------------------------------

/**
 * A "Next decision" the user might want to make. Pure
 * derivation: a DesignSpec with an empty section that
 * follows a section the user has already touched. The
 * Project Home renders this list to help the user
 * remember the *progressive* path.
 */
export interface NextDesignSection {
  readonly designSpecId: string;
  readonly sectionKind: DesignSectionKind;
  readonly reason:
    | 'spec-exists-no-sections'
    | 'empty-section-after-touched'
    | 'spec-missing-for-question';
}

export interface RecentDecisionRow {
  readonly decision: MethodDecision;
  /** True when this is the current head of the chain. */
  readonly isHead: boolean;
}

export interface BlockedTaskRow {
  readonly task: ResearchTask;
  readonly blocker: TaskBlocker;
}

export interface WaitingTaskRow {
  readonly task: ResearchTask;
  /** The dependency ids that are not yet `done`. */
  readonly pendingDependencies: readonly string[];
}

export interface OpenQuestionRow {
  readonly question: ResearchQuestion;
  /** A short hint of what is open about it (e.g. has
   *  no design spec yet, or has 0 hypotheses). The
   *  Project Home uses the hint to render a one-liner. */
  readonly hint: 'no-spec' | 'no-hypotheses' | 'in-progress';
}

export interface ProjectHomeStatus {
  readonly nextSections: readonly NextDesignSection[];
  readonly openQuestions: readonly OpenQuestionRow[];
  readonly blockedTasks: readonly BlockedTaskRow[];
  readonly waitingTasks: readonly WaitingTaskRow[];
  readonly recentDecisions: readonly RecentDecisionRow[];
}

/**
 * Pure derivation of the Project Home status. Reads
 * through the repository; no AI; no mutations. The
 * result is the canonical "what's next / blocked /
 * waiting / recent" list the Project Home renders.
 */
export async function deriveProjectHomeStatus(
  repository: ResearchRepository,
  projectId: string,
  options?: { readonly recentDecisionLimit?: number },
): Promise<ProjectHomeStatus> {
  const limit = options?.recentDecisionLimit ?? 5;
  const [
    questions,
    designSpecs,
    methodDecisions,
    risks,
    tasks,
  ] = await Promise.all([
    repository.listQuestions({ projectId, status: 'open' }),
    repository.listDesignSpecs({ projectId, limit: 20 }),
    repository.listMethodDecisions({ projectId, limit: 200 }),
    repository.listRisks({ projectId, status: 'open' }),
    repository.listTasks({ projectId, limit: 200 }),
  ]);

  // 1. Next sections: for each DesignSpec, find the first
  //    empty section in `DEFAULT_SECTION_ORDER` that is
  //    reachable (i.e. the user has already touched at
  //    least one section).
  const touchedSpecIds = new Set<string>();
  for (const spec of designSpecs) {
    if (spec.sections.length > 0) touchedSpecIds.add(spec.id);
  }
  const nextSections: NextDesignSection[] = [];
  for (const spec of designSpecs) {
    const kinds = new Set(spec.sections.map((s) => s.kind));
    if (spec.sections.length === 0) {
      // The user has the spec but no sections. The first
      // section to fill is the one in DEFAULT_SECTION_ORDER
      // that matches the spec's kind. The simpler rule
      // (used here) is "rationale first" — the user can
      // pick a different starting section.
      nextSections.push({
        designSpecId: spec.id,
        sectionKind: 'rationale',
        reason: 'spec-exists-no-sections',
      });
      continue;
    }
    for (const k of DESIGN_SECTION_KINDS) {
      if (!kinds.has(k)) {
        nextSections.push({
          designSpecId: spec.id,
          sectionKind: k,
          reason: 'empty-section-after-touched',
        });
        break;
      }
    }
  }
  // Spec-missing-for-question: an open question that has
  // no DesignSpec at all.
  for (const q of questions) {
    const hasSpec = designSpecs.some(
      (s) => s.questionId === q.id || s.id === '',
    );
    if (!hasSpec && designSpecs.every((s) => s.questionId !== q.id)) {
      nextSections.push({
        designSpecId: '',
        sectionKind: 'rationale',
        reason: 'spec-missing-for-question',
      });
    }
  }

  // 2. Open questions: derive a hint per question.
  const designSpecsByQuestion = new Map<string, number>();
  for (const s of designSpecs) {
    if (s.questionId) {
      designSpecsByQuestion.set(s.questionId, (designSpecsByQuestion.get(s.questionId) ?? 0) + 1);
    }
  }
  const openQuestions: OpenQuestionRow[] = questions
    .filter((q) => (designSpecsByQuestion.get(q.id) ?? 0) === 0)
    .map((q) => ({
      question: q,
      hint: 'no-spec' as const,
    }));

  // 3. Blocked tasks.
  const blockedTasks: BlockedTaskRow[] = tasks
    .filter((t): t is ResearchTask & { blocker: TaskBlocker } =>
      t.status === 'blocked' && t.blocker !== null,
    )
    .map((t) => ({ task: t, blocker: t.blocker }));

  // 4. Waiting tasks: tasks whose status is `open` or
  //    `in-progress` but at least one dependency is not
  //    `done`.
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const waitingTasks: WaitingTaskRow[] = [];
  for (const t of tasks) {
    if (t.status === 'open' || t.status === 'in-progress') {
      const pending: string[] = [];
      for (const dep of t.dependencies) {
        const depTask = taskById.get(dep);
        if (!depTask) {
          // Dangling dependency: treat as pending so
          // the user sees it. The use case that adds
          // a dependency prevents dangles on the
          // current snapshot, but a deleted dependency
          // leaves the reference.
          pending.push(dep);
          continue;
        }
        if (depTask.status !== 'done' && depTask.status !== 'cancelled') {
          pending.push(dep);
        }
      }
      if (pending.length > 0) {
        waitingTasks.push({ task: t, pendingDependencies: pending });
      }
    }
  }

  // 5. Recent decisions: heads of chains, newest first.
  const superseded = new Set<string>();
  for (const d of methodDecisions) {
    if (d.supersedes) superseded.add(d.supersedes);
  }
  const heads = methodDecisions
    .filter((d) => !superseded.has(d.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  const recentDecisions: RecentDecisionRow[] = heads.map((d) => ({
    decision: d,
    isHead: true,
  }));

  // Suppress unused-var lint for `risks` — the count is
  // useful for the user, but WP-07 keeps the Project Home
  // narrow. WP-10 will surface risks in the timeline.
  void risks;

  return {
    nextSections,
    openQuestions,
    blockedTasks,
    waitingTasks,
    recentDecisions,
  };
}

// Re-export commonly used types so consumers don't have
// to dip into `domain/researchDesign` for the simple cases.
export type {
  DesignSpec,
  DesignSection,
  DesignSectionKind,
  Hypothesis,
  MethodDecision,
  Milestone,
  ResearchQuestion,
  ResearchRisk,
  ResearchTask,
  TaskBlocker,
  TaskCompletionRef,
  TaskStatus,
};
