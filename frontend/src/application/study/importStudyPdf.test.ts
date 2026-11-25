import { describe, expect, it, vi } from 'vitest';
import { importStudyPdf } from './importStudyPdf';
import type { SourceAssetBridge } from '../assets/sourceAssetBridge';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({ promise: Promise.resolve({
    numPages: 2,
    getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }),
    destroy: async () => undefined,
  }) }),
}));
vi.mock('../../lib/literature/pdf-processor', () => ({
  PDFProcessor: { validatePDFFile: () => ({ valid: true }) },
}));

function bridge(discard = vi.fn()): SourceAssetBridge {
  return {
    kind: 'native',
    choosePdf: vi.fn().mockResolvedValue({
      assetId: 'asset-1',
      file: new File(['%PDF-'], 'Week 1.pdf', { type: 'application/pdf' }),
      contentHash: 'hash', storedAt: '2026-08-08T00:00:00Z', sizeBytes: 5,
    }),
    getBlob: vi.fn(), getObjectUrl: vi.fn(), releaseObjectUrl: vi.fn(), discard,
  };
}

describe('importStudyPdf', () => {
  it('atomically registers lecture, source metadata and page geometry', async () => {
    const putWithPages = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockImplementation(async (_id, patch) => ({ id: 'lec-1', module_id: 'course-1', title: 'Week 1', ...patch }));
    const result = await importStudyPdf(bridge(), { courseId: 'course-1' }, {
      lectures: {
        create: vi.fn().mockResolvedValue({ id: 'lec-1', module_id: 'course-1', title: 'Week 1' }),
        update,
        delete: vi.fn(),
        list: vi.fn(),
      },
      sourceDocuments: { get: vi.fn(), getPages: vi.fn(), putWithPages, delete: vi.fn() },
    });
    expect(result?.document.storage_key).toBe('asset-1');
    expect(result?.pages).toHaveLength(2);
    expect(putWithPages).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith('lec-1', { active_source_document_id: 'source-asset-1' });
  });

  it('removes metadata, lecture and native asset when the final link fails', async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const removeDoc = vi.fn().mockResolvedValue(undefined);
    const removeLecture = vi.fn().mockResolvedValue({ success: true });
    await expect(importStudyPdf(bridge(discard), { courseId: 'course-1' }, {
      lectures: {
        create: vi.fn().mockResolvedValue({ id: 'lec-1', module_id: 'course-1', title: 'Week 1' }),
        update: vi.fn().mockRejectedValue(new Error('link failed')),
        delete: removeLecture,
        list: vi.fn(),
      },
      sourceDocuments: {
        get: vi.fn(), getPages: vi.fn(), putWithPages: vi.fn(), delete: removeDoc,
      },
    })).rejects.toThrow('link failed');
    expect(removeDoc).toHaveBeenCalledWith('source-asset-1');
    expect(removeLecture).toHaveBeenCalledWith('lec-1');
    expect(discard).toHaveBeenCalledWith('asset-1');
  });
});
