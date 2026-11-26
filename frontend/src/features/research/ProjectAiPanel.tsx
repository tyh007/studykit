/**
 * StudyKit v0.5 P4 — the project AI panel (ADR-003 §6).
 *
 * A thinking partner, not a ghostwriter. Three things on screen: ask,
 * “Challenge” (one button, four voices) and “What am I missing?”, which
 * asks for your own ideas first. Replies are short; suggestions arrive
 * as cards that change nothing until you apply them. Conversations are
 * saved with the project and shared with its members by default.
 */

import React from 'react';
import './projectAi.css';
import { useResearchDeps } from './researchContext';
import {
  AI_ROLES,
  askPartner,
  decideDraft,
  roleLabel,
  shareThread,
} from '../../application/research/aiPartner';
import { contextKey } from '../../application/research/aiContext';
import type {
  AiContextRef,
  AiDraftDecision,
  AiDraftProposal,
  AiMessage,
  AiMove,
  AiRole,
  AiThread,
} from '../../domain/aiThread';
import { Button } from '../../shared/ui/Button';

export interface ProjectAiPanelProps {
  readonly projectId: string;
  readonly userId: string;
  /** Context from the focused editor, most specific first. */
  readonly context: readonly AiContextRef[];
  readonly onClose: () => void;
  /** Open the argument, optionally at a point. */
  readonly onOpenArgument: (claimId?: string) => void;
}

type Availability = 'checking' | 'available' | 'off';

interface ThreadData {
  readonly threads: readonly AiThread[];
  readonly messages: readonly AiMessage[];
  readonly decisions: readonly AiDraftDecision[];
}

const ACTIVE_KEY = 'studykit.ai.activeThread.';

function useThreads(projectId: string, activeId: string | null): ThreadData {
  const { repository } = useResearchDeps();
  const [data, setData] = React.useState<ThreadData>({ threads: [], messages: [], decisions: [] });
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [threads, messages, decisions] = await Promise.all([
        repository.listAiThreads({ projectId }),
        activeId ? repository.listAiMessages({ threadId: activeId }) : Promise.resolve([]),
        activeId ? repository.listAiDraftDecisions({ threadId: activeId }) : Promise.resolve([]),
      ]);
      if (!cancelled) setData({ threads, messages, decisions });
    };
    void refresh().catch(() => undefined);
    const off = repository.subscribe(() => void refresh().catch(() => undefined));
    return () => {
      cancelled = true;
      off();
    };
  }, [projectId, activeId, repository]);
  return data;
}

