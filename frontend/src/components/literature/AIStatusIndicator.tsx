import React, { useCallback, useEffect, useState } from 'react'
import { literatureAiApi } from '../../lib/literature-api'
import { presetFor, type AIProfile } from '../../lib/literature/ai-profiles'

export default function AIStatusIndicator({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [profile, setProfile] = useState<AIProfile | null>(null)
  const [checking, setChecking] = useState(true)

  const load = useCallback(async () => {
    setChecking(true)
    try {
      const result = await literatureAiApi.profiles()
      setProfile(result.profiles.find((item: AIProfile) => item.id === result.defaults?.summaryProfileId) || null)
    } catch {
      setProfile(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('studykit-ai-config-changed', load)
    return () => window.removeEventListener('studykit-ai-config-changed', load)
  }, [load])

  const connected = profile?.local || profile?.lastTestStatus === 'success'
  const label = checking
    ? 'AI 配置检查中…'
    : profile
      ? `${profile.name}${profile.model ? ` · ${profile.model}` : ''}`
      : '配置 Literature AI'

  return (
    <button
      className="lit-ai-status"
      onClick={onOpenSettings}
      title={profile ? `${presetFor(profile.provider).label} · 点击管理 AI 配置` : '点击添加 AI 配置'}
      style={{ cursor: 'pointer', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.78rem', color: 'var(--color-text-secondary)', maxWidth: 260 }}
    >
      <span className={`dot ${connected ? 'online' : 'offline'}`} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}
