/**
 * StudyKit v0.4 — `resolveWorkReaderSource` tests (WP-05 Gate)
 *
 * The function is the single seam between a canonical
 * `Work` and the `LiteraturePDFSource` the Reader
 * renders. The contract has three tiers:
 *
 *   1. `local-pdf` WorkAsset → `{ kind: 'local-url', url, assetId }`
 *   2. `linked-file` WorkAsset → `{ kind: 'remote', paperId: ref, assetId }`
 *   3. DOI match in v0.3 `LiteraturePaper` → `{ kind: 'remote', paperId, assetId }`
 *
 * Every "ok" result carries an `assetId` so the
 * Evidence drawer can build a `paper-page` locator
 * that satisfies `isCompleteResearchLocator`. The
 * failure mode (`no-asset` / `sync-only`) is honest
 * and surfaces to the UI.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { resolveWorkReaderSource } from './workReaderSource';
import type { ResearchRepository } from './researchRepository';
import type { Work, WorkAsset } from '../../domain/research';

vi.mock('../../platforms/web/pdfAssetStore', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const blobs = new Map<string, { blob: Blob; contentHash: string; storedAt: string }>();
  const urlCache = new Map<string, string>();
  const fakeStore = {
    async put(input: { assetId: string; blob: Blob; contentHash: string }) {
      blobs.set(input.assetId, { blob: input.blob, contentHash: input.contentHash, storedAt: new Date().toISOString() });
      return { assetId: input.assetId, contentHash: input.contentHash, storedAt: new Date().toISOString(), sizeBytes: input.blob.size };
    },
    async get(assetId: string) {
      return blobs.get(assetId)?.blob ?? null;
    },
    async getMeta(assetId: string) {
      const row = blobs.get(assetId);
      if (!row) return null;
      return { assetId, contentHash: row.contentHash, storedAt: row.storedAt, sizeBytes: row.blob.size };
    },
    async getObjectUrl(assetId: string) {
      const cached = urlCache.get(assetId);
      if (cached) return cached;
      const row = blobs.get(assetId);
      if (!row) return null;
      const url = URL.createObjectURL(row.blob);
      urlCache.set(assetId, url);
      return url;
    },
    releaseObjectUrl(assetId: string) {
      const url = urlCache.get(assetId);
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        urlCache.delete(assetId);
      }
    },
    async delete(assetId: string) {
      const url = urlCache.get(assetId);
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        urlCache.delete(assetId);
      }
      blobs.delete(assetId);
    },
    async clear() {
      for (const url of urlCache.values()) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
      urlCache.clear();
      blobs.clear();
    },
  };
  return {
    ...actual,
    pdfAssetStore: fakeStore,
  };
});

// The `dataApi` is read via `getDataApi()`; the resolver
// uses `dataApi.supports('literaturePapers.list')` and
// `dataApi.literaturePapers.list(projectId)`. We mock
// the module to drive the legacy-paper path.
let mockLegacyPapers: Array<{ id: string; doi?: string | null }> = [];
let mockSupportsLegacy = true;
vi.mock('../dataApi', () => ({
  getDataApi: () => ({
    supports: (_cap: string) => mockSupportsLegacy,
    literaturePapers: {
      list: async (_projectId: string) => mockLegacyPapers,
    },
  }),
  useSupports: () => true,
  useCapability: () => ({ supported: true, tooltip: '' }),
}));

function makeWork(overrides: Partial<Work> = {}): Work {
  const now = new Date().toISOString();
  return {
    id: 'work_1',
    identifiers: {},
    title: 'A test work',
    authors: ['Author A'],
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
    ...overrides,
  };
}

async function seedAsset(repo: ResearchRepository, workId: string, asset: WorkAsset): Promise<void> {
  await repo.transact(async (tx) => {
    tx.putWorkAsset(asset);
  });
  // Make sure the Work's assetIds includes the asset id.
  const w = await repo.getWork(workId);
  if (w) {
    await repo.transact(async (tx) => {
      tx.putWork({ ...w, assetIds: Array.from(new Set([...w.assetIds, asset.id])) });
    });
  }
}

beforeEach(() => {
  mockLegacyPapers = [];
  mockSupportsLegacy = true;
});

describe('resolveWorkReaderSource', () => {
  it('tier 1: local-pdf WorkAsset → local-url with assetId', async () => {
    const repo = new MemoryResearchRepository();
    const work = makeWork({ id: 'work_local' });
    await repo.transact(async (tx) => {
      tx.putWork(work);
    });
    // Inject the asset bytes into the (mocked) pdfAssetStore.
    const { pdfAssetStore } = await import('../../platforms/web/pdfAssetStore');
    await pdfAssetStore.put({
      assetId: 'asset_local_1',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
      contentHash: 'h1',
    });
    await seedAsset(repo, work.id, {
      id: 'asset_local_1',
      workId: work.id,
      kind: 'local-pdf',
      ref: 'asset_local_1',
      createdAt: new Date().toISOString(),
    });
    // Read the Work back so `work.assetIds` reflects
    // the seed.
    const stored = (await repo.getWork(work.id))!;
    const res = await resolveWorkReaderSource(repo, stored);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.source.kind).toBe('local-url');
      if (res.source.kind === 'local-url') {
        expect(res.source.assetId).toBe('asset_local_1');
        expect(res.source.url).toMatch(/^blob:/);
      }
    }
  });

  it('tier 2: linked-file WorkAsset → remote with paperId + assetId', async () => {
    const repo = new MemoryResearchRepository();
    const work = makeWork({ id: 'work_linked' });
    await repo.transact(async (tx) => {
      tx.putWork(work);
    });
    await seedAsset(repo, work.id, {
      id: 'asset_linked_1',
      workId: work.id,
      kind: 'linked-file',
      ref: 'legacy_paper_42',
      createdAt: new Date().toISOString(),
    });
    const stored = (await repo.getWork(work.id))!;
    const res = await resolveWorkReaderSource(repo, stored);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.source.kind).toBe('remote');
      if (res.source.kind === 'remote') {
        expect(res.source.paperId).toBe('legacy_paper_42');
        // The WorkAsset.id is the assetId, so the
        // locator round-trips through the same row.
        expect(res.source.assetId).toBe('asset_linked_1');
      }
    }
  });

  it('tier 3: DOI match in legacy papers → remote with paperId + assetId', async () => {
    const repo = new MemoryResearchRepository();
    mockLegacyPapers = [
      { id: 'legacy_1', doi: '10.1234/foo' },
      { id: 'legacy_2', doi: '10.1234/bar' },
    ];
    const work = makeWork({
      id: 'work_doi',
      identifiers: { doi: '10.1234/bar' },
    });
    await repo.transact(async (tx) => {
      tx.putWork(work);
    });
    const res = await resolveWorkReaderSource(repo, work);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok' && res.source.kind === 'remote') {
      expect(res.source.paperId).toBe('legacy_2');
      // The legacy paper id is the assetId, so the
      // locator round-trips back to the same row.
      expect(res.source.assetId).toBe('legacy_2');
    } else {
      expect.fail('expected a remote source');
    }
  });

  it('returns no-asset when the Work has no asset and no DOI match', async () => {
    const repo = new MemoryResearchRepository();
    const work = makeWork({ id: 'work_empty', identifiers: {} });
    await repo.transact(async (tx) => {
      tx.putWork(work);
    });
    mockLegacyPapers = [];
    const res = await resolveWorkReaderSource(repo, work);
    expect(res.kind).toBe('error');
    if (res.kind === 'error') {
      expect(res.error.kind).toBe('no-asset');
    }
  });

  it('returns sync-only when the dataApi refuses the lookup and a DOI exists', async () => {
    const repo = new MemoryResearchRepository();
    mockSupportsLegacy = false;
    const work = makeWork({
      id: 'work_doi_nogateway',
      identifiers: { doi: '10.1234/sync-only' },
    });
    await repo.transact(async (tx) => {
      tx.putWork(work);
    });
    const res = await resolveWorkReaderSource(repo, work);
    expect(res.kind).toBe('error');
    if (res.kind === 'error') {
      expect(res.error.kind).toBe('sync-only');
    }
  });

  it('always provides an assetId on the resolved source so the locator is complete', async () => {
    const repo = new MemoryResearchRepository();
    // Seed a work + linked-file asset.
    const work = makeWork({ id: 'work_complete' });
    await repo.transact(async (tx) => {
      tx.putWork(work);
    });
    await seedAsset(repo, work.id, {
      id: 'asset_complete_1',
      workId: work.id,
      kind: 'linked-file',
      ref: 'legacy_99',
      createdAt: new Date().toISOString(),
    });
    const stored = (await repo.getWork(work.id))!;
    const res = await resolveWorkReaderSource(repo, stored);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.source.kind).toBe('remote');
      if (res.source.kind === 'remote') {
        expect(res.source.assetId).toBeTruthy();
        const { isCompleteResearchLocator } = await import('../../domain/research');
        const locator = {
          kind: 'paper-page' as const,
          workId: work.id,
          assetId: res.source.assetId,
          pageNumber: 1,
          quoteHash: 'h',
          capturedAt: new Date().toISOString(),
        };
        expect(isCompleteResearchLocator(locator)).toBe(true);
      }
    }
  });
});
