import * as pdfjs from 'pdfjs-dist';
import type { AcquiredPdfAsset, SourceAssetBridge } from '../assets/sourceAssetBridge';
import { getDataApi, type DataApi } from '../dataGateway';
import type { Lecture, SourceDocument, SourcePage } from '../../types';
import { PDFProcessor } from '../../lib/literature/pdf-processor';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface ImportStudyPdfResult {
  readonly lecture: Lecture;
  readonly document: SourceDocument;
  readonly pages: ReadonlyArray<SourcePage>;
}

type StudyPdfDataApi = Pick<DataApi, 'lectures' | 'sourceDocuments'>;

async function inspectPages(file: File, documentId: string): Promise<SourcePage[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const pages: SourcePage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        id: `${documentId}:page:${pageNumber}`,
        source_document_id: documentId,
        page_number: pageNumber,
        width: viewport.width,
        height: viewport.height,
      });
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

export async function importStudyPdf(
  sourceAssets: SourceAssetBridge,
  input: { readonly courseId: string },
  dataApi: StudyPdfDataApi = getDataApi(),
): Promise<ImportStudyPdfResult | null> {
  const acquired = await sourceAssets.choosePdf();
  if (!acquired) return null;
  return registerAcquiredStudyPdf(sourceAssets, acquired, input, dataApi);
}

async function registerAcquiredStudyPdf(
  sourceAssets: SourceAssetBridge,
  acquired: AcquiredPdfAsset,
  input: { readonly courseId: string },
  dataApi: StudyPdfDataApi,
): Promise<ImportStudyPdfResult> {
  let lecture: Lecture | null = null;
  let metadataStored = false;
  const documentId = `source-${acquired.assetId}`;
  try {
    const validation = PDFProcessor.validatePDFFile(acquired.file);
    if (!validation.valid) throw new Error(validation.error || 'Not a valid PDF.');
    const pages = await inspectPages(acquired.file, documentId);
    const now = new Date().toISOString();
    const title = acquired.file.name.replace(/\.pdf$/i, '').trim() || 'Imported PDF';
    lecture = await dataApi.lectures.create({ module_id: input.courseId, title });
    const document: SourceDocument = {
      id: documentId,
      lecture_id: lecture.id,
      type: 'pdf',
      original_filename: acquired.file.name,
      storage_key: acquired.assetId,
      mime_type: 'application/pdf',
      file_size_bytes: acquired.sizeBytes,
      checksum: acquired.contentHash,
      page_count: pages.length,
      processing_status: 'ready',
      created_at: acquired.storedAt || now,
      updated_at: now,
    };
    await dataApi.sourceDocuments.putWithPages(document, pages);
    metadataStored = true;
    const updated = await dataApi.lectures.update(lecture.id, {
      active_source_document_id: document.id,
    });
    return { lecture: updated, document, pages };
  } catch (error) {
    if (metadataStored) await dataApi.sourceDocuments.delete(documentId).catch(() => undefined);
    if (lecture) await dataApi.lectures.delete(lecture.id).catch(() => undefined);
    await sourceAssets.discard(acquired.assetId).catch(() => undefined);
    throw error;
  }
}
