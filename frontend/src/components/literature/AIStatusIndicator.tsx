import React, { useState, useEffect, useCallback } from 'react';
import { readAIProviderConfig, saveAIProviderConfig, type AIProvider } from '../../lib/literature/ai-provider-config';
import { readOllamaSettings, saveOllamaSettings } from '../../lib/literature/ollama-settings';
import { readCustomAISettings, saveCustomAISettings } from '../../lib/literature/custom-ai-settings';
import { getLocalOllamaAvailability } from '../../lib/literature/local-ollama-ai';
import { getCustomAIAvailability } from '../../lib/literature/custom-ai-extraction';

const PROVIDER_LABELS: Record<AIProvider, string> = {
  ollama: 'Ollama',
  custom: 'Custom API',
  gemini: 'Gemini',
};

export default function AIStatusIndicator() {
  const [expanded, setExpanded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [provider, setProvider] = useState<AIProvider>('ollama');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [customUrl, setCustomUrl] = useState('http://localhost:1234/v1');
  const [customModel, setCustomModel] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.0-flash');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const loadConfig = useCallback(() => {
    const config = readAIProviderConfig();
    setProvider(config.provider);

    const ollama = readOllamaSettings();
    setOllamaUrl(ollama.baseUrl);
    setOllamaModel(ollama.model);

    const custom = readCustomAISettings();
    setCustomUrl(custom.baseUrl);
    setCustomModel(custom.model);
    setCustomApiKey(custom.apiKey);

    if (config.geminiApiKey) setGeminiKey(config.geminiApiKey);
    if (config.geminiModel) setGeminiModel(config.geminiModel);
  }, []);

  const checkAvailability = useCallback(async () => {
    setChecking(true);
    const config = readAIProviderConfig();
    try {
      if (config.provider === 'custom') {
        const result = await getCustomAIAvailability();
        setAvailable(result.available);
      } else if (config.provider === 'ollama') {
        const result = await getLocalOllamaAvailability();
        setAvailable(result.available);
      } else {
        setAvailable(!!config.geminiApiKey);
      }
    } catch {
      setAvailable(false);
    } finally {
      setChecking(false);
    }
  }, []);

  // Load config and check on mount
  useEffect(() => {
    loadConfig();
    checkAvailability();
  }, [loadConfig, checkAvailability]);

  const handleProviderChange = useCallback((newProvider: AIProvider) => {
    setProvider(newProvider);
    saveAIProviderConfig({ provider: newProvider });
  }, []);

  const handleOllamaChange = useCallback(() => {
    saveOllamaSettings({ baseUrl: ollamaUrl, model: ollamaModel });
  }, [ollamaUrl, ollamaModel]);

  const handleCustomChange = useCallback(() => {
    saveCustomAISettings({ baseUrl: customUrl, model: customModel, apiKey: customApiKey });
  }, [customUrl, customModel, customApiKey]);

  const handleGeminiChange = useCallback(() => {
    saveAIProviderConfig({ geminiApiKey: geminiKey || undefined, geminiModel });
  }, [geminiKey, geminiModel]);

  const saveAll = useCallback(() => {
    handleOllamaChange();
    handleCustomChange();
    handleGeminiChange();
    checkAvailability();
    setSaveFeedback('Saved!');
    setTimeout(() => setSaveFeedback(null), 1500);
  }, [handleOllamaChange, handleCustomChange, handleGeminiChange, checkAvailability]);

  const modelName = provider === 'custom' ? customModel
    : provider === 'gemini' ? geminiModel
    : ollamaModel || 'local';

  const statusText = checking ? 'Checking...' : available ? modelName : modelName ? `${modelName} (offline)` : 'AI Offline';
  const tooltip = available
    ? `${PROVIDER_LABELS[provider]} connected (${modelName})`
    : `AI not available (${PROVIDER_LABELS[provider]})`;

  const labelStyle: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-text-secondary)' };
  const inputStyle: React.CSSProperties = { padding: '0.25rem 0.35rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.78rem' };
  const selectStyle: React.CSSProperties = { ...inputStyle, width: '100%' };

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="lit-ai-status"
        title={tooltip}
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}
      >
        <span className={`dot ${available ? 'online' : 'offline'}`} />
        <span>{statusText}</span>
      </button>

      {expanded && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, zIndex: 100,
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', padding: '0.75rem', minWidth: 280,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: '0.8rem',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem' }}>AI Provider</div>

          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
            style={{ ...selectStyle, marginBottom: '0.5rem' }}
          >
            <option value="ollama">Ollama</option>
            <option value="custom">Custom API (OpenAI-compatible)</option>
            <option value="gemini">Gemini</option>
          </select>

          {provider === 'ollama' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={labelStyle}>Base URL</label>
              <input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} onBlur={handleOllamaChange} placeholder="http://localhost:11434" style={inputStyle} />
              <label style={labelStyle}>Model</label>
              <input value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} onBlur={handleOllamaChange} placeholder="qwen2.5:3b" style={inputStyle} />
            </div>
          )}

          {provider === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={labelStyle}>Base URL</label>
              <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} onBlur={handleCustomChange} placeholder="http://localhost:1234/v1" style={inputStyle} />
              <label style={labelStyle}>Model</label>
              <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} onBlur={handleCustomChange} placeholder="mlx-model-name" style={inputStyle} />
              <label style={labelStyle}>API Key (optional)</label>
              <input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} onBlur={handleCustomChange} placeholder="sk-..." style={inputStyle} />
            </div>
          )}

          {provider === 'gemini' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={labelStyle}>API Key</label>
              <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} onBlur={handleGeminiChange} placeholder="AIza..." style={inputStyle} />
              <label style={labelStyle}>Model</label>
              <select value={geminiModel} onChange={(e) => { setGeminiModel(e.target.value); handleGeminiChange(); }} style={selectStyle}>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              </select>
            </div>
          )}

          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', alignItems: 'center' }}>
            {saveFeedback && <span style={{ fontSize: '0.75rem', color: 'var(--color-success, #22c55e)' }}>{saveFeedback}</span>}
            <button className="btn btn-sm" onClick={saveAll}>Save</button>
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setExpanded(false)} />
      )}
    </div>
  );
}