export function ProjectAiPanel(props: ProjectAiPanelProps): React.ReactElement {
  const { projectId, userId } = props;
  const { repository, providerRouter } = useResearchDeps();
  const deps = React.useMemo(() => ({ userId }), [userId]);

  const [activeId, setActiveIdState] = React.useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY + projectId);
    } catch {
      return null;
    }
  });
  const setActiveId = (id: string | null): void => {
    setActiveIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_KEY + projectId, id);
      else localStorage.removeItem(ACTIVE_KEY + projectId);
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  };
  const data = useThreads(projectId, activeId);
  const active = data.threads.find((t) => t.id === activeId) ?? null;
  // A remembered thread that no longer exists falls back to a new one.
  React.useEffect(() => {
    if (activeId && data.threads.length > 0 && !active) setActiveId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active, data.threads.length]);

  const [availability, setAvailability] = React.useState<Availability>('checking');
  React.useEffect(() => {
    let cancelled = false;
    if (!providerRouter) {
      setAvailability('off');
      return;
    }
    setAvailability('checking');
    void providerRouter
      .probe()
      .then((p) => !cancelled && setAvailability(p.aiAvailable ? 'available' : 'off'))
      .catch(() => !cancelled && setAvailability('off'));
    return () => {
      cancelled = true;
    };
  }, [providerRouter]);

  const [text, setText] = React.useState('');
  const [mode, setMode] = React.useState<'ask' | 'missing'>('ask');
  const [ideas, setIdeas] = React.useState('');
  const [roleMenu, setRoleMenu] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [privateNew, setPrivateNew] = React.useState(false);
  const [removed, setRemoved] = React.useState<ReadonlySet<string>>(new Set());
  const context = props.context.filter((c) => !removed.has(contextKey(c)));

  const canSend = availability === 'available' && Boolean(providerRouter) && !busy;

  const send = async (move: AiMove, extra: { role?: AiRole; ownIdeas?: string; prompt?: string } = {}): Promise<void> => {
    if (!providerRouter || !canSend) return;
    const prompt = extra.prompt ?? (move === 'ask' ? text : '');
    if (move === 'ask' && !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setRoleMenu(false);
    try {
      const result = await askPartner(
        repository,
        providerRouter,
        {
          projectId,
          ...(active ? { threadId: active.id } : { visibility: privateNew ? 'private' : 'shared' }),
          move,
          prompt,
          ...(extra.role ? { role: extra.role } : {}),
          ...(extra.ownIdeas !== undefined ? { ownIdeas: extra.ownIdeas } : {}),
          context,
        },
        deps,
      );
      if (!active) setActiveId(result.thread.id);
      if (move === 'ask' && extra.prompt === undefined) setText('');
      if (move === 'missing') {
        setIdeas('');
        setMode('ask');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Couldn’t send that.');
    } finally {
      setBusy(false);
    }
  };

  const retry = (failed: AiMessage): void => {
    const idx = data.messages.findIndex((m) => m.id === failed.id);
    const question = data.messages.slice(0, idx).reverse().find((m) => m.role === 'user');
    if (!question) return;
    void send(question.move ?? 'ask', {
      prompt: question.body,
      ...(question.aiRole ? { role: question.aiRole } : {}),
    });
  };

  const decide = async (message: AiMessage, draft: AiDraftProposal, decision: AiDraftDecision['decision']): Promise<void> => {
    setError(null);
    try {
      const d = await decideDraft(repository, { message, draftId: draft.draftId, decision }, deps);
      if (d.resultRef?.kind === 'claim') props.onOpenArgument(d.resultRef.id);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Couldn’t apply that.');
    }
  };

  const listEnd = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [data.messages.length, busy]);

  return (
    <div className="ai-panel" data-testid="ai-panel">
      <header className="ai-panel-header">
        <select
          className="ai-panel-thread"
          aria-label="Conversation"
          value={active?.id ?? ''}
          onChange={(e) => setActiveId(e.target.value || null)}
          data-testid="ai-thread-select"
        >
          <option value="">New conversation</option>
          {data.threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {active ? (
          <button type="button" className="ai-icon" aria-label="New conversation" title="New conversation" onClick={() => setActiveId(null)} data-testid="ai-new-thread">
            +
          </button>
        ) : null}
        <button type="button" className="ai-icon" aria-label="Close AI panel" onClick={props.onClose} data-testid="ai-close">
          ×
        </button>
      </header>
      {active ? (
        <p className="ai-panel-visibility" data-testid="ai-visibility">
          {active.visibility === 'shared' ? (
            'Shared with this project'
          ) : (
            <>
              Private ·{' '}
              <button
                type="button"
                className="ai-link"
                onClick={() => {
                  if (window.confirm('Share this conversation with the project? Members will see every message so far. This can’t be undone.')) {
                    void shareThread(repository, active.id);
                  }
                }}
              >
                Share with project
              </button>
            </>
          )}
        </p>
      ) : null}

      <div className="ai-panel-body" aria-live="polite">
        {data.messages.length === 0 && !busy ? (
          <div className="ai-intro" data-testid="ai-intro">
            <p>Think out loud here. I answer in small steps and leave the writing to you.</p>
            <label className="ai-private">
              <input type="checkbox" checked={privateNew} onChange={(e) => setPrivateNew(e.target.checked)} data-testid="ai-private" />
              Keep this conversation to myself
            </label>
          </div>
        ) : null}
        <ol className="ai-messages">
          {data.messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              decisions={data.decisions}
              onDecide={decide}
              onRetry={() => retry(m)}
              onOpenArgument={props.onOpenArgument}
              canRetry={canSend}
            />
          ))}
          {busy ? (
            <li className="ai-message ai-message--assistant ai-message--pending" role="status">
              Thinking…
            </li>
          ) : null}
        </ol>
        <div ref={listEnd} />
      </div>

      <footer className="ai-composer">
        {context.length > 0 ? (
          <ul className="ai-chips" aria-label="What the AI will see">
            {context.map((c) => (
              <li key={contextKey(c)} className="ai-chip" data-testid="ai-context-chip">
                <span title={c.excerpt ?? c.label}>{c.label}</span>
                <button
                  type="button"
                  aria-label={`Don’t share ${c.label}`}
                  onClick={() => setRemoved((prev) => new Set(prev).add(contextKey(c)))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {availability === 'off' ? (
          <p className="ai-off" role="note" data-testid="ai-off">
            AI is off. Start Ollama with a local model, or sign in to use cloud AI. Your conversations stay readable.
          </p>
        ) : null}
        {error ? (
          <p className="ai-error" role="alert">
            {error}
          </p>
        ) : null}

        {mode === 'missing' ? (
          <div className="ai-think-first" data-testid="ai-think-first">
            <label htmlFor="ai-ideas">First, your own ideas — one per line.</label>
            <textarea
              id="ai-ideas"
              rows={3}
              value={ideas}
              onChange={(e) => setIdeas(e.target.value)}
              placeholder={'e.g. naps\ntime of day'}
              autoFocus
              data-testid="ai-ideas"
            />
            <div className="ai-row">
              <Button variant="primary" size="sm" disabled={!canSend || !ideas.trim()} onClick={() => void send('missing', { ownIdeas: ideas })} data-testid="ai-missing-send">
                What am I missing?
              </Button>
              <button type="button" className="ai-link" disabled={!canSend} onClick={() => void send('missing', { ownIdeas: '' })} data-testid="ai-missing-skip">
                Just show me
              </button>
              <button type="button" className="ai-link" onClick={() => setMode('ask')}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              className="ai-input"
              rows={2}
              value={text}
              placeholder="Ask about your project…"
              aria-label="Message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send('ask');
                }
              }}
              data-testid="ai-input"
            />
            <div className="ai-row">
              <Button variant="primary" size="sm" disabled={!canSend || !text.trim()} onClick={() => void send('ask')} data-testid="ai-send">
                Send
              </Button>
              <div className="ai-role-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canSend}
                  aria-haspopup="menu"
                  aria-expanded={roleMenu}
                  onClick={() => setRoleMenu((v) => !v)}
                  data-testid="ai-challenge"
                >
                  Challenge
                </Button>
                {roleMenu ? (
                  <ul className="ai-role-menu" role="menu" data-testid="ai-role-menu">
                    {AI_ROLES.map((r) => (
                      <li key={r.id} role="none">
                        <button type="button" role="menuitem" onClick={() => void send('challenge', { role: r.id })} data-testid={`ai-role-${r.id}`}>
                          {r.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button type="button" className="ai-link" disabled={!canSend} onClick={() => setMode('missing')} data-testid="ai-missing">
                What am I missing?
              </button>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

function MessageItem(props: {
  readonly message: AiMessage;
  readonly decisions: readonly AiDraftDecision[];
  readonly onDecide: (m: AiMessage, d: AiDraftProposal, decision: AiDraftDecision['decision']) => void;
  readonly onRetry: () => void;
  readonly onOpenArgument: (claimId?: string) => void;
  readonly canRetry: boolean;
}): React.ReactElement {
  const m = props.message;
  if (m.role === 'user') {
    return (
      <li className="ai-message ai-message--user" data-testid="ai-message" data-role="user">
        <p className="ai-message-body">{m.body}</p>
        {m.skippedOwnThinking ? <p className="ai-meta">Asked before writing own ideas</p> : null}
      </li>
    );
  }
  return (
    <li className={`ai-message ai-message--assistant${m.status === 'failed' ? ' is-failed' : ''}`} data-testid="ai-message" data-role="assistant">
      {m.aiRole ? <p className="ai-meta">{roleLabel(m.aiRole)}</p> : null}
      <p className="ai-message-body">{m.status === 'failed' ? `Couldn’t answer: ${m.body}` : m.body}</p>
      {m.status === 'failed' ? (
        <button type="button" className="ai-link" disabled={!props.canRetry} onClick={props.onRetry} data-testid="ai-retry">
          Try again
        </button>
      ) : null}
      {m.drafts.map((d) => {
        const decision = props.decisions.find((x) => x.draftId === d.draftId);
        return (
          <div key={d.draftId} className="ai-draft" data-testid="ai-draft">
            <p className="ai-draft-label">Suggested point</p>
            <p className="ai-draft-text">{d.summary}</p>
            {decision ? (
              <p className="ai-meta" data-testid="ai-draft-decision">
                {decision.decision === 'applied' ? (
                  <>
                    Added to your argument ·{' '}
                    <button type="button" className="ai-link" onClick={() => props.onOpenArgument(decision.resultRef?.id)}>
                      Open
                    </button>
                  </>
                ) : (
                  'Dismissed'
                )}
              </p>
            ) : (
              <div className="ai-row">
                <Button variant="secondary" size="sm" onClick={() => props.onDecide(m, d, 'applied')} data-testid="ai-draft-apply">
                  Add to argument
                </Button>
                <button type="button" className="ai-link" onClick={() => props.onDecide(m, d, 'rejected')} data-testid="ai-draft-dismiss">
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
      {m.provider ? (
        <p className="ai-meta ai-provenance">
          {m.provider.id === 'ollama' ? 'Local AI' : 'Cloud AI'}
          {m.provider.model ? ` · ${m.provider.model}` : ''}
          {m.context.length > 0 ? ` · saw ${m.context.map((c) => c.label).join(', ')}` : ''}
        </p>
      ) : null}
    </li>
  );
}
