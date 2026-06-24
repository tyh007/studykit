import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { literatureAiApi } from '../../lib/literature-api'
import {
  PROVIDER_PRESETS,
  hasLegacyAIConfiguration,
  importLegacyAIConfiguration,
  readLocalProfileCredential,
  saveLocalProfileCredential,
  presetFor,
  type AIProfile,
  type AIProviderId,
  type AITaskDefaults,
} from '../../lib/literature/ai-profiles'

const DEFAULT_FIELDS = [
  { key: 'background', label: '研究背景' },
  { key: 'theory', label: '理论与假设' },
  { key: 'methodology', label: '研究方法' },
  { key: 'measures', label: '测量工具' },
  { key: 'results', label: '研究结果' },
  { key: 'implications', label: '研究启示' },
  { key: 'limitations', label: '局限性' },
]

const EMPTY_DEFAULTS: AITaskDefaults = {
  summaryProfileId: null,
  visionProfileId: null,
  chatProfileId: null,
  summaryOptions: {
    temperature: 0.3,
    maxTokens: 4096,
    enabledFields: DEFAULT_FIELDS.map(field => field.key),
    customInstructions: '',
    useVision: true,
  },
}

interface ProfileDraft {
  id?: string
  name: string
  provider: AIProviderId
  baseUrl: string
  model: string
  apiKey: string
}

function blankDraft(provider: AIProviderId = 'deepseek'): ProfileDraft {
  const preset = presetFor(provider)
  return { name: preset.label, provider, baseUrl: preset.defaultBaseUrl, model: '', apiKey: '' }
}

function profileDraft(profile: AIProfile): ProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: '',
  }
}

function CapabilityBadge({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      padding: '0.1rem 0.4rem',
      borderRadius: 999,
      fontSize: '0.68rem',
      background: enabled ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'var(--color-bg-secondary)',
      color: enabled ? 'var(--color-primary)' : 'var(--color-text-secondary)',
      border: '1px solid var(--color-border-light)',
    }}>
      {children}
    </span>
  )
}

