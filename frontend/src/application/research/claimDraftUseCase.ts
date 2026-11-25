/**
 * StudyKit v0.4 — `application/research/claimDraftUseCase`
 *
 * AI-suggested Claim generation, gated on the WP-03
 * `ProviderRouter` and `DraftLayer`. The use case:
 *
 *   1. Builds a focused prompt from the selected
 *      verified Evidence (titles + quotes + work ids
 *      + project brief). The prompt is included
 *      verbatim in the Draft Layer record so a
 *      Retry shows the user what was sent.
 *   2. Calls `providerRouter.chat({ messages })`. If
 *      the router is unavailable, AI is off, or the
 *      provider errors, the use case returns a
 *      `failed: true` result. The UI keeps the
 *      selected evidence + brief + scope and shows
 *      a Retry / Continue-without-AI path.
 *   3. Parses the response into `title` + `body`. The
 *      parser is a tiny, honest heuristic: the
 *      first non-empty line is the title; the rest
 *      is the body. Anything ambiguous is rejected
 *      so a stray markdown fence can't become a
 *      canonical claim.
 *   4. Writes a `DraftLayer` record with
 *      `target: { kind: 'claim', targetId: <id>, containerId: <projectId> }`,
 *      `provenance.provider` reflects the model that
 *      actually answered (`ollama` / `cloud` /
 *      `human`), and `provenance.sourceScope` lists
 *      the evidence ids the user selected. The
 *      `acceptClaimDraft` use case (in
 *      `researchUseCases`) is the only path to
 *      canonical state.
 *
 * Why not call the AI directly? The kernel is the
 * one seam; the rest of the Research slice never
 * imports an AI client.
 */

import {
  draftLayer,
  type DraftRecord,
} from '../../features/ai/kernel/draftLayer';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import { nowIso } from '../../domain/research';
import type { Evidence, ResearchProject, Work } from '../../domain/research';

export interface ClaimDraftInput {
  readonly project: ResearchProject;
  /** The brief + project context, included in the
   *  prompt so the AI can frame the claim. */
  readonly contextText: string;
  /** The verified Evidence the user selected. Must
   *  be non-empty. */
  readonly evidence: ReadonlyArray<{ evidence: Evidence; work: Work }>;
  /** The router; the use case never imports an AI
   *  client directly. */
  readonly providerRouter?: ProviderRouter;
  /** When the AI is off / failing, the use case
   *  returns a `failed: true` result with the prompt
   *  + selection intact. */
  readonly idFactory?: () => string;
}

export type ClaimDraftResult =
  | { kind: 'draft'; draft: DraftRecord; title: string; body: string }
  | {
      kind: 'failed';
      reason: 'no-router' | 'provider-failed' | 'parse-failed' | 'no-evidence';
      message: string;
      prompt: string;
    };

const EVIDENCE_CAP = 6;

function buildPrompt(input: ClaimDraftInput): string {
  const lines: string[] = [];
  lines.push('You are a research assistant. The user has selected verified Evidence from a Research project.');
  lines.push('');
  lines.push('Project: ' + input.project.name);
  if (input.project.livingBrief.trim().length > 0) {
    lines.push('Project brief: ' + input.project.livingBrief.trim());
  }
  if (input.contextText.trim().length > 0) {
    lines.push('User-supplied context: ' + input.contextText.trim());
  }
  lines.push('');
  lines.push('Verified Evidence:');
  const cap = Math.min(input.evidence.length, EVIDENCE_CAP);
  for (let i = 0; i < cap; i += 1) {
    const { evidence, work } = input.evidence[i]!;
    lines.push(`  [E${i + 1}] ${work.title} (${work.identifiers.doi ?? work.id}) — ${evidence.evidenceType}`);
    lines.push(`      Quote: ${evidence.exactQuote}`);
    lines.push(`      Reading: ${evidence.userInterpretation}`);
  }
  if (input.evidence.length > cap) {
    lines.push(`  (${input.evidence.length - cap} more Evidence not shown)`);
  }
  lines.push('');
  lines.push('Task: write a single Claim (one short title + 1-2 sentence body) that synthesises the Evidence above.');
  lines.push('Rules:');
  lines.push('  - Only synthesise what the Evidence supports. Do not invent citations.');
  lines.push('  - Be specific: name the construct, the study population, or the effect size when you can.');
  lines.push('  - Output format: the first non-empty line is the title; subsequent lines are the body. No markdown headings, no lists.');
  return lines.join('\n');
}

