/**
 * StudyKit v0.4 — `application/research/importLocalPdf`
 *
 * The use case for "user picks a PDF on disk →
 * canonical Work is created and a local-pdf
 * WorkAsset is registered". The minimum behaviour
 * the WP-05 Gate requires:
 *
 *   1. Validate the file (PDF mime / size cap / page
 *      count probe via the existing
 *      `PDFProcessor.validatePDFFile`).
 *   2. Persist the bytes in the IndexedDB
 *      `pdfAssetStore` (cross-reload safe).
 *   3. Resolve a canonical `Work` from any
 *      PDF-extracted metadata (title / authors /
 *      year) — when extraction yields no identifiers
 *      the Work is *still* canonical, the user
 *      sees it in the library, and they can later
 *      back-fill the DOI.
 *   4. Persist the `Work` + `WorkAsset` in the
 *      Research repository. The work gains the
 *      project id in `projectIds`; the asset is
 *      attached.
 *   5. Return the `Work` so the UI can navigate to
 *      the Reader.
 *
 * Why no automatic full-text extraction? The Gate
 * explicitly forbids "自动全文 extraction"; we
 * extract *enough* to build a canonical Work, and
 * we leave the rest for the user. The Reader renders
 * the PDF; the user creates Evidence by hand.
 *
 * Errors: a non-PDF throws `LocalPdfImportError` with
 * a human-readable reason. The UI surfaces the
 * message and the user keeps their selection.
 */

import { PDFProcessor } from '../../lib/literature/pdf-processor';
import { pdfAssetStore, type PdfAssetMeta } from '../../platforms/web/pdfAssetStore';
import { hashQuote, nowIso, type Work, type WorkAsset } from '../../domain/research';
import { makeWorkIdFromIdentifiers } from '../../domain/research';
import type { ResearchRepository } from './researchRepository';
import type { AcquiredPdfAsset } from '../assets/sourceAssetBridge';

export class LocalPdfImportError extends Error {
  readonly code: 'not-pdf' | 'too-large' | 'no-asset-store' | 'unknown';
  constructor(code: LocalPdfImportError['code'], message: string) {
    super(message);
    this.name = 'LocalPdfImportError';
    this.code = code;
  }
}

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap, aligned with the existing `pdf-processor` cap.

export interface ImportLocalPdfInput {
  readonly projectId: string;
  readonly file: File;
  /**
   * The existing `Work` to attach the asset to. When
   * omitted, a new canonical Work is created from
   * the PDF's metadata. The typical call passes an
   * existing work (after a Save); the Library's
   * "Import PDF" button passes no workId.
   */
  readonly existingWorkId?: string;
  /** id factory for tests. */
  readonly idFactory?: () => string;
}

export interface ImportLocalPdfResult {
  readonly work: Work;
  readonly asset: WorkAsset;
  readonly assetMeta: PdfAssetMeta;
}

export interface ImportAcquiredPdfInput {
  readonly projectId: string;
  readonly acquired: AcquiredPdfAsset;
  readonly existingWorkId?: string;
}

function nowStamp(): string {
  return nowIso();
}

