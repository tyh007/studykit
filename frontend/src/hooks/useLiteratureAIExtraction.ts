import { useState, useCallback, useEffect } from 'react'
import { getLocalOllamaAvailability, extractPaperWithLocalOllama } from '../lib/literature/local-ollama-ai'
import { getCustomAIAvailability, extractPaperWithCustomAI } from '../lib/literature/custom-ai-extraction'
import { readOllamaSettings, saveOllamaSettings, DEFAULT_OLLAMA_SETTINGS } from '../lib/literature/ollama-settings'
import { readCustomAISettings, saveCustomAISettings } from '../lib/literature/custom-ai-settings'
import { readAIProviderConfig, saveAIProviderConfig, type AIProvider } from '../lib/literature/ai-provider-config'
import { PSYCHOLOGY_CUSTOM_FIELDS, type CustomFieldDefinition } from '../lib/literature/prompt-builder'
import { literaturePapersApi } from '../lib/literature-api'

export interface AIExtractionState {
  isAvailable: boolean
  isChecking: boolean
  availableModels: string[]
  currentModel: string
  baseUrl: string
  provider: AIProvider
  error?: string
}

export function useLiteratureAIExtraction() {
  const initialSettings = readOllamaSettings()
  const initialProviderConfig = readAIProviderConfig()
  const initialCustomSettings = readCustomAISettings()

  const [aiState, setAIState] = useState<AIExtractionState>({
    isAvailable: false,
    isChecking: true,
    availableModels: [],
    currentModel: initialSettings.model || DEFAULT_OLLAMA_SETTINGS.model,
    baseUrl: initialSettings.baseUrl || DEFAULT_OLLAMA_SETTINGS.baseUrl,
    provider: initialProviderConfig.provider
  })
  const [detailLevel, setDetailLevel] = useState<'brief' | 'detailed'>('brief')
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([])

  const checkAIAvailability = useCallback(async () => {
    setAIState(prev => ({ ...prev, isChecking: true, error: undefined }))
    const config = readAIProviderConfig()

    try {
      if (config.provider === 'custom') {
        const check = await getCustomAIAvailability()
        const settings = readCustomAISettings()
        setAIState({
          isAvailable: check.available,
          isChecking: false,
          availableModels: check.models,
          currentModel: settings.model,
          baseUrl: settings.baseUrl,
          provider: 'custom',
          error: check.available ? undefined : 'Custom API not reachable'
        })
      } else if (config.provider === 'ollama') {
        const check = await getLocalOllamaAvailability()
        const savedSettings = readOllamaSettings()
        setAIState({
          isAvailable: check.available,
          isChecking: false,
          availableModels: check.models,
          currentModel: savedSettings.model,
          baseUrl: savedSettings.baseUrl,
          provider: 'ollama',
          error: check.available ? undefined : 'Ollama not running'
        })
      } else {
        // Gemini — just mark as available if API key is set
        setAIState({
          isAvailable: !!config.geminiApiKey,
          isChecking: false,
          availableModels: [],
          currentModel: config.geminiModel || 'gemini-2.0-flash',
          baseUrl: '',
          provider: 'gemini',
          error: config.geminiApiKey ? undefined : 'No Gemini API key configured'
        })
      }
    } catch (error) {
      setAIState(prev => ({
        ...prev, isAvailable: false, isChecking: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      }))
    }
  }, [])

  const setProvider = useCallback((provider: AIProvider) => {
    saveAIProviderConfig({ provider })
    setAIState(prev => ({ ...prev, provider }))
    checkAIAvailability()
  }, [checkAIAvailability])

  const setCurrentModel = useCallback((model: string) => {
    const config = readAIProviderConfig()
    if (config.provider === 'custom') {
      saveCustomAISettings({ model })
    } else {
      saveOllamaSettings({ model })
    }
    setAIState(prev => ({ ...prev, currentModel: model }))
  }, [])

  const setBaseUrl = useCallback((baseUrl: string) => {
    const config = readAIProviderConfig()
    if (config.provider === 'custom') {
      const settings = saveCustomAISettings({ baseUrl })
      setAIState(prev => ({ ...prev, baseUrl: settings.baseUrl }))
    } else {
      const settings = saveOllamaSettings({ baseUrl })
      setAIState(prev => ({ ...prev, baseUrl: settings.baseUrl }))
    }
  }, [])

  const setCustomApiKey = useCallback((apiKey: string) => {
    saveCustomAISettings({ apiKey })
  }, [])

  const extractFromPaper = useCallback(async (
    paperId: string,
    paperText: string,
    model?: string
  ) => {
    if (!paperText) return { success: false, error: 'No paper text provided' }
    try {
      const config = readAIProviderConfig()

      if (config.provider === 'custom') {
        const settings = readCustomAISettings()
        const result = await extractPaperWithCustomAI(
          paperText, detailLevel,
          customFields.length > 0 ? customFields : undefined,
          model || settings.model
        )
        await literaturePapersApi.update(paperId, {
          extracted_data: result.extractedData,
          processing_status: 'completed'
        })
        return { success: true, extractedData: result.extractedData, model: result.model }
      } else {
        const result = await extractPaperWithLocalOllama(
          paperText, detailLevel,
          customFields.length > 0 ? customFields : undefined,
          model || aiState.currentModel
        )
        await literaturePapersApi.update(paperId, {
          extracted_data: result.extractedData,
          processing_status: 'completed'
        })
        return { success: true, extractedData: result.extractedData, model: result.model }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Extraction failed' }
    }
  }, [aiState.currentModel, aiState.provider, detailLevel, customFields])

  const addCustomField = useCallback((field: CustomFieldDefinition) => {
    setCustomFields(prev => [...prev, field])
  }, [])

  const removeCustomField = useCallback((fieldId: string) => {
    setCustomFields(prev => prev.filter(f => f.id !== fieldId))
  }, [])

  const addPsychologyFields = useCallback(() => {
    setCustomFields(prev => {
      const existing = new Set(prev.map(f => f.id))
      return [...prev, ...PSYCHOLOGY_CUSTOM_FIELDS.filter(f => !existing.has(f.id))]
    })
  }, [])

  useEffect(() => { checkAIAvailability() }, [checkAIAvailability])

  return {
    aiState, checkAIAvailability, setProvider, setCurrentModel, setBaseUrl, setCustomApiKey,
    extractFromPaper,
    detailLevel, setDetailLevel,
    customFields, addCustomField, removeCustomField, addPsychologyFields
  }
}
