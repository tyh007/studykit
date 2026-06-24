import type { ExtractedData, CustomFieldDefinition } from './types'
import { extractPaperWithLocalOllama, parseExtractionResponse, truncatePaperText } from './local-ollama-ai'
import { saveOllamaSettings } from './ollama-settings'
import { saveCustomAISettings } from './custom-ai-settings'
import { extractPaperWithCustomAI } from './custom-ai-extraction'
import { PromptBuilder } from './prompt-builder'
import { literatureAiApi } from '../literature-api'
import type { AIProfile } from './ai-profiles'
import { readLocalProfileCredential } from './ai-profiles'

async function resolveSummaryProfile(profileId?: string): Promise<AIProfile> {
  const result = await literatureAiApi.profiles()
  const id = profileId || result.defaults?.summaryProfileId
  const profile = result.profiles.find((item: AIProfile) => item.id === id)
  if (!profile) throw new Error('请先在 Literature AI 配置中心设置“文献总结”的默认配置')
  return profile
}

export function createAIExtractionService(profileId?: string): {
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
      customFields?: CustomFieldDefinition[],
    ) {
      const profile = await resolveSummaryProfile(profileId)

      if (profile.provider === 'ollama') {
        saveOllamaSettings({ baseUrl: profile.baseUrl, model: profile.model })
        const result = await extractPaperWithLocalOllama(paperText, detailLevel, customFields, profile.model)
        return { extractedData: result.extractedData, method: profile.name }
      }
      if (profile.provider === 'custom' && profile.local) {
        saveCustomAISettings({ baseUrl: profile.baseUrl, model: profile.model, apiKey: readLocalProfileCredential(profile.id) })
        const result = await extractPaperWithCustomAI(paperText, detailLevel, customFields, profile.model)
        return { extractedData: result.extractedData, method: profile.name }
      }

      const prompt = PromptBuilder.buildExtractionPrompt(
        truncatePaperText(paperText),
        detailLevel,
        customFields,
      )
      const result = await literatureAiApi.extract({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        profileId: profile.id,
      })
      if (!result.success || !result.extractedData) {
        throw new Error(result.error || 'AI 总结没有返回结构化结果')
      }
      return {
        extractedData: parseExtractionResponse(result.extractedData as Record<string, unknown>),
        method: profile.name,
      }
    },
  }
}
