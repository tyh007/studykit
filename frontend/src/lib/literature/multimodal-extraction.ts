import * as pdfjsLib from 'pdfjs-dist'
import { readAIProviderConfig, type AIProviderConfig } from './ai-provider-config'
import { getAuthToken } from '../api'
import { fetchWithTimeout } from './fetch-with-timeout'

// Ensure PDF.js worker is set (do once)
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
}

/**
 * Render PDF pages to compressed JPEG base64 images for multi-modal extraction.
 * @param pdfUrl — URL of the PDF file to load (e.g. /uploads/storage_key)
 * @param maxPages — max pages to render (default 20, to limit token cost)
 * @returns Array of base64 JPEG strings (with data:image/jpeg;base64, prefix)
 */
export async function renderPDFPagesToBase64(
  pdfUrl: string,
  maxPages: number = 20,
): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise
  const pageCount = Math.min(pdf.numPages, maxPages)
  const base64Pages: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    // White background for scanned PDFs
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport }).promise

    // Compress to JPEG at 85% quality
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    base64Pages.push(dataUrl)

    // Clean up
    canvas.width = 0
    canvas.height = 0
  }

  return base64Pages
}

/**
 * Run multi-modal extraction via Gemini Vision API.
 * Sends rendered PDF page images to the backend vision proxy.
 */
export async function extractWithVision(
  pages: string[],
  customPrompt?: string,
  config?: AIProviderConfig,
): Promise<any> {
  const cfg = config || readAIProviderConfig()

  // Build extraction prompt with field definitions
  const enabledFields = cfg.enabledFields?.length
    ? cfg.enabledFields
    : ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations']

  const fieldDescriptions: Record<string, string> = {
    background: 'Research context, problem statement, gap addressed',
    theory: 'Theoretical framework, hypotheses, core concepts',
    methodology: 'Research design, sample, procedures, analytical approach',
    measures: 'Instruments, scales, tasks, operational definitions',
    results: 'Main findings, key statistics, effect sizes',
    implications: 'Theoretical contributions, practical applications',
    limitations: 'Study limitations, caveats, future directions',
  }

  const fieldList = enabledFields
    .filter(f => !f.startsWith('custom_'))
    .map(f => `  "${f}": "${fieldDescriptions[f] || f}"`)
    .join('\n')

  const outputKeys = JSON.stringify(enabledFields.reduce((o, f) => ({ ...o, [f]: '' }), {}))

  const defaultPrompt = `You are an AI research assistant. Analyze these academic PDF pages (rendered as images) and extract structured information.

STRICT RULES:
1. Extract ONLY from what you see in the page images
2. If a field has no applicable content, use exactly: "Not mentioned"
3. Each bullet = ONE short sentence (10-20 words maximum)
4. 2-4 bullets per field maximum
5. Synthesize in your own words — do NOT copy verbatim
6. Use the paper's own terminology and specific numbers/statistics
7. If you see figures/tables/images, describe their key findings in the relevant field

Fields to extract:
${fieldList}

${cfg.customInstructions ? `ADDITIONAL INSTRUCTIONS:\n${cfg.customInstructions}\n` : ''}

Return ONLY valid JSON using these exact keys:
${outputKeys}

Do NOT wrap in markdown code blocks.`

  const prompt = customPrompt || defaultPrompt

  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetchWithTimeout('/api/literature/ai/vision-extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pages,
      prompt,
      geminiModel: cfg.geminiModel || 'gemini-2.0-flash',
      userApiKey: cfg.geminiApiKey,
      temperature: cfg.temperature ?? 0.3,
      maxTokens: cfg.maxTokens || 4096,
    }),
  }, 300000) // 5min timeout for multi-page extraction

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Vision extraction failed' }))
    throw new Error(err.error || `HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!data.success || !data.extractedData) {
    throw new Error(data.error || 'Vision extraction returned no data')
  }

  // Ensure all enabled fields are present, fill missing with "Not mentioned"
  for (const field of enabledFields) {
    if (!(field in data.extractedData)) {
      data.extractedData[field] = 'Not mentioned'
    }
  }

  return data.extractedData
}

/**
 * Smart extraction: checks if PDF has usable text, renders pages as images if not.
 * @param pdfUrl — URL of the PDF
 * @param existingText — already extracted text (paper.full_text)
 * @returns extracted data on success, null if both methods fail
 */
export async function smartExtract(
  pdfUrl: string,
  existingText?: string | null,
  customPrompt?: string,
  config?: AIProviderConfig,
): Promise<any> {
  const cfg = config || readAIProviderConfig()

  // Determine whether to use vision mode
  const textIsEmpty = !existingText || existingText.trim().length < 200
  const forceVision = cfg.useVision === true
  const useVision = forceVision || textIsEmpty

  if (!useVision && existingText) {
    // Use existing text extraction (handled by the standard extraction flow)
    return null // signal to use text extraction
  }

  // Render pages as images and run vision extraction
  const pages = await renderPDFPagesToBase64(pdfUrl, 20)
  if (pages.length === 0) throw new Error('Failed to render PDF pages')

  return await extractWithVision(pages, customPrompt, cfg)
}
