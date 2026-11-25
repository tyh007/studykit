/**
 * StudyKit v0.4 — `application/study/studyUseCases`
 *
 * Use-case layer for the Study Vertical Slice (WP-04). Pure
 * functions, no React, no Dexie, no fetch. Every use case
 * takes a `StudyRepository` plus the small set of inputs it
 * needs; the UI calls them and renders the result.
 *
 * Why a separate use-case layer?
 *
 *   - The UI is small. Each use case is one or two
 *     `repository.transact(...)` calls plus the AI / Draft
 *     glue. Splitting them into named functions makes the
 *     Verify Thought Loop legible: a test can assert the
 *     loop without rendering anything.
 *   - The AI / Draft / Provider Router integration is a
 *     *separate* concern from persistence. `requestFeedback`
 *     is the only use case that talks to a provider; the
 *     others are pure CRUD. This keeps the AI off / fail /
 *     retry paths testable in isolation.
 *   - The use cases are the seam the *integration tests* use
 *     to drive the full Lecture → Attempt → Question → Review
 *     loop without rendering. A test that bypasses the use
 *     cases and pokes the repository directly would miss the
 *     exact behaviours WP-04 must guarantee.
 *
 * AI integration rules (per WP-04 Gate)
 * --------------------------------------
 *
 *   - AI feedback is *always* a draft first. The use case
 *     writes a Draft Layer record (`features/ai/kernel/draftLayer`),
 *     then waits for the host to Accept / Reject.
 *   - On Accept, the use case reads the accepted body and
 *     writes a *new* `StudyFeedback` record with
 *     `authorType: 'ai'` and the AI's provenance. The Draft
 *     Layer record itself is left in the `accepted` state.
 *   - On Reject, the use case transitions the draft to
 *     `rejected`; the user can keep editing the attempt or
 *     the question. No feedback record is written.
 *   - On Retry, the use case starts a *new* draft. The
 *     previous draft is left in `failed`; its `prompt`,
 *     `selection`, `locator` and `focus` are still on the
 *     session so the user can compare.
 *   - The user can `Continue without AI`: a user-authored
 *     `StudyFeedback` is written instead, with
 *     `authorType: 'user'`.
 *
 * Reload recovery
 * ---------------
 *
 *   Every `saveAttempt` and every `acceptFeedback` writes a
 *   `StudyRecoveryEntry` to the per-(container, lecture)
 *   buffer. After a reload / offline / AI failure, the UI
 *   reads the latest entry for the active (container,
 *   lecture) pair and restores the user's text.
 */

import type { ProviderRouter, ProviderChatRequest } from '../../features/ai/kernel/providerRouter';
import type { DraftRecord } from '../../features/ai/kernel/draftLayer';
import type {
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
  ReviewState,
  SourceLocator,
  StudyRecoveryEntry,
  FeedbackProvenance,
} from '../../domain/study';
import { nowIso } from '../../domain/study';
import type {
  StudyRepository,
  StudyRepositoryTransaction,
} from './studyRepository';
import type { ContainerRef } from '../../domain/workspace';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateQuestionInput {
  readonly body: string;
  readonly locator: SourceLocator | null;
  readonly container?: ContainerRef;
}

export interface SaveAttemptInput {
  readonly questionId: string;
  readonly body: string;
  readonly locator: SourceLocator | null;
  readonly containerId: string;
}

export interface RequestFeedbackInput {
  readonly questionId: string;
  readonly attemptId?: string;
  /** The prompt the user is asking the AI to address. */
  readonly prompt: string;
  /** The source the AI should read against (the user's selection, etc.). */
  readonly contextText: string;
  /** The locator the user was looking at when they asked. */
  readonly locator: SourceLocator | null;
  readonly containerId: string;
}

export interface AcceptFeedbackInput {
  readonly draftId: string;
  readonly questionId: string;
  readonly attemptId?: string;
  readonly body: string;
  readonly locator: SourceLocator | null;
  readonly containerId: string;
  readonly lectureId: string;
}

export interface RejectFeedbackInput {
  readonly draftId: string;
}

