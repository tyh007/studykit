import { describe, expect, it, vi } from 'vitest';
import type { Work } from '../../domain/research';
import { MemoryResearchRepository } from '../research/researchRepository';
import {
  applyCitationVerification,
  CrossrefOpenAlexCitationVerifier,
  parseCrossrefVerification,
} from './citationVerification';

const now = '2026-07-31T00:00:00.000Z';
const work: Work = {
  id: 'work-1',
  identifiers: { doi: '10.1234/example', openAlex: 'W123' },
  title: 'Old title',
  authors: ['Doe, Jane'],
  year: 2024,
  venue: 'Old venue',
  metadataProvenance: {},
  integrity: 'unknown',
  assetIds: [],
  projectIds: ['p-1'],
  readingStatus: 'read',
  importance: 0,
  createdAt: now,
  updatedAt: now,
  authorType: 'imported',
};

const crossrefPayload = {
  message: {
    DOI: '10.1234/example',
    title: ['Sleep and Memory'],
    author: [{ family: 'Doe', given: 'Jane' }, { family: 'Roe', given: 'John' }],
    issued: { 'date-parts': [[2025]] },
    'container-title': ['Journal of Sleep'],
    'update-to': [{ type: 'correction' }],
  },
};

const openAlexPayload = {
  id: 'https://openalex.org/W123',
  doi: 'https://doi.org/10.1234/example',
  title: 'Sleep and Memory',
  publication_year: 2025,
  authorships: [
    { author: { display_name: 'Jane Doe' } },
    { author: { display_name: 'John Roe' } },
  ],
  primary_location: { source: { display_name: 'Journal of Sleep' } },
};

describe('citation verification', () => {
  it('strictly parses matching Crossref metadata and update status', () => {
    const source = parseCrossrefVerification(crossrefPayload, '10.1234/example', now);
    expect(source.integrity).toBe('corrected');
    expect(source.metadata).toMatchObject({ title: 'Sleep and Memory', year: 2025 });
    expect(() => parseCrossrefVerification(crossrefPayload, '10.9999/wrong', now)).toThrow(/did not match/);
  });

  it('queries Crossref and OpenAlex in one explicit verification without writing', async () => {
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => url.includes('crossref') ? crossrefPayload : openAlexPayload,
    }));
    const verifier = new CrossrefOpenAlexCitationVerifier({ fetchImpl });
    const result = await verifier.verify(work);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sources.map((source) => source.providerId)).toEqual(['crossref', 'openalex']);
    expect(result.differences.map((difference) => difference.field)).toEqual([
      'title', 'authors', 'year', 'venue',
    ]);
    expect(result.integrity).toBe('corrected');
  });

  it('surfaces partial provider failure while preserving the successful registry result', async () => {
    const verifier = new CrossrefOpenAlexCitationVerifier({
      fetchImpl: async (url) => {
        if (url.includes('crossref')) throw new Error('offline');
        return { ok: true, status: 200, json: async () => openAlexPayload };
      },
    });
    const result = await verifier.verify(work);
    expect(result.sources).toHaveLength(1);
    expect(result.errors).toEqual(['offline']);
    expect(result.integrity).toBe('unknown');
  });

  it('applies only user-accepted fields and integrity, with provenance', async () => {
    const repo = new MemoryResearchRepository();
    await repo.transact((tx) => tx.putWork(work));
    const verifier = new CrossrefOpenAlexCitationVerifier({
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        json: async () => url.includes('crossref') ? crossrefPayload : openAlexPayload,
      }),
    });
    const result = await verifier.verify(work);
    expect((await repo.getWork(work.id))?.title).toBe('Old title');
    const updated = await applyCitationVerification(repo, {
      result,
      acceptedFields: ['title', 'year'],
      acceptIntegrity: true,
    });
    expect(updated).toMatchObject({ title: 'Sleep and Memory', year: 2025, venue: 'Old venue', integrity: 'corrected' });
    expect(updated.metadataProvenance.title?.providerId).toBe('crossref');
    expect(updated.integrityCheckedAt).toBe(result.checkedAt);
  });

  it('rejects stale previews instead of overwriting a concurrent edit', async () => {
    const repo = new MemoryResearchRepository();
    await repo.transact((tx) => tx.putWork(work));
    const verifier = new CrossrefOpenAlexCitationVerifier({
      fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => url.includes('crossref') ? crossrefPayload : openAlexPayload }),
    });
    const result = await verifier.verify(work);
    await repo.transact((tx) => tx.putWork({ ...work, title: 'User edit', updatedAt: '2026-07-31T01:00:00.000Z' }));
    await expect(applyCitationVerification(repo, {
      result,
      acceptedFields: ['title'],
      acceptIntegrity: false,
    })).rejects.toThrow(/changed after verification/);
    expect((await repo.getWork(work.id))?.title).toBe('User edit');
  });
});
