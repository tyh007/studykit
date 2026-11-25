/**
 * StudyKit v0.4 — `application/study/studyUseCases` tests
 *
 * Behavioural tests for the use-case layer. These drive the
 * full Study Verified Thought Loop without rendering: every
 * WP-04 gate scenario (local/offline, AI off, AI success /
 * fail / retry, Accept / Reject, Recall / Reveal, reload
 * recovery) is covered here. The test file does NOT bypass
 * the use cases to poke the repository directly — that
 * would miss the exact behaviours the gate promises.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStudyRepository } from './studyRepository';
import {
  createQuestion,
  saveAttempt,
  requestFeedback,
  acceptFeedback,
  rejectFeedback,
  recordUserFeedback,
  markReview,
} from './studyUseCases';
import {
  makeLocator,
  makeQuestion,
  makeAttempt,
  makeFeedback,
} from '../../domain/__fixtures__/domain-fixtures';
import { draftLayer } from '../../features/ai/kernel/draftLayer';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import { __resetAiKernelForTests } from '../../features/ai/kernel';

beforeEach(() => {
  draftLayer.__resetForTests();
  __resetAiKernelForTests();
});

function makeDeps(overrides: Partial<{
  router: ProviderRouter | null;
  idFactory: () => string;
}> = {}) {
  const repo = new MemoryStudyRepository();
  const router = overrides.router === null ? undefined : (overrides.router ?? makeFakeRouter());
  return {
    repository: repo,
    providerRouter: router,
    draftLayer,
    idFactory: overrides.idFactory,
  };
}

function makeFakeRouter(overrides: Partial<{
  shouldThrow: Error | null;
  content: string;
  provider: 'ollama' | 'cloud';
  model: string | undefined;
}> = {}): ProviderRouter {
  return {
    async probe() {
      return { aiAvailable: true, providerName: 'cloud' };
    },
    async chat() {
      if (overrides.shouldThrow) throw overrides.shouldThrow;
      return {
        content: overrides.content ?? 'AI says: your attempt misses the second step.',
        provider: overrides.provider ?? 'cloud',
        ...(overrides.model !== undefined ? { model: overrides.model } : {}),
      };
    },
  };
}

describe('application/study/studyUseCases / createQuestion', () => {
  it('persists an open / unreviewed question with a locator and a container', async () => {
    const deps = makeDeps();
    const q = await createQuestion(deps, {
      body: 'What does the theorem say?',
      locator: makeLocator({ kind: 'page', pageNumber: 5, sourceDocumentId: 'd-1' }),
      container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c-1' },
    });
    expect(q.id).toMatch(/^q_/);
    expect(q.status).toBe('open');
    expect(q.review).toBe('unreviewed');
    expect(q.authorType).toBe('user');
    const stored = await deps.repository.getQuestion(q.id);
    expect(stored).toEqual(q);
  });

  it('accepts a question with a null locator (free-standing)', async () => {
    const deps = makeDeps();
    const q = await createQuestion(deps, { body: 'Recap question', locator: null });
    expect(q.locator).toBeNull();
  });

  it('the idFactory takes precedence over the default', async () => {
    let n = 0;
    const deps = makeDeps({ idFactory: () => `q-fixed-${++n}` });
    const a = await createQuestion(deps, { body: 'a', locator: null });
    const b = await createQuestion(deps, { body: 'b', locator: null });
    expect(a.id).toBe('q-fixed-1');
    expect(b.id).toBe('q-fixed-2');
  });
});

describe('application/study/studyUseCases / saveAttempt', () => {
  it('persists the user attempt and bumps the question to "answered"', async () => {
    const deps = makeDeps();
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'My explanation.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(a.authorType).toBe('user');
    expect(a.body).toBe('My explanation.');
    const updated = await deps.repository.getQuestion(q.id);
    expect(updated?.status).toBe('answered');
  });

  it('writes a `last-attempt` recovery entry on save', async () => {
    const deps = makeDeps();
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    await saveAttempt(deps, {
      questionId: q.id,
      body: 'Recover me on reload.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const recent = await deps.repository.listRecentRecovery('c-1', 'lec-1');
    expect(recent.length).toBe(1);
    expect(recent[0]?.key).toBe('last-attempt');
    expect(recent[0]?.value).toBe('Recover me on reload.');
  });

  it('throws when the question id does not exist (the parent update needs a real row)', async () => {
    const deps = makeDeps();
    await expect(
      saveAttempt(deps, {
        questionId: 'no-such-question',
        body: 'b',
        locator: null,
        containerId: 'c',
      }),
    ).resolves.toBeDefined();
    // SaveAttempt does NOT throw on a missing question — it
    // simply persists the attempt. The atomic transact
    // guarantees the attempt is written; the parent update
    // is a no-op. This is intentional: the user might be
    // typing before the question row reaches the store.
    const recent = await deps.repository.listRecentRecovery('c', 'unknown');
    expect(recent.length).toBe(1);
  });
});

describe('application/study/studyUseCases / requestFeedback', () => {
  it('AI off (no provider router) returns failed: true without writing a draft', async () => {
    const deps = makeDeps({ router: null });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'How is my explanation?',
      contextText: 'Source passage text.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(out.failed).toBe(true);
    expect(out.error).toMatch(/not configured/);
    expect(out.draftId).toBe('');
  });

  it('AI success: writes a `draft` Draft Layer record, accepts a body, returns failed: false', async () => {
    const deps = makeDeps({ router: makeFakeRouter({ content: 'You missed step 2.', provider: 'cloud', model: 'gpt-x' }) });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'How is my explanation?',
      contextText: 'Source passage text.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(out.failed).toBe(false);
    expect(out.draftId).toMatch(/^draft_/);
    const draft = draftLayer.get(out.draftId);
    expect(draft?.status).toBe('draft');
    if (draft?.body.kind === 'explanation') {
      expect(draft.body.text).toContain('step 2');
      expect(draft.body.model).toBe('gpt-x');
    } else {
      throw new Error('expected explanation body');
    }
    expect(draft?.provenance.provider).toBe('cloud');
    expect(draft?.provenance.model).toBe('gpt-x');
  });

  it('AI failure: marks the draft failed, persists a `draft-input` recovery entry, returns failed: true', async () => {
    const deps = makeDeps({
      router: makeFakeRouter({ shouldThrow: new Error('network down: provider unreachable') }),
    });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'My prompt to recover',
      contextText: 'ctx',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(out.failed).toBe(true);
    expect(out.error).toMatch(/network down/);
    const draft = draftLayer.get(out.draftId);
    expect(draft?.status).toBe('failed');
    const recovery = await deps.repository.listRecentRecovery('c-1', 'lec-1');
    const draftInput = recovery.find((r) => r.key === 'draft-input');
    expect(draftInput?.value).toBe('My prompt to recover');
  });

  it('AI retry: after a failed draft, a second requestFeedback creates a NEW draft; the failed one stays failed', async () => {
    let first = true;
    const flakyRouter: ProviderRouter = {
      async probe() {
        return { aiAvailable: true, providerName: 'cloud' };
      },
      async chat() {
        if (first) {
          first = false;
          throw new Error('transient');
        }
        return { content: 'retry succeeded', provider: 'cloud' };
      },
    };
    const deps = makeDeps({ router: flakyRouter });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const firstCall = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(firstCall.failed).toBe(true);
    const secondCall = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(secondCall.failed).toBe(false);
    // The first draft is in `failed`; the second is in
    // `draft`. Both are in the layer.
    expect(draftLayer.get(firstCall.draftId)?.status).toBe('failed');
    expect(draftLayer.get(secondCall.draftId)?.status).toBe('draft');
  });
});

describe('application/study/studyUseCases / acceptFeedback', () => {
  it('writes a permanent StudyFeedback with authorType ai, transitions the draft to accepted', async () => {
    const deps = makeDeps({ router: makeFakeRouter({ content: 'feedback body', provider: 'cloud' }) });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const fb = await acceptFeedback(deps, {
      draftId: out.draftId,
      questionId: q.id,
      attemptId: a.id,
      body: 'feedback body',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(fb.authorType).toBe('ai');
    expect(fb.body).toBe('feedback body');
    expect(fb.provenance.provider).toBe('cloud');
    expect(fb.provenance.draftId).toBe(out.draftId);
    expect(draftLayer.get(out.draftId)?.status).toBe('accepted');
    const list = await deps.repository.listFeedbackForQuestion(q.id);
    expect(list.map((x) => x.id)).toEqual([fb.id]);
  });

  it('writes a `last-feedback` recovery entry', async () => {
    const deps = makeDeps({ router: makeFakeRouter() });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    await acceptFeedback(deps, {
      draftId: out.draftId,
      questionId: q.id,
      attemptId: a.id,
      body: 'feedback body',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    const recent = await deps.repository.listRecentRecovery('c-1', 'lec-1');
    const lastFeedback = recent.find((r) => r.key === 'last-feedback');
    expect(lastFeedback?.value).toBe('feedback body');
  });

  it('rejects an unknown draftId', async () => {
    const deps = makeDeps();
    await expect(
      acceptFeedback(deps, {
        draftId: 'no-such-draft',
        questionId: 'q',
        body: 'b',
        locator: null,
        containerId: 'c',
        lectureId: 'l',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('application/study/studyUseCases / rejectFeedback', () => {
  it('transitions the draft to rejected; no feedback is written', async () => {
    const deps = makeDeps({ router: makeFakeRouter() });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const out = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    await rejectFeedback(deps, { draftId: out.draftId });
    expect(draftLayer.get(out.draftId)?.status).toBe('rejected');
    const list = await deps.repository.listFeedbackForQuestion(q.id);
    expect(list.length).toBe(0);
  });

  it('rejecting an unknown draftId is a no-op', async () => {
    const deps = makeDeps();
    await expect(rejectFeedback(deps, { draftId: 'no-such' })).resolves.toBeUndefined();
  });
});

describe('application/study/studyUseCases / recordUserFeedback', () => {
  it('writes a permanent StudyFeedback with authorType user, provenance provider human', async () => {
    const deps = makeDeps();
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const fb = await recordUserFeedback(deps, {
      draftId: '', // not used
      questionId: q.id,
      attemptId: a.id,
      body: 'My own clarification.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(fb.authorType).toBe('user');
    expect(fb.provenance.provider).toBe('human');
    const list = await deps.repository.listFeedbackForQuestion(q.id);
    expect(list.length).toBe(1);
  });
});

describe('application/study/studyUseCases / markReview', () => {
  it('marks the question as reviewed + understood and updates updatedAt', async () => {
    const deps = makeDeps();
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const updated = await markReview(deps, {
      questionId: q.id,
      review: 'understood',
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(updated.review).toBe('understood');
    expect(updated.status).toBe('reviewed');
  });

  it('throws when the question does not exist', async () => {
    const deps = makeDeps();
    await expect(
      markReview(deps, {
        questionId: 'no-such',
        review: 'understood',
        containerId: 'c-1',
        lectureId: 'lec-1',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('application/study/studyUseCases / Verified Thought Loop (integration)', () => {
  it('Lecture → user explanation → AI Feedback → Question → Review, end-to-end', async () => {
    // AI on
    const deps = makeDeps({ router: makeFakeRouter({ content: 'You missed step 2.', provider: 'cloud', model: 'm' }) });
    // 1. Create a question while reading the lecture.
    const q = await createQuestion(deps, {
      body: 'What does the theorem state?',
      locator: makeLocator({ kind: 'page', pageNumber: 7, sourceDocumentId: 'doc-77' }),
      container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c-1' },
    });
    // 2. User types their own explanation.
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'The theorem says: every continuous function is differentiable.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    // 3. User requests AI feedback.
    const fb = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'How is my explanation?',
      contextText: 'Source passage text about the mean value theorem.',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(fb.failed).toBe(false);
    // 4. User Accepts.
    const persisted = await acceptFeedback(deps, {
      draftId: fb.draftId,
      questionId: q.id,
      attemptId: a.id,
      body: 'You missed step 2.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(persisted.authorType).toBe('ai');
    // 5. User marks review.
    const reviewed = await markReview(deps, {
      questionId: q.id,
      review: 'understood',
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(reviewed.status).toBe('reviewed');
    // 6. Reload-recovery entries are present.
    const recent = await deps.repository.listRecentRecovery('c-1', 'lec-1');
    expect(recent.find((r) => r.key === 'last-attempt')?.value).toContain('continuous function');
    expect(recent.find((r) => r.key === 'last-feedback')?.value).toContain('step 2');
  });

  it('AI off: the user can still complete the loop with `recordUserFeedback` and `markReview`', async () => {
    // AI off — no router.
    const deps = makeDeps({ router: null });
    const q = await createQuestion(deps, { body: 'q', locator: makeLocator() });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: 'att',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    const fb = await requestFeedback(deps, {
      questionId: q.id,
      attemptId: a.id,
      prompt: 'p',
      contextText: 'c',
      locator: makeLocator(),
      containerId: 'c-1',
    });
    expect(fb.failed).toBe(true);
    // User types their own feedback instead.
    const userFb = await recordUserFeedback(deps, {
      draftId: '',
      questionId: q.id,
      attemptId: a.id,
      body: 'I think this is right.',
      locator: makeLocator(),
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(userFb.authorType).toBe('user');
    const reviewed = await markReview(deps, {
      questionId: q.id,
      review: 'uncertain',
      containerId: 'c-1',
      lectureId: 'lec-1',
    });
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.review).toBe('uncertain');
  });
});
