export interface CustomAISettings {
  baseUrl: string
  model: string
  apiKey: string
}

const STORAGE_KEY = 'studykit-custom-ai'

export const DEFAULT_CUSTOM_AI_SETTINGS: CustomAISettings = {
  baseUrl: 'http://localhost:1234/v1',
  model: '',
  apiKey: ''
}

export function readCustomAISettings(): CustomAISettings {
  if (typeof window === 'undefined') {
    return DEFAULT_CUSTOM_AI_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CUSTOM_AI_SETTINGS

    const parsed = JSON.parse(raw) as Partial<CustomAISettings>
    return {
      baseUrl: sanitizeUrl(parsed.baseUrl) || DEFAULT_CUSTOM_AI_SETTINGS.baseUrl,
      model: parsed.model?.trim() || DEFAULT_CUSTOM_AI_SETTINGS.model,
      apiKey: parsed.apiKey?.trim() || ''
    }
  } catch {
    return DEFAULT_CUSTOM_AI_SETTINGS
  }
}

export function saveCustomAISettings(settings: Partial<CustomAISettings>): CustomAISettings {
  const current = readCustomAISettings()
  const next: CustomAISettings = {
    ...current,
    ...settings,
    baseUrl: sanitizeUrl(settings.baseUrl) || current.baseUrl,
    model: settings.model?.trim() || current.model,
    apiKey: settings.apiKey !== undefined ? settings.apiKey.trim() : current.apiKey
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  return next
}

function sanitizeUrl(value?: string): string {
  return value?.trim().replace(/\/+$/, '') || ''
}
