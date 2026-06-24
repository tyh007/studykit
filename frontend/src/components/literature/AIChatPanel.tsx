import React, { useState, useRef, useEffect, useCallback } from 'react';
import { literatureAiApi } from '../../lib/literature-api';
import { CloseIcon } from '../ui/Icons';
import { OllamaClient } from '../../lib/literature/ollama-client';
import { CustomAIClient } from '../../lib/literature/custom-ai-client';
import { readLocalProfileCredential, type AIProfile } from '../../lib/literature/ai-profiles';
import ReactMarkdown from 'react-markdown';
import type { LiteraturePaper } from '../../types';

// Parse AI response to separate thinking process from final answer
function parseAIContent(text: string): { thinking: string | null; response: string } {
  const marker = "Here's a thinking process:";
  const idx = text.indexOf(marker);
  if (idx === -1) return { thinking: null, response: text };

  const lines = text.split('\n');
  let markerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Here's a thinking process:")) { markerLine = i; break; }
  }
  if (markerLine === -1) return { thinking: null, response: text };

  // Find the LAST numbered step (1., 2., etc.) after the marker
  let lastNumLine = -1;
  for (let i = markerLine + 1; i < lines.length; i++) {
    if (/^\s*\d+\./.test(lines[i])) { lastNumLine = i; }
  }

  if (lastNumLine !== -1) {
    const thinking = lines.slice(0, lastNumLine + 1).join('\n').trim();
    const rest = lines.slice(lastNumLine + 1).map(l => l.trim()).filter(Boolean).join('\n').trim();
    return { thinking, response: rest || text };
  }
  return { thinking: null, response: text };
}

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
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('lit-chat-height') : null;
    return saved ? parseInt(saved) : 250;
  });
  const chatDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleChatResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    chatDragRef.current = { startY: e.clientY, startH: panelHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const handleMouseMove = (ev: MouseEvent) => {
      if (!chatDragRef.current) return;
      const dy = ev.clientY - chatDragRef.current.startY;
      const newH = chatDragRef.current.startH - dy;
      const clamped = Math.max(120, Math.min(500, newH));
      setPanelHeight(clamped);
      localStorage.setItem('lit-chat-height', String(clamped));
    };
    const handleMouseUp = () => {
      chatDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelHeight]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    literatureAiApi.profiles().then(result => {
      const available = result.profiles.filter((profile: AIProfile) => profile.capabilities.text);
      setProfiles(available);
      setProfileId(result.defaults?.chatProfileId || available[0]?.id || '');
    }).catch(() => {
      setProfiles([]);
      setProfileId('');
    });
  }, []);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const chatMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const profile = profiles.find(item => item.id === profileId);
      if (!profile) throw new Error('请先在 Literature AI 配置中心设置论文问答模型');

      if (profile.provider === 'ollama') {
        const client = new OllamaClient(profile.baseUrl, profile.model);
        const paperContext = paper
          ? `You are analyzing this academic paper.
TITLE: ${paper.title || 'Untitled'}
AUTHORS: ${paper.authors || 'Unknown'}
YEAR: ${paper.year || 'Unknown'}
ABSTRACT: ${paper.abstract || 'Not available'}
EXTRACTED DATA: ${JSON.stringify(paper.extracted_data || {})}
Answer from this paper and say when information is unavailable.`
          : 'You are a research assistant helping analyze academic literature.';
        const result = await client.chat({
          model: profile.model,
          messages: [{ role: 'system', content: paperContext }, ...chatMessages],
          stream: false,
          options: { temperature: 0.3, max_tokens: 4096 },
        })
        setMessages(prev => [...prev, { role: 'assistant', content: result.message?.content || '(no response)' }]);
      } else if (profile.provider === 'custom' && profile.local) {
        const client = new CustomAIClient(profile.baseUrl, profile.model, readLocalProfileCredential(profile.id));
        const paperContext = paper
          ? `You are analyzing this academic paper.
TITLE: ${paper.title || 'Untitled'}
ABSTRACT: ${paper.abstract || 'Not available'}
EXTRACTED DATA: ${JSON.stringify(paper.extracted_data || {})}`
          : 'You are a research assistant helping analyze academic literature.';
        const result = await client.chat({
          model: profile.model,
          messages: [{ role: 'system', content: paperContext }, ...chatMessages],
          temperature: 0.3,
          max_tokens: 4096,
          stream: false,
        })
        setMessages(prev => [...prev, { role: 'assistant', content: result.choices?.[0]?.message?.content || '(no response)' }]);
      } else {
        const result = await literatureAiApi.chat({
          paperId: paper?.id,
          paperIds: paperIds || (paper?.id ? [paper.id] : undefined),
          messages: chatMessages,
          profileId: profile.id,
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
        onMouseDown={handleChatResizeStart}
        style={{ height: 5, cursor: 'row-resize', background: 'var(--color-border-light)', flexShrink: 0 }}
      />
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.375rem 0.75rem',
        borderBottom: '1px solid var(--color-border-light)',
        background: 'var(--color-bg-secondary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>AI Assistant</span>
          <select
            value={profileId}
            onChange={event => setProfileId(event.target.value)}
            style={{ maxWidth: 210, minWidth: 120, fontSize: '0.72rem', padding: '0.15rem 0.35rem' }}
            title="仅切换本次对话使用的 AI 配置"
          >
            {profiles.length === 0 && <option value="">未配置 AI</option>}
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model || '未选模型'}</option>)}
          </select>
        </div>
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
                      <div style={{ lineHeight: 1.5 }}><ReactMarkdown>{parsed.response}</ReactMarkdown></div>
                    </>
                  );
                }
                return msg.content;
              })() : <ReactMarkdown>{msg.content}</ReactMarkdown>}
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
