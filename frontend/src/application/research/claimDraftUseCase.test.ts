/**
 * StudyKit v0.4 — `generateClaimDraft` contract tests (WP-05 Gate)
 *
 * Round 4 fix: the use case MUST thread the *real*
 * provider / model from `providerRouter.chat` into the
 * Draft Layer provenance. A response from Ollama must
 * not be mislabelled as `cloud`. The test pins:
 *
 *   - `ollama` response → provenance.provider === 'ollama'
 *   - `cloud` response → provenance.provider === 'cloud'
 *   - missing model string → no `model` key
 *   - missing provider string → provenance.provider === 'unknown'
 *   - failed route → no Draft Layer record is written
 *   - The Draft Layer record's `provenance.provider` is
 *     what the audit trail will surface.
 *
 * Tests are *contract* tests on the use case; the UI
 * assertion is in
 * `v04ResearchProduction.test.tsx` (real Suggest UI).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateClaimDraft, type ClaimDraftInput } from './claimDraftUseCase';
import { draftLayer } from '../../features/ai/kernel/draftLayer';
import type { ProviderRouter, ProviderChatResponse } from '../../features/ai/kernel/providerRouter';
import type { ResearchProject, Work, Evidence } from '../../domain/research';
import { MemoryResearchRepository } from './researchRepository';

function makeProject(): ResearchProject {
  const now = new Date().toISOString();
  return {
    id: 'p-1',
    container: { workspaceId: 'ws-1', mode: 'research', kind: 'project', id: 'p-1' },
    name: 'AI provenance test',
    livingBrief: 'brief',
    kind: 'blank',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function makeWork(): Work {
  const now = new Date().toISOString();
  return {
    id: 'work-1',
    identifiers: { doi: '10.0/test' },
    title: 'Test paper',
    authors: ['A'],
    metadataProvenance: {
      title: { providerId: 'openalex', at: now },
      authors: { providerId: 'openalex', at: now },
    },
    integrity: 'unknown',
    assetIds: [],
    projectIds: ['p-1'],
    readingStatus: 'unread',
    importance: 0,
    createdAt: now,
    updatedAt: now,
    authorType: 'imported',
  };
}

function makeEvidence(workId: string): Evidence {
  const now = new Date().toISOString();
  return {
    id: 'ev-1',
    projectId: 'p-1',
    workId,
    locator: {
      kind: 'paper-page',
      workId,
      assetId: 'asset-1',
      pageNumber: 1,
      quoteHash: 'qh',
      capturedAt: now,
    },
    exactQuote: 'q',
    userInterpretation: 'i',
    evidenceType: 'finding',
    status: 'verified',
    createdAt: now,
    updatedAt: now,
    authorType: 'user',
  };
}

function makeRouter(chat: (req: unknown) => Promise<{ content: string; provider?: 'ollama' | 'cloud'; model?: string }>): ProviderRouter {
  return {
    capabilities: () => ({ supports: {} as Record<string, boolean>, flavour: 'sync' as const, list: () => [] }),
    chat: chat as unknown as ProviderRouter['chat'],
  } as unknown as ProviderRouter;
}

beforeEach(() => {
  draftLayer.__resetForTests();
});

describe('generateClaimDraft provenance', () => {
  it('writes the real provider name from the router response (ollama)', async () => {
    const router = makeRouter(async () => ({
      content: 'Sleep consolidates memory.\nAcross three studies, the effect is consistent.',
      provider: 'ollama',
      model: 'llama3.1:8b',
    }));
    const input: ClaimDraftInput = {
      project: makeProject(),
      contextText: '',
      evidence: [{ evidence: makeEvidence('work-1'), work: makeWork() }],
      providerRouter: router,
    };
    const res = await generateClaimDraft(input);
    expect(res.kind).toBe('draft');
    if (res.kind === 'draft') {
      // The Draft Layer record must surface the real
      // provider; not a hardcoded `cloud`.
      expect(res.draft.provenance.provider).toBe('ollama');
      expect(res.draft.provenance.model).toBe('llama3.1:8b');
      // The `actionId` is preserved.
      expect(res.draft.provenance.actionId).toBe('research.generateClaimDraft');
    }
  });

  it('writes the real provider name from the router response (cloud)', async () => {
    const router = makeRouter(async () => ({
      content: 'Sleep consolidates memory.\nAcross three studies, the effect is consistent.',
      provider: 'cloud',
      model: 'claude-3-5-sonnet',
    }));
    const res = await generateClaimDraft({
      project: makeProject(),
      contextText: '',
      evidence: [{ evidence: makeEvidence('work-1'), work: makeWork() }],
      providerRouter: router,
    });
    expect(res.kind).toBe('draft');
    if (res.kind === 'draft') {
      expect(res.draft.provenance.provider).toBe('cloud');
      expect(res.draft.provenance.model).toBe('claude-3-5-sonnet');
    }
  });

  it('omits the `model` key when the response has no model string', async () => {
    const router = makeRouter(async () => ({
      content: 'Sleep consolidates memory.\nAcross three studies, the effect is consistent.',
      provider: 'ollama',
    }));
    const res = await generateClaimDraft({
      project: makeProject(),
      contextText: '',
      evidence: [{ evidence: makeEvidence('work-1'), work: makeWork() }],
      providerRouter: router,
    });
    expect(res.kind).toBe('draft');
    if (res.kind === 'draft') {
      expect(res.draft.provenance.provider).toBe('ollama');
      expect(res.draft.provenance.model).toBeUndefined();
    }
  });

  it('records `unknown` when the response has no provider string (defensive)', async () => {
    const router = makeRouter(async () => ({
      content: 'Sleep consolidates memory.\nAcross three studies, the effect is consistent.',
    }));
    const res = await generateClaimDraft({
      project: makeProject(),
      contextText: '',
      evidence: [{ evidence: makeEvidence('work-1'), work: makeWork() }],
      providerRouter: router,
    });
    expect(res.kind).toBe('draft');
    if (res.kind === 'draft') {
      // The audit trail never lies: `unknown` is
      // honest, `cloud` would be a fabrication.
      expect(res.draft.provenance.provider).toBe('unknown');
    }
  });

  it('does not write a Draft Layer record when the provider fails', async () => {
    const router = makeRouter(async () => {
      throw new Error('upstream timeout');
    });
    const res = await generateClaimDraft({
      project: makeProject(),
      contextText: '',
      evidence: [{ evidence: makeEvidence('work-1'), work: makeWork() }],
      providerRouter: router,
    });
    expect(res.kind).toBe('failed');
    if (res.kind === 'failed') {
      expect(res.reason).toBe('provider-failed');
    }
    expect(draftLayer.list().length).toBe(0);
  });

  it('repository state is untouched on the failed path', async () => {
    // The use case must not write a canonical Claim
    // on the failure path; only Draft Layer
    // mutations are allowed.
    const repo = new MemoryResearchRepository();
    const router = makeRouter(async () => {
      throw new Error('upstream timeout');
    });
    const res = await generateClaimDraft({
      project: makeProject(),
      contextText: '',
      evidence: [{ evidence: makeEvidence('work-1'), work: makeWork() }],
      providerRouter: router,
    });
    expect(res.kind).toBe('failed');
    const claims = await repo.listClaims({ projectId: 'p-1' });
    expect(claims).toHaveLength(0);
  });
});
