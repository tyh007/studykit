import { literatureAiApi } from '../literature-api'
import { readAIProviderConfig, clearAIProviderConfig } from './ai-provider-config'
import { readCustomAISettings } from './custom-ai-settings'
import { readOllamaSettings } from './ollama-settings'

export type AIProviderId =
  | 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'groq'
  | 'deepseek' | 'minimax' | 'moonshot' | 'zhipu' | 'dashscope'
  | 'volcengine' | 'baidu' | 'tencent' | 'siliconflow'
  | 'ollama' | 'custom'

export interface AIProviderPreset {
  id: AIProviderId
  label: string
  defaultBaseUrl: string
  local?: boolean
  custom?: boolean
}

export interface AIProfile {
  id: string
  name: string
  provider: AIProviderId
  baseUrl: string
  model: string
  options: Record<string, unknown>
  capabilities: { text: boolean; structured: boolean; vision: boolean }
  hasCredential: boolean
  credentialMask?: string | null
  local: boolean
  lastTestStatus: 'untested' | 'success' | 'error'
  lastTestError?: string | null
  lastTestedAt?: string | null
}

export interface AITaskDefaults {
  summaryProfileId: string | null
  visionProfileId: string | null
  chatProfileId: string | null
  summaryOptions: {
    temperature: number
    maxTokens: number
    enabledFields: string[]
    customInstructions: string
    useVision: boolean
  }
}

export const PROVIDER_PRESETS: AIProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com' },
  { id: 'minimax', label: 'MiniMax', defaultBaseUrl: 'https://api.minimaxi.com/v1' },
  { id: 'moonshot', label: 'Kimi / Moonshot', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', label: '智谱 GLM', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'dashscope', label: '阿里云百炼', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'volcengine', label: '火山方舟 / 豆包', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'baidu', label: '百度千帆 / 文心', defaultBaseUrl: 'https://qianfan.baidubce.com/v2' },
  { id: 'tencent', label: '腾讯混元', defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'siliconflow', label: '硅基流动', defaultBaseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'ollama', label: 'Ollama（本机）', defaultBaseUrl: 'http://localhost:11434', local: true },
  { id: 'custom', label: '自定义 OpenAI-compatible', defaultBaseUrl: '', custom: true },
]

export function presetFor(provider: AIProviderId) {
  return PROVIDER_PRESETS.find(item => item.id === provider) || PROVIDER_PRESETS[0]
}

export function saveLocalProfileCredential(profileId: string, apiKey: string) {
  if (typeof window === 'undefined') return
  const key = `studykit-local-ai-credential:${profileId}`
  if (apiKey) window.localStorage.setItem(key, apiKey)
  else window.localStorage.removeItem(key)
}

export function readLocalProfileCredential(profileId: string) {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(`studykit-local-ai-credential:${profileId}`) || ''
}

export function hasLegacyAIConfiguration(): boolean {
  if (typeof window === 'undefined') return false
  return ['studykit-ai-provider', 'studykit-custom-ai', 'studykit-ollama-settings']
    .some(key => window.localStorage.getItem(key))
}

export async function importLegacyAIConfiguration() {
  const config = readAIProviderConfig()
  let payload: Parameters<typeof literatureAiApi.createProfile>[0]

  if (config.provider === 'gemini') {
    payload = {
      name: 'Gemini（旧配置）',
      provider: 'gemini',
      baseUrl: presetFor('gemini').defaultBaseUrl,
      model: config.geminiModel || '',
      apiKey: config.geminiApiKey || '',
    }
  } else if (config.provider === 'custom') {
    const custom = readCustomAISettings()
    const browserLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(custom.baseUrl)
    payload = {
      name: '自定义 API（旧配置）',
      provider: 'custom',
      baseUrl: custom.baseUrl,
      model: custom.model,
      apiKey: custom.apiKey,
      options: browserLocal ? { browserLocal: true } : {},
    }
  } else {
    const ollama = readOllamaSettings()
    payload = {
      name: 'Ollama（旧配置）',
      provider: 'ollama',
      baseUrl: ollama.baseUrl,
      model: ollama.model,
    }
  }

  const result = await literatureAiApi.createProfile(payload)
  if (payload.options?.browserLocal === true && payload.apiKey) {
    saveLocalProfileCredential(result.profile.id, payload.apiKey)
  }
  const defaults: Partial<AITaskDefaults> = {
    summaryProfileId: result.profile.id,
    chatProfileId: result.profile.id,
  }
  if (result.profile.capabilities.vision) defaults.visionProfileId = result.profile.id
  await literatureAiApi.updateTaskDefaults(defaults)

  clearAIProviderConfig()
  window.localStorage.removeItem('studykit-custom-ai')
  window.localStorage.removeItem('studykit-ollama-settings')
  return result.profile as AIProfile
}