export default function AISettingsPanel({ onClose, onSave }: { onClose: () => void; onSave?: () => void }) {
  const [tab, setTab] = useState<'connections' | 'defaults' | 'preferences'>('connections')
  const [profiles, setProfiles] = useState<AIProfile[]>([])
  const [defaults, setDefaults] = useState<AITaskDefaults>(EMPTY_DEFAULTS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProfileDraft>(() => blankDraft())
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [legacyAvailable, setLegacyAvailable] = useState(hasLegacyAIConfiguration)

  const selected = useMemo(
    () => profiles.find(profile => profile.id === selectedId) || null,
    [profiles, selectedId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await literatureAiApi.profiles()
      setProfiles(result.profiles)
      setDefaults({ ...EMPTY_DEFAULTS, ...result.defaults, summaryOptions: { ...EMPTY_DEFAULTS.summaryOptions, ...result.defaults?.summaryOptions } })
      if (!selectedId && result.profiles.length) {
        setSelectedId(result.profiles[0].id)
        setDraft(profileDraft(result.profiles[0]))
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法加载 AI 配置' })
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectProfile = (profile: AIProfile) => {
    setSelectedId(profile.id)
    setDraft(profileDraft(profile))
    setModels([])
    setMessage(null)
  }

  const startNew = (provider: AIProviderId = 'deepseek') => {
    setSelectedId(null)
    setDraft(blankDraft(provider))
    setModels([])
    setMessage(null)
  }

  const changeProvider = (provider: AIProviderId) => {
    const preset = presetFor(provider)
    setDraft(current => ({
      ...current,
      provider,
      name: current.id ? current.name : preset.label,
      baseUrl: preset.defaultBaseUrl,
      model: '',
    }))
    setModels([])
  }

  const saveProfile = async () => {
    if (!draft.name.trim() || !draft.baseUrl.trim()) {
      setMessage({ type: 'error', text: '请填写配置名称和 Base URL' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        name: draft.name,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        model: draft.model,
        options: draft.provider === 'custom' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(draft.baseUrl)
          ? { browserLocal: true }
          : {},
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      }
      const result = draft.id
        ? await literatureAiApi.updateProfile(draft.id, payload)
        : await literatureAiApi.createProfile(payload)
      if (payload.options.browserLocal === true && draft.apiKey) {
        saveLocalProfileCredential(result.profile.id, draft.apiKey)
      }
      await load()
      setSelectedId(result.profile.id)
      setDraft(profileDraft(result.profile))
      setMessage({ type: 'success', text: '配置已保存，API Key 不会返回到浏览器。' })
      onSave?.()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const testProfile = async () => {
    if (!draft.id) {
      setMessage({ type: 'error', text: '请先保存配置，再测试连接。' })
      return
    }
    setTesting(true)
    setMessage(null)
    try {
      const browserLocalCustom = draft.provider === 'custom' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(draft.baseUrl)
      if (draft.provider === 'ollama' || browserLocalCustom) {
        const endpoint = draft.provider === 'ollama' ? '/api/tags' : '/models'
        const localKey = draft.apiKey || (draft.id ? readLocalProfileCredential(draft.id) : '')
        const response = await fetch(`${draft.baseUrl.replace(/\/+$/, '')}${endpoint}`, {
          headers: localKey ? { Authorization: `Bearer ${localKey}` } : undefined,
        })
        if (!response.ok) throw new Error(`本地 AI HTTP ${response.status}`)
        const data = await response.json()
        const names = (data.models || data.data || []).map((item: any) => item.name || item.model || item.id).filter(Boolean)
        setModels(names)
        setMessage({ type: 'success', text: `已连接本地 AI，发现 ${names.length} 个模型。` })
      } else {
        const result = await literatureAiApi.testProfile(draft.id)
        setModels(result.models || [])
        setMessage({ type: 'success', text: `连接成功${result.models ? `，发现 ${result.models.length} 个模型` : ''}。` })
      }
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  const deleteProfile = async () => {
    if (!selected || !window.confirm(`删除 AI 配置“${selected.name}”？`)) return
    try {
      await literatureAiApi.deleteProfile(selected.id)
      saveLocalProfileCredential(selected.id, '')
      setSelectedId(null)
      setDraft(blankDraft())
      await load()
      setMessage({ type: 'success', text: '配置已删除。' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除失败' })
    }
  }

  const duplicateProfile = () => {
    if (!selected) return
    setSelectedId(null)
    setDraft({ ...profileDraft(selected), id: undefined, name: `${selected.name} 副本`, apiKey: '' })
    setModels([])
    setMessage({ type: 'success', text: '已复制非敏感设置；请重新填写 API Key。' })
  }

  const saveDefaults = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const next = await literatureAiApi.updateTaskDefaults({
        summaryProfileId: defaults.summaryProfileId,
        visionProfileId: defaults.visionProfileId,
        chatProfileId: defaults.chatProfileId,
        summaryOptions: defaults.summaryOptions,
      })
      setDefaults(next)
      setMessage({ type: 'success', text: '任务默认配置已保存。' })
      onSave?.()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const importLegacy = async () => {
    setSaving(true)
    try {
      await importLegacyAIConfiguration()
      setLegacyAvailable(false)
      await load()
      setMessage({ type: 'success', text: '旧配置已加密导入，浏览器中的旧密钥已清除。' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '旧配置导入失败' })
    } finally {
      setSaving(false)
    }
  }

  const updateSummaryOptions = (partial: Partial<AITaskDefaults['summaryOptions']>) => {
    setDefaults(current => ({
      ...current,
      summaryOptions: { ...current.summaryOptions, ...partial },
    }))
  }

  const fieldEnabled = (field: string) => defaults.summaryOptions.enabledFields.includes(field)
  const toggleField = (field: string) => {
    const current = defaults.summaryOptions.enabledFields
    updateSummaryOptions({
      enabledFields: current.includes(field) ? current.filter(item => item !== field) : [...current, field],
    })
  }

  const tabButton = (id: typeof tab, label: string) => (
    <button
      className={`btn btn-sm ${tab === id ? 'btn-primary' : ''}`}
      onClick={() => { setTab(id); setMessage(null) }}
      style={{ borderRadius: 999 }}
    >
      {label}
    </button>
  )

  const inputStyle: React.CSSProperties = { width: '100%' }
  const activeProvider = presetFor(draft.provider)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(960px, 94vw)', maxWidth: 960, height: 'min(720px, 90vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>Literature AI 配置中心</h2>
            <p className="text-sm text-muted">集中管理供应商、模型和不同任务的默认 AI。</p>
          </div>
          <button className="btn btn-sm" onClick={onClose}>关闭</button>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', margin: '1rem 0 0.75rem' }}>
          {tabButton('connections', 'AI 连接')}
          {tabButton('defaults', '任务默认')}
          {tabButton('preferences', '总结偏好')}
        </div>

        {legacyAvailable && (
          <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <span className="text-sm">检测到旧版浏览器 AI 配置。可将其加密迁移到账户。</span>
            <button className="btn btn-sm btn-primary" disabled={saving} onClick={importLegacy}>导入旧配置</button>
          </div>
        )}

        {message && (
          <div style={{
            padding: '0.55rem 0.7rem',
            marginBottom: '0.75rem',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            color: message.type === 'error' ? 'var(--color-danger, #b42318)' : 'var(--color-success, #15803d)',
            background: 'var(--color-bg-secondary)',
          }}>
            {message.text}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {loading ? (
            <div className="text-sm text-muted" style={{ padding: '2rem', textAlign: 'center' }}>正在加载配置…</div>
          ) : tab === 'connections' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 0.8fr) minmax(360px, 1.5fr)', gap: '1rem', minHeight: '100%' }}>
              <div style={{ borderRight: '1px solid var(--color-border-light)', paddingRight: '1rem' }}>
                <button className="btn btn-primary" style={{ width: '100%', marginBottom: '0.75rem' }} onClick={() => startNew()}>
                  新建 AI 连接
                </button>
                {profiles.length === 0 && <p className="text-sm text-muted">还没有配置。选择一个平台开始。</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {profiles.map(profile => (
                    <button
                      key={profile.id}
                      className="btn"
                      onClick={() => selectProfile(profile)}
                      style={{
                        textAlign: 'left',
                        display: 'block',
                        padding: '0.65rem',
                        borderColor: selectedId === profile.id ? 'var(--color-primary)' : undefined,
                        background: selectedId === profile.id ? 'color-mix(in srgb, var(--color-primary) 7%, var(--color-bg))' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <strong style={{ fontSize: '0.82rem' }}>{profile.name}</strong>
                        <span className={`dot ${profile.lastTestStatus === 'success' ? 'online' : 'offline'}`} />
                      </div>
                      <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                        {presetFor(profile.provider).label} · {profile.model || '未选择模型'}
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                        <CapabilityBadge enabled={profile.capabilities.text}>文本</CapabilityBadge>
                        <CapabilityBadge enabled={profile.capabilities.structured}>结构化</CapabilityBadge>
                        <CapabilityBadge enabled={profile.capabilities.vision}>视觉</CapabilityBadge>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ paddingRight: '0.25rem' }}>
                <div className="form-group">
                  <label>平台预设</label>
                  <select value={draft.provider} onChange={event => changeProvider(event.target.value as AIProviderId)} style={inputStyle}>
                    <optgroup label="国际平台">
                      {PROVIDER_PRESETS.slice(0, 5).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </optgroup>
                    <optgroup label="中国平台">
                      {PROVIDER_PRESETS.slice(5, 14).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </optgroup>
                    <optgroup label="本地与自定义">
                      {PROVIDER_PRESETS.slice(14).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div className="form-group">
                  <label>配置名称</label>
                  <input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} style={inputStyle} placeholder="例如：Claude 精读" />
                </div>
                <div className="form-group">
                  <label>Base URL</label>
                  <input
                    value={draft.baseUrl}
                    onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))}
                    style={inputStyle}
                    disabled={!activeProvider.custom && draft.provider !== 'ollama'}
                  />
                  {draft.provider === 'custom' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(draft.baseUrl) && (
                    <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>本地兼容接口由浏览器直连，密钥仅保存在当前浏览器。</p>
                  )}
                  {activeProvider.custom && <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>云端会阻止私网、localhost 和云元数据地址。</p>}
                </div>
                <div className="form-group">
                  <label>API Key {draft.provider === 'ollama' ? '（不需要）' : selected?.hasCredential && selected.provider === draft.provider ? `（已保存 ${selected.credentialMask || ''}）` : ''}</label>
                  <input
                    type="password"
                    value={draft.apiKey}
                    disabled={draft.provider === 'ollama'}
                    onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))}
                    style={inputStyle}
                    placeholder={selected?.hasCredential && selected.provider === draft.provider ? '留空以保留原密钥' : '输入 API Key'}
                    autoComplete="new-password"
                  />
                </div>
                <div className="form-group">
                  <label>模型</label>
                  <input
                    list="ai-profile-models"
                    value={draft.model}
                    onChange={event => setDraft(current => ({ ...current, model: event.target.value }))}
                    style={inputStyle}
                    placeholder="测试连接后选择，或手动输入模型 ID"
                  />
                  <datalist id="ai-profile-models">
                    {models.map(model => <option key={model} value={model} />)}
                  </datalist>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {selected && <button className="btn btn-sm" onClick={duplicateProfile}>复制</button>}
                    {selected && <button className="btn btn-sm" onClick={deleteProfile} style={{ color: 'var(--color-danger, #b42318)' }}>删除</button>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-sm" disabled={testing || !draft.id} onClick={testProfile}>
                      {testing ? '测试中…' : '测试并获取模型'}
                    </button>
                    <button className="btn btn-sm btn-primary" disabled={saving} onClick={saveProfile}>
                      {saving ? '保存中…' : '保存连接'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : tab === 'defaults' ? (
            <div style={{ maxWidth: 680 }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>按任务选择默认 AI</h3>
              <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>任务入口可以临时切换，但不会修改这里的默认值。</p>
              {([
                ['summaryProfileId', '文献结构化总结', profiles.filter(profile => profile.capabilities.structured)],
                ['visionProfileId', 'PDF 视觉提取', profiles.filter(profile => profile.capabilities.vision)],
                ['chatProfileId', '单篇 / 多篇论文问答', profiles.filter(profile => profile.capabilities.text)],
              ] as const).map(([key, label, choices]) => (
                <div className="form-group" key={key}>
                  <label>{label}</label>
                  <select
                    value={defaults[key] || ''}
                    onChange={event => setDefaults(current => ({ ...current, [key]: event.target.value || null }))}
                    style={inputStyle}
                  >
                    <option value="">未设置</option>
                    {choices.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.name} · {profile.model || '未选择模型'}</option>
                    ))}
                  </select>
                  {choices.length === 0 && <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>暂无具备该能力的配置。</p>}
                </div>
              ))}
              <button className="btn btn-primary" disabled={saving} onClick={saveDefaults}>保存任务默认</button>
            </div>
          ) : (
            <div style={{ maxWidth: 720 }}>
              <div className="form-group">
                <label>总结输出字段</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.45rem', marginTop: '0.5rem' }}>
                  {DEFAULT_FIELDS.map(field => (
                    <label key={field.key} style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', fontSize: '0.82rem' }}>
                      <input type="checkbox" checked={fieldEnabled(field.key)} onChange={() => toggleField(field.key)} />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Temperature：{defaults.summaryOptions.temperature}</label>
                <input type="range" min="0" max="1" step="0.05" value={defaults.summaryOptions.temperature} onChange={event => updateSummaryOptions({ temperature: Number(event.target.value) })} style={inputStyle} />
              </div>
              <div className="form-group">
                <label>最大输出 Tokens</label>
                <input type="number" min={512} max={32768} step={512} value={defaults.summaryOptions.maxTokens} onChange={event => updateSummaryOptions({ maxTokens: Number(event.target.value) || 4096 })} style={inputStyle} />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={defaults.summaryOptions.useVision} onChange={event => updateSummaryOptions({ useVision: event.target.checked })} />
                  扫描 PDF 或文本不足时启用视觉提取
                </label>
              </div>
              <div className="form-group">
                <label>自定义总结指令</label>
                <textarea
                  rows={5}
                  value={defaults.summaryOptions.customInstructions}
                  onChange={event => updateSummaryOptions({ customInstructions: event.target.value })}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  placeholder="例如：重点提取样本量、效应量和研究设计限制。"
                />
              </div>
              <button className="btn btn-primary" disabled={saving} onClick={saveDefaults}>保存总结偏好</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
