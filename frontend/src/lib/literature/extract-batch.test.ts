import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the API + downstream AI helpers before importing the SUT.
vi.mock('../literature-api', () => ({
  literaturePapersApi: {
    update: vi.fn(async () => ({ success: true })),
  },
}))

vi.mock('./ai-extraction', () => ({
  createAIExtractionService: () => ({
    extractWithFallback: vi.fn(async (text: string) => ({
      extractedData: {
        background: `bg:${text.slice(0, 4)}`,
        theory: 'T',
        methodology: 'M',
        measures: 'Ms',
        results: 'R',
        implications: 'I',
        limitations: 'L',
      },
      method: 'mock',
    })),
  }),
}))

vi.mock('./multimodal-extraction', () => ({
  smartExtract: vi.fn(async () => null),
}))

import { extractPapersBatch } from './extract-batch'
import { literaturePapersApi } from '../literature-api'
import type { LiteraturePaper } from '../../types'

const makePaper = (overrides: Partial<LiteraturePaper> = {}): LiteraturePaper => ({
  id: overrides.id ?? 'p1',
  project_id: 'proj1',
  file_name: 'paper.pdf',
  file_size: 1024,
  file_type: 'application/pdf',
  processing_status: 'pending',
  uploaded_at: '2026-01-01T00:00:00Z',
  full_text: overrides.full_text ?? 'a'.repeat(2000),
  storage_key: overrides.storage_key,
  extracted_data: overrides.extracted_data,
  reading_status: 'unread',
  importance: 0,
  ...overrides,
})

describe('extractPapersBatch', () => {
  beforeEach(() => {
    vi.mocked(literaturePapersApi.update).mockClear()
    vi.mocked(literaturePapersApi.update).mockResolvedValue({ success: true } as any)
  })

  it('extracts each paper with text and reports success via onProgress', async () => {
    const papers = [makePaper({ id: 'a' }), makePaper({ id: 'b' })]
    const onProgress = vi.fn()
    const summary = await extractPapersBatch(papers, { mode: 'text', onProgress })
    expect(summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 })
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ paperId: 'a', status: 'success' }),
    )
    expect(onProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paperId: 'b', status: 'success' }),
    )
  })

  it('marks a paper as error and PATCHes error_message when extraction throws', async () => {
    const papers = [makePaper({ id: 'a' }), makePaper({ id: 'b' })]
    const { createAIExtractionService } = await import('./ai-extraction')
    // First paper succeeds, second throws.
    let i = 0
    vi.mocked(createAIExtractionService().extractWithFallback).mockImplementation(async () => {
      i++
      if (i === 2) throw new Error('LLM offline')
      return {
        extractedData: {
          background: 'x', theory: 'x', methodology: 'x', measures: 'x',
          results: 'x', implications: 'x', limitations: 'x',
        },
        method: 'mock',
      }
    })
    const onProgress = vi.fn()
    const summary = await extractPapersBatch(papers, { mode: 'text', onProgress })
    expect(summary.failed).toBe(1)
    expect(summary.succeeded).toBe(1)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ paperId: 'b', status: 'error', errorMessage: 'LLM offline' }),
    )
    // The error_message PATCH should be present
    expect(literaturePapersApi.update).toHaveBeenCalledWith('b', { error_message: 'LLM offline' })
  })

  it('aborts remaining papers when signal is set', async () => {
    const papers = [makePaper({ id: 'a' }), makePaper({ id: 'b' }), makePaper({ id: 'c' })]
    const controller = new AbortController()
    const onProgress = vi.fn()
    // Abort before the second paper finishes its await.
    let calls = 0
    const { createAIExtractionService } = await import('./ai-extraction')
    vi.mocked(createAIExtractionService().extractWithFallback).mockImplementation(async () => {
      calls++
      if (calls === 2) controller.abort()
      return {
        extractedData: {
          background: 'x', theory: 'x', methodology: 'x', measures: 'x',
          results: 'x', implications: 'x', limitations: 'x',
        },
        method: 'mock',
      }
    })
    const summary = await extractPapersBatch(papers, {
      mode: 'text',
      onProgress,
      signal: controller.signal,
    })
    // The third paper should be reported as skipped, and the summary should
    // count it as skipped rather than failed.
    expect(summary.skipped).toBeGreaterThanOrEqual(1)
    expect(summary.succeeded + summary.failed + summary.skipped).toBe(3)
  })

  it('uses vision mode when mode="vision" regardless of full_text length', async () => {
    const { smartExtract } = await import('./multimodal-extraction')
    vi.mocked(smartExtract).mockClear()
    vi.mocked(smartExtract).mockResolvedValue({
      background: 'V', theory: 'V', methodology: 'V', measures: 'V',
      results: 'V', implications: 'V', limitations: 'V',
    } as any)
    const papers = [makePaper({ id: 'a', full_text: 'a'.repeat(5000), storage_key: 'pdf' })]
    await extractPapersBatch(papers, { mode: 'vision' })
    expect(smartExtract).toHaveBeenCalledTimes(1)
  })
})
