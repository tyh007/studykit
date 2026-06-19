import React, { useState, useEffect } from 'react';
import {
  readAIProviderConfig,
  saveAIProviderConfig,
  clearAIProviderConfig,
  type AIProvider,
  type AIProviderConfig,
} from '../../lib/literature/ai-provider-config';

const DEFAULT_FIELDS = [
  { key: 'background', label: 'Background' },
  { key: 'theory', label: 'Theory & Hypotheses' },
  { key: 'methodology', label: 'Methodology' },
  { key: 'measures', label: 'Measures' },
  { key: 'results', label: 'Results' },
  { key: 'implications', label: 'Implications' },
  { key: 'limitations', label: 'Limitations' },
];

interface AISettingsPanelProps {
  onClose: () => void;
  onSave?: (config: AIProviderConfig) => void;
}

export default function AISettingsPanel({ onClose, onSave }: AISettingsPanelProps) {
  const [config, setConfig] = useState<AIProviderConfig>(() => readAIProviderConfig());
  const [showApiKey, setShowApiKey] = useState(false);

  const update = (partial: Partial<AIProviderConfig>) => {
    const next = { ...config, ...partial };
    setConfig(next);
  };

  const handleSave = () => {
    const saved = saveAIProviderConfig(config);
    setConfig(saved);
    onSave?.(saved);
    onClose();
  };

  const handleReset = () => {
    clearAIProviderConfig();
    const fresh = readAIProviderConfig();
    setConfig(fresh);
  };

  const toggleField = (key: string) => {
    const current = config.enabledFields || DEFAULT_FIELDS.map(f => f.key);
    const next = current.includes(key)
      ? current.filter(f => f !== key)
      : [...current, key];
    update({ enabledFields: next });
  };

  const enabledFields = config.enabledFields || DEFAULT_FIELDS.map(f => f.key);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>AI Extraction Settings</h2>
        <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
          Configure how AI extracts structured data from your papers.
        </p>

        {/* AI Provider */}
        <div className="form-group">
          <label>AI Provider</label>
          <select
            value={config.provider}
            onChange={e => update({ provider: e.target.value as AIProvider })}
            style={{ width: '100%' }}
          >
            <option value="gemini">Gemini (cloud)</option>
            <option value="custom">Custom API</option>
            <option value="ollama">Local Ollama</option>
          </select>
        </div>

        {/* Gemini-specific settings */}
        {config.provider === 'gemini' && (
          <>
            <div className="form-group">
              <label>Gemini Model</label>
              <select
                value={config.geminiModel || 'gemini-2.0-flash'}
                onChange={e => update({ geminiModel: e.target.value })}
                style={{ width: '100%' }}
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (vision, multimodal)</option>
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
              </select>
            </div>
            <div className="form-group">
              <label>API Key</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={config.geminiApiKey || ''}
                  onChange={e => update({ geminiApiKey: e.target.value })}
                  placeholder="AIzaSy..."
                  style={{ flex: 1 }}
                />
                <button className="btn btn-sm" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Custom API settings */}
        {config.provider === 'custom' && (
          <>
            <div className="form-group">
              <label>API Base URL</label>
              <input
                value={config.customBaseUrl || ''}
                onChange={e => update({ customBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                style={{ width: '100%' }}
              />
            </div>
            <div className="form-group">
              <label>Model</label>
              <input
                value={config.customModel || ''}
                onChange={e => update({ customModel: e.target.value })}
                placeholder="gpt-4o"
                style={{ width: '100%' }}
              />
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={config.customApiKey || ''}
                onChange={e => update({ customApiKey: e.target.value })}
                placeholder="sk-..."
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        {/* Temperature */}
        <div className="form-group">
          <label>Temperature: {config.temperature ?? 0.3}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.temperature ?? 0.3}
            onChange={e => update({ temperature: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            <span>Precise (0)</span>
            <span>Balanced (0.3)</span>
            <span>Creative (1)</span>
          </div>
        </div>

        {/* Max Output Tokens */}
        <div className="form-group">
          <label>Max Output Tokens</label>
          <input
            type="number"
            min={512}
            max={16384}
            step={512}
            value={config.maxTokens || 4096}
            onChange={e => update({ maxTokens: parseInt(e.target.value) || 4096 })}
            style={{ width: '100%' }}
          />
        </div>

        {/* Multi-modal toggle */}
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ margin: 0, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.useVision !== false}
              onChange={e => update({ useVision: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            Enable multi-modal Vision extraction (PDF page images)
          </label>
        </div>
        <p className="text-xs text-muted" style={{ marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
          When enabled, AI reads PDF pages as images — supports scanned PDFs, figures, and tables.
          Recommended model: Gemini 2.5 Pro for best results.
        </p>

        {/* Output Fields */}
        <div className="form-group">
          <label>Output Fields (columns in summary table)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', marginTop: '0.25rem' }}>
            {DEFAULT_FIELDS.map(f => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enabledFields.includes(f.key)}
                  onChange={() => toggleField(f.key)}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        {/* Custom Instructions */}
        <div className="form-group">
          <label>Custom Instructions (optional)</label>
          <textarea
            value={config.customInstructions || ''}
            onChange={e => update({ customInstructions: e.target.value })}
            placeholder="E.g. 'Focus on methodological details. Extract sample sizes for all studies.'"
            rows={4}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}
          />
          <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
            These instructions are appended to the AI extraction prompt.
          </p>
        </div>

        <div className="flex gap-2 justify-between" style={{ marginTop: '1rem' }}>
          <button className="btn" onClick={handleReset} style={{ color: 'var(--color-text-secondary)' }}>
            Reset to Default
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
