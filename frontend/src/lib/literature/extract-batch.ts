import { literaturePapersApi } from '../literature-api'
import { createAIExtractionService } from './ai-extraction'
import { smartExtract } from './multimodal-extraction'
import type { ExtractedData, LiteraturePaper } from '../../types'

/**
 * Strategy for picking between text-based and vision-based extraction.
 *
 * - `'text'`: always use text extraction. Requires `paper.full_text` to be
 *   populated; otherwise the paper is marked as skipped/failed.
 * - `'vision'`: always use vision (render PDF pages as base64 JPEGs and ask
 *   a vision-capable model to read them). Requires `paper.storage_key` to
 *   be set; otherwise falls back to text.
 * - `'auto'`: prefer text when `full_text` has at least 200 characters,
 *   otherwise prefer vision. Mirrors the heuristic in the original
 *   SummaryTable.handleBatchExtract.
 */
export type ExtractMode = 'text' | 'vision' | 'auto'

/**
 * Per-paper progress event. Fired once per paper after the paper is
 * processed (success, error, or skipped).
 */
export interface BatchProgress {
  paperId: string
  index: number
  total: number
  status: 'success' | 'error' | 'skipped'
  /** Present when `status === 'success'`. */
  extractedData?: ExtractedData
  /** Present when `status === 'error'`. */
  errorMessage?: string
}

/**
 * Summary returned once the batch completes (or aborts). All counters are
 * non-negative and sum to `total`.
 */
export interface BatchSummary {
  total: number
  succeeded: number
  failed: number
  skipped: number
}

export interface ExtractPapersBatchOptions {
  mode: ExtractMode
  profileId?: string
  /**
   * Called after each paper finishes processing. Useful for showing
   * "Extracting 3/12…" progress in the UI.
   */
  onProgress?: (p: BatchProgress) => void
  /**
   * Optional cancellation. When `signal.aborted` becomes true, the loop
   * stops starting new papers; the in-flight paper's `await` still
   * completes so we don't leak Promises.
   */
  signal?: AbortSignal
}

/**
 * Run AI extraction over a list of papers, with a single AI service
 * instance shared across the batch.
 *
 * Replaces four near-duplicate loops that lived in
 * `SummaryTable.handleBatchExtract`, `SummaryTable.handleSingleExtract`,
 * `ReadingListsView.handleExtractAll`, `PaperWorkspace.handleExtractAll`,
 * and `ZoteroImportPanel.handleImportAndExtract`.
 *
 * Behavior:
 *  - One `createAIExtractionService` per batch (not per paper) so the
 *    profile is resolved exactly once.
 *  - Vision vs text selection follows the `mode` argument and the
 *    `paper.full_text.length` heuristic from the original SummaryTable.
 *  - On error, the paper's `error_message` is patched and the error is
 *    reported via `onProgress`. Errors do not abort the batch.
 *  - Honors `signal.aborted` between papers.
 */
export async function extractPapersBatch(
  papers: LiteraturePaper[],
  opts: ExtractPapersBatchOptions,
): Promise<BatchSummary> {
  const { mode, profileId, onProgress, signal } = opts
  const service = createAIExtractionService(profileId || undefined)
  let succeeded = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i]
    if (signal?.aborted) {
      skipped++
      onProgress?.({
        paperId: paper.id,
        index: i,
        total: papers.length,
        status: 'skipped',
      })
      continue
    }
    try {
      const textIsShort = !paper.full_text || paper.full_text.length < 200
      const useVision = mode === 'vision' || (mode === 'auto' && textIsShort)

      let extractedData: ExtractedData | null = null

      if (useVision && paper.storage_key) {
        const pdfUrl = `/uploads/${paper.storage_key}`
        const vision = await smartExtract(pdfUrl, paper.full_text, undefined, profileId)
        if (vision) extractedData = vision as ExtractedData
      }

      if (!extractedData && paper.full_text) {
        const { extractedData: data } = await service.extractWithFallback(paper.full_text, 'brief')
        extractedData = data
      }

      if (!extractedData) {
        throw new Error('No text or PDF available to extract from')
      }

      await literaturePapersApi.update(paper.id, {
        extracted_data: extractedData,
        processing_status: 'completed',
      })
      succeeded++
      onProgress?.({
        paperId: paper.id,
        index: i,
        total: papers.length,
        status: 'success',
        extractedData,
      })
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : 'Extraction failed'
      // Best-effort error patch; ignore the patch's own failure so it
      // doesn't mask the original error.
      await literaturePapersApi
        .update(paper.id, { error_message: message })
        .catch(() => undefined)
      onProgress?.({
        paperId: paper.id,
        index: i,
        total: papers.length,
        status: 'error',
        errorMessage: message,
      })
    }
  }

  return { total: papers.length, succeeded, failed, skipped }
}
