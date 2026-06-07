const STORAGE_KEY = 'studykit-ai-provider'

export type AIProvider = 'ollama' | 'gemini' | 'custom'

export interface AIProviderConfig {
  provider: AIProvider
  geminiApiKey?: string
  geminiModel?: string
  customBaseUrl?: string
  customModel?: string
  customApiKey?: string
  // Extended settings for AI extraction
  temperature?: number
  maxTokens?: number
  enabledFields?: string[]
  customInstructions?: string
  useVision?: boolean
}

export function readAIProviderConfig(): AIProviderConfig {
  if (typeof window === 'undefined') {
    return { provider: 'ollama' }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { provider: 'ollama' }

    const parsed = JSON.parse(raw) as Partial<AIProviderConfig>
    return {
      provider: parsed.provider || 'ollama',
      geminiApiKey: parsed.geminiApiKey || undefined,
      geminiModel: parsed.geminiModel || 'gemini-2.0-flash',
      customBaseUrl: parsed.customBaseUrl || undefined,
      customModel: parsed.customModel || undefined,
      customApiKey: parsed.customApiKey || undefined,
    }
  } catch {
    return { provider: 'ollama' }
  }
}

export function saveAIProviderConfig(config: Partial<AIProviderConfig>): AIProviderConfig {
  const current = readAIProviderConfig()
  const next: AIProviderConfig = {
    ...current,
    ...config,
    provider: config.provider || current.provider,
    geminiApiKey: config.geminiApiKey !== undefined ? config.geminiApiKey : current.geminiApiKey,
    geminiModel: config.geminiModel || current.geminiModel || 'gemini-2.0-flash',
    customBaseUrl: config.customBaseUrl !== undefined ? config.customBaseUrl : current.customBaseUrl,
    customModel: config.customModel !== undefined ? config.customModel : current.customModel,
    customApiKey: config.customApiKey !== undefined ? config.customApiKey : current.customApiKey,
  temperature: config.temperature !== undefined ? config.temperature : current.temperature,
  maxTokens: config.maxTokens !== undefined ? config.maxTokens : current.maxTokens,
  enabledFields: config.enabledFields !== undefined ? config.enabledFields : current.enabledFields,
  customInstructions: config.customInstructions !== undefined ? config.customInstructions : current.customInstructions,
  useVision: config.useVision !== undefined ? config.useVision : current.useVision,
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  return next
}

export function clearAIProviderConfig(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}
