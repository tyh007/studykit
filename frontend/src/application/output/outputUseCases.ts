/**
 * StudyKit v0.4 — `application/output/outputUseCases`
 *
 * Pure use cases for the Evidence-backed Output slice
 * (WP-10 Round 1). Each function:
 *
 *   - validates the input against the repository
 *     (project / output / section / statement
 *     ownership);
 *   - uses the domain guard so a buggy caller cannot
 *     slip a malformed record past the boundary;
 *   - reads the repository first, then writes inside
 *     a single `transact` so a mid-write failure does
 *     not leave the canonical store half-committed;
 *   - accepts an optional `clock` + `idFactory` so
 *     tests are deterministic;
 *   - never imports Dexie, SQLite, the HTTP client,
 *     React, or a component. The UI calls into these
 *     use cases through `useResearchDeps()` (the same
 *     `ResearchRepository` injection point every
 *     Research use case uses).
 *
 * Invariants (enforced here, *not* in the UI):
 *
 *   1. AI text never reaches the canonical
 *      `OutputStatement` directly — the Draft Layer is
 *      the only path. `addStatement` refuses
 *      `authorType: 'ai'`.
 *   2. `createOutput` rejects `status: 'final'`
 *      authored by AI. Final status is a user-only
 *      action.
 *   3. `attachSupport` looks up the canonical Claim /
 *      Evidence and refuses if the lookup fails, the
 *      projectId mismatches, the Claim is not
 *      `canonical`, or the Evidence is not `verified`.
 *      The repository's `putStatementSupport`
 *      additionally rejects duplicate
 *      `(statementId, ref.kind, ref.id, relation)`
 *      tuples inside the same transaction (so the use
 *      case is idempotent-safe at the boundary).
 *   4. `deleteOutput` cascades: the supports,
 *      statements, sections, then the output itself
 *      all leave the canonical store in one
 *      transaction. `deleteSection` does NOT cascade
 *      to other sections of the same output, but it
 *      DOES cascade to statements and supports
 *      within that section (same rule).
 *   5. The audit is **derived** — `auditStatement`
 *      and `auditOutput` return an in-memory object,
 *      not a persisted row.
 */

import type { Claim, Evidence } from '../../domain/research';
import {
  nowIso,
  type OutputAuthorType,
  type OutputDocument,
  type OutputSection,
  type OutputStatement,
  type StatementAudit,
  type StatementRef,
  type StatementSupport,
  type SupportRelation,
  auditOutput as auditOutputDomain,
  auditStatement as auditStatementDomain,
  stableSectionOrder,
  stableStatementOrder,
} from '../../domain/output';
import type { ResearchRepository } from '../research/researchRepository';

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface OutputUseCaseDeps {
  /** Deterministic timestamp generator. Defaults to `nowIso`. */
  readonly clock?: () => string;
  /** Deterministic id generator. Defaults to a `prefix`-prefixed random. */
  readonly idFactory?: (prefix: string) => string;
}

export interface CreateOutputInput {
  readonly projectId: string;
  readonly title: string;
  readonly authorType?: OutputAuthorType;
  readonly status?: OutputDocument['status'];
}

export interface RenameOutputInput {
  readonly outputId: string;
  readonly title: string;
}

export interface AddSectionInput {
  readonly outputId: string;
  readonly title: string;
}

export interface ReorderSectionsInput {
  readonly outputId: string;
  readonly sectionIdsInOrder: readonly string[];
}

export interface AddStatementInput {
  readonly sectionId: string;
  readonly body: string;
  readonly authorType?: OutputAuthorType;
  readonly status?: OutputStatement['status'];
}

export interface UpdateStatementInput {
  readonly statementId: string;
  readonly body: string;
}

export interface ReorderStatementsInput {
  readonly sectionId: string;
  readonly statementIdsInOrder: readonly string[];
}

export interface AttachSupportInput {
  readonly statementId: string;
  readonly ref: StatementRef;
  readonly relation: SupportRelation;
  readonly authorType?: OutputAuthorType;
}

export interface RemoveSupportInput {
  readonly supportId: string;
}

export interface DeleteOutputInput {
  readonly outputId: string;
}

export interface DeleteSectionInput {
  readonly sectionId: string;
}

export interface AuditStatementInput {
  readonly statementId: string;
}

