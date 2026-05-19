import type { ExtractedData, CustomFieldDefinition } from './types'
import { CustomAIClient } from './custom-ai-client'
import { readCustomAISettings, type CustomAISettings } from './custom-ai-settings'
import { PromptBuilder } from './prompt-builder'
import {
  extractPaperWithRules,
  parseExtractionResponse,
  validateExtractedData,
  buildFocusedPaperContext,
  truncatePaperText,
} from './local-ollama-ai'

function getClient(settings: CustomAISettings = readCustomAISettings()) {
  return new CustomAIClient(settings.baseUrl, settings.model, settings.apiKey)
}

export async function getCustomAIAvailability() {
  const settings = readCustomAISettings()
  const client = getClient(settings)
  const connected = await client.checkConnection()

  let models: string[] = []
  if (connected && settings.baseUrl) {
    try {
      const result = await client.getAvailableModels()
      models = result.map(m => m.id)
    } catch {
      // models list not available, that's ok
    }
  }

  return {
    available: connected && (models.length > 0 || !settings.model),
    models,
    currentBaseUrl: settings.baseUrl,
  }
}

export async function extractPaperWithCustomAI(
  paperText: string,
  detailLevel: 'brief' | 'detailed' = 'brief',
  customFields?: CustomFieldDefinition[],
  model?: string,
  context?: { title?: string; abstract?: string }
) {
  const settings = readCustomAISettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })

  if (!resolvedModel) {
    console.warn('Custom AI: no model specified, falling back to rule-based')
    return {
      extractedData: extractPaperWithRules(paperText),
      model: 'rule-based extraction (no model configured)'
    }
  }

  try {
    const prompt = PromptBuilder.buildExtractionPrompt(
      buildFocusedPaperContext(truncatePaperText(paperText), context),
      detailLevel,
      customFields
    )
    const result = await client.chatForJson(prompt.systemPrompt, prompt.userPrompt, resolvedModel)
    const extractedData = parseExtractionResponse(result.parsed)

    if (!validateExtractedData(extractedData)) {
      console.warn('Custom AI extraction validation failed. Attempting rule-based fallback...')
      const ruleBasedData = extractPaperWithRules(paperText)
      return {
        extractedData: ruleBasedData,
        model: `${result.model} (with rule-based fallback)`
      }
    }

    return { extractedData, model: result.model }
  } catch (error) {
    console.warn('Custom AI extraction error, using rule-based fallback:', error instanceof Error ? error.message : String(error))
    const fallbackData = extractPaperWithRules(paperText)
    return {
      extractedData: fallbackData,
      model: 'rule-based extraction (error fallback)'
    }
  }
}

export async function extractCustomFieldWithCustomAI(
  paperText: string,
  customField: CustomFieldDefinition,
  detailLevel: 'brief' | 'detailed' = 'brief',
  model?: string
) {
  const settings = readCustomAISettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })
  const prompt = PromptBuilder.buildCustomFieldPrompt(
    truncatePaperText(paperText),
    customField,
    detailLevel
  )
  return client.generateText(prompt, resolvedModel, {
    temperature: 0.1,
    max_tokens: detailLevel === 'detailed' ? 700 : 300
  })
}

export async function reExtractFieldsWithCustomAI(
  paperText: string,
  existingExtraction: ExtractedData,
  fieldsToUpdate: string[],
  detailLevel: 'brief' | 'detailed' = 'brief',
  model?: string
) {
  const settings = readCustomAISettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })
  const prompt = PromptBuilder.buildReExtractionPrompt(
    truncatePaperText(paperText),
    existingExtraction,
    fieldsToUpdate,
    detailLevel
  )
  const result = await client.chatForJson(prompt.systemPrompt, prompt.userPrompt, resolvedModel)
  return {
    extractedData: parseExtractionResponse(result.parsed),
    model: result.model
  }
}

export async function performCrossPaperAnalysisWithCustomAI(
  papers: Array<{
    title: string
    authors: string
    year: number
    extractedData: ExtractedData
  }>,
  analysisQuestion: string,
  model?: string
) {
  const settings = readCustomAISettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })
  const prompt = PromptBuilder.buildCrossPaperAnalysisPrompt(papers, analysisQuestion)
  return client.generateText(prompt, resolvedModel, {
    temperature: 0.2,
    max_tokens: 900
  })
}