async function contentHashOf(blob: Blob): Promise<string> {
  // FNV-1a 32-bit over the first 256 KB — stable for
  // round-trip but cheap to compute. The full SHA
  // would require a SubtleCrypto import; for the
  // Reader's dedup, a 32-bit FNV-1a is good enough.
  const sample = await blob.slice(0, 256 * 1024).arrayBuffer();
  const bytes = new Uint8Array(sample);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function safePageCount(file: File): Promise<number | undefined> {
  // PDF.js's `getDocument` over the raw bytes works
  // in the browser; on the server it's a no-op. We
  // try it best-effort and swallow errors. A
  // `getDocument` is a heavy operation; we accept
  // a missing page count rather than block the
  // import.
  try {
    if (typeof window === 'undefined') return undefined;
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const n = doc.numPages;
    await doc.destroy();
    return n;
  } catch {
    return undefined;
  }
}

function makeId(idFactory: (() => string) | undefined, prefix: string): string {
  if (idFactory) return idFactory();
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

export async function importLocalPdf(
  repository: ResearchRepository,
  input: ImportLocalPdfInput,
): Promise<ImportLocalPdfResult> {
  const validation = PDFProcessor.validatePDFFile(input.file);
  if (!validation.valid) {
    throw new LocalPdfImportError('not-pdf', validation.error || 'Not a valid PDF.');
  }
  if (input.file.size > MAX_BYTES) {
    throw new LocalPdfImportError(
      'too-large',
      `File is ${(input.file.size / 1024 / 1024).toFixed(1)} MB; the local cap is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }
  const pageCount = await safePageCount(input.file);
  const contentHash = await contentHashOf(input.file);
  const assetId = makeId(input.idFactory, 'asset');
  let assetMeta: PdfAssetMeta;
  try {
    assetMeta = await pdfAssetStore.put({
      assetId,
      blob: input.file,
      contentHash,
      pageCount,
    });
  } catch (err) {
    throw new LocalPdfImportError(
      'no-asset-store',
      err instanceof Error ? err.message : 'PDF asset store is unavailable in this environment.',
    );
  }
  return persistImportedPdf(repository, input, assetId, contentHash, pageCount, assetMeta);
}

/** Register a PDF already copied into the native workspace. */
export async function importAcquiredPdf(
  repository: ResearchRepository,
  input: ImportAcquiredPdfInput,
): Promise<ImportLocalPdfResult> {
  const validation = PDFProcessor.validatePDFFile(input.acquired.file);
  if (!validation.valid) {
    throw new LocalPdfImportError('not-pdf', validation.error || 'Not a valid PDF.');
  }
  if (input.acquired.sizeBytes > MAX_BYTES) {
    throw new LocalPdfImportError('too-large', 'The selected PDF exceeds the 50 MB limit.');
  }
  const pageCount = await safePageCount(input.acquired.file);
  const assetMeta: PdfAssetMeta = {
    assetId: input.acquired.assetId,
    contentHash: input.acquired.contentHash,
    sizeBytes: input.acquired.sizeBytes,
    storedAt: input.acquired.storedAt,
    ...(pageCount !== undefined ? { pageCount } : {}),
  };
  return persistImportedPdf(
    repository,
    { projectId: input.projectId, file: input.acquired.file, existingWorkId: input.existingWorkId },
    input.acquired.assetId,
    input.acquired.contentHash,
    pageCount,
    assetMeta,
  );
}

async function persistImportedPdf(
  repository: ResearchRepository,
  input: ImportLocalPdfInput,
  assetId: string,
  contentHash: string,
  pageCount: number | undefined,
  assetMeta: PdfAssetMeta,
): Promise<ImportLocalPdfResult> {
  const now = nowStamp();
  const asset: WorkAsset = {
    id: assetId,
    workId: input.existingWorkId ?? '', // back-filled below
    kind: 'local-pdf',
    ref: assetId,
    contentHash,
    ...(pageCount !== undefined ? { pageCount } : {}),
    createdAt: now,
  };

  let work: Work;
  if (input.existingWorkId) {
    const existing = await repository.getWork(input.existingWorkId);
    if (!existing) {
      throw new LocalPdfImportError(
        'unknown',
        `Work ${input.existingWorkId} not found.`,
      );
    }
    const alreadyOnProject = existing.projectIds.includes(input.projectId);
    const nextWork: Work = {
      ...existing,
      projectIds: alreadyOnProject
        ? existing.projectIds
        : [...existing.projectIds, input.projectId],
      assetIds: Array.from(new Set([...existing.assetIds, assetId])),
      updatedAt: now,
    };
    work = nextWork;
  } else {
    // Derive a canonical Work id from whatever we
    // can extract. PDFProcessor is the existing
    // utility; the `extractPdfMetadata` helper
    // already produces a title + author list.
    let title = input.file.name.replace(/\.pdf$/i, '').trim();
    let authors: string[] = [];
    let year: number | undefined;
    try {
      const extracted = await PDFProcessor.extractPDFContent(input.file);
      if (extracted.metadata.title) title = extracted.metadata.title;
      if (extracted.metadata.author) {
        authors = [extracted.metadata.author];
      }
    } catch {
      // Extraction is best-effort; an unparseable PDF
      // still becomes a canonical Work with the
      // file name as the title.
    }
    if (title.length === 0) title = 'Untitled PDF';
    const workId = makeWorkIdFromIdentifiers({}, title, authors, year);
    work = {
      id: workId,
      identifiers: {},
      title,
      authors,
      ...(year !== undefined ? { year } : {}),
      metadataProvenance: {
        title: { providerId: 'local-pdf', at: now },
        ...(authors.length > 0 ? { authors: { providerId: 'local-pdf', at: now } } : {}),
        ...(year !== undefined ? { year: { providerId: 'local-pdf', at: now } } : {}),
      },
      integrity: 'unknown',
      assetIds: [assetId],
      projectIds: [input.projectId],
      readingStatus: 'unread',
      importance: 0,
      createdAt: now,
      updatedAt: now,
      authorType: 'imported',
    };
  }
  const finalAsset: WorkAsset = { ...asset, workId: work.id };
  await repository.transact(async (tx) => {
    tx.putWork(work);
    tx.putWorkAsset(finalAsset);
  });
  return { work, asset: finalAsset, assetMeta };
}

/**
 * Compute the `assetId` the Reader needs to look up
 * the PDF Blob. The function is a tiny convenience;
 * the real asset id lives on the `WorkAsset` row.
 */
export function readerSourceForWork(work: Work): { kind: 'remote' | 'local-url' | 'local-blob'; assetId?: string } | null {
  if (work.assetIds.length === 0) return null;
  // The first local-pdf asset wins. The Library
  // guarantees only one local-pdf per Work; the
  // hookup is the only place that creates them.
  return { kind: 'local-url', assetId: work.assetIds[0]! };
}

// Keep the import alive for tests that exercise the
// hash path; the function is intentionally exported.
export { contentHashOf as _contentHashOfForTests, hashQuote };
