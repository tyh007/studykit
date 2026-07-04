import React, { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Identifier of the most recently focused/selected paper; -1 if none. */
  paperId?: string | null;
  /** All selected paper IDs (when multiple are selected). */
  paperIds?: string[];
  prompt?: string;
  onPromptChange?: (p: string) => void;
  onSubmitted?: (answer: string, sources: string[]) => void;
  /** Prompt shortcuts shown as buttons. */
  shortcuts?: { label: string; prompt: string }[];
}

const DEFAULT_SHORTCUTS = [
  { label: 'Summarize selected', prompt: 'Summarize the key findings of the selected paper(s).' },
  { label: 'Compare selected', prompt: 'Compare the selected papers and highlight differences.' },
  { label: 'Find literature gap', prompt: 'Identify gaps in the literature covered by the selected paper(s).' },
  { label: 'Suggest relation', prompt: 'Suggest a semantic relationship between the selected papers.' },
  { label: 'Generate research questions', prompt: 'Generate research questions inspired by the selected paper(s).' },
  { label: 'Extract methodology', prompt: 'Extract the methodologies used in the selected paper(s).' },
  { label: 'Literature review paragraph', prompt: 'Write a literature review paragraph synthesizing the selected paper(s).' },
  { label: 'Make a concise note', prompt: 'Distill a concise note from the selected paper(s).' },
];

export default function CanvasAIAssistant({
  open,
  onClose,
  paperId = null,
  paperIds = [],
  prompt = '',
  onPromptChange,
  onSubmitted,
  shortcuts = DEFAULT_SHORTCUTS,
}: Props) {
  const [value, setValue] = useState(prompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setValue(prompt);
  }, [prompt]);

  if (!open) return null;

  const handleSubmit = async () => {
    const text = value.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const { literatureAiApi } = await import('../../../lib/literature-api');
      const messages = [{ role: 'user' as const, content: text }];
      let res;
      if (paperIds.length >= 2) {
        res = await literatureAiApi.chat({ paperIds, messages });
      } else if (paperIds.length === 1) {
        res = await literatureAiApi.chat({ paperId: paperIds[0], messages });
      } else if (paperId) {
        res = await literatureAiApi.chat({ paperId, messages });
      } else {
        res = await literatureAiApi.chat({ messages });
      }
      const answer = res?.message?.content ?? '';
      const sources = res?.sources ?? [];
      onSubmitted?.(answer, sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="canvas-ai-assistant" role="dialog" aria-label="AI assistant">
      <div className="canvas-ai-assistant-header">
        <span>AI assistant</span>
        <button
          className="canvas-ai-assistant-close"
          onClick={onClose}
          aria-label="Close AI assistant"
        >
          ×
        </button>
      </div>
      <div className="canvas-ai-assistant-body">
        <div className="canvas-ai-assistant-context">
          {paperIds.length >= 2
            ? `${paperIds.length} papers selected`
            : paperIds.length === 1 || paperId
              ? '1 paper in context'
              : 'No paper in context'}
        </div>
        <div className="canvas-ai-assistant-shortcuts">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              className="canvas-ai-assistant-chip"
              onClick={() => {
                setValue(s.prompt);
                onPromptChange?.(s.prompt);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <textarea
          className="canvas-ai-assistant-input"
          value={value}
          placeholder="Ask anything about the selected paper(s)…"
          onChange={(e) => {
            setValue(e.target.value);
            onPromptChange?.(e.target.value);
          }}
          rows={3}
        />
        {error && <div className="canvas-ai-assistant-error">{error}</div>}
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
