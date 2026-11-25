/**
 * StudyKit v0.4 — `importLocalPdf` use case tests (WP-05 Gate)
 *
 * The use case is the seam between the user-picked
 * PDF and the Research repository. The contract:
 *
 *   1. A non-PDF / oversize / corrupt file is rejected
 *      with `LocalPdfImportError`.
 *   2. A valid PDF produces a canonical `Work` + a
 *      `WorkAsset` keyed by a fresh `assetId`.
 *   3. The asset is stored in `pdfAssetStore` and the
 *      same `assetId` round-trips through
 *      `getObjectUrl` (object URL is stable).
 *   4. `existingWorkId` upgrades the existing Work
 *      rather than creating a new one.
 *
 * Tests use the same in-memory `pdfAssetStore` mock
 * the production test uses (happy-dom has no
 * IndexedDB).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { importAcquiredPdf, importLocalPdf, LocalPdfImportError } from './importLocalPdf';
import { __resetPdfAssetStoreForTests, pdfAssetStore } from '../../platforms/web/pdfAssetStore';
import { hashQuote, type Work, type WorkAsset } from '../../domain/research';

const validPdf = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x0a, 0x3e, 0x3e, 0x0a,
  0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
  0x78, 0x72, 0x65, 0x66, 0x0a, 0x30, 0x20, 0x31, 0x0a,
  0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a,
]);

vi.mock('../../platforms/web/pdfAssetStore', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const blobs = new Map<string, { blob: Blob; contentHash: string; pageCount?: number; storedAt: string }>();
  const urlCache = new Map<string, string>();
  const fakeStore = {
    async put(input: { assetId: string; blob: Blob; contentHash: string; pageCount?: number }) {
      blobs.set(input.assetId, { blob: input.blob, contentHash: input.contentHash, pageCount: input.pageCount, storedAt: new Date().toISOString() });
      const prev = urlCache.get(input.assetId);
      if (prev) {
        try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
        urlCache.delete(input.assetId);
      }
      return {
        assetId: input.assetId,
        contentHash: input.contentHash,
        pageCount: input.pageCount,
        storedAt: new Date().toISOString(),
        sizeBytes: input.blob.size,
      };
    },
    async get(assetId: string) {
      return blobs.get(assetId)?.blob ?? null;
    },
    async getMeta(assetId: string) {
      const row = blobs.get(assetId);
      if (!row) return null;
      return { assetId, contentHash: row.contentHash, pageCount: row.pageCount, storedAt: row.storedAt, sizeBytes: row.blob.size };
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
    __resetPdfAssetStoreForTests: () => fakeStore.clear(),
  };
});

vi.mock('../../lib/literature/pdf-processor', async () => {
  return {
    PDFProcessor: {
      validatePDFFile: (file: File) => ({
        valid: file.type === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf'),
        error: file.type === 'application/pdf' ? undefined : 'Not a PDF',
      }),
      extractPDFContent: async (file: File) => ({
        text: '',
        metadata: {
          title: file.name.replace(/\.pdf$/i, ''),
          author: 'Imported',
        },
        pageCount: 1,
      }),
    },
  };
});

let counter = 0;
function makePdfFile(): File {
  counter += 1;
  return new File([validPdf], `paper-${counter}.pdf`, { type: 'application/pdf' });
}

beforeEach(() => {
  __resetPdfAssetStoreForTests();
});

describe('importLocalPdf', () => {
  it('registers an already-acquired native asset without copying it into the web store', async () => {
    const repo = new MemoryResearchRepository();
    const put = vi.spyOn(pdfAssetStore, 'put');
    const file = makePdfFile();
    const result = await importAcquiredPdf(repo, {
      projectId: 'p-native',
      acquired: {
        assetId: 'asset-native',
        file,
        contentHash: 'a'.repeat(64),
        storedAt: '2026-08-08T00:00:00Z',
        sizeBytes: file.size,
      },
    });
    expect(put).not.toHaveBeenCalled();
    expect(result.asset.id).toBe('asset-native');
    expect(result.asset.contentHash).toBe('a'.repeat(64));
    expect(await repo.getWork(result.work.id)).not.toBeNull();
  });

  it('creates a canonical Work + WorkAsset for a valid PDF', async () => {
    const repo = new MemoryResearchRepository();
    const file = makePdfFile();
    const res = await importLocalPdf(repo, { projectId: 'p-1', file });
    expect(res.work.id.length).toBeGreaterThan(0);
    expect(res.work.title).toContain('paper-');
    expect(res.work.projectIds).toEqual(['p-1']);
    expect(res.work.assetIds).toContain(res.asset.id);
    expect(res.asset.workId).toBe(res.work.id);
    expect(res.asset.kind).toBe('local-pdf');
    expect(res.assetMeta.assetId).toBe(res.asset.id);
    expect(res.assetMeta.contentHash).toMatch(/^[0-9a-f]{8}$/);
    // The repository now has the work + asset.
    const storedWork = await repo.getWork(res.work.id);
    expect(storedWork).not.toBeNull();
    const storedAssets = await repo.listWorkAssetsForWork(res.work.id);
    expect(storedAssets).toHaveLength(1);
    expect(storedAssets[0]?.id).toBe(res.asset.id);
  });

  it('rejects a non-PDF file with a LocalPdfImportError', async () => {
    const repo = new MemoryResearchRepository();
    const file = new File([new Uint8Array([0, 1, 2])], 'fake.pdf', { type: 'text/plain' });
    await expect(importLocalPdf(repo, { projectId: 'p-1', file })).rejects.toBeInstanceOf(
      LocalPdfImportError,
    );
  });

  it('rejects an over-size file', async () => {
    const repo = new MemoryResearchRepository();
    // Construct a >50MB Uint8Array of zeros; the
    // validatePDFFile check is type-based, so we keep
    // the type but override the size assertion in the
    // import use case. We pass a real File with size
    // > 50MB by mocking the size on the File object.
    const file = makePdfFile();
    Object.defineProperty(file, 'size', { value: 60 * 1024 * 1024 });
    await expect(importLocalPdf(repo, { projectId: 'p-1', file })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('attaches the asset to an existing Work when existingWorkId is passed', async () => {
    const repo = new MemoryResearchRepository();
    // Seed an existing Work.
    const existingWork: Work = {
      id: 'work_x',
      identifiers: { doi: '10.1234/example' },
      title: 'Existing',
      authors: ['A'],
      metadataProvenance: {
        title: { providerId: 'openalex', at: new Date().toISOString() },
        authors: { providerId: 'openalex', at: new Date().toISOString() },
      },
      integrity: 'unknown',
      assetIds: [],
      projectIds: ['p-1'],
      readingStatus: 'unread',
      importance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      authorType: 'imported',
    };
    await repo.transact(async (tx) => {
      tx.putWork(existingWork);
    });
    const file = makePdfFile();
    const res = await importLocalPdf(repo, {
      projectId: 'p-1',
      file,
      existingWorkId: 'work_x',
    });
    expect(res.work.id).toBe('work_x');
    expect(res.work.assetIds).toContain(res.asset.id);
    // The repository's view matches.
    const stored = await repo.getWork('work_x');
    expect(stored?.assetIds).toContain(res.asset.id);
  });

  it('round-trips through pdfAssetStore.getObjectUrl', async () => {
    const repo = new MemoryResearchRepository();
    const file = makePdfFile();
    const res = await importLocalPdf(repo, { projectId: 'p-1', file });
    // The mock pdfAssetStore was used (imported by
    // the use case). getObjectUrl returns a stable
    // URL.
    const url1 = await pdfAssetStore.getObjectUrl(res.asset.id);
    const url2 = await pdfAssetStore.getObjectUrl(res.asset.id);
    expect(url1).not.toBeNull();
    expect(url1).toBe(url2); // Stable across calls.
  });

  it('produces an assetId that satisfies isCompleteResearchLocator', async () => {
    const repo = new MemoryResearchRepository();
    const file = makePdfFile();
    const res = await importLocalPdf(repo, { projectId: 'p-1', file });
    // The Reader builds a `paper-page` locator from the
    // resolved source's `assetId`. Verify the assetId
    // is sufficient to make a complete locator.
    const { isCompleteResearchLocator } = await import('../../domain/research');
    const locator = {
      kind: 'paper-page' as const,
      workId: res.work.id,
      assetId: res.asset.id,
      pageNumber: 1,
      quoteHash: hashQuote('quote'),
      capturedAt: new Date().toISOString(),
    };
    expect(isCompleteResearchLocator(locator)).toBe(true);
    // The WorkAsset the use case created also points
    // at the work, so round-tripping through the
    // repository is consistent.
    const assets: WorkAsset[] = await repo.listWorkAssetsForWork(res.work.id);
    expect(assets[0]?.kind).toBe('local-pdf');
  });
});
