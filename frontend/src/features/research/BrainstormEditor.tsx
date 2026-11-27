/**
 * StudyKit v0.5 P5 — brainstorm editor.
 *
 * One card, one idea. Type and press Enter; put cards in named groups;
 * “Turn into argument” makes each group a point. The AI offers
 * directions you haven't covered only after you've written three ideas
 * of your own; you can ask earlier, and that is recorded.
 *
 * P5b, with project members: a group brainstorm is brainwriting. Each
 * member sees only their own ideas (and how many others have written)
 * until the person who started it reveals them all at once. Then they
 * run the grouping and the conversion; members group their own ideas.
 */

import React from 'react';
import './thinking.css';
import { useResearchDeps } from './researchContext';
import {
  OWN_IDEAS_BEFORE_AI,
  addGroup,
  addIdea,
  convertToArgument,
  editIdea,
  moveGroup,
  moveIdea,
  removeGroup,
  renameGroup,
  revealIdeas,
  setBrainstormMode,
  suggestDirections,
  unpickedIdeas,
  updatePrompt,
  visibleIdeas,
} from '../../application/research/brainstorm';
import { isHiddenUntilReveal, type Brainstorm, type Idea, type IdeaGroup } from '../../domain/brainstorm';
import { memberName, useThinkingCollab, type ThinkingCollab } from './thinkingCollab';
import { Button } from '../../shared/ui/Button';

export interface BrainstormEditorProps {
  readonly brainstormId: string;
  readonly userId: string;
  readonly onOpenArgument: () => void;
}

function useBrainstorm(brainstormId: string): { loaded: boolean; brainstorm: Brainstorm | null; ideas: readonly Idea[] } {
  const { repository } = useResearchDeps();
  const [state, setState] = React.useState<{ loaded: boolean; brainstorm: Brainstorm | null; ideas: readonly Idea[] }>({
    loaded: false,
    brainstorm: null,
    ideas: [],
  });
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [brainstorm, ideas] = await Promise.all([repository.getBrainstorm(brainstormId), repository.listIdeas({ brainstormId })]);
      if (!cancelled) setState({ loaded: true, brainstorm, ideas });
    };
    void refresh().catch(() => !cancelled && setState((s) => ({ ...s, loaded: true })));
    const off = repository.subscribe(() => void refresh().catch(() => undefined));
    return () => {
      cancelled = true;
      off();
    };
  }, [brainstormId, repository]);
  return state;
}

