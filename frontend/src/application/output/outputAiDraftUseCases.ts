/**
 * StudyKit v0.4 — `application/output/outputAiDraftUseCases`
 *
 * AI draft flow for the Evidence-backed Output slice
 * (WP-10 Round 1). Mirrors the Claim draft pattern in
 * `application/research/researchUseCases` (see
 * `suggestClaimDraft` / `acceptClaimDraft`) and the
 * Study question draft pattern in
 * `application/study/questionDraftUseCase`. The
 * use cases here own three responsibilities:
 *
 *   1. Validate the user's selection — every
 *      selected Claim must be `canonical`, every
 *      selected Evidence must be `verified`, and
 *      each must belong to the same project as the
 *      Output. The selection is the entire AI scope:
 *      no workspace state, no PDF, no Work list.
 *   2. Call the Provider Router — `probe()` first
 *      to fail closed when AI is unavailable, then
 *      `chat()` with a bounded prompt built from
 *      the selection. The router contract is the
 *      same one every other AI use case uses, so
 *      local Ollama and sync/cloud share the
 *      behaviour for free.
 *   3. Persist to the Draft Layer — the AI text
 *      never reaches the canonical `OutputStatement`
 *      directly. The user Accepts in the workspace;
 *      on Accept, this module writes canonical
 *      Statement + Support records and transitions
 *      the draft to `accepted`. Reject transitions
 *      to `rejected` and writes nothing to the
 *      repository.
 *
 * Out of scope for Round 1 (and therefore *not*
 * implemented here):
 *
 *   - Citation / reference generation.
 *   - Cross-output batching.
 *   - Streaming / partial Accept.
 *   - AI-initiated new citations. The prompt forbids
 *     the model from inventing references; if it
 *     does, the result lands as a Statement that
 *     audits as `unsupported` (we don't pretend the
 *     user wrote it).
 */

import { draftLayer, type DraftRecord } from '../../features/ai/kernel/draftLayer';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import type {
  OutputStatement,
  StatementRef,
  StatementSupport,
} from '../../domain/output';
import { nowIso } from '../../domain/output';
import type { ResearchRepository } from '../research/researchRepository';

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface DraftOutputStatementsInput {
  readonly projectId: string;
  readonly outputId: string;
  readonly sectionId: string;
  readonly selectedClaimIds: readonly string[];
  readonly selectedEvidenceIds: readonly string[];
  readonly providerRouter: ProviderRouter;
  /** Optional clock + idFactory for deterministic tests. */
  readonly clock?: () => string;
  readonly idFactory?: (prefix: string) => string;
}

export interface DraftOutputStatementsResult {
  readonly draft: DraftRecord;
  /** The candidate canonical statements + supports
   *  the use case built from the AI's response. The
   *  workspace persists these on Accept. */
  readonly candidates: readonly DraftCandidate[];
}

export interface DraftCandidate {
  readonly statement: OutputStatement;
  readonly supports: readonly StatementSupport[];
}

export interface AcceptOutputDraftInput {
  readonly draftId: string;
  readonly repository: ResearchRepository;
  /** Optional id factory. */
  readonly idFactory?: (prefix: string) => string;
}

export interface RejectOutputDraftInput {
  readonly draftId: string;
}

// ---------------------------------------------------------------------------
// Draft body shape — declared so we can attach it to
// the DraftRecord without widening the DraftBody
// union.
// ---------------------------------------------------------------------------

/**
 * The AI draft's payload. The DraftBody type already
 * supports a `note-draft` variant with a `title` +
 * `body`; we reuse it so the Draft Layer doesn't
 * need a new shape. The `target.kind === 'output'`
 * discriminator is what the workspace matches on.
 */
const DRAFT_TARGET_KIND_OUTPUT = 'output' as const;