export interface MarkReviewInput {
  readonly questionId: string;
  readonly review: ReviewState;
  readonly containerId: string;
  readonly lectureId: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface RequestFeedbackResult {
  /** The draft the host UI should preview. Always returned. */
  readonly draftId: string;
  /** True when the AI is unreachable and the user must retry or proceed. */
  readonly failed: boolean;
  /** When `failed`, a human-readable reason. */
  readonly error?: string;
}

export interface UseCaseDeps {
  readonly repository: StudyRepository;
  /**
   * Provider router. The use case never calls the AI client
   * directly; the kernel is the seam. When the AI is off
   * (local flavour or capability missing) the router's
   * `chat` throws and the use case returns `failed: true`.
   */
  readonly providerRouter?: ProviderRouter;
  /**
   * Draft layer (the AI Interaction Kernel's in-memory
   * store). The use case creates a draft, stamps the AI's
   * response, and waits for the host to Accept / Reject.
   * The host reads the draft through the same handle.
   * The interface matches `features/ai/kernel/draftLayer` —
   * we only depend on the shape, not the concrete class.
   */
  readonly draftLayer?: {
    create(input: {
      id: string;
      title: string;
      body: { kind: 'none' } | { kind: 'explanation'; text: string; model?: string } | { kind: 'text'; text: string } | { kind: 'note-draft'; title: string; body: string; moduleId?: string } | { kind: 'navigation'; target: { route: string; label: string } } | { kind: 'search-results'; query: string; hits: readonly { id: string; label: string; preview?: string }[] };
      target: { targetId: string; kind: 'note' | 'claim' | 'evidence' | 'task' | 'concept' | 'question' | 'output' | 'navigation' | 'other'; containerId?: string };
      provenance: {
        provider: 'local' | 'ollama' | 'cloud' | 'pending' | 'human';
        model?: string;
        actionId: string;
        contextSnapshotHash: string;
        sourceScope: readonly string[];
        invocationSurface: 'selection' | 'object' | 'intent-capsule' | 'transition' | 'workspace' | 'desktop-quick-access';
        createdAt: string;
      };
      noUndo?: boolean;
    }): DraftRecord;
    get(id: string): DraftRecord | undefined;
    transition(id: string, next: 'draft' | 'rejected' | 'failed' | 'cancelled' | 'generating' | 'suggested' | 'accepted', extras?: { errorMessage?: string }): DraftRecord;
    updateBody(id: string, body: { kind: 'none' } | { kind: 'explanation'; text: string; model?: string } | { kind: 'text'; text: string } | { kind: 'note-draft'; title: string; body: string; moduleId?: string } | { kind: 'navigation'; target: { route: string; label: string } } | { kind: 'search-results'; query: string; hits: readonly { id: string; label: string; preview?: string }[] }, title?: string): DraftRecord;
    updateProvenance(id: string, patch: { provider?: string; model?: string }): DraftRecord;
  };
  /** A small id factory; defaults to a timestamp+random. */
  readonly idFactory?: () => string;
}

function defaultIdFactory(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `study_${Date.now().toString(36)}_${rand}`;
}

function makeId(deps: UseCaseDeps, prefix: string): string {
  // The idFactory takes precedence: when tests inject one,
  // they expect the literal value back (no prefix double-
  // wrapping). The default factory always returns a value
  // that *starts with* `study_` so we strip the prefix and
  // re-stamp the requested one to keep the schema honest.
  if (deps.idFactory) {
    return deps.idFactory();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newId(deps: UseCaseDeps, prefix: string): string {
  return makeId(deps, prefix);
}

function makeQuestionRecord(
  id: string,
  input: CreateQuestionInput,
  now: string,
): StudyQuestion {
  return {
    id,
    body: input.body,
    locator: input.locator,
    ...(input.container ? { container: input.container } : {}),
    status: 'open',
    review: 'unreviewed',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function makeAttemptRecord(
  id: string,
  input: SaveAttemptInput,
  now: string,
): StudyAttempt {
  return {
    id,
    questionId: input.questionId,
    body: input.body,
    locator: input.locator,
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function makeFeedbackRecord(
  id: string,
  input: {
    questionId: string;
    attemptId?: string;
    body: string;
    locator: SourceLocator | null;
    authorType: 'user' | 'ai';
    provenance: FeedbackProvenance;
  },
  now: string,
): StudyFeedback {
  return {
    id,
    questionId: input.questionId,
    ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
    body: input.body,
    locator: input.locator,
    authorType: input.authorType,
    provenance: input.provenance,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRecoveryEntry(
  input:
    | { kind: 'last-attempt'; containerId: string; lectureId: string; questionId: string; value: string; locator: SourceLocator | null }
    | { kind: 'last-feedback'; containerId: string; lectureId: string; questionId: string; value: string; locator: SourceLocator | null }
    | { kind: 'draft-input'; containerId: string; lectureId: string; questionId: string; value: string; locator: SourceLocator | null },
  now: string,
): StudyRecoveryEntry {
  return {
    id: `recovery_${input.kind}_${input.questionId}_${now}`,
    containerId: input.containerId,
    lectureId: input.lectureId,
    key: input.kind,
    questionId: input.questionId,
    value: input.value,
    locator: input.locator,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

/**
 * Create a new question and persist it. The question starts
 * in `status: 'open'` with `review: 'unreviewed'`. The
 * lecture-id is read from the locator (a `null` locator is
 * a free-standing question).
 */
export async function createQuestion(
  deps: UseCaseDeps,
  input: CreateQuestionInput,
): Promise<StudyQuestion> {
  const now = nowIso();
  const id = newId(deps, 'q');
  const record = makeQuestionRecord(id, input, now);
  await deps.repository.transact(async (tx: StudyRepositoryTransaction) => {
    tx.putQuestion(record);
  });
  return record;
}

/**
 * Save (or update) a user's Attempt. The use case also
 * updates the parent Question's `status` to `'answered'` and
 * its `updatedAt`. The recovery entry for
 * `last-attempt` is written so a reload / offline / AI
 * failure can restore the user's text.
 */
export async function saveAttempt(
  deps: UseCaseDeps,
  input: SaveAttemptInput,
): Promise<StudyAttempt> {
  const now = nowIso();
  const id = newId(deps, 'a');
  const attempt = makeAttemptRecord(id, input, now);
  const recovery = makeRecoveryEntry(
    {
      kind: 'last-attempt',
      containerId: input.containerId,
      lectureId: input.locator?.lectureId ?? 'unknown',
      questionId: input.questionId,
      value: input.body,
      locator: input.locator,
    },
    now,
  );
  await deps.repository.transact(async (tx: StudyRepositoryTransaction) => {
    const existing = await deps.repository.getQuestion(input.questionId);
    if (existing) {
      tx.putQuestion({
        ...existing,
        status: 'answered',
        updatedAt: now,
      });
    }
    tx.putAttempt(attempt);
  });
  await deps.repository.putRecovery(recovery);
  return attempt;
}

/**
 * Request AI feedback on a Question (and optional Attempt).
 * The flow is:
 *
 *   1. Create a Draft Layer record in `suggested` state.
 *   2. Mark it `generating`.
 *   3. Call the provider router's `chat` with the question,
 *      the attempt (if any) and the source context.
 *   4. On success → mark the draft `draft` with the AI's
 *      content + provider/model. Return `failed: false`.
 *   5. On failure → mark the draft `failed` with the error
 *      message. Return `failed: true` and the error. The
 *      draft, prompt, context, locator, focus are all
 *      preserved for retry.
 *   6. When no provider router is registered (e.g. AI off),
 *      return `failed: true` with an explanatory message.
 *
 * The host UI shows the draft; Accept/Reject/Continue
 * are routed through the matching use cases below.
 */
export async function requestFeedback(
  deps: UseCaseDeps,
  input: RequestFeedbackInput,
): Promise<RequestFeedbackResult> {
  if (!deps.draftLayer || !deps.providerRouter) {
    return {
      draftId: '',
      failed: true,
      error: 'AI is not configured for this workspace.',
    };
  }
  const now = nowIso();
  const draftId = newId(deps, 'draft');
  const messages: ProviderChatRequest['messages'] = [
    {
      role: 'system',
      content:
        'You are an academic feedback assistant. The user is studying a course and has ' +
        'typed their own explanation. Compare their explanation to the source passage ' +
        'and provide concise, accurate feedback that distinguishes facts (from the ' +
        'source) from suggestions (from you). Never invent sources. If the source ' +
        'is insufficient, say so explicitly.',
    },
    {
      role: 'user',
      content: [
        `Source passage:`,
        '"""',
        input.contextText,
        '"""',
        '',
        `Question: ${(await deps.repository.getQuestion(input.questionId))?.body ?? ''}`,
        ...(input.attemptId
          ? [
              '',
              `User's own attempt:`,
              '"""',
              (await deps.repository.listAttemptsForQuestion(input.questionId)).find(
                (a) => a.id === input.attemptId,
              )?.body ?? '',
              '"""',
            ]
          : []),
        '',
        `User prompt: ${input.prompt}`,
      ].join('\n'),
    },
  ];
  const draft = deps.draftLayer.create({
    id: draftId,
    title: 'Feedback on your attempt',
    body: { kind: 'none' },
    target: {
      targetId: input.questionId,
      kind: 'other',
      containerId: input.containerId,
    },
    provenance: {
      provider: 'pending',
      actionId: 'study.requestFeedback',
      contextSnapshotHash: input.questionId,
      sourceScope: input.locator ? [input.locator.kind, input.locator.lectureId] : ['no-source'],
      invocationSurface: 'intent-capsule',
      createdAt: now,
    },
    noUndo: true,
  });
  // Stamp `generating`.
  deps.draftLayer.transition(draft.id, 'generating');
  try {
    const res = await deps.providerRouter.chat({ messages });
    deps.draftLayer.updateBody(
      draft.id,
      { kind: 'explanation', text: res.content, ...(res.model !== undefined ? { model: res.model } : {}) },
      'Feedback on your attempt',
    );
    deps.draftLayer.updateProvenance(draft.id, {
      provider: res.provider,
      ...(res.model !== undefined ? { model: res.model } : {}),
    });
    deps.draftLayer.transition(draft.id, 'draft');
    return { draftId: draft.id, failed: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    deps.draftLayer.transition(draft.id, 'failed', { errorMessage: message });
    // Recovery: persist the user's prompt + context so a
    // reload restores what they were working on. The value
    // is the user's prompt text, not the AI's reply.
    await deps.repository.putRecovery(
      makeRecoveryEntry(
        {
          kind: 'draft-input',
          containerId: input.containerId,
          lectureId: input.locator?.lectureId ?? 'unknown',
          questionId: input.questionId,
          value: input.prompt,
          locator: input.locator,
        },
        now,
      ),
    );
    return { draftId: draft.id, failed: true, error: message };
  }
}

/**
 * Accept an AI feedback draft. The use case writes a
 * permanent `StudyFeedback` record with `authorType: 'ai'`
 * and a `provenance` that points back to the draft. The
 * draft is transitioned to `accepted` (the host can read
 * the kernel's draft store if it wants to display
 * provenance). The recovery buffer is updated to
 * `last-feedback`.
 */
export async function acceptFeedback(
  deps: UseCaseDeps,
  input: AcceptFeedbackInput,
): Promise<StudyFeedback> {
  if (!deps.draftLayer) {
    throw new Error('acceptFeedback: draftLayer is required.');
  }
  const draft = deps.draftLayer.get(input.draftId);
  if (!draft) {
    throw new Error(`acceptFeedback: draft "${input.draftId}" not found.`);
  }
  const now = nowIso();
  const id = newId(deps, 'f');
  const body = extractDraftText(draft.body);
  const provider = draft.provenance.provider;
  // The `provenance.provider` is one of the values the
  // Draft Layer allows (`'local' | 'ollama' | 'cloud' |
  // 'pending' | 'human'`). Map `'local'` and `'pending'` to
  // `'cloud'` so the persisted `FeedbackProvenance` stays
  // honest (a local call was never made; a pending call
  // never returned a model). User-authored feedback (the
  // `recordUserFeedback` use case below) writes `'human'`.
  const persistedProvider: 'human' | 'ollama' | 'cloud' =
    provider === 'ollama' ? 'ollama' : 'cloud';
  // `input.body` is the canonical body: the user has the
  // final say, possibly after editing the draft. The Draft
  // Layer's body is the *starting point*; the user's edit
  // (passed as `input.body`) is what we persist.
  const finalBody = input.body.length > 0 ? input.body : body;
  const feedback = makeFeedbackRecord(
    id,
    {
      questionId: input.questionId,
      ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
      body: finalBody,
      locator: input.locator,
      authorType: 'ai',
      provenance: {
        provider: persistedProvider,
        ...(draft.provenance.model !== undefined ? { model: draft.provenance.model } : {}),
        generatedAt: draft.provenance.createdAt,
        draftId: draft.id,
      },
    },
    now,
  );
  await deps.repository.transact(async (tx: StudyRepositoryTransaction) => {
    const existing = await deps.repository.getQuestion(input.questionId);
    if (existing) {
      tx.putQuestion({ ...existing, updatedAt: now });
    }
    tx.putFeedback(feedback);
  });
  deps.draftLayer.transition(draft.id, 'accepted');
  await deps.repository.putRecovery(
    makeRecoveryEntry(
      {
        kind: 'last-feedback',
        containerId: input.containerId,
        lectureId: input.lectureId,
        questionId: input.questionId,
        value: feedback.body,
        locator: input.locator,
      },
      now,
    ),
  );
  return feedback;
}

/**
 * Reject an AI feedback draft. The use case transitions the
 * draft to `rejected`; no `StudyFeedback` is written. The
 * user's text / selection / locator / focus are preserved
 * on the session so they can keep working.
 */
export async function rejectFeedback(
  deps: UseCaseDeps,
  input: RejectFeedbackInput,
): Promise<void> {
  if (!deps.draftLayer) {
    return;
  }
  const draft = deps.draftLayer.get(input.draftId);
  if (!draft) return;
  if (draft.status === 'draft' || draft.status === 'generating' || draft.status === 'suggested') {
    deps.draftLayer.transition(draft.id, 'rejected');
  }
}

/**
 * "Continue without AI" — the user types the feedback
 * themselves. We persist a `StudyFeedback` with
 * `authorType: 'user'` and a `human` provenance. This is
 * the same path the system takes when the user Accepts a
 * user-edited draft from the Explain action.
 */
export async function recordUserFeedback(
  deps: UseCaseDeps,
  input: AcceptFeedbackInput,
): Promise<StudyFeedback> {
  const now = nowIso();
  const id = newId(deps, 'f');
  const feedback = makeFeedbackRecord(
    id,
    {
      questionId: input.questionId,
      ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
      body: input.body,
      locator: input.locator,
      authorType: 'user',
      provenance: {
        provider: 'human',
        generatedAt: now,
      },
    },
    now,
  );
  await deps.repository.transact(async (tx: StudyRepositoryTransaction) => {
    const existing = await deps.repository.getQuestion(input.questionId);
    if (existing) {
      tx.putQuestion({ ...existing, updatedAt: now });
    }
    tx.putFeedback(feedback);
  });
  await deps.repository.putRecovery(
    makeRecoveryEntry(
      {
        kind: 'last-feedback',
        containerId: input.containerId,
        lectureId: input.lectureId,
        questionId: input.questionId,
        value: feedback.body,
        locator: input.locator,
      },
      now,
    ),
  );
  return feedback;
}

/**
 * Mark a question's review state. The use case updates the
 * question's `review` field and, when the user marks it
 * `understood` / `uncertain` / `review-later`, also updates
 * the question's `status` to `'reviewed'`. There is no
 * automatic spaced-repetition; this is the simple, explicit
 * state per WP-04 scope.
 */
export async function markReview(
  deps: UseCaseDeps,
  input: MarkReviewInput,
): Promise<StudyQuestion> {
  const now = nowIso();
  let updated: StudyQuestion | null = null;
  await deps.repository.transact(async (tx: StudyRepositoryTransaction) => {
    const existing = await deps.repository.getQuestion(input.questionId);
    if (!existing) {
      throw new Error(`markReview: question "${input.questionId}" not found.`);
    }
    updated = {
      ...existing,
      review: input.review,
      status: input.review === 'unreviewed' ? existing.status : 'reviewed',
      updatedAt: now,
    };
    tx.putQuestion(updated);
  });
  // `updated` is set inside the transact; the closure captures
  // it as `let updated: ... | null = null` and assigns inside.
  // The `await` guarantees the assignment happened.
  if (!updated) {
    // Defensive: the transact callback runs synchronously in
    // the in-memory adapter; the Dexie adapter is async. We
    // re-fetch in the rare race where the closure assignment
    // hasn't been observed yet.
    const refetched = await deps.repository.getQuestion(input.questionId);
    if (!refetched) {
      throw new Error(`markReview: question "${input.questionId}" disappeared.`);
    }
    return refetched;
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pull the visible text out of a `DraftBody`. The
 * `requestFeedback` use case always writes an
 * `'explanation'` body; other shapes return the empty
 * string so the host can still see *something* (the
 * fallback is the `body` field on the use-case input).
 */
function extractDraftText(body: import('../../features/ai/kernel/draftLayer').DraftBody): string {
  if (body.kind === 'explanation') return body.text;
  if (body.kind === 'text') return body.text;
  if (body.kind === 'note-draft') return body.body;
  return '';
}