export interface AuditOutputInput {
  readonly outputId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(
  idFactory: ((prefix: string) => string) | undefined,
  prefix: string,
): string {
  if (idFactory) return idFactory(prefix);
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

function clock(deps: OutputUseCaseDeps | undefined): string {
  return deps?.clock?.() ?? nowIso();
}

function nextOrder(max: number): number {
  if (!Number.isFinite(max) || max < 0) return 0;
  return Math.floor(max) + 1;
}

// ---------------------------------------------------------------------------
// createOutput
// ---------------------------------------------------------------------------

export async function createOutput(
  repository: ResearchRepository,
  input: CreateOutputInput,
  deps?: OutputUseCaseDeps,
): Promise<OutputDocument> {
  const project = await repository.getProject(input.projectId);
  if (!project) {
    throw new Error(`createOutput: project ${input.projectId} not found.`);
  }
  if (!input.title.trim()) {
    throw new Error('createOutput: title is required.');
  }
  const authorType: OutputAuthorType = input.authorType ?? 'user';
  const status: OutputDocument['status'] = input.status ?? 'outline';
  if (authorType === 'ai' && status === 'final') {
    throw new Error(
      'createOutput: an AI-authored Output cannot start in "final" status.',
    );
  }
  const ts = clock(deps);
  const record: OutputDocument = {
    id: makeId(deps?.idFactory, 'out'),
    projectId: input.projectId,
    title: input.title.trim(),
    status,
    authorType,
    createdAt: ts,
    updatedAt: ts,
  };
  await repository.transact(async (tx) => {
    tx.putOutput(record);
  });
  return record;
}

// ---------------------------------------------------------------------------
// renameOutput / setOutputStatus
// ---------------------------------------------------------------------------

export async function renameOutput(
  repository: ResearchRepository,
  input: RenameOutputInput,
  deps?: OutputUseCaseDeps,
): Promise<OutputDocument> {
  const target = await repository.getOutput(input.outputId);
  if (!target) {
    throw new Error(`renameOutput: output ${input.outputId} not found.`);
  }
  if (!input.title.trim()) {
    throw new Error('renameOutput: title is required.');
  }
  const next: OutputDocument = {
    ...target,
    title: input.title.trim(),
    updatedAt: clock(deps),
  };
  await repository.transact(async (tx) => {
    tx.putOutput(next);
  });
  return next;
}

/**
 * Update the status of an Output. Marking `final` is
 * only legal when the author is a user (the audit at
 * the boundary catches AI authors claiming `final`).
 */
export async function setOutputStatus(
  repository: ResearchRepository,
  input: { readonly outputId: string; readonly status: OutputDocument['status'] },
  deps?: OutputUseCaseDeps,
): Promise<OutputDocument> {
  const target = await repository.getOutput(input.outputId);
  if (!target) {
    throw new Error(`setOutputStatus: output ${input.outputId} not found.`);
  }
  if (target.authorType === 'ai' && input.status === 'final') {
    throw new Error(
      'setOutputStatus: an AI-authored Output cannot transition to "final" status.',
    );
  }
  const next: OutputDocument = {
    ...target,
    status: input.status,
    updatedAt: clock(deps),
  };
  await repository.transact(async (tx) => {
    tx.putOutput(next);
  });
  return next;
}

// ---------------------------------------------------------------------------
// addSection / reorderSections / deleteSection
// ---------------------------------------------------------------------------

export async function addSection(
  repository: ResearchRepository,
  input: AddSectionInput,
  deps?: OutputUseCaseDeps,
): Promise<OutputSection> {
  const output = await repository.getOutput(input.outputId);
  if (!output) {
    throw new Error(`addSection: output ${input.outputId} not found.`);
  }
  if (!input.title.trim()) {
    throw new Error('addSection: title is required.');
  }
  const existing = await repository.listOutputSections({ outputId: input.outputId });
  const maxOrder = existing.reduce((m, s) => (s.order > m ? s.order : m), -1);
  const ts = clock(deps);
  const record: OutputSection = {
    id: makeId(deps?.idFactory, 'osec'),
    projectId: output.projectId,
    outputId: input.outputId,
    title: input.title.trim(),
    order: nextOrder(maxOrder),
    createdAt: ts,
    updatedAt: ts,
  };
  await repository.transact(async (tx) => {
    tx.putOutputSection(record);
  });
  return record;
}

export async function reorderSections(
  repository: ResearchRepository,
  input: ReorderSectionsInput,
  deps?: OutputUseCaseDeps,
): Promise<readonly OutputSection[]> {
  const output = await repository.getOutput(input.outputId);
  if (!output) {
    throw new Error(`reorderSections: output ${input.outputId} not found.`);
  }
  const existing = await repository.listOutputSections({ outputId: input.outputId });
  const existingIds = new Set(existing.map((s) => s.id));
  // Validate that every provided id is a real section
  // of this output. We also require the list to be
  // exactly the same set — a reorder is a permutation,
  // not an additive change.
  if (input.sectionIdsInOrder.length !== existing.length) {
    throw new Error(
      `reorderSections: expected ${existing.length} sections, got ${input.sectionIdsInOrder.length}.`,
    );
  }
  if (new Set(input.sectionIdsInOrder).size !== input.sectionIdsInOrder.length) {
    throw new Error('reorderSections: section ids must form a permutation without duplicates.');
  }
  for (const id of input.sectionIdsInOrder) {
    if (!existingIds.has(id)) {
      throw new Error(`reorderSections: section ${id} does not belong to this output.`);
    }
  }
  const ts = clock(deps);
  const updates: OutputSection[] = input.sectionIdsInOrder.map((id, idx) => {
    const cur = existing.find((s) => s.id === id);
    if (!cur) {
      throw new Error(`reorderSections: missing section ${id}.`);
    }
    return { ...cur, order: idx, updatedAt: ts };
  });
  await repository.transact(async (tx) => {
    for (const s of updates) tx.putOutputSection(s);
  });
  return stableSectionOrder(updates);
}

export async function deleteSection(
  repository: ResearchRepository,
  input: DeleteSectionInput,
): Promise<void> {
  const section = await repository.getOutputSection(input.sectionId);
  if (!section) {
    throw new Error(`deleteSection: section ${input.sectionId} not found.`);
  }
  // Cascade to the section's statements and their
  // supports. Sibling sections of the same output are
  // untouched (the cascade is *scope-bounded*).
  const statements = await repository.listOutputStatements({ sectionId: section.id });
  const statementIds = new Set(statements.map((s) => s.id));
  const supports = await repository.listStatementSupports({ outputId: section.outputId });
  const citations = await repository.listStatementCitations({ outputId: section.outputId });
  await repository.transact(async (tx) => {
    for (const citation of citations) {
      if (statementIds.has(citation.statementId)) tx.deleteStatementCitation(citation.id);
    }
    for (const s of supports) {
      if (statementIds.has(s.statementId)) {
        tx.deleteStatementSupport(s.id);
      }
    }
    for (const stmt of statements) {
      tx.deleteOutputStatement(stmt.id);
    }
    tx.deleteOutputSection(section.id);
  });
}

// ---------------------------------------------------------------------------
// addStatement / updateStatement / reorderStatements
// ---------------------------------------------------------------------------

export async function addStatement(
  repository: ResearchRepository,
  input: AddStatementInput,
  deps?: OutputUseCaseDeps,
): Promise<OutputStatement> {
  const section = await repository.getOutputSection(input.sectionId);
  if (!section) {
    throw new Error(`addStatement: section ${input.sectionId} not found.`);
  }
  const body = input.body.trim();
  if (body.length === 0) {
    throw new Error('addStatement: body cannot be empty.');
  }
  const authorType: OutputAuthorType = input.authorType ?? 'user';
  if (authorType === 'ai') {
    throw new Error(
      'addStatement: authorType="ai" is not allowed; AI text lives in the Draft Layer.',
    );
  }
  const status: OutputStatement['status'] = input.status ?? 'draft';
  const existing = await repository.listOutputStatements({ sectionId: section.id });
  const maxOrder = existing.reduce((m, s) => (s.order > m ? s.order : m), -1);
  const ts = clock(deps);
  const record: OutputStatement = {
    id: makeId(deps?.idFactory, 'ost'),
    projectId: section.projectId,
    outputId: section.outputId,
    sectionId: section.id,
    body,
    order: nextOrder(maxOrder),
    authorType,
    status,
    createdAt: ts,
    updatedAt: ts,
  };
  await repository.transact(async (tx) => {
    tx.putOutputStatement(record);
  });
  return record;
}

export async function updateStatement(
  repository: ResearchRepository,
  input: UpdateStatementInput,
  deps?: OutputUseCaseDeps,
): Promise<OutputStatement> {
  const target = await repository.getOutputStatement(input.statementId);
  if (!target) {
    throw new Error(`updateStatement: statement ${input.statementId} not found.`);
  }
  const body = input.body.trim();
  if (body.length === 0) {
    throw new Error('updateStatement: body cannot be empty.');
  }
  const next: OutputStatement = { ...target, body, updatedAt: clock(deps) };
  await repository.transact(async (tx) => {
    tx.putOutputStatement(next);
  });
  return next;
}

export async function reorderStatements(
  repository: ResearchRepository,
  input: ReorderStatementsInput,
  deps?: OutputUseCaseDeps,
): Promise<readonly OutputStatement[]> {
  const section = await repository.getOutputSection(input.sectionId);
  if (!section) {
    throw new Error(`reorderStatements: section ${input.sectionId} not found.`);
  }
  const existing = await repository.listOutputStatements({ sectionId: section.id });
  const existingIds = new Set(existing.map((s) => s.id));
  if (input.statementIdsInOrder.length !== existing.length) {
    throw new Error(
      `reorderStatements: expected ${existing.length} statements, got ${input.statementIdsInOrder.length}.`,
    );
  }
  if (
    new Set(input.statementIdsInOrder).size !== input.statementIdsInOrder.length
  ) {
    throw new Error(
      'reorderStatements: statement ids must form a permutation without duplicates.',
    );
  }
  for (const id of input.statementIdsInOrder) {
    if (!existingIds.has(id)) {
      throw new Error(
        `reorderStatements: statement ${id} does not belong to this section.`,
      );
    }
  }
  const ts = clock(deps);
  const updates: OutputStatement[] = input.statementIdsInOrder.map((id, idx) => {
    const cur = existing.find((s) => s.id === id);
    if (!cur) {
      throw new Error(`reorderStatements: missing statement ${id}.`);
    }
    return { ...cur, order: idx, updatedAt: ts };
  });
  await repository.transact(async (tx) => {
    for (const s of updates) tx.putOutputStatement(s);
  });
  return stableStatementOrder(updates);
}

export async function deleteStatement(
  repository: ResearchRepository,
  input: { readonly statementId: string },
): Promise<void> {
  const target = await repository.getOutputStatement(input.statementId);
  if (!target) {
    throw new Error(`deleteStatement: statement ${input.statementId} not found.`);
  }
  const supports = await repository.listStatementSupports({ statementId: target.id });
  const citations = await repository.listStatementCitations({ statementId: target.id });
  await repository.transact(async (tx) => {
    for (const citation of citations) tx.deleteStatementCitation(citation.id);
    for (const s of supports) {
      tx.deleteStatementSupport(s.id);
    }
    tx.deleteOutputStatement(target.id);
  });
}

// ---------------------------------------------------------------------------
// attachSupport / removeSupport
// ---------------------------------------------------------------------------

export async function attachSupport(
  repository: ResearchRepository,
  input: AttachSupportInput,
  deps?: OutputUseCaseDeps,
): Promise<StatementSupport> {
  const statement = await repository.getOutputStatement(input.statementId);
  if (!statement) {
    throw new Error(`attachSupport: statement ${input.statementId} not found.`);
  }
  // Validate the ref is a real, project-scoped,
  // status-correct canonical object. We refuse BEFORE
  // touching the repository so a failure leaves the
  // store unchanged.
  if (input.ref.kind === 'claim') {
    const claim = await repository.getClaim(input.ref.id);
    if (!claim) {
      throw new Error(
        `attachSupport: claim ${input.ref.id} not found.`,
      );
    }
    if (claim.projectId !== statement.projectId) {
      throw new Error(
        'attachSupport: claim belongs to a different project.',
      );
    }
    if (claim.status !== 'canonical') {
      throw new Error(
        `attachSupport: claim ${input.ref.id} is not canonical; only canonical claims can be linked.`,
      );
    }
  } else {
    const evidence = await repository.getEvidence(input.ref.id);
    if (!evidence) {
      throw new Error(
        `attachSupport: evidence ${input.ref.id} not found.`,
      );
    }
    if (evidence.projectId !== statement.projectId) {
      throw new Error(
        'attachSupport: evidence belongs to a different project.',
      );
    }
    if (evidence.status !== 'verified') {
      throw new Error(
        `attachSupport: evidence ${input.ref.id} is not verified; only verified evidence can be linked.`,
      );
    }
  }
  const authorType: OutputAuthorType = input.authorType ?? 'user';
  const ts = clock(deps);
  const record: StatementSupport = {
    id: makeId(deps?.idFactory, 'sup'),
    projectId: statement.projectId,
    outputId: statement.outputId,
    statementId: statement.id,
    ref: input.ref,
    relation: input.relation,
    authorType,
    createdAt: ts,
    updatedAt: ts,
  };
  await repository.transact(async (tx) => {
    tx.putStatementSupport(record);
  });
  return record;
}

export async function removeSupport(
  repository: ResearchRepository,
  input: RemoveSupportInput,
): Promise<void> {
  await repository.transact(async (tx) => {
    tx.deleteStatementSupport(input.supportId);
  });
}

// ---------------------------------------------------------------------------
// auditStatement / auditOutput
// ---------------------------------------------------------------------------

function buildLookups(
  claims: readonly Claim[],
  evidence: readonly Evidence[],
): {
  readonly claims: Map<string, { readonly id: string; readonly projectId: string; readonly status: string }>;
  readonly evidence: Map<string, { readonly id: string; readonly projectId: string; readonly status: string }>;
} {
  const claimMap = new Map<string, { id: string; projectId: string; status: string }>();
  for (const c of claims) {
    claimMap.set(c.id, c);
  }
  const evidenceMap = new Map<string, { id: string; projectId: string; status: string }>();
  for (const e of evidence) {
    evidenceMap.set(e.id, e);
  }
  return { claims: claimMap, evidence: evidenceMap };
}

export async function auditStatement(
  repository: ResearchRepository,
  input: AuditStatementInput,
): Promise<StatementAudit> {
  const statement = await repository.getOutputStatement(input.statementId);
  if (!statement) {
    throw new Error(
      `auditStatement: statement ${input.statementId} not found.`,
    );
  }
  const supports = await repository.listStatementSupports({ statementId: statement.id });
  const claims = await repository.listClaims({ projectId: statement.projectId });
  const evidence = await repository.listEvidence({ projectId: statement.projectId });
  return auditStatementDomain({
    statement: { id: statement.id, projectId: statement.projectId },
    supports,
    lookups: buildLookups(claims, evidence),
  });
}

export async function auditOutput(
  repository: ResearchRepository,
  input: AuditOutputInput,
): Promise<{
  readonly outputId: string;
  readonly overall: StatementAudit['state'];
  readonly byStatement: ReadonlyMap<string, StatementAudit>;
}> {
  const output = await repository.getOutput(input.outputId);
  if (!output) {
    throw new Error(`auditOutput: output ${input.outputId} not found.`);
  }
  const statements = await repository.listOutputStatements({ outputId: output.id });
  const supports = await repository.listStatementSupports({ outputId: output.id });
  const claims = await repository.listClaims({ projectId: output.projectId });
  const evidence = await repository.listEvidence({ projectId: output.projectId });
  const audited = auditOutputDomain({
    output: { id: output.id, projectId: output.projectId },
    statements,
    supports,
    lookups: buildLookups(claims, evidence),
  });
  return { outputId: output.id, ...audited };
}

// ---------------------------------------------------------------------------
// deleteOutput
// ---------------------------------------------------------------------------

export async function deleteOutput(
  repository: ResearchRepository,
  input: DeleteOutputInput,
): Promise<void> {
  const output = await repository.getOutput(input.outputId);
  if (!output) {
    throw new Error(`deleteOutput: output ${input.outputId} not found.`);
  }
  // Cascade: supports → statements → sections →
  // output, in one transaction. Sibling outputs of the
  // same project are untouched.
  const statements = await repository.listOutputStatements({ outputId: output.id });
  const sections = await repository.listOutputSections({ outputId: output.id });
  const supports = await repository.listStatementSupports({ outputId: output.id });
  const citations = await repository.listStatementCitations({ outputId: output.id });
  await repository.transact(async (tx) => {
    for (const citation of citations) tx.deleteStatementCitation(citation.id);
    for (const s of supports) {
      tx.deleteStatementSupport(s.id);
    }
    for (const stmt of statements) {
      tx.deleteOutputStatement(stmt.id);
    }
    for (const sec of sections) {
      tx.deleteOutputSection(sec.id);
    }
    tx.deleteOutput(output.id);
  });
}

// ---------------------------------------------------------------------------
// Completion validator (used by `completeTask`)
// ---------------------------------------------------------------------------

/**
 * Validate a `completionRef.kind = 'output'`
 * reference. The repository's `getOutput` is the
 * single source of truth — there is no parallel
 * "phantom Output" registry.
 */
export async function assertOutputCompletion(
  repository: ResearchRepository,
  args: { readonly projectId: string; readonly outputId: string },
): Promise<OutputDocument> {
  const output = await repository.getOutput(args.outputId);
  if (!output) {
    throw new Error(
      `completionRef.kind="output" references a non-existent Output (${args.outputId}).`,
    );
  }
  if (output.projectId !== args.projectId) {
    throw new Error(
      `completionRef.kind="output" points at an Output in project ${output.projectId}, not ${args.projectId}.`,
    );
  }
  if (output.status !== 'final') {
    throw new Error(
      `completionRef.kind="output" requires the Output to be "final" (currently "${output.status}").`,
    );
  }
  return output;
}
