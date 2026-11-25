import React, { useCallback, useEffect, useState } from 'react'
import { literatureAiApi, useSupports } from '../../application/dataApi'
import { presetFor, type AIProfile } from '../../lib/literature/ai-profiles'

export default function AIStatusIndicator({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [profile, setProfile] = useState<AIProfile | null>(null)
  const [checking, setChecking] = useState(true)
  // Centralised capability check (WP-02 Gate §3 blocker D).
  // In a local workspace AI is not supported; we MUST NOT
  // auto-fetch `literatureAiApi.profiles()` on mount, otherwise
  // the indicator would silently hit `/api`. Render a
  // "需要 Sync" state instead and skip the effect.
  const canUseAi = useSupports('ai.status')

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
    if (!canUseAi) {
      // No fetch in local mode — leave the indicator in a
      // explicit "需要 Sync" state.
      setChecking(false)
      setProfile(null)
      return
    }
    load()
    window.addEventListener('studykit-ai-config-changed', load)
    return () => window.removeEventListener('studykit-ai-config-changed', load)
  }, [canUseAi, load])

  if (!canUseAi) {
    return (
      <button
        className="lit-ai-status lit-ai-status-local"
        onClick={onOpenSettings}
        data-testid="ai-status-local-notice"
        title="AI 同步需要 Sync workspace"
        style={{ cursor: 'not-allowed', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', maxWidth: 260 }}
        disabled
      >
        <span className="dot offline" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          AI 需要 Sync workspace
        </span>
      </button>
    )
  }

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
