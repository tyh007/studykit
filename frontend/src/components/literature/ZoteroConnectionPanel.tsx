import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useSupports, zoteroApi } from '../../application/dataApi';

export default function ZoteroConnectionPanel() {
  const {
    externalAccount, setExternalAccount,
    zoteroConnectionStatus, setZoteroConnectionStatus,
  } = useStore();
  // Centralised capability check (WP-02 Gate §3 blocker D):
  // the Zotero connect / import / status calls all require a
  // sync workspace. In a local workspace we show a "需要 Sync"
  // notice *before* the user can click, so the click never
  // reaches the `/api` backend.
  const canUseZotero = useSupports('zotero.connect');

  const [showConnect, setShowConnect] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check connection status on mount — only when the local
  // workspace actually supports Zotero. The hook is unconditional
  // so the hook order stays stable, but the body short-circuits
  // when `canUseZotero` is false.
  useEffect(() => {
    if (!canUseZotero) return;
    zoteroApi.status()
      .then((res: any) => {
        if (res.status === 'connected' && res.account) {
          setExternalAccount(res.account);
          setZoteroConnectionStatus('connected');
        }
      })
      .catch(() => { /* not connected */ });
  }, [canUseZotero, setExternalAccount, setZoteroConnectionStatus]);

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await zoteroApi.connect({ apiKey: apiKey.trim(), userId: userId.trim() });
      setExternalAccount(result.account);
      setZoteroConnectionStatus('connected');
      setShowConnect(false);
      setApiKey('');
      setUserId('');
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
      setZoteroConnectionStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await zoteroApi.disconnect();
      setExternalAccount(null);
      setZoteroConnectionStatus('disconnected');
    } catch (err: any) {
      console.error('Disconnect failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="zotero-panel" data-testid="zotero-connection-panel" data-can-use-zotero={canUseZotero} style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-border)', marginBottom: '0.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)' }}>
          Zotero
        </span>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background:
              zoteroConnectionStatus === 'connected' ? 'var(--color-success, #4CAF50)'
              : zoteroConnectionStatus === 'connecting' ? 'var(--color-warning, #FF9800)'
              : zoteroConnectionStatus === 'error' ? 'var(--color-danger, #F44336)'
              : '#999',
          }}
          title={zoteroConnectionStatus}
        />
      </div>

      {!canUseZotero ? (
        <div
          className="zotero-local-notice"
          data-testid="zotero-local-notice"
          style={{
            fontSize: '0.7rem',
            color: 'var(--color-text-secondary)',
            padding: '0.25rem 0',
            lineHeight: 1.4,
          }}
        >
          Zotero 同步需要 Sync workspace。在 local workspace 中此项不可用。
        </div>
      ) : zoteroConnectionStatus === 'connected' && externalAccount ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          <div style={{ marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {externalAccount.provider_display_name || 'Connected'}
          </div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleDisconnect}
              disabled={loading}
              style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : zoteroConnectionStatus === 'error' ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
          <div style={{ marginBottom: '0.25rem' }}>Connection error</div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setShowConnect(true); setError(null); }}
            style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
          >
            Retry
          </button>
        </div>
      ) : !showConnect ? (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowConnect(true)}
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%', textAlign: 'left' }}
        >
          + Connect Zotero
        </button>
      ) : null}

      {showConnect && zoteroConnectionStatus !== 'connected' && (
        <div style={{ marginTop: '0.375rem' }}>
          <input
            autoFocus
            placeholder="Zotero API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{
              width: '100%',
              padding: '0.25rem 0.375rem',
              fontSize: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              marginBottom: '0.25rem',
            }}
          />
          <input
            placeholder="User ID (optional)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{
              width: '100%',
              padding: '0.25rem 0.375rem',
              fontSize: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              marginBottom: '0.25rem',
            }}
          />
          {error && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-danger)', marginBottom: '0.25rem' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleConnect}
              disabled={loading || !apiKey.trim()}
              style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setShowConnect(false); setError(null); }}
              style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