function parseClaim(response: string): { title: string; body: string } | null {
  // Strip code fences (some models wrap the answer).
  const stripped = response
    .replace(/```[a-zA-Z]*\n/g, '')
    .replace(/```\n?/g, '')
    .trim();
  if (stripped.length === 0) return null;
  const lines = stripped.split(/\r?\n/);
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i]!.trim();
    if (t.length > 0) {
      titleIdx = i;
      break;
    }
  }
  if (titleIdx === -1) return null;
  const title = lines[titleIdx]!.replace(/^#+\s*/, '').trim();
  if (title.length === 0 || title.length > 200) return null;
  const body = lines
    .slice(titleIdx + 1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ')
    .trim();
  if (body.length === 0) return null;
  return { title, body };
}

export async function generateClaimDraft(input: ClaimDraftInput): Promise<ClaimDraftResult> {
  if (input.evidence.length === 0) {
    return {
      kind: 'failed',
      reason: 'no-evidence',
      message: 'Select at least one verified Evidence to suggest a Claim.',
      prompt: '',
    };
  }
  if (!input.providerRouter) {
    const prompt = buildPrompt(input);
    return {
      kind: 'failed',
      reason: 'no-router',
      message: 'AI is not configured. Continue without AI to write a Claim yourself.',
      prompt,
    };
  }
  const prompt = buildPrompt(input);
  let responseText: string;
  let response: { readonly provider?: string; readonly model?: string; readonly content?: string } | null = null;
  try {
    const res = await input.providerRouter.chat({
      messages: [
        {
          role: 'system',
          content:
            'You synthesise verified research Evidence into a single concise Claim. You do not invent sources.',
        },
        { role: 'user', content: prompt },
      ],
    });
    response = res;
    responseText = res.content ?? '';
  } catch (err) {
    return {
      kind: 'failed',
      reason: 'provider-failed',
      message: err instanceof Error ? err.message : 'AI provider failed.',
      prompt,
    };
  }
  const parsed = parseClaim(responseText);
  if (!parsed) {
    return {
      kind: 'failed',
      reason: 'parse-failed',
      message: 'The AI response could not be parsed as a Claim.',
      prompt,
    };
  }
  // The Draft Layer record carries the *real* provider
  // + model from the router response. We do NOT
  // hardcode `cloud` here — an Ollama response
  // (`res.provider === 'ollama'`) must surface as
  // `ollama` in provenance so the Claim audit trail
  // tells the user where the suggestion came from.
  // When the call returned no usable model string we
  // fall back to the provider name; when even the
  // provider is missing (defensive), we record
  // `unknown` so the audit trail never lies.
  const responseProvider = response?.provider;
  const responseModel = response?.model;
  const provider =
    typeof responseProvider === 'string' && responseProvider.length > 0
      ? responseProvider
      : 'unknown';
  const model =
    typeof responseModel === 'string' && responseModel.length > 0
      ? responseModel
      : undefined;
  const now = nowIso();
  const draftId = (() => {
    if (input.idFactory) return input.idFactory();
    const rand = Math.random().toString(36).slice(2, 10);
    return `cdraft_${Date.now().toString(36)}_${rand}`;
  })();
  const draft = draftLayer.create({
    id: draftId,
    title: parsed.title,
    body: { kind: 'text', text: parsed.body },
    target: {
      targetId: draftId,
      kind: 'claim',
      containerId: input.project.id,
    },
    provenance: {
      provider,
      ...(model !== undefined ? { model } : {}),
      actionId: 'research.generateClaimDraft',
      contextSnapshotHash: draftId,
      sourceScope: [
        'project:' + input.project.id,
        ...input.evidence.map((e) => 'evidence:' + e.evidence.id),
      ],
      invocationSurface: 'intent-capsule',
      createdAt: now,
    },
    noUndo: true,
  });
  // Bump the draft to `draft` with the real body so
  // the host can preview the title immediately.
  draftLayer.updateBody(draft.id, { kind: 'text', text: parsed.body }, parsed.title);
  // The provenance already carries the real provider /
  // model — we just promote the status. The
  // `updateProvenance` call would overwrite the
  // provider name with the one we just set, so we
  // intentionally skip it.
  draftLayer.transition(draft.id, 'draft');
  const updated = draftLayer.get(draft.id) ?? draft;
  return { kind: 'draft', draft: updated, title: parsed.title, body: parsed.body };
}
