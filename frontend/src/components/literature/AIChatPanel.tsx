import React, { useState, useRef, useEffect } from 'react';
import { literatureAiApi } from '../../lib/literature-api';
import { CloseIcon } from '../ui/Icons';
import { readAIProviderConfig } from '../../lib/literature/ai-provider-config';
import { readCustomAISettings } from '../../lib/literature/custom-ai-settings';
import { CustomAIClient } from '../../lib/literature/custom-ai-client';
import { useDragResize } from '../../hooks/useDragResize';
import ReactMarkdown from 'react-markdown';
import type { LiteraturePaper } from '../../types';

// Parse AI response to separate thinking process from final answer.
// Exported for unit tests (see AIChatPanel.test.ts).
export function parseAIContent(text: string): { thinking: string | null; response: string } {
  // The marker must be on its own line — otherwise the model is just
  // mentioning the phrase in prose, and we should not split the response.
  const lines = text.split('\n');
  const markerLine = lines.findIndex((l) => l.trim() === "Here's a thinking process:");
  if (markerLine === -1) return { thinking: null, response: text };

  // Find the LAST numbered step after the marker. The step must have a
  // number, a dot, and at least one non-space character (so that "1." at
  // end-of-line doesn't qualify). Without this, a model that mentions
  // "Step 1." once and then prose would incorrectly split the response.
  let lastNumLine = -1;
  for (let i = markerLine + 1; i < lines.length; i++) {
    if (/^\s*\d+\.\s+\S/.test(lines[i])) lastNumLine = i;
  }
  if (lastNumLine === -1) return { thinking: null, response: text };

  const thinking = lines.slice(0, lastNumLine + 1).join('\n').trim();
  const response = lines
    .slice(lastNumLine + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return { thinking, response: response || text };
}

// Loopback check used by the localhost warning (P3 #2/#3).
function isLoopbackUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|::1)(:\d+)?\//.test(url);
}

// react-markdown's default <a> renderer doesn't add rel="noopener noreferrer",
// so external links from LLM output would have reverse-tabnabbing risk.
// Wrap the link to always emit both attributes.
const CustomLink: React.ComponentProps<typeof ReactMarkdown>['components']['a'] = ({
  href,
  children,
  ...rest
}) => (
  <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
    {children}
  </a>
);

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
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('lit-chat-height') : null;
    return saved ? parseInt(saved) : 250;
  });

  // Drag-resize the AI chat panel vertically. Persists the committed height
  // to localStorage on pointerup only (the old code wrote on every move).
  const { onPointerDown: onChatResizeDown, separatorProps: chatResizeProps } = useDragResize({
    axis: 'y',
    startValue: panelHeight,
    min: 120,
    max: 500,
    onChange: setPanelHeight,
    persistKey: 'lit-chat-height',
  });
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
        // Warn once per non-loopback baseUrl so the user notices credentials
        // and paper content are leaving their machine (P3 #2/#3).
        if (!isLoopbackUrl(customSettings.baseUrl)) {
          console.warn(
            `[AIChatPanel] Connecting to non-loopback LLM at ${customSettings.baseUrl}. ` +
              'Credentials and paper content will be sent to this host.',
          );
        }
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
        <span style={{ opacity: 0.7 }}>AI</span>
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
      height: panelHeight + 'px',
      background: 'var(--color-bg)',
    }}>
      {/* Resize handle */}
      <div
        {...chatResizeProps}
        onPointerDown={onChatResizeDown}
        aria-label="Resize AI assistant"
        style={{ height: 5, cursor: 'row-resize', background: 'var(--color-border-light)', flexShrink: 0 }}
      />
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.375rem 0.75rem',
        borderBottom: '1px solid var(--color-border-light)',
        background: 'var(--color-bg-secondary)',
      }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>AI Assistant</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setExpanded(false); onClose?.(); }}
          style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem' }}
        >
          <CloseIcon size="sm" />
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
              {msg.role === 'assistant' ? (() => {
                const parsed = parseAIContent(msg.content);
                if (parsed.thinking) {
                  return (
                    <>
                      <details style={{ marginBottom: '0.25rem' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--color-text-muted)', userSelect: 'none' }}>
                          💭 Thinking
                        </summary>
                        <div style={{
                          fontSize: '0.72rem', color: 'var(--color-text-muted)',
                          padding: '0.25rem 0 0.25rem 0.5rem',
                          borderLeft: '2px solid var(--color-border)',
                          marginTop: '0.125rem',
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.5,
                        }}>
                          {parsed.thinking}
                        </div>
                      </details>
                      <div style={{ lineHeight: 1.5 }}><ReactMarkdown components={{ a: CustomLink }}>{parsed.response}</ReactMarkdown></div>
                    </>
                  );
                }
                return msg.content;
              })() : <ReactMarkdown components={{ a: CustomLink }}>{msg.content}</ReactMarkdown>}
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
