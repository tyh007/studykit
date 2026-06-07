import React, { useState, useRef, useEffect } from 'react';
import { literatureAiApi } from '../../lib/literature-api';
import { readAIProviderConfig } from '../../lib/literature/ai-provider-config';
import { readCustomAISettings } from '../../lib/literature/custom-ai-settings';
import { CustomAIClient } from '../../lib/literature/custom-ai-client';
import type { LiteraturePaper } from '../../types';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface AIChatPanelProps {
  paper?: LiteraturePaper | null;
  paperIds?: string[];
  onClose?: () => void;
}

export default function AIChatPanel({ paper, paperIds, onClose }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Show initial greeting based on context
    if (paper) {
      return [{
        role: 'assistant' as const,
        content: `I've analyzed "${paper.title || 'this paper'}". What would you like to know about it?`
      }];
    }
    return [{
      role: 'assistant' as const,
      content: 'I can help you analyze papers. What would you like to know?'
    }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const config = readAIProviderConfig();
      const chatMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      if (config.provider === 'custom') {
        // Use CustomAIClient directly (matches user's MLX setup)
        const customSettings = readCustomAISettings();
        if (!customSettings.baseUrl) throw new Error('Custom API URL not configured in AI Settings');
        const client = new CustomAIClient(customSettings.baseUrl, customSettings.model, customSettings.apiKey);
        const result = await client.chat({
          model: customSettings.model || 'default',
          messages: chatMessages,
          temperature: 0.3,
          max_tokens: 2048,
          stream: false,
        });
        const reply = result.choices?.[0]?.message?.content || '';
        setMessages(prev => [...prev, { role: 'assistant', content: reply || '(no response)' }]);
      } else {
        // Fallback: backend Gemini chat
        const result = await literatureAiApi.chat({
          paperId: paper?.id,
          paperIds: paperIds || (paper?.id ? [paper.id] : undefined),
          messages: chatMessages,
          geminiApiKey: config.geminiApiKey,
          geminiModel: config.geminiModel || 'gemini-2.0-flash',
        });
        setMessages(prev => [...prev, { role: 'assistant', content: result.message.content }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to get response.'}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        style={{
          padding: '0.5rem 0.75rem',
          borderTop: '1px solid var(--color-border)',
          cursor: 'pointer',
          fontSize: '0.82rem',
          color: 'var(--color-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <span>💬</span>
        <span>Ask AI about this paper...</span>
      </div>
    );
  }

  return (
    <div style={{
      borderTop: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      maxHeight: 300,
      background: 'var(--color-bg)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.375rem 0.75rem',
        borderBottom: '1px solid var(--color-border-light)',
        background: 'var(--color-bg-secondary)',
      }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>💬 AI Assistant</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setExpanded(false); onClose?.(); }}
          style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '0.5rem 0.75rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '85%',
              padding: '0.375rem 0.625rem',
              borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg-secondary)',
              color: msg.role === 'user' ? '#fff' : 'var(--color-text)',
              fontSize: '0.8rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0' }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary)',
              animation: 'pulse 1s infinite',
            }} />
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary)',
              animation: 'pulse 1s infinite 0.2s',
            }} />
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary)',
              animation: 'pulse 1s infinite 0.4s',
            }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.25rem' }}>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex', gap: '0.375rem', padding: '0.5rem 0.75rem',
        borderTop: '1px solid var(--color-border-light)',
      }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder={loading ? 'Waiting for response...' : 'Ask about this paper...'}
          disabled={loading}
          style={{
            flex: 1, padding: '0.375rem 0.5rem', fontSize: '0.8rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{ fontSize: '0.78rem' }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