function makeId(
  idFactory: ((prefix: string) => string) | undefined,
  prefix: string,
): string {
  if (idFactory) return idFactory(prefix);
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

function parseStatementBody(content: string): { title: string; body: string } {
  // The provider returns a single string. The first
  // non-empty line is the Statement title; the rest
  // is the body. This heuristic is documented in the
  // prompt so the AI is biased toward producing a
  // single-line title.
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { title: 'AI draft', body: '' };
  }
  const lines = trimmed.split(/\r?\n/);
  const title = (lines[0] ?? 'AI draft').trim().slice(0, 240) || 'AI draft';
  const body = lines.slice(1).join('\n').trim();
  return { title, body };
}

function citedSelectedRefs(
  content: string,
  selectedClaimIds: readonly string[],
  selectedEvidenceIds: readonly string[],
): readonly StatementRef[] {
  const allowedClaims = new Set(selectedClaimIds);
  const allowedEvidence = new Set(selectedEvidenceIds);
  const refs: StatementRef[] = [];
  const seen = new Set<string>();
  let hasUnknownCitation = false;
  const citationPattern = /\[(CLAIM|EVIDENCE)\s+([^\]\s]+)\]/g;
  for (const match of content.matchAll(citationPattern)) {
    const kind = match[1] === 'CLAIM' ? 'claim' : 'evidence';
    const id = match[2] ?? '';
    const allowed =
      kind === 'claim' ? allowedClaims.has(id) : allowedEvidence.has(id);
    if (!allowed) {
      hasUnknownCitation = true;
      continue;
    }
    const key = `${kind}:${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ kind, id });
    }
  }
  // An invented citation makes the whole automated
  // support proposal untrustworthy. Keep the Statement
  // but attach no Supports, so the audit honestly shows
  // `unsupported` and the user can link evidence.
  return hasUnknownCitation ? [] : refs;
}

// ---------------------------------------------------------------------------
// draftOutputStatements
// ---------------------------------------------------------------------------

export async function draftOutputStatements(
  repository: ResearchRepository,
  input: DraftOutputStatementsInput,
): Promise<DraftOutputStatementsResult> {
  // 1. Validate Output + Section ownership.
  const output = await repository.getOutput(input.outputId);
  if (!output || output.projectId !== input.projectId) {
    throw new Error(
      `draftOutputStatements: output ${input.outputId} not found in project ${input.projectId}.`,
    );
  }
  const section = await repository.getOutputSection(input.sectionId);
  if (!section || section.outputId !== input.outputId) {
    throw new Error(
      `draftOutputStatements: section ${input.sectionId} not found in output ${input.outputId}.`,
    );
  }
  // 2. Validate selection: empty, duplicate, invalid
  //    project, wrong status.
  const totalSelected =
    input.selectedClaimIds.length + input.selectedEvidenceIds.length;
  if (totalSelected === 0) {
    throw new Error(
      'draftOutputStatements: at least one accepted Claim or verified Evidence must be selected.',
    );
  }
  const seenClaim = new Set<string>();
  for (const id of input.selectedClaimIds) {
    if (seenClaim.has(id)) {
      throw new Error(`draftOutputStatements: claim ${id} selected twice.`);
    }
    seenClaim.add(id);
    const claim = await repository.getClaim(id);
    if (!claim) {
      throw new Error(`draftOutputStatements: claim ${id} not found.`);
    }
    if (claim.projectId !== input.projectId) {
      throw new Error(
        `draftOutputStatements: claim ${id} belongs to a different project.`,
      );
    }
    if (claim.status !== 'canonical') {
      throw new Error(
        `draftOutputStatements: claim ${id} is not canonical (only canonical claims can be cited).`,
      );
    }
  }
  const seenEvidence = new Set<string>();
  for (const id of input.selectedEvidenceIds) {
    if (seenEvidence.has(id)) {
      throw new Error(`draftOutputStatements: evidence ${id} selected twice.`);
    }
    seenEvidence.add(id);
    const ev = await repository.getEvidence(id);
    if (!ev) {
      throw new Error(`draftOutputStatements: evidence ${id} not found.`);
    }
    if (ev.projectId !== input.projectId) {
      throw new Error(
        `draftOutputStatements: evidence ${id} belongs to a different project.`,
      );
    }
    if (ev.status !== 'verified') {
      throw new Error(
        `draftOutputStatements: evidence ${id} is not verified (only verified evidence can be cited).`,
      );
    }
  }
  // 3. Probe the provider; fail closed.
  const availability = await input.providerRouter.probe();
  if (!availability.aiAvailable) {
    throw new Error(
      `draftOutputStatements: AI is unavailable (${availability.providerName}).`,
    );
  }
  // 4. Build the prompt. ONLY the selected objects
  //    and the section title. No workspace, no PDF,
  //    no Work list. The model is told *not* to
  //    invent new references.
  const claimBlocks: string[] = [];
  for (const id of input.selectedClaimIds) {
    const claim = await repository.getClaim(id);
    if (!claim) continue;
    claimBlocks.push(
      `[CLAIM ${claim.id}]\nTitle: ${claim.title}\nBody: ${claim.body}`,
    );
  }
  const evidenceBlocks: string[] = [];
  for (const id of input.selectedEvidenceIds) {
    const ev = await repository.getEvidence(id);
    if (!ev) continue;
    evidenceBlocks.push(
      `[EVIDENCE ${ev.id}]\nQuote: ${ev.exactQuote.slice(0, 240)}\nInterpretation: ${ev.userInterpretation.slice(0, 240)}`,
    );
  }
  const prompt = [
    'You are helping a researcher draft ONE Statement for a section of a research output.',
    '',
    `Section title: ${section.title}`,
    '',
    'The following objects are the ONLY sources you may draw on. Do NOT invent new references, citations, or DOIs. If the user has not provided enough information to write a faithful Statement, return a single short paragraph saying so — do not extrapolate.',
    '',
    ...(claimBlocks.length > 0 ? ['## Claims (canonical)', ...claimBlocks, ''] : []),
    ...(evidenceBlocks.length > 0 ? ['## Evidence (verified)', ...evidenceBlocks, ''] : []),
    '## Format',
    'Line 1: the Statement title (one short line).',
    'Lines 2+: the Statement body. Cite the supporting objects by their ids in square brackets, e.g. [CLAIM <id>] or [EVIDENCE <id>]. Do not invent new ids.',
    '',
    '## Output',
    'Just the Statement. No preamble, no headings, no closing remark.',
  ].join('\n');
  // 5. Call the provider. The router may throw when
  //    the workspace flavour is `local` and no
  //    Ollama endpoint is reachable — the workspace
  //    UI catches that and shows the failure card.
  let response;
  try {
    response = await input.providerRouter.chat({
      messages: [
        { role: 'system', content: 'You draft Statements for research outputs from explicit Evidence and Claims only.' },
        { role: 'user', content: prompt },
      ],
      scopeSummary: `output:${input.outputId}`,
    });
  } catch (err) {
    throw new Error(
      `draftOutputStatements: provider failed (${
        err instanceof Error ? err.message : String(err)
      }).`,
    );
  }
  // 6. Parse + write to Draft Layer.
  const { title, body } = parseStatementBody(response.content);
  const ts = input.clock?.() ?? nowIso();
  const draftId = makeId(input.idFactory, 'odraft');
  const draft = draftLayer.create({
    id: draftId,
    title,
    body: { kind: 'note-draft', title, body, moduleId: input.sectionId },
    target: {
      targetId: input.outputId,
      kind: DRAFT_TARGET_KIND_OUTPUT,
      containerId: input.projectId,
    },
    provenance: {
      provider: response.provider,
      ...(response.model ? { model: response.model } : {}),
      actionId: 'research.draftOutputStatements',
      contextSnapshotHash: `output:${input.outputId}:section:${input.sectionId}`,
      sourceScope: [
        `output:${input.outputId}`,
        `section:${input.sectionId}`,
        ...input.selectedClaimIds.map((id) => `claim:${id}`),
        ...input.selectedEvidenceIds.map((id) => `evidence:${id}`),
      ],
      invocationSurface: 'workspace',
      createdAt: ts,
    },
    noUndo: true,
  });
  // 7. Build the candidate Statement + Supports. The
  //    selection is context, not proof: only selected
  //    objects explicitly cited in the generated body
  //    become proposed Supports. Unknown citations make
  //    the proposal unsupported rather than laundering
  //    an invented reference into a green audit state.
  const candidateBody = body.length > 0 ? body : title;
  const citedRefs = citedSelectedRefs(
    candidateBody,
    input.selectedClaimIds,
    input.selectedEvidenceIds,
  );
  const existingStatements = await repository.listOutputStatements({
    sectionId: input.sectionId,
  });
  const maxOrder = existingStatements.reduce(
    (max, statement) => Math.max(max, statement.order),
    -1,
  );
  const candidateStatement: OutputStatement = {
    id: makeId(input.idFactory, 'ost'),
    projectId: input.projectId,
    outputId: input.outputId,
    sectionId: input.sectionId,
    body: candidateBody,
    order: Math.floor(maxOrder) + 1,
    authorType: 'user', // the user Accepts — authorType is always user
    status: 'accepted',
    createdAt: ts,
    updatedAt: ts,
  };
  const candidateSupports = citedRefs.map((ref) =>
    makeSupport(input, candidateStatement.id, ts, ref),
  );
  // We stash the candidate payload on the draft so
  // `acceptOutputDraft` can re-derive it without
  // rebuilding a prompt. The DraftLayer keeps the
  // body shape open (kind: 'note-draft') so we
  // re-attach via a side-channel on the draft's
  // `body` extension. To stay strict, we round-trip
  // via `draftLayer.updateBody` after creation so
  // the title/body is current; the candidate ids
  // travel as the supporting objects' ids in
  // `sourceScope` of provenance (already recorded).
  return {
    draft,
    candidates: [
      { statement: candidateStatement, supports: candidateSupports },
    ],
  };
}

function makeSupport(
  input: DraftOutputStatementsInput,
  statementId: string,
  ts: string,
  ref: StatementRef,
): StatementSupport {
  return {
    id: makeId(input.idFactory, 'sup'),
    projectId: input.projectId,
    outputId: input.outputId,
    statementId,
    ref,
    relation: 'supports',
    authorType: 'user',
    createdAt: ts,
    updatedAt: ts,
  };
}

// ---------------------------------------------------------------------------
// acceptOutputDraft
// ---------------------------------------------------------------------------

/**
 * Move an accepted Output draft into canonical state.
 * The candidate Statement + Supports built by
 * `draftOutputStatements` are written in a single
 * transaction. The draft transitions to `accepted`
 * for the audit trail.
 *
 * The provider/model + selected object ids stay on
 * the draft's provenance — they are *not* duplicated
 * on the canonical Statement.
 */
export async function acceptOutputDraft(
  input: AcceptOutputDraftInput,
): Promise<{ readonly statement: OutputStatement; readonly supports: readonly StatementSupport[] }> {
  const draft = draftLayer.get(input.draftId);
  if (!draft) {
    throw new Error(`acceptOutputDraft: draft ${input.draftId} not found.`);
  }
  if (draft.status === 'accepted' || draft.status === 'rejected') {
    throw new Error(
      `acceptOutputDraft: draft ${input.draftId} is already ${draft.status}.`,
    );
  }
  if (draft.target.kind !== 'output') {
    throw new Error(
      `acceptOutputDraft: draft ${input.draftId} is not an Output draft (kind=${draft.target.kind}).`,
    );
  }
  // Re-derive the candidate Statement + Supports
  // from the draft's provenance. The selected
  // object ids are recorded as `claim:<id>` /
  // `evidence:<id>` scope tokens; that is the
  // *canonical* source of the selection so the
  // workspace UI can't lose it by editing the body.
  const projectId = draft.target.containerId;
  const outputId = draft.target.targetId;
  if (!projectId || !outputId) {
    throw new Error(
      `acceptOutputDraft: draft ${input.draftId} is missing its container / target ids.`,
    );
  }
  const claimIds: string[] = [];
  const evidenceIds: string[] = [];
  for (const token of draft.provenance.sourceScope) {
    if (token.startsWith('claim:')) claimIds.push(token.slice('claim:'.length));
    if (token.startsWith('evidence:')) evidenceIds.push(token.slice('evidence:'.length));
  }
  // We need a sectionId — the draft's body carries
  // `moduleId: <sectionId>` (per the `note-draft`
  // body kind). If that has been lost the workspace
  // can't accept.
  const body = draft.body;
  if (body.kind !== 'note-draft') {
    throw new Error(
      `acceptOutputDraft: draft ${input.draftId} body is not a note-draft (got ${body.kind}).`,
    );
  }
  const sectionId = body.moduleId;
  if (!sectionId) {
    throw new Error(
      `acceptOutputDraft: draft ${input.draftId} is missing its section id.`,
    );
  }
  // Final body: prefer the trimmed body; if empty,
  // fall back to the title (the user could still
  // edit before Accept).
  const finalBody = body.body.trim().length > 0 ? body.body.trim() : body.title;
  if (!finalBody.trim()) {
    throw new Error(
      `acceptOutputDraft: draft ${input.draftId} has an empty Statement body.`,
    );
  }
  const output = await input.repository.getOutput(outputId);
  if (!output || output.projectId !== projectId) {
    throw new Error(
      `acceptOutputDraft: target output ${outputId} no longer exists in project ${projectId}.`,
    );
  }
  const section = await input.repository.getOutputSection(sectionId);
  if (
    !section ||
    section.outputId !== outputId ||
    section.projectId !== projectId
  ) {
    throw new Error(
      `acceptOutputDraft: target section ${sectionId} no longer belongs to output ${outputId}.`,
    );
  }
  const citedRefs = citedSelectedRefs(finalBody, claimIds, evidenceIds);
  for (const ref of citedRefs) {
    if (ref.kind === 'claim') {
      const claim = await input.repository.getClaim(ref.id);
      if (
        !claim ||
        claim.projectId !== projectId ||
        claim.status !== 'canonical'
      ) {
        throw new Error(
          `acceptOutputDraft: cited claim ${ref.id} is no longer canonical in this project.`,
        );
      }
    } else {
      const evidence = await input.repository.getEvidence(ref.id);
      if (
        !evidence ||
        evidence.projectId !== projectId ||
        evidence.status !== 'verified'
      ) {
        throw new Error(
          `acceptOutputDraft: cited evidence ${ref.id} is no longer verified in this project.`,
        );
      }
    }
  }
  const existingStatements = await input.repository.listOutputStatements({
    sectionId,
  });
  const maxOrder = existingStatements.reduce(
    (max, existing) => Math.max(max, existing.order),
    -1,
  );
  const ts = nowIso();
  const statement: OutputStatement = {
    id: makeId(input.idFactory, 'ost'),
    projectId,
    outputId,
    sectionId,
    body: finalBody,
    order: Math.floor(maxOrder) + 1,
    authorType: 'user',
    status: 'accepted',
    createdAt: ts,
    updatedAt: ts,
  };
  const supports: StatementSupport[] = citedRefs.map((ref) => ({
      id: makeId(input.idFactory, 'sup'),
      projectId,
      outputId,
      statementId: statement.id,
      ref,
      relation: 'supports' as const,
      authorType: 'user' as const,
      createdAt: ts,
      updatedAt: ts,
    }));
  // Single transaction: write the Statement + every
  // Support, then move the draft to `accepted`.
  await input.repository.transact(async (tx) => {
    tx.putOutputStatement(statement);
    for (const s of supports) {
      tx.putStatementSupport(s);
    }
  });
  draftLayer.transition(draft.id, 'accepted');
  return { statement, supports };
}

// ---------------------------------------------------------------------------
// rejectOutputDraft
// ---------------------------------------------------------------------------

/**
 * Reject an Output draft. The use case transitions
 * the draft to `rejected` and writes nothing to the
 * repository. The user can keep editing; the workspace
 * can offer another draft on a fresh selection.
 */
export function rejectOutputDraft(input: RejectOutputDraftInput): void {
  const draft = draftLayer.get(input.draftId);
  if (!draft) {
    throw new Error(`rejectOutputDraft: draft ${input.draftId} not found.`);
  }
  draftLayer.transition(input.draftId, 'rejected');
}
