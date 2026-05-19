import { getAuthToken } from '../api'
import type { ExtractedData, CustomFieldDefinition } from './types'
import { extractPaperWithLocalOllama, extractPaperWithRules, getLocalOllamaAvailability, buildFocusedPaperContext, truncatePaperText, parseExtractionResponse } from './local-ollama-ai'
import { extractPaperWithCustomAI, getCustomAIAvailability } from './custom-ai-extraction'
import { readAIProviderConfig, type AIProvider } from './ai-provider-config'
import { PromptBuilder } from './prompt-builder'

async function tryOllama(paperText: string, detailLevel: 'brief' | 'detailed', customFields?: CustomFieldDefinition[]): Promise<{ extractedData: ExtractedData; method: string } | null> {
  try {
    const availability = await getLocalOllamaAvailability()
    if (availability.available) {
      const result = await extractPaperWithLocalOllama(paperText, detailLevel, customFields)
      return { extractedData: result.extractedData, method: result.model }
    }
  } catch (err) {
    console.warn('Local Ollama extraction failed:', err)
  }
  return null
}

async function tryCustomAPI(paperText: string, detailLevel: 'brief' | 'detailed', customFields?: CustomFieldDefinition[]): Promise<{ extractedData: ExtractedData; method: string } | null> {
  try {
    const availability = await getCustomAIAvailability()
    if (availability.available) {
      const result = await extractPaperWithCustomAI(paperText, detailLevel, customFields)
      return { extractedData: result.extractedData, method: result.model }
    }
  } catch (err) {
    console.warn('Custom API extraction failed:', err)
  }
  return null
}

async function tryGemini(paperText: string, detailLevel: 'brief' | 'detailed', customFields?: CustomFieldDefinition[]): Promise<{ extractedData: ExtractedData; method: string } | null> {
  try {
    const config = readAIProviderConfig()
    const prompt = PromptBuilder.buildExtractionPrompt(
      buildFocusedPaperContext(truncatePaperText(paperText)),
      detailLevel,
      customFields
    )
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const response = await fetch('/api/literature/ai/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        expectedFields: prompt.expectedFields,
        detailLevel,
        geminiModel: config.geminiModel || 'gemini-2.0-flash',
      })
    })
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.extractedData) {
        const extractedData = parseExtractionResponse(data.extractedData)
        return { extractedData, method: 'Gemini (cloud)' }
      }
    }
  } catch (err) {
    console.warn('Server AI extraction failed:', err)
  }
  return null
}

function getFallbackOrder(configuredProvider: AIProvider): Array<typeof tryOllama> {
  // Local providers: configured one first, then the other
  const locals: Array<typeof tryOllama> =
    configuredProvider === 'custom'
      ? [tryCustomAPI, tryOllama]
      : [tryOllama, tryCustomAPI]

  // Gemini (server-side) always last
  return [...locals, tryGemini]
}

export function createAIExtractionService(): {
  extractWithFallback(
    paperText: string,
    detailLevel?: 'brief' | 'detailed',
    customFields?: CustomFieldDefinition[]
  ): Promise<{ extractedData: ExtractedData; method: string }>
} {
  return {
    async extractWithFallback(
      paperText: string,
      detailLevel: 'brief' | 'detailed' = 'brief',
      customFields?: CustomFieldDefinition[]
    ): Promise<{ extractedData: ExtractedData; method: string }> {
      const config = readAIProviderConfig()
      const fallbackChain = getFallbackOrder(config.provider)

      // Try each provider in order
      for (const tryFn of fallbackChain) {
        const result = await tryFn(paperText, detailLevel, customFields)
        if (result) return result
      }

      // Final fallback: rule-based extraction
      return {
        extractedData: extractPaperWithRules(paperText),
        method: 'rule-based extraction (final fallback)'
      }
    }
  }
}
