import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { captureExcerpt, createClaim, relationInterpretation } from './researchUseCases';
import { makeResearchLocator, makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';
import type { ResearchSourceLocator } from '../../domain/research';

const P = 'p-001';
let repo: MemoryResearchRepository;

const locator = (overrides: Partial<ResearchSourceLocator> = {}): ResearchSourceLocator =>
  makeResearchLocator({ workId: 'w-1', ...overrides } as Partial<ResearchSourceLocator>);

beforeEach(async () => {
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P }));
    tx.putProject(makeResearchProject({ id: 'p-other' }));
    tx.putWork(makeWork({ id: 'w-1', projectIds: [P] }));
  });
});

describe('captureExcerpt', () => {
  it('creates a new point, a verified excerpt and the link in one step', async () => {
    const r = await captureExcerpt(repo, {
      projectId: P,
      workId: 'w-1',
      locator: locator(),
      exactQuote: '  Sleep strengthens consolidation.  ',
      point: { kind: 'new', title: '  Sleep helps memory ' },
    });
    expect(r.claim?.title).toBe('Sleep helps memory');
    expect(r.claim?.authorType).toBe('user');
    expect(r.evidence.status).toBe('verified');
    expect(r.evidence.exactQuote).toBe('Sleep strengthens consolidation.');
    expect(r.evidence.userInterpretation).toBe('Supports: Sleep helps memory');
    expect(r.evidence.authorType).toBe('user');
    expect(r.link).toMatchObject({ claimId: r.claim!.id, evidenceId: r.evidence.id, relation: 'supports' });
    expect(await repo.listClaims({ projectId: P })).toHaveLength(1);
    expect(await repo.listLinks({ projectId: P })).toHaveLength(1);
  });

  it('links to an existing point with the chosen relation and the user’s own note', async () => {
    const claim = await createClaim(repo, { projectId: P, title: 'Sleep helps memory', body: '' });
    const r = await captureExcerpt(repo, {
      projectId: P,
      workId: 'w-1',
      locator: locator(),
      exactQuote: 'No effect on procedural skills.',
      point: { kind: 'existing', claimId: claim.id },
      relation: 'contradicts',
      note: 'Only declarative memory benefits',
    });
    expect(r.claim?.id).toBe(claim.id);
    expect(r.evidence.userInterpretation).toBe('Only declarative memory benefits');
    expect(r.link?.relation).toBe('contradicts');
    expect(r.link?.note).toBe('Only declarative memory benefits');
    expect(await repo.listClaims({ projectId: P })).toHaveLength(1);
  });

  it('saves an excerpt on its own as an unverified candidate', async () => {
    const r = await captureExcerpt(repo, { projectId: P, workId: 'w-1', locator: locator(), exactQuote: 'A passage.' });
    expect(r.evidence.status).toBe('candidate');
    expect(r.evidence.userInterpretation).toBe('');
    expect(r.evidence.authorType).toBe('user');
    expect(r.claim).toBeNull();
    expect(r.link).toBeNull();
  });

  it('verifies an excerpt with a note even without a point', async () => {
    const r = await captureExcerpt(repo, {
      projectId: P,
      workId: 'w-1',
      locator: locator(),
      exactQuote: 'A passage.',
      note: 'Key definition',
    });
    expect(r.evidence.status).toBe('verified');
  });

  it('refuses to back a point with an incomplete locator and writes nothing', async () => {
    await expect(
      captureExcerpt(repo, {
        projectId: P,
        workId: 'w-1',
        locator: locator({ assetId: undefined } as Partial<ResearchSourceLocator>),
        exactQuote: 'A passage.',
        point: { kind: 'new', title: 'Sleep helps memory' },
      }),
    ).rejects.toThrow(/complete page locator/);
    expect(await repo.listClaims({ projectId: P })).toHaveLength(0);
    expect(await repo.listEvidence({ projectId: P })).toHaveLength(0);
  });

  it('rejects empty excerpts, unknown works, blank new points and points from other projects', async () => {
    await expect(captureExcerpt(repo, { projectId: P, workId: 'w-1', locator: locator(), exactQuote: '   ' })).rejects.toThrow(/empty/);
    await expect(captureExcerpt(repo, { projectId: P, workId: 'nope', locator: locator(), exactQuote: 'x' })).rejects.toThrow(/not found/);
    await expect(
      captureExcerpt(repo, { projectId: P, workId: 'w-1', locator: locator(), exactQuote: 'x', point: { kind: 'new', title: ' ' } }),
    ).rejects.toThrow(/needs a title/);
    const foreign = await createClaim(repo, { projectId: 'p-other', title: 'Elsewhere', body: '' });
    await expect(
      captureExcerpt(repo, {
        projectId: P,
        workId: 'w-1',
        locator: locator(),
        exactQuote: 'x',
        point: { kind: 'existing', claimId: foreign.id },
      }),
    ).rejects.toThrow(/another project/);
  });

  it('describes the user’s choice in plain words', () => {
    expect(relationInterpretation('supports', ' A ')).toBe('Supports: A');
    expect(relationInterpretation('contradicts', 'A')).toBe('Contradicts: A');
    expect(relationInterpretation('qualifies', 'A')).toBe('Qualifies: A');
  });
});
