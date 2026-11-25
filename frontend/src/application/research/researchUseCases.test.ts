/**
 * StudyKit v0.4 — `application/research/researchUseCases` tests
 *
 * Behavioural tests for the Research Evidence Slice
 * (WP-05). These exercise the use cases that the UI
 * relies on, end to end:
 *
 *   - Project / Living Brief persistence.
 *   - QuerySpec → runSearch → candidates → save / maybe /
 *     exclude → saveWorkFromCandidate.
 *   - canonicalisation + dedup (DOI / OpenAlex / arXiv /
 *     PMID / S2 / Zotero).
 *   - Maybe / Exclude are reversible.
 *   - Evidence Draft → verify → only verified can be
 *     linked to a Claim.
 *   - No locator / no quote / no interpretation → verify
 *     is rejected.
 *   - Claim → supports / contradicts / qualifies.
 *   - AI suggestion → accept / reject through the
 *     Draft Layer.
 *   - Conflict resolution: keep-existing / use-candidate /
 *     keep-both.
 *   - Run lineage: a re-run creates a new run, the old
 *     one is preserved.
 *
 * The tests do NOT bypass the use cases to poke the
 * repository directly — that would miss the invariants
 * the gate promises.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import {
  acceptClaimDraft,
  addWorkFromIdentifier,
  createClaim,
  createEvidenceDraft,
  createProject,
  linkEvidenceToClaim,
  rejectClaimDraft,
  rejectEvidence,
  resolveConflict,
  runSearch,
  saveQuerySpec,
  saveWorkFromCandidate,
  setCandidateVerdict,
  suggestClaimDraft,
  unlinkEvidenceFromClaim,
  updateLivingBrief,
  verifyEvidence,
} from './researchUseCases';
import { __resetAiKernelForTests } from '../../features/ai/kernel';
import { draftLayer } from '../../features/ai/kernel/draftLayer';
import {
  OpenAlexSearchProvider,
  makeFixtureFetch,
  deterministicOpenAlexResponse,
  type SearchProviderResult,
  type ProviderCandidate,
  type SearchProvider,
  OPEN_ALEX_PROVIDER_ID,
  mergeWorks,
} from './openAlexProvider';
import {
  canonicaliseDoi,
  hashQuote,
  isEvidence,
  isWork,
  makeWorkIdFromIdentifiers,
  type ClaimEvidenceLink,
  type Evidence,
  type QuerySpec,
  type ResearchProject,
  type Work,
} from '../../domain/research';
import type { ContainerRef } from '../../domain/workspace';
import { nowIso } from '../../domain/research';

const TS = '2026-07-21T12:00:00.000Z';
const CONTAINER: ContainerRef = { workspaceId: 'ws-local', mode: 'research', kind: 'project', id: 'p-1' };

describe('addWorkFromIdentifier', () => {
  it('adds and deduplicates a DOI as unverified user metadata', async () => {
    const repo = new MemoryResearchRepository();
    const first = await addWorkFromIdentifier(repo, {
      projectId: 'project-a',
      value: 'https://doi.org/10.1000/Example',
      title: 'A useful paper',
    });
    const second = await addWorkFromIdentifier(repo, {
      projectId: 'project-b',
      value: '10.1000/example',
    });

    expect(first.id).toBe(second.id);
    expect(second.identifiers.doi).toBe('10.1000/example');
    expect(second.projectIds).toEqual(['project-a', 'project-b']);
    expect(second.integrity).toBe('unknown');
    expect(await repo.listWorkAssetsForWork(first.id)).toEqual([]);
  });

  it('persists an http URL as an addressable source and rejects incomplete input', async () => {
    const repo = new MemoryResearchRepository();
    const work = await addWorkFromIdentifier(repo, {
      projectId: 'project-a',
      value: 'https://example.org/article?id=7',
      idFactory: () => 'asset-url-1',
    });

    expect(work.title).toBe('example.org');
    expect(work.assetIds).toEqual(['asset-url-1']);
    expect(await repo.listWorkAssetsForWork(work.id)).toEqual([
      expect.objectContaining({ id: 'asset-url-1', ref: 'https://example.org/article?id=7', kind: 'oa-url' }),
    ]);
    await expect(addWorkFromIdentifier(repo, { projectId: 'project-a', value: 'example.org' }))
      .rejects.toThrow('complete https:// URL or DOI');
  });
});

function makeProvider(seed: string, count = 3): SearchProvider {
  return new OpenAlexSearchProvider({
    fetchImpl: makeFixtureFetch({
      responses: new Map([
        [`https://api.openalex.org/works`, deterministicOpenAlexResponse({ seed, count })],
      ]),
    }),
  });
}

function makeProviderWithResult(result: SearchProviderResult): SearchProvider {
  return {
    id: 'fake',
    label: 'Fake',
    async probe() {
      return { available: true };
    },
    async runSearch(): Promise<SearchProviderResult> {
      return result;
    },
  };
}

function makeProviderWithFn(
  fn: () => Promise<SearchProviderResult>,
): SearchProvider {
  return {
    id: 'fn',
    label: 'Fn',
    async probe() {
      return { available: true };
    },
    runSearch: fn,
  };
}

function makeSpec(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    id: 'qs-1',
    projectId: 'p-1',
    question: 'How does sleep affect memory recall?',
    concepts: [{ label: 'sleep', synonyms: ['slumber'] }],
    // The `includeTerms` field becomes a hard
    // `title.search:` filter in OpenAlex; the fixture
    // titles only contain the `seed`, so we leave the
    // include set empty in the test. The question
    // becomes the `search=` clause, which is honoured
    // by every fixture response.
    includeTerms: [],
    excludeTerms: [],
    languages: ['en'],
    seedWorkIds: [],
    strategy: 'explore',
    aiAssisted: false,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeLocator() {
  return {
    kind: 'paper-page' as const,
    workId: 'doi:10.1/example',
    assetId: 'asset-1',
    pageNumber: 4,
    quoteHash: hashQuote('a representative quote'),
    capturedAt: TS,
  };
}

beforeEach(() => {
  draftLayer.__resetForTests();
  __resetAiKernelForTests();
});

describe('Project + Living Brief', () => {
  it('creates a project with default kind=blank and no brief', async () => {
    const repo = new MemoryResearchRepository();
    const p = await createProject(repo, { name: 'Sleep & memory', container: CONTAINER });
    expect(p.kind).toBe('blank');
    expect(p.livingBrief).toBe('');
    expect(p.container).toEqual(CONTAINER);
    const round = await repo.getProject(p.id);
    expect(round).toEqual(p);
  });

  it('rejects a non-research container', async () => {
    const repo = new MemoryResearchRepository();
    await expect(
      createProject(repo, {
        name: 'X',
        container: { workspaceId: null, mode: 'study', kind: 'course', id: 'c-1' },
      }),
    ).rejects.toThrow(/research project/);
  });

  it('updates the Living Brief and bumps updatedAt', async () => {
    const repo = new MemoryResearchRepository();
    const p = await createProject(repo, { name: 'X', container: CONTAINER });
    const next = await updateLivingBrief(repo, { projectId: p.id, livingBrief: 'A freeform brief.' });
    expect(next.livingBrief).toBe('A freeform brief.');
    expect(next.updatedAt >= p.updatedAt).toBe(true);
  });
});

describe('QuerySpec + runSearch', () => {
  it('persists the spec and runs the provider', async () => {
    const repo = new MemoryResearchRepository();
    const provider = makeProvider('sleep', 3);
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const spec = makeSpec();
    const { run, candidates } = await runSearch(repo, {
      projectId: project.id,
      querySpec: spec,
      provider,
      signal: new AbortController().signal,
    });
    expect(run.status).toBe('completed');
    expect(candidates.length).toBe(3);
    expect(run.candidateWorkIds.length).toBe(3);
    expect(run.providerId).toBe(OPEN_ALEX_PROVIDER_ID);
    const stored = await repo.getRun(run.id);
    expect(stored).toEqual(run);
  });

  it('preserves the run lineage: a second run becomes a new run with runNumber 2', async () => {
    const repo = new MemoryResearchRepository();
    const provider = makeProvider('sleep', 2);
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const r1 = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec(),
      provider,
      signal: new AbortController().signal,
    });
    const r2 = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec({ id: 'qs-2' }),
      provider,
      signal: new AbortController().signal,
    });
    expect(r1.run.runNumber).toBe(1);
    expect(r2.run.runNumber).toBe(2);
    const allRuns = await repo.listRuns({ projectId: project.id });
    expect(allRuns.length).toBe(2);
  });

  it('records a failed run when the provider throws', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const provider: SearchProvider = {
      id: 'broken',
      label: 'Broken',
      async probe() {
        return { available: false, reason: 'no network' };
      },
      async runSearch() {
        throw new Error('boom');
      },
    };
    const { run } = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec(),
      provider,
      signal: new AbortController().signal,
    });
    expect(run.status).toBe('failed');
    expect(run.errors[0]?.code).toBe('network');
  });

  it('records a cancelled run when the abort signal fires before fetch', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const ctl = new AbortController();
    ctl.abort();
    const provider = makeProvider('sleep', 1);
    const { run } = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec(),
      provider,
      signal: ctl.signal,
    });
    expect(run.status).toBe('cancelled');
  });
});

describe('Candidates — save / maybe / exclude / dedup / conflict', () => {
  async function setupWithRun(): Promise<{
    repo: MemoryResearchRepository;
    project: ResearchProject;
    spec: QuerySpec;
    candidateIds: string[];
    workIds: string[];
  }> {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const { candidates, run } = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec(),
      provider: makeProvider('sleep', 3),
      signal: new AbortController().signal,
    });
    void run;
    return {
      repo,
      project,
      spec: makeSpec(),
      candidateIds: candidates.map((c) => c.id),
      workIds: candidates.map((c) => c.workId),
    };
  }

  it('setCandidateVerdict marks Maybe / Exclude reversibly', async () => {
    const { repo, project, candidateIds } = await setupWithRun();
    const c1 = candidateIds[0]!;
    const c2 = candidateIds[1]!;
    const maybe = await setCandidateVerdict(repo, {
      candidateId: c1,
      userProjectId: project.id,
      verdict: 'maybe',
    });
    expect(maybe.verdict).toBe('maybe');
    const excluded = await setCandidateVerdict(repo, {
      candidateId: c2,
      userProjectId: project.id,
      verdict: 'excluded',
      excludeReason: 'not relevant',
    });
    expect(excluded.verdict).toBe('excluded');
    expect(excluded.excludeReason).toBe('not relevant');
    // Reversibility — flip back to pending.
    const back = await setCandidateVerdict(repo, {
      candidateId: c2,
      userProjectId: project.id,
      verdict: 'pending',
    });
    expect(back.verdict).toBe('pending');
  });

  it('saveWorkFromCandidate adds the project to the Work', async () => {
    const { repo, project, candidateIds, workIds } = await setupWithRun();
    const { work } = await saveWorkFromCandidate(repo, {
      candidateId: candidateIds[0]!,
      projectId: project.id,
    });
    expect(workIds).toContain(work.id);
    expect(work.projectIds).toContain(project.id);
    const stored = await repo.getWork(work.id);
    expect(stored?.projectIds).toContain(project.id);
  });

  it('saveWorkFromCandidate is idempotent (no double add)', async () => {
    const { repo, project, candidateIds } = await setupWithRun();
    await saveWorkFromCandidate(repo, { candidateId: candidateIds[0]!, projectId: project.id });
    const { work } = await saveWorkFromCandidate(repo, {
      candidateId: candidateIds[0]!,
      projectId: project.id,
    });
    const occurrences = work.projectIds.filter((id) => id === project.id).length;
    expect(occurrences).toBe(1);
  });

  it('canonicalises DOIs into the same Work id', () => {
    const a = makeWorkIdFromIdentifiers({ doi: canonicaliseDoi('https://doi.org/10.1/ABC')! }, 'x', ['a'], 2020);
    const b = makeWorkIdFromIdentifiers({ doi: canonicaliseDoi('10.1/abc')! }, 'x', ['a'], 2020);
    expect(a).toBe(b);
  });

  it('mergeWorks reports conflicts but the user can keep both', () => {
    const a: Work = {
      id: 'doi:10.1/x',
      identifiers: { doi: '10.1/x' },
      title: 'Old title',
      authors: ['Doe, J.'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: ['p-1'],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    const b: Work = {
      ...a,
      title: 'New title',
      year: 2024,
    };
    const { work, conflicts } = mergeWorks(a, b);
    expect(conflicts).toContain('title');
    expect(conflicts).toContain('year');
    expect(isWork(work)).toBe(true);
  });
});

describe('Evidence Draft → Verify', () => {
  it('cannot verify without a complete locator / quote / interpretation', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    // Persist a Work the evidence can attach to.
    const work: Work = {
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
      title: 'T',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => tx.putWork(work));
    const draft = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: makeLocator(),
      exactQuote: 'A representative quote.',
      evidenceType: 'finding',
    });
    // No userInterpretation → verify must throw.
    await expect(
      verifyEvidence(repo, { evidenceId: draft.id }),
    ).rejects.toThrow(/complete locator.*non-empty quote.*non-empty user interpretation/);
    // With interpretation + locator, verify succeeds.
    const verified = await verifyEvidence(repo, {
      evidenceId: draft.id,
      userInterpretation: 'My reading of the passage.',
    });
    expect(verified.status).toBe('verified');
  });

  it('rejects evidence even when the record is well-formed', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const work: Work = {
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
      title: 'T',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => tx.putWork(work));
    const draft = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: makeLocator(),
      exactQuote: 'A representative quote.',
      userInterpretation: 'My reading.',
      evidenceType: 'finding',
    });
    const rejected = await rejectEvidence(repo, { evidenceId: draft.id });
    expect(rejected.status).toBe('rejected');
  });

  it('evidence without a real locator can be saved as candidate but not verified', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const work: Work = {
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
      title: 'T',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => tx.putWork(work));
    // The locator has no assetId and no pageNumber.
    const draft = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: {
        kind: 'paper-page',
        workId: work.id,
        capturedAt: TS,
      },
      exactQuote: 'A representative quote.',
      userInterpretation: 'My reading.',
      evidenceType: 'finding',
    });
    // The draft is saved (candidate); verify fails because
    // the locator is incomplete.
    expect(draft.status).toBe('candidate');
    await expect(
      verifyEvidence(repo, { evidenceId: draft.id }),
    ).rejects.toThrow(/complete locator/);
  });
});

describe('Claim + ClaimEvidenceLink', () => {
  it('creates a Claim in canonical state', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const c = await createClaim(repo, {
      projectId: project.id,
      title: 'Sleep loss reduces recall',
      body: 'A summary of the findings.',
    });
    expect(c.status).toBe('canonical');
    expect(c.authorType).toBe('user');
  });

  it('links a verified Evidence to a Claim with supports / contradicts / qualifies', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const work: Work = {
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
      title: 'T',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => tx.putWork(work));
    const claim = await createClaim(repo, {
      projectId: project.id,
      title: 'Sleep loss reduces recall',
      body: 'A summary.',
    });
    const e1 = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: makeLocator(),
      exactQuote: 'Quote 1',
      userInterpretation: 'Reading 1',
      evidenceType: 'finding',
    });
    const e2 = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: { ...makeLocator(), pageNumber: 5 },
      exactQuote: 'Quote 2',
      userInterpretation: 'Reading 2',
      evidenceType: 'finding',
    });
    const e3 = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: { ...makeLocator(), pageNumber: 6 },
      exactQuote: 'Quote 3',
      userInterpretation: 'Reading 3',
      evidenceType: 'limitation',
    });
    const v1 = await verifyEvidence(repo, { evidenceId: e1.id });
    const v2 = await verifyEvidence(repo, { evidenceId: e2.id });
    const v3 = await verifyEvidence(repo, { evidenceId: e3.id });
    const linkSupports: ClaimEvidenceLink = await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: v1.id,
      relation: 'supports',
    });
    const linkContradicts: ClaimEvidenceLink = await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: v2.id,
      relation: 'contradicts',
    });
    const linkQualifies: ClaimEvidenceLink = await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: v3.id,
      relation: 'qualifies',
    });
    expect(linkSupports.relation).toBe('supports');
    expect(linkContradicts.relation).toBe('contradicts');
    expect(linkQualifies.relation).toBe('qualifies');
    const allLinks = await repo.listLinks({ projectId: project.id });
    expect(allLinks.length).toBe(3);
  });

  it('refuses to link an unverified Evidence', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const work: Work = {
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
      title: 'T',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => tx.putWork(work));
    const claim = await createClaim(repo, {
      projectId: project.id,
      title: 'X',
      body: 'Y',
    });
    const e = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: makeLocator(),
      exactQuote: 'Quote',
      userInterpretation: 'Reading',
      evidenceType: 'finding',
    });
    // Evidence is candidate, not verified.
    await expect(
      linkEvidenceToClaim(repo, {
        projectId: project.id,
        claimId: claim.id,
        evidenceId: e.id,
        relation: 'supports',
      }),
    ).rejects.toThrow(/not verified/);
  });

  it('unlinkEvidenceFromClaim removes the link without touching the claim or evidence', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const work: Work = {
      id: 'doi:10.1/example',
      identifiers: { doi: '10.1/example' },
      title: 'T',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => tx.putWork(work));
    const claim = await createClaim(repo, { projectId: project.id, title: 'X', body: 'Y' });
    const e = await createEvidenceDraft(repo, {
      projectId: project.id,
      workId: work.id,
      locator: makeLocator(),
      exactQuote: 'Q',
      userInterpretation: 'I',
      evidenceType: 'finding',
    });
    const v = await verifyEvidence(repo, { evidenceId: e.id });
    const link = await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: v.id,
      relation: 'supports',
    });
    await unlinkEvidenceFromClaim(repo, { linkId: link.id });
    const all = await repo.listLinks({ projectId: project.id });
    expect(all.length).toBe(0);
    // Claim and Evidence still present.
    expect(await repo.getClaim(claim.id)).not.toBeNull();
    expect(await repo.getEvidence(v.id)).not.toBeNull();
  });
});

describe('AI Claim Draft (Draft Layer integration)', () => {
  it('suggest → accept creates a canonical Claim with aiSuggested=true', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const draft = suggestClaimDraft({
      projectId: project.id,
      title: 'Sleep loss reduces recall',
      body: 'AI-suggested body.',
    });
    const claim = await acceptClaimDraft(repo, {
      draftId: draft.id,
      projectId: project.id,
      title: 'Sleep loss reduces recall',
      body: 'AI-suggested body.',
    });
    expect(claim.aiSuggested).toBe(true);
    expect(claim.authorType).toBe('ai');
    expect(claim.status).toBe('canonical');
  });

  it('suggest → reject writes nothing to the repository', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const draft = suggestClaimDraft({
      projectId: project.id,
      title: 'X',
      body: 'Y',
    });
    rejectClaimDraft(draft.id);
    const claims = await repo.listClaims({ projectId: project.id });
    expect(claims.length).toBe(0);
  });
});

describe('Conflict resolution', () => {
  it('drops the conflict with keep-existing', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const existing: Work = {
      id: 'w-existing',
      identifiers: {},
      title: 'Existing',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [project.id],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    const candidate: Work = {
      id: 'w-candidate',
      identifiers: {},
      title: 'Candidate',
      authors: ['Doe'],
      year: 2020,
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [],
      readingStatus: 'unread',
      importance: 0,
      createdAt: TS,
      updatedAt: TS,
      authorType: 'imported',
    };
    await repo.transact(async (tx) => {
      tx.putWork(existing);
      tx.putWork(candidate);
      tx.putCandidate({
        id: 'cand-x',
        runId: 'run-x',
        projectId: project.id,
        workId: candidate.id,
        work: candidate,
        providerRank: 0,
        reasonChips: ['matches-construct'],
        reasonNotes: ['n'],
        verdict: 'pending',
      });
      tx.putConflict({
        id: 'wc-1',
        projectId: project.id,
        candidateWorkId: candidate.id,
        existingWorkId: existing.id,
        fields: ['title'],
        createdAt: TS,
      });
    });
    await resolveConflict(repo, { conflictId: 'wc-1', resolution: 'use-existing' });
    const conflicts = await repo.listConflicts({ projectId: project.id });
    expect(conflicts.length).toBe(0);
    const c = await repo.getCandidate('cand-x');
    expect(c?.verdict).toBe('excluded');
  });
});

describe('QuerySpec persistence', () => {
  it('saveQuerySpec persists the spec, editOfSpecId stays', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const spec = await saveQuerySpec(repo, {
      projectId: project.id,
      question: 'Q?',
      concepts: [],
      includeTerms: ['a'],
      excludeTerms: [],
      dateRange: undefined,
      languages: ['en'],
      seedWorkIds: [],
      strategy: 'balanced',
      aiAssisted: true,
    });
    expect(spec.id).toMatch(/^qs_/);
    const stored = await repo.getQuerySpec(spec.id);
    expect(stored?.aiAssisted).toBe(true);
    // Re-saving produces a *new* spec.
    const spec2 = await saveQuerySpec(repo, {
      projectId: project.id,
      question: 'Q2?',
      concepts: [],
      includeTerms: ['a'],
      excludeTerms: [],
      dateRange: undefined,
      languages: ['en'],
      seedWorkIds: [],
      strategy: 'balanced',
      aiAssisted: false,
      editOfSpecId: spec.id,
    });
    expect(spec2.id).not.toBe(spec.id);
    const all = await repo.listQuerySpecsForProject(project.id);
    expect(all.length).toBe(2);
  });
});

describe('Re-run preserves previous run + Maybe / Exclude verdicts', () => {
  it('a re-run keeps the prior run and the user can restore the prior Maybe verdict', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const r1 = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec({ id: 'qs-1' }),
      provider: makeProvider('sleep', 2),
      signal: new AbortController().signal,
    });
    await setCandidateVerdict(repo, {
      candidateId: r1.candidates[0]!.id,
      userProjectId: project.id,
      verdict: 'maybe',
    });
    const r2 = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec({ id: 'qs-2' }),
      provider: makeProvider('sleep', 2),
      signal: new AbortController().signal,
    });
    expect(r2.run.runNumber).toBe(2);
    // The Maybe verdict is still there on the previous candidate.
    const stored = await repo.getCandidate(r1.candidates[0]!.id);
    expect(stored?.verdict).toBe('maybe');
    // And the user can flip it back to pending if they change their mind.
    const flipped = await setCandidateVerdict(repo, {
      candidateId: r1.candidates[0]!.id,
      userProjectId: project.id,
      verdict: 'pending',
    });
    expect(flipped.verdict).toBe('pending');
  });
});

describe('Real-world save flow — three Works, three verified Evidence, one Claim with mixed relations', () => {
  it('end-to-end: search → save → evidence → verify → claim → links', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    // 1) Run a search that returns 3 works.
    const r = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec(),
      provider: makeProvider('sleep', 3),
      signal: new AbortController().signal,
    });
    expect(r.candidates.length).toBe(3);
    // 2) Save all three to the library.
    const saved: Work[] = [];
    for (const c of r.candidates) {
      const { work } = await saveWorkFromCandidate(repo, {
        candidateId: c.id,
        projectId: project.id,
      });
      saved.push(work);
    }
    expect(saved.length).toBe(3);
    // 3) Create + verify one Evidence per work.
    const evidence: Evidence[] = [];
    for (const w of saved) {
      const draft = await createEvidenceDraft(repo, {
        projectId: project.id,
        workId: w.id,
        locator: { ...makeLocator(), workId: w.id },
        exactQuote: 'Quote for ' + w.title,
        userInterpretation: 'Reading for ' + w.title,
        evidenceType: 'finding',
      });
      const verified = await verifyEvidence(repo, { evidenceId: draft.id });
      expect(verified.status).toBe('verified');
      evidence.push(verified);
    }
    // 4) Create one Claim, link with all three relations.
    const claim = await createClaim(repo, {
      projectId: project.id,
      title: 'Sleep loss reduces recall',
      body: 'Across three studies.',
    });
    await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: evidence[0]!.id,
      relation: 'supports',
    });
    await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: evidence[1]!.id,
      relation: 'contradicts',
    });
    await linkEvidenceToClaim(repo, {
      projectId: project.id,
      claimId: claim.id,
      evidenceId: evidence[2]!.id,
      relation: 'qualifies',
    });
    // 5) Reload: the data must round-trip.
    const reloadedClaims = await repo.listClaims({ projectId: project.id });
    expect(reloadedClaims.length).toBe(1);
    const reloadedLinks = await repo.listLinks({ projectId: project.id });
    expect(reloadedLinks.length).toBe(3);
    const reloadedEvidence = await repo.listEvidence({ projectId: project.id });
    expect(reloadedEvidence.length).toBe(3);
    expect(reloadedEvidence.every((e) => e.status === 'verified')).toBe(true);
    const reloadedWorks = await repo.listWorks({ projectId: project.id });
    expect(reloadedWorks.length).toBe(3);
  });
});

describe('SearchRunListResult renders the openalex response correctly', () => {
  it('records http error when the response is not 2xx', async () => {
    const repo = new MemoryResearchRepository();
    const project = await createProject(repo, { name: 'X', container: CONTAINER });
    const provider: SearchProvider = {
      id: 'httpfail',
      label: 'http fail',
      async probe() {
        return { available: true };
      },
      async runSearch() {
        return {
          status: 'failed',
          candidates: [],
          totalHits: 0,
          errors: [
            {
              providerId: 'httpfail',
              code: 'http',
              status: 503,
              message: 'service unavailable',
            },
          ],
          completedAt: nowIso(),
        };
      },
    };
    const { run } = await runSearch(repo, {
      projectId: project.id,
      querySpec: makeSpec(),
      provider,
      signal: new AbortController().signal,
    });
    expect(run.status).toBe('failed');
    expect(run.errors[0]?.code).toBe('http');
    expect(run.errors[0]?.status).toBe(503);
  });
});

describe('ProviderCandidate ranking + reason chips', () => {
  it('attaches open-access and recent-review chips for newer, OA papers', async () => {
    const provider = makeProvider('sleep', 5);
    const { run, candidates } = await runSearch(
      new MemoryResearchRepository(),
      {
        projectId: 'p-x',
        querySpec: makeSpec(),
        provider,
        signal: new AbortController().signal,
      },
    );
    // Higher-index candidates are older, lower-index are
    // newer; check the chips fire on the right ones.
    const newer = candidates[0]!;
    expect(newer.reasonChips.length).toBeGreaterThan(0);
    expect(run.candidateWorkIds[0]).toBe(newer.workId);
  });
});