export function BrainstormEditor(props: BrainstormEditorProps): React.ReactElement {
  const { brainstormId } = props;
  const { repository, providerRouter } = useResearchDeps();
  const deps = React.useMemo(() => ({ userId: props.userId }), [props.userId]);
  const { loaded, brainstorm, ideas: allIdeas } = useBrainstorm(brainstormId);
  const collab = useThinkingCollab();
  const [draft, setDraft] = React.useState('');
  const [groupName, setGroupName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [suggestions, setSuggestions] = React.useState<readonly string[]>([]);
  const [thinking, setThinking] = React.useState(false);
  const [converted, setConverted] = React.useState<number | null>(null);

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Something went wrong.');
      return false;
    }
  };

  if (!loaded) return <p className="thinking-muted">Loading…</p>;
  if (!brainstorm) return <p className="thinking-muted">This brainstorm no longer exists.</p>;

  const isGroup = brainstorm.mode === 'group';
  const hidden = isHiddenUntilReveal(brainstorm);
  const me = props.userId;
  const facilitator = brainstorm.createdBy === me;
  // A group brainstorm is run by the person who started it; a solo one is all yours.
  const canWrite = !isGroup || collab.access !== 'read';
  const canRun = !isGroup || (facilitator && collab.access === 'manage');
  const canStructure = canRun && !hidden;
  const ideas = visibleIdeas(brainstorm, allIdeas, me);
  const perms: IdeaPerms = {
    me,
    isGroup,
    canEdit: (i) => canWrite && (!isGroup || i.authorId === me),
    canGroup: (i) => !hidden && canWrite && (!isGroup || collab.access === 'manage' || i.authorId === me),
    collab,
  };
  const groups = [...brainstorm.groups].sort((a, b) => a.order - b.order);
  const loose = ideas.filter((i) => i.groupId === null);
  const ownCount = allIdeas.filter((i) => i.authorType === 'user' && i.authorId === me).length;
  const showModeChoice =
    collab.hasMembers && facilitator && collab.access === 'manage' && allIdeas.length === 0 && !brainstorm.revealedAt;
  const readyForAi = ownCount >= OWN_IDEAS_BEFORE_AI;
  const convertible = groups.filter((g) => !g.claimId && ideas.some((i) => i.groupId === g.id));

  const ask = async (early: boolean): Promise<void> => {
    if (!providerRouter) return;
    setThinking(true);
    await run(async () => setSuggestions(await suggestDirections(repository, providerRouter, { brainstormId, early, userId: me })));
    setThinking(false);
  };

  return (
    <div className="thinking brainstorm" data-testid="brainstorm-editor">
      <header className="thinking-header">
        <p className="thinking-kicker">
          {isGroup ? (hidden ? 'Group brainstorm · writing on your own' : 'Group brainstorm · revealed') : 'Brainstorm'}
        </p>
        {canRun ? (
          <PromptField value={brainstorm.prompt} onSave={(prompt) => run(() => updatePrompt(repository, brainstormId, prompt, deps))} />
        ) : (
          <h1 className="thinking-title" data-testid="brainstorm-prompt-readonly">
            {brainstorm.prompt || 'Brainstorm'}
          </h1>
        )}
      </header>

      {showModeChoice ? (
        <fieldset className="brainstorm-mode" data-testid="brainstorm-mode">
          <legend>Who's writing?</legend>
          <label>
            <input
              type="radio"
              name="brainstorm-mode"
              checked={!isGroup}
              onChange={() => void run(() => setBrainstormMode(repository, brainstormId, 'solo', deps))}
            />
            Just me
          </label>
          <label>
            <input
              type="radio"
              name="brainstorm-mode"
              checked={isGroup}
              onChange={() => void run(() => setBrainstormMode(repository, brainstormId, 'group', deps))}
              data-testid="brainstorm-mode-group"
            />
            The group: everyone writes on their own, then you reveal all the ideas at once
          </label>
        </fieldset>
      ) : null}

      {isGroup && hidden ? (
        <RevealBar
          brainstorm={brainstorm}
          ideas={allIdeas}
          me={me}
          collab={collab}
          canReveal={canRun}
          onReveal={() => void run(() => revealIdeas(repository, brainstormId, deps))}
        />
      ) : null}

      {canWrite ? (
        <form
          className="brainstorm-add"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            // Clear at once so fast typing never runs into the previous idea.
            setDraft('');
            void run(() => addIdea(repository, { brainstormId, text }, deps)).then((ok) => !ok && setDraft(text));
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={ideas.length === 0 ? 'One idea per card. Type it and press Enter.' : 'Another idea…'}
            aria-label="New idea"
            autoFocus
            data-testid="brainstorm-idea-input"
          />
        </form>
      ) : null}

      {error ? (
        <p className="thinking-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="brainstorm-loose" aria-label="Ideas not in a group">
        {loose.length > 0 ? (
          <ul className="brainstorm-cards">
            {loose.map((i) => (
              <IdeaCard key={i.id} idea={i} groups={groups} brainstormId={brainstormId} run={run} perms={perms} deps={deps} />
            ))}
          </ul>
        ) : ideas.length > 0 && groups.length > 0 ? (
          <p className="thinking-muted">Every idea is in a group.</p>
        ) : null}
      </section>

      {isGroup && !hidden && groups.length > 0 ? <ModeratorNote ideas={ideas} me={me} /> : null}

      <section className="brainstorm-ai" aria-label="AI directions" data-testid="brainstorm-ai">
        {providerRouter && canWrite ? (
          readyForAi ? (
            <Button variant="secondary" size="sm" disabled={thinking} onClick={() => void ask(false)} data-testid="brainstorm-ai-ask">
              {thinking ? 'Thinking…' : 'What am I missing?'}
            </Button>
          ) : (
            <p className="thinking-muted">
              Write {OWN_IDEAS_BEFORE_AI - ownCount} more {OWN_IDEAS_BEFORE_AI - ownCount === 1 ? 'idea' : 'ideas'} of your own, then ask
              what you're missing.{' '}
              <button type="button" className="thinking-link" disabled={thinking} onClick={() => void ask(true)} data-testid="brainstorm-ai-early">
                Show me now
              </button>
            </p>
          )
        ) : null}
        {suggestions.length > 0 ? (
          <ul className="brainstorm-cards">
            {suggestions.map((text) => (
              <li key={text} className="brainstorm-card brainstorm-card--suggestion" data-testid="brainstorm-suggestion">
                <span className="brainstorm-card-text">{text}</span>
                <span className="brainstorm-card-actions">
                  <button
                    type="button"
                    className="thinking-link"
                    onClick={() =>
                      void run(() => addIdea(repository, { brainstormId, text, fromAi: true }, deps)).then(
                        (ok) => ok && setSuggestions((s) => s.filter((x) => x !== text)),
                      )
                    }
                  >
                    Add
                  </button>
                  <button type="button" className="thinking-link" onClick={() => setSuggestions((s) => s.filter((x) => x !== text))}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {ideas.length > 0 && !hidden && (canStructure || groups.length > 0) ? (
        <section className="brainstorm-groups" aria-label="Groups">
          {canStructure ? (
            <form
              className="brainstorm-new-group"
              onSubmit={(e) => {
                e.preventDefault();
                const title = groupName.trim();
                if (!title) return;
                setGroupName('');
                void run(() => addGroup(repository, { brainstormId, title }, deps)).then((ok) => !ok && setGroupName(title));
              }}
            >
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={groups.length === 0 ? 'Name a group, e.g. the point several ideas make' : 'Another group…'}
                aria-label="New group"
                data-testid="brainstorm-group-input"
              />
              <Button type="submit" variant="secondary" size="sm" disabled={!groupName.trim()}>
                Add group
              </Button>
            </form>
          ) : null}
          <ol className="brainstorm-group-list">
            {groups.map((g, index) => (
              <GroupColumn
                key={g.id}
                group={g}
                index={index}
                total={groups.length}
                ideas={ideas.filter((i) => i.groupId === g.id)}
                groups={groups}
                brainstormId={brainstormId}
                run={run}
                perms={perms}
                deps={deps}
                canStructure={canStructure}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {groups.length > 0 && canStructure ? (
        <footer className="brainstorm-footer">
          {converted !== null ? (
            <p data-testid="brainstorm-converted">
              Added {converted} {converted === 1 ? 'point' : 'points'} to your argument.{' '}
              <button type="button" className="thinking-link" onClick={props.onOpenArgument}>
                Open the argument
              </button>
            </p>
          ) : (
            <p className="thinking-muted">Each group becomes a point in your argument, in this order.</p>
          )}
          <Button
            variant="primary"
            disabled={convertible.length === 0}
            onClick={() =>
              void run(async () => {
                const claims = await convertToArgument(repository, brainstormId, deps);
                setConverted(claims.length);
              })
            }
            data-testid="brainstorm-convert"
          >
            Turn into argument
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function PromptField(props: { readonly value: string; readonly onSave: (v: string) => Promise<boolean> }): React.ReactElement {
  const [v, setV] = React.useState(props.value);
  React.useEffect(() => setV(props.value), [props.value]);
  return (
    <input
      className="thinking-title-input"
      value={v}
      placeholder="What are you trying to figure out?"
      aria-label="Brainstorm question"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== props.value && void props.onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      data-testid="brainstorm-prompt"
    />
  );
}

interface IdeaPerms {
  readonly me: string;
  readonly isGroup: boolean;
  readonly canEdit: (idea: Idea) => boolean;
  readonly canGroup: (idea: Idea) => boolean;
  readonly collab: ThinkingCollab;
}

/** Before the reveal: how many ideas each member has written, never what. */
function RevealBar(props: {
  readonly brainstorm: Brainstorm;
  readonly ideas: readonly Idea[];
  readonly me: string;
  readonly collab: ThinkingCollab;
  readonly canReveal: boolean;
  readonly onReveal: () => void;
}): React.ReactElement {
  const counts = new Map<string, number>();
  for (const i of props.ideas) counts.set(i.authorId, (counts.get(i.authorId) ?? 0) + 1);
  const others = [...counts.entries()].filter(([id]) => id !== props.me);
  const mine = counts.get(props.me) ?? 0;
  const ideasWord = (n: number): string => `${n} ${n === 1 ? 'idea' : 'ideas'}`;
  return (
    <section className="brainstorm-reveal" aria-label="Writing on your own" data-testid="brainstorm-reveal">
      <p>
        {props.canReveal
          ? 'Everyone writes on their own first. Ideas stay hidden until you reveal them, so nobody anchors on the first ones.'
          : `Everyone writes on their own first. ${memberName(props.collab, props.brainstorm.createdBy)} will reveal all the ideas at once.`}
      </p>
      <p className="thinking-muted" data-testid="brainstorm-reveal-counts">
        You: {ideasWord(mine)}
        {others.map(([id, n]) => ` · ${memberName(props.collab, id)}: ${ideasWord(n)}`)}
        {others.length === 0 ? ' · Nobody else has written yet' : ''}
      </p>
      {props.canReveal ? (
        <Button variant="primary" size="sm" disabled={props.ideas.length === 0} onClick={props.onReveal} data-testid="brainstorm-reveal-button">
          Reveal everyone's ideas
        </Button>
      ) : null}
    </section>
  );
}

/** The moderator's note after a reveal: ideas nobody has picked up yet. */
function ModeratorNote(props: { readonly ideas: readonly Idea[]; readonly me: string }): React.ReactElement | null {
  const { total, fromOthers } = unpickedIdeas(props.ideas, props.me);
  if (total === 0) return null;
  return (
    <p className="brainstorm-moderator" data-testid="brainstorm-moderator">
      Not picked up yet: {total} {total === 1 ? 'idea isn’t' : 'ideas aren’t'} in any group
      {fromOthers > 0 ? ` (${fromOthers} from other members)` : ''}. Look at them before you turn this into an argument.
    </p>
  );
}

function IdeaCard(props: {
  readonly idea: Idea;
  readonly groups: readonly IdeaGroup[];
  readonly brainstormId: string;
  readonly run: (a: () => Promise<unknown>) => Promise<boolean>;
  readonly perms: IdeaPerms;
  readonly deps: { readonly userId: string };
}): React.ReactElement {
  const { repository } = useResearchDeps();
  const { idea, perms } = props;
  const editable = perms.canEdit(idea);
  const [text, setText] = React.useState(idea.text);
  React.useEffect(() => setText(idea.text), [idea.text]);
  return (
    <li className={`brainstorm-card${idea.authorType === 'ai' ? ' is-ai' : ''}`} data-testid="brainstorm-idea">
      <textarea
        className="brainstorm-card-text"
        value={text}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 26)))}
        aria-label="Idea"
        readOnly={!editable}
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          editable && text !== idea.text && void props.run(() => editIdea(repository, idea.id, text, props.brainstormId, props.deps))
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {idea.authorType === 'ai' ? <span className="thinking-tag">AI</span> : null}
      {perms.isGroup && idea.authorId !== perms.me ? (
        <span className="thinking-tag" data-testid="brainstorm-idea-author">
          {memberName(perms.collab, idea.authorId)}
        </span>
      ) : null}
      {props.groups.length > 0 ? (
        <select
          className="brainstorm-card-group"
          aria-label={`Group for “${idea.text}”`}
          disabled={!perms.canGroup(idea)}
          value={idea.groupId ?? ''}
          onChange={(e) =>
            void props.run(() =>
              moveIdea(repository, { brainstormId: props.brainstormId, ideaId: idea.id, groupId: e.target.value || null }),
            )
          }
          data-testid="brainstorm-idea-group"
        >
          <option value="">No group</option>
          {props.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      ) : null}
    </li>
  );
}

function GroupColumn(props: {
  readonly group: IdeaGroup;
  readonly index: number;
  readonly total: number;
  readonly ideas: readonly Idea[];
  readonly groups: readonly IdeaGroup[];
  readonly brainstormId: string;
  readonly run: (a: () => Promise<unknown>) => Promise<boolean>;
  readonly perms: IdeaPerms;
  readonly deps: { readonly userId: string };
  readonly canStructure: boolean;
}): React.ReactElement {
  const { repository } = useResearchDeps();
  const { group, brainstormId, run, deps } = props;
  const [title, setTitle] = React.useState(group.title);
  React.useEffect(() => setTitle(group.title), [group.title]);
  return (
    <li className="brainstorm-group" data-testid="brainstorm-group">
      <div className="brainstorm-group-header">
        <input
          className="brainstorm-group-title"
          value={title}
          aria-label="Group name"
          readOnly={!props.canStructure}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            props.canStructure &&
            title.trim() &&
            title !== group.title &&
            void run(() => renameGroup(repository, brainstormId, group.id, title, deps))
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {group.claimId ? <span className="thinking-tag">In argument</span> : null}
        {props.canStructure ? (
          <>
            <button type="button" className="thinking-icon" aria-label={`Move “${group.title}” up`} disabled={props.index === 0} onClick={() => void run(() => moveGroup(repository, brainstormId, group.id, -1, deps))}>
              ↑
            </button>
            <button type="button" className="thinking-icon" aria-label={`Move “${group.title}” down`} disabled={props.index === props.total - 1} onClick={() => void run(() => moveGroup(repository, brainstormId, group.id, 1, deps))}>
              ↓
            </button>
            <button type="button" className="thinking-icon" aria-label={`Remove group “${group.title}”`} onClick={() => void run(() => removeGroup(repository, brainstormId, group.id, deps))}>
              ×
            </button>
          </>
        ) : null}
      </div>
      {props.ideas.length > 0 ? (
        <ul className="brainstorm-cards">
          {props.ideas.map((i) => (
            <IdeaCard key={i.id} idea={i} groups={props.groups} brainstormId={brainstormId} run={run} perms={props.perms} deps={deps} />
          ))}
        </ul>
      ) : (
        <p className="thinking-muted">Move ideas here with their “Group” menu.</p>
      )}
    </li>
  );
}
