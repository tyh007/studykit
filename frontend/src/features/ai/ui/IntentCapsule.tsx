/**
 * StudyKit v0.4 — Universal Intent Capsule
 *
 * A single floating panel that is mounted ONCE in the
 * AppShell. It reads from the assistant session store
 * (`useAssistantSession`) and renders the right surface
 * for the current `status`.
 *
 * Rules of this file:
 *
 *   1. **Hooks are unconditional.** The flag-on/off
 *      gate happens at the *outer* provider; here we
 *      render null when the flag is off, but every
 *      hook is called on every render. A `false →
 *      true → false` flag rerender therefore runs the
 *      same hook set every time.
 *
 *   2. **Scope comes from the packet, not the session.**
 *      `session.scopePolicy` is the *user's intent*;
 *      the resolver may demote it (e.g. user picked
 *      `selection` but the selection is empty). The
 *      `ScopeEditor` shows the *resolved* scope
 *      (`packet.scopePolicy`) as pressed; clicking a
 *      chip writes to `session.scopePolicy`. The
 *      packet re-resolves on every render.
 *
 *   3. **Writes go through the Draft Layer.** `navigate`
 *      builds a typed `AppLocation`, encodes it with
 *      `encodeLocationToHash`, and the Accept handler
 *      decodes it with `decodeLocationFromHash` and
 *      pushes. Only a successful decode + push is
 *      followed by the `accepted` transition + close.
 *      Unknown / invalid prompts show a recoverable
 *      error; there is no fallback.
 *
 *   4. **`create-free-note-draft` requires a course
 *      container.** The gate refuses without one; the
 *      chip is disabled and explains why. The writer
 *      is the *host's* responsibility — Accept calls
 *      `acceptNoteDraft`, which delegates to the
 *      `noteWriter` injected via `registerSafeActions`.
 *      A failure (no writer, or writer throws) is
 *      caught and surfaced in the session; the draft,
 *      prompt, selection, focus and scope are
 *      preserved so the user can retry.
 *
 *   5. **Search uses a real corpus.** The Capsule only
 *      reads from `dataApi` when the user picks the
 *      `search-local` chip; other actions trigger
 *      zero data reads. The corpus walks
 *      `modules → lectures` and `literatureProjects`;
 *      a complete read failure surfaces a recoverable
 *      error in the session.
 *
 *   6. **Exceptions become session errors.** Both
 *      `runAction` and `onAccept` wrap their bodies in
 *      `try/catch`; any uncaught error is set via
 *      `assistantSession.setError(...)`. The user sees
 *      the error, the draft / prompt / selection are
 *      preserved, and the capsule stays open.
 *
 * The component uses the v0.4 shared UI primitives
 * (`Surface`, `Pill`, `Button`, `Input`) and semantic
 * tokens, so Light / Dark / System are honoured for
 * free.
 */

import React from 'react';
import { Button } from '../../../shared/ui/Button';
import { Input } from '../../../shared/ui/Input';
import { Pill } from '../../../shared/ui/Pill';
import { Surface } from '../../../shared/ui/Surface';
import {
  ACTION_CREATE_FREE_NOTE,
  ACTION_EXPLAIN_SELECTED,
  ACTION_NAVIGATE,
  ACTION_SEARCH_LOCAL,
  ACTION_CANVAS_SUGGEST_RELATIONS,
  ACTION_CANVAS_SUGGEST_CLUSTER,
  ACTION_CANVAS_SUGGEST_LAYOUT,
  ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
  SAFE_ACTION_IDS,
  acceptDesignTaskSuggestion,
  acceptNoteDraft,
  actionRegistry,
  assistantSession,
  checkPermission,
  draftLayer,
  resolveContext,
  useAssistantSession,
  type ActionPreview,
  type ContextPacket,
  type DraftRecord,
  type ProviderAvailability,
  type ScopePolicy,
} from '../kernel';
import { closeCapsule } from './openCapsule';
import { isFeatureEnabled } from '../../../app/feature-flags';
import { useWorkspaceFlavour } from '../../../application/workspaceFlavour';
import { getDataApi } from '../../../application/dataGateway';
import {
  encodeLocationToHash,
  decodeLocationFromHash,
  locationStore,
} from '../../../app/v04/locationStore';
import type { Capability } from '../../../application/dataApi';
import type { AppLocation } from '../../../domain/workspace';
import './intent-capsule.css';

// ---------------------------------------------------------------------------
// Static metadata
// ---------------------------------------------------------------------------

const INTENT_CHIPS: ReadonlyArray<{
  readonly id: typeof SAFE_ACTION_IDS[number];
  readonly label: string;
  readonly intent: 'Explain' | 'Find' | 'Create' | 'Navigate' | 'Suggest';
}> = [
  { id: ACTION_EXPLAIN_SELECTED, label: 'Explain selection', intent: 'Explain' },
  { id: ACTION_SEARCH_LOCAL, label: 'Find in this workspace', intent: 'Find' },
  { id: ACTION_CREATE_FREE_NOTE, label: 'Save as note', intent: 'Create' },
  { id: ACTION_NAVIGATE, label: 'Open…', intent: 'Navigate' },
  // WP-06 Round 6 P0-4: the cognitive canvas's 3
  // AI actions. They show up as chips when the
  // cognitive canvas has populated the
  // `actionArgsById` map (i.e. the user opened the
  // capsule from a cognitive-canvas surface with
  // pre-built args). The `IntentChips` renderer
  // hides chips whose id is not in the map so
  // these don't show up in the generic capsule.
  { id: ACTION_CANVAS_SUGGEST_RELATIONS, label: 'Suggest canvas relations', intent: 'Suggest' },
  { id: ACTION_CANVAS_SUGGEST_CLUSTER, label: 'Suggest canvas clusters', intent: 'Suggest' },
  { id: ACTION_CANVAS_SUGGEST_LAYOUT, label: 'Suggest canvas layout', intent: 'Suggest' },
  // WP-07: research design + PM. The chip is hidden
  // unless the calling surface populated the
  // `actionArgsById[research-suggest-design-tasks]`
  // map (i.e. the user picked a Question / Decision /
  // Risk and we have the typed args ready).
  { id: ACTION_RESEARCH_SUGGEST_DESIGN_TASKS, label: 'Suggest tasks', intent: 'Suggest' },
];

const SCOPE_LABELS: Record<ScopePolicy, string> = {
  'selection': 'Selection',
  'current-view': 'Current view',
  'container': 'Whole container',
  'explicit-set': 'Pinned set',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface IntentCapsuleProps {
  /** The current route — used by the resolver to build the context packet. */
  readonly route: string;
  /** The current location (mode + surface + container). */
  readonly location: AppLocation;
}

export function IntentCapsule(props: IntentCapsuleProps): React.ReactElement | null {
  // ============================================================
  // Hooks — every one of these runs on every render, regardless
  // of the flag or session state. The flag is only consulted
  // at the very end of the render and inside specific effects.
  // ============================================================
  const session = useAssistantSession();
  const flavour = useWorkspaceFlavour();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<typeof SAFE_ACTION_IDS[number] | null>(null);
  const flagOn = isFeatureEnabled('v04Assistant');

  // Focus the input when the capsule opens AND the flag is
  // on. The effect no-ops when either condition is false —
  // no focus() call on a hidden panel.
  React.useEffect(() => {
    if (flagOn && session.isOpen && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
    }
  }, [flagOn, session.isOpen]);

  // ============================================================
  // Early render: flag off → return null. This is a *final*
  // render decision, not a hooks guard. All hooks above
  // have already run.
  // ============================================================
  if (!flagOn) {
    return null;
  }
  if (!session.isOpen) {
    return null;
  }

  // ============================================================
  // Build the packet. `userScope` is the user's *intent*;
  // the resolver may demote it. The displayed/pressed
  // chip is the *resolved* `packet.scopePolicy`.
  // ============================================================
  const packet: ContextPacket = resolveContext({
    route: props.route,
    location: props.location,
    workspaceFlavour: flavour,
    invocationSurface: session.invocationSurface ?? 'intent-capsule',
    // The host (openCapsule, NoteEditor's adapter, the
    // window listener) may pass a container via
    // `setContext`; the resolver uses it as an override
    // when the location's own container is missing.
    containerOverride: session.lastContext?.container ?? undefined,
    selectedText: session.selectedText,
    selectedObjects: session.selectedObjectIds.map((id) => ({
      id,
      kind: 'text' as const,
      preview: session.selectedText ? session.selectedText.slice(0, 60) : `id:${id}`,
    })),
    pinnedContext: session.pinnedContextIds.map((id) => ({
      id,
      kind: 'other' as const,
      label: id,
    })),
    userScope: session.scopePolicy,
  });

  // ============================================================
  // Event handlers
  // ============================================================
  const handleKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeCapsule();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void runCurrent();
    }
  };

  const runAction = async (actionId: typeof SAFE_ACTION_IDS[number]): Promise<void> => {
    const action = actionRegistry.get(actionId);
    if (!action) {
      assistantSession.setError(`Unknown action: ${actionId}`);
      return;
    }
    const provider = probeProviderSnapshot(flavour);
    const permission = checkPermission({
      action,
      packet,
      workspaceFlavour: flavour,
      provider,
    });
    if (!permission.ok) {
      assistantSession.setError(permission.message);
      return;
    }
    setPending(actionId);
    try {
      // Build per-action args. Only `search-local` reads
      // from `dataApi`; everything else uses a pure
      // session-derived args object.
      const args = await buildArgsForAction(actionId, session, packet);
      if (args === null) {
        // The args builder returned an error; it has
        // already surfaced it on the session.
        return;
      }
      const out = await actionRegistry.run(actionId, {
        packet,
        prompt: session.prompt,
        args,
      });
      assistantSession.setDraft(out.draft);
    } catch (err) {
      assistantSession.setError(
        err instanceof Error ? err.message : 'Action failed',
      );
    } finally {
      setPending(null);
    }
  };

  const runCurrent = async (): Promise<void> => {
    const available = actionRegistry.available(packet);
    for (const id of INTENT_CHIPS) {
      if (!available.find((a) => a.id === id.id)) continue;
      if (id.id === ACTION_NAVIGATE) continue; // navigate needs args the input doesn't have
      await runAction(id.id);
      return;
    }
  };

  const onAccept = async (): Promise<void> => {
    const d = session.draft;
    if (!d) return;
    try {
      if (d.target.kind === 'note') {
        // The writer is the host's responsibility.
        // On success → close. On failure → preserve
        // draft / prompt / selection / focus / scope;
        // show the error; user can retry.
        const res = await acceptNoteDraft(d);
        assistantSession.setError(`Note accepted as ${res.canonicalId}.`);
        closeCapsule();
        return;
      }
      if (d.body.kind === 'navigation') {
        // Only `accepted/close` after a successful
        // decode + push. Invalid route → error, no
        // close, no transition.
        const route = d.body.target.route;
        const decoded = decodeLocationFromHash(route);
        if (!decoded) {
          assistantSession.setError(
            `Cannot navigate: route "${route}" is not a recognised location.`,
          );
          return;
        }
        locationStore.push(decoded);
        draftLayer.transition(d.id, 'accepted');
        closeCapsule();
        return;
      }
      // `explanation` and other no-write drafts:
      // just mark `accepted` + close.
      draftLayer.transition(d.id, 'accepted');
      closeCapsule();
    } catch (err) {
      assistantSession.setError(
        err instanceof Error ? err.message : 'Accept failed',
      );
    }
  };

  const onReject = (): void => {
    if (session.draft) {
      draftLayer.transition(session.draft.id, 'rejected');
    }
    assistantSession.setDraft(null);
    assistantSession.setError(null);
  };

  const onRetry = (): void => {
    if (session.draft) {
      const id = session.draft.id;
      // A `failed` draft is already terminal; the
      // `draftLayer.transition(...)` call would throw.
      // We only attempt the transition for *live*
      // drafts (e.g. `generating` → `cancelled`); for
      // terminal drafts (failed / rejected / accepted)
      // we just clear the session reference and
      // re-run. The re-run creates a fresh draft
      // (the action's `execute` calls
      // `draftLayer.create(...)`).
      const current = session.draft;
      // Only attempt the cancel transition for *live*
      // drafts (`suggested` / `generating` / `draft`).
      // Terminal drafts (accepted / rejected /
      // failed / cancelled) are frozen; calling
      // `transition(...)` would throw. We use a
      // `try/catch` belt-and-braces in case the
      // status moves between the snapshot read and
      // the transition call.
      if (
        current.status === 'suggested' ||
        current.status === 'generating' ||
        current.status === 'draft'
      ) {
        try {
          draftLayer.transition(id, 'cancelled');
        } catch {
          // Ignore — the draft is already terminal.
        }
      }
      assistantSession.setDraft(null);
      void runAction(
        current.provenance.actionId as typeof SAFE_ACTION_IDS[number],
      );
    }
  };

  const onCancel = (): void => {
    if (session.draft) {
      draftLayer.transition(session.draft.id, 'cancelled');
    }
    assistantSession.setDraft(null);
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div
      className="v04-ai-capsule-overlay"
      role="dialog"
      aria-label="Intent Capsule"
      aria-modal="true"
      onKeyDown={handleKey}
      data-testid="v04-intent-capsule"
      data-status={session.status}
    >
      <Surface level="floating" glass className="v04-ai-capsule">
        <header className="v04-ai-capsule-header">
          <h2 className="v04-ai-capsule-title">Intent Capsule</h2>
          <Pill tone="neutral" className="v04-ai-capsule-flavour">
            {flavour === 'local' ? 'Local' : 'Sync'} · {packet.visibility}
          </Pill>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeCapsule}
            aria-label="Close Intent Capsule"
            data-testid="v04-intent-capsule-close"
          >
            Close
          </Button>
        </header>

        <ContextChips packet={packet} />

        <ScopeEditor
          current={packet.scopePolicy}
          packet={packet}
          onChange={(s) => assistantSession.setScope(s)}
        />

        {session.draft ? (
          <DraftResult
            draft={session.draft}
            onAccept={() => void onAccept()}
            onReject={onReject}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        ) : (
          <>
            <IntentField
              ref={inputRef}
              value={session.prompt}
              onChange={(v) => assistantSession.setPrompt(v)}
              placeholder={
                session.selectedText
                  ? 'What should the AI do with the selection?'
                  : 'What do you want to do?'
              }
            />

            <IntentChips
              pending={pending}
              onPick={runAction}
              packet={packet}
              flavour={flavour}
            />

            <ActionPreviewArea
              packet={packet}
              flavour={flavour}
              prompt={session.prompt}
            />
          </>
        )}

        {session.error ? (
          <p
            className="v04-ai-capsule-error"
            role="alert"
            data-testid="v04-intent-capsule-error"
          >
            {session.error}
          </p>
        ) : null}

        <footer className="v04-ai-capsule-foot">
          <span className="v04-ai-capsule-hint">⌘K · Esc to close · ⌘⏎ to run</span>
          <span className="v04-ai-capsule-hint">
            {packet.provider === 'cloud'
              ? 'Cloud AI'
              : packet.provider === 'ollama'
                ? 'Local AI (Ollama)'
                : 'Local actions only'}
          </span>
        </footer>
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ContextChipsProps {
  readonly packet: ContextPacket;
}

function ContextChips(props: ContextChipsProps): React.ReactElement {
  const { packet } = props;
  const chips: React.ReactElement[] = [];
  chips.push(<Pill key="mode" tone="info">{packet.mode}</Pill>);
  if (packet.container) {
    chips.push(
      <Pill key="container" tone="neutral">
        {packet.container.kind}#{packet.container.id}
      </Pill>,
    );
  }
  chips.push(<Pill key="surface" tone="neutral">via {packet.invocationSurface}</Pill>);
  chips.push(
    <Pill key="scope" tone="warning" data-testid="v04-intent-capsule-scope-readout">
      scope: {SCOPE_LABELS[packet.scopePolicy]}
    </Pill>,
  );
  for (const s of packet.selectionPreview) {
    chips.push(
      <Pill key={`s-${s.id}`} tone="primary" title={s.label}>
        {s.label.length > 28 ? `${s.label.slice(0, 28)}…` : s.label}
      </Pill>,
    );
  }
  for (const id of packet.pinnedContextIds) {
    chips.push(<Pill key={`p-${id}`} tone="success">📌 {id}</Pill>);
  }
  if (packet.selectedText) {
    const text = packet.selectedText;
    chips.push(
      <Pill key="text" tone="primary" title={text}>
        “{text.length > 32 ? `${text.slice(0, 32)}…` : text}”
      </Pill>,
    );
  }
  return (
    <div
      className="v04-ai-capsule-chips"
      data-testid="v04-intent-capsule-chips"
    >
      {chips}
    </div>
  );
}

interface ScopeEditorProps {
  /**
   * The *resolved* scope. The chip pressed state is
   * read from the packet, not the session, so the
   * UI always reflects the post-demotion scope.
   */
  readonly current: ScopePolicy;
  readonly packet: ContextPacket;
  /** Click handler — writes the user's *intent* to the session. */
  readonly onChange: (s: ScopePolicy) => void;
}

function ScopeEditor(props: ScopeEditorProps): React.ReactElement {
  const { current, onChange, packet } = props;
  const hasSelection = Boolean(packet.selectedText) || packet.selectedObjectIds.length > 0;
  const hasPinned = packet.pinnedContextIds.length > 0;
  return (
    <div
      className="v04-ai-capsule-scope"
      data-testid="v04-intent-capsule-scope"
      role="radiogroup"
      aria-label="Scope"
    >
      <span className="v04-ai-capsule-scope-label">Scope:</span>
      {(['selection', 'current-view', 'container', 'explicit-set'] as ScopePolicy[]).map((s) => {
        const disabled =
          (s === 'selection' && !hasSelection) ||
          (s === 'explicit-set' && !hasPinned);
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={current === s}
            aria-pressed={current === s}
            className="v04-ai-capsule-scope-chip"
            disabled={disabled}
            onClick={() => onChange(s)}
            data-testid={`v04-intent-capsule-scope-${s}`}
          >
            {SCOPE_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

interface IntentFieldProps {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
}

const IntentField = React.forwardRef<HTMLInputElement, IntentFieldProps>(function IntentField(
  props,
  ref,
): React.ReactElement {
  return (
    <Input
      ref={ref}
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className="v04-ai-capsule-input"
      data-testid="v04-intent-capsule-input"
      aria-label="Intent"
    />
  );
});

interface IntentChipsProps {
  readonly pending: typeof SAFE_ACTION_IDS[number] | null;
  readonly onPick: (id: typeof SAFE_ACTION_IDS[number]) => Promise<void>;
  readonly packet: ContextPacket;
  readonly flavour: 'local' | 'sync';
}

function IntentChips(props: IntentChipsProps): React.ReactElement {
  const { pending, onPick, packet, flavour } = props;
  // The precomputed action args determine which
  // surface-specific chips are visible. The
  // `canvas-suggest-*` chips only show up when the
  // cognitive canvas has populated the map; the
  // generic capsule never sees them.
  const actionArgsById = assistantSession.getSnapshot().actionArgsById;
  return (
    <div
      className="v04-ai-capsule-actions"
      data-testid="v04-intent-capsule-actions"
    >
      {INTENT_CHIPS.map((c) => {
        // Hide surface-specific chips when the host
        // has not populated the typed args for them.
        // The Capsule is a *single* floating panel —
        // each surface that needs it supplies the
        // right `actionArgsById` entry, and the
        // generic capsule never sees the
        // surface-specific chips.
        if (
          (c.id === ACTION_CANVAS_SUGGEST_RELATIONS ||
            c.id === ACTION_CANVAS_SUGGEST_CLUSTER ||
            c.id === ACTION_CANVAS_SUGGEST_LAYOUT ||
            c.id === ACTION_RESEARCH_SUGGEST_DESIGN_TASKS) &&
          !actionArgsById[c.id]
        ) {
          return null;
        }
        const action = actionRegistry.get(c.id);
        if (!action) return null;
        const provider = probeProviderSnapshot(flavour);
        const permission = checkPermission({
          action,
          packet,
          workspaceFlavour: flavour,
          provider,
        });
        const disabled = !permission.ok || pending !== null;
        const reason = permission.ok ? null : permission.message;
        return (
          <Button
            key={c.id}
            variant={c.id === ACTION_CREATE_FREE_NOTE ? 'secondary' : 'primary'}
            size="sm"
            disabled={disabled}
            onClick={() => void onPick(c.id)}
            title={reason ?? action.description}
            data-testid={`v04-intent-capsule-action-${c.id}`}
            data-disabled-reason={reason ?? ''}
          >
            {pending === c.id ? '…' : c.label}
          </Button>
        );
      })}
    </div>
  );
}

interface ActionPreviewAreaProps {
  readonly packet: ContextPacket;
  readonly flavour: 'local' | 'sync';
  readonly prompt: string;
}

function ActionPreviewArea(props: ActionPreviewAreaProps): React.ReactElement {
  // Build a single pre-flight preview of the "next safe
  // action": the first chip the gate currently allows.
  // The user sees exactly what the action will read /
  // write / send.
  const provider = probeProviderSnapshot(props.flavour);
  for (const id of INTENT_CHIPS) {
    const action = actionRegistry.get(id.id);
    if (!action) continue;
    const permission = checkPermission({
      action,
      packet: props.packet,
      workspaceFlavour: props.flavour,
      provider,
    });
    if (!permission.ok) continue;
    const preview: ActionPreview = action.preview({
      packet: props.packet,
      prompt: props.prompt,
    });
    return (
      <div
        className="v04-ai-capsule-preview"
        data-testid="v04-intent-capsule-preview"
      >
        <p className="v04-ai-capsule-preview-summary">{preview.summary}</p>
        <ul className="v04-ai-capsule-preview-list">
          {preview.reads.map((r, i) => (
            <li key={`r-${i}`}>Reads: {r}</li>
          ))}
          {preview.writes.map((w, i) => (
            <li key={`w-${i}`}>Writes: {w}</li>
          ))}
        </ul>
        <p className="v04-ai-capsule-preview-meta">
          Provider: <strong>{preview.providerLabel}</strong> · Visibility:{' '}
          <strong>{props.packet.visibility}</strong>
        </p>
      </div>
    );
  }
  return (
    <div
      className="v04-ai-capsule-preview"
      data-testid="v04-intent-capsule-preview-empty"
    >
      <p>No action is currently available. Open a course / project or pin a context to enable one.</p>
    </div>
  );
}

interface DraftResultProps {
  readonly draft: DraftRecord;
  readonly onAccept: () => void | Promise<void>;
  readonly onReject: () => void;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}

function DraftResult(props: DraftResultProps): React.ReactElement {
  const { draft, onAccept, onReject, onRetry, onCancel } = props;
  const isTaskSuggestions = draft.body.kind === 'task-suggestions';
  // For task-suggestions we render per-row Accept /
  // Ignore inline; the top-level "Accept" is hidden
  // because there is no single canonical write. The
  // Reject / Cancel / Retry actions still work.
  const canAccept = !isTaskSuggestions &&
    (draft.target.kind !== 'note' || draft.body.kind === 'note-draft');
  return (
    <div
      className="v04-ai-capsule-draft"
      data-testid="v04-intent-capsule-draft"
      data-draft-body-kind={draft.body.kind}
    >
      <header className="v04-ai-capsule-draft-header">
        <Pill tone={draft.status === 'failed' ? 'error' : 'info'}>
          {draft.status}
        </Pill>
        <span className="v04-ai-capsule-draft-title">{draft.title}</span>
        {isTaskSuggestions && draft.body.kind === 'task-suggestions' && (
          <span
            className="v04-ai-capsule-draft-provider"
            data-testid="v04-intent-capsule-draft-provider"
            data-provider={draft.provenance.provider}
          >
            {draft.provenance.provider}
            {draft.provenance.model ? ` · ${draft.provenance.model}` : ''}
          </span>
        )}
      </header>
      <DraftBodyView draft={draft} onAccept={onAccept} onReject={onReject} />
      {draft.provenance.errorMessage ? (
        <p
          className="v04-ai-capsule-draft-error"
          role="status"
          data-testid="v04-intent-capsule-draft-error"
        >
          {draft.provenance.errorMessage}
        </p>
      ) : null}
      <div className="v04-ai-capsule-draft-actions">
        {draft.status === 'failed' || draft.status === 'cancelled' ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onRetry}
            data-testid="v04-intent-capsule-retry"
          >
            Retry
          </Button>
        ) : null}
        {!isTaskSuggestions && (
          <Button
            variant="primary"
            size="sm"
            onClick={onAccept}
            data-testid="v04-intent-capsule-accept"
            disabled={!canAccept}
          >
            Accept
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onReject}
          data-testid="v04-intent-capsule-reject"
        >
          Reject all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid="v04-intent-capsule-cancel"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DraftBodyView({
  draft,
  onAccept,
  onReject,
}: {
  readonly draft: DraftRecord;
  readonly onAccept: () => void | Promise<void>;
  readonly onReject: () => void;
}): React.ReactElement {
  const { body } = draft;
  if (body.kind === 'explanation') {
    return <p className="v04-ai-capsule-draft-text">{body.text || '(no response)'}</p>;
  }
  if (body.kind === 'navigation') {
    return <p className="v04-ai-capsule-draft-text">Navigate to: {body.target.label}</p>;
  }
  if (body.kind === 'note-draft') {
    return (
      <div className="v04-ai-capsule-draft-text">
        <p><strong>{body.title}</strong></p>
        <p>{body.body}</p>
      </div>
    );
  }
  if (body.kind === 'search-results') {
    return (
      <ul
        className="v04-ai-capsule-draft-text"
        data-testid="v04-intent-capsule-search-results"
      >
        {body.hits.length === 0 ? (
          <li>No matches.</li>
        ) : (
          body.hits.map((h) => (
            <li key={h.id}>
              <strong>{h.label}</strong>
              {h.preview ? <span> — {h.preview}</span> : null}
            </li>
          ))
        )}
      </ul>
    );
  }
  if (body.kind === 'task-suggestions') {
    // The task-suggestions Draft has its own per-row
    // Accept / Ignore renderer. Each row Accept calls
    // `acceptDesignTaskSuggestion(...)`; Ignore just
    // removes the row from the local view (no canonical
    // write). The top-level Accept / Reject / Cancel
    // buttons still apply — Reject / Cancel drop the
    // whole draft.
    return (
      <TaskSuggestionsBody
        draft={draft}
        onAccept={onAccept}
        onReject={onReject}
      />
    );
  }
  if (body.kind === 'text') {
    return <p className="v04-ai-capsule-draft-text">{body.text}</p>;
  }
  return <p className="v04-ai-capsule-draft-text">(no body)</p>;
}

interface TaskSuggestionsBodyProps {
  readonly draft: DraftRecord;
  readonly onAccept: () => void | Promise<void>;
  readonly onReject: () => void;
}

function TaskSuggestionsBody(props: TaskSuggestionsBodyProps): React.ReactElement {
  const { draft, onReject } = props;
  const body = draft.body;
  if (body.kind !== 'task-suggestions') {
    return <p className="v04-ai-capsule-draft-text">(no body)</p>;
  }
  // Per-row Accept state. The host reads from
  // `body.displayedTasks`; Accept rewrites the body
  // so the row disappears (or moves to a separate
  // `acceptedTasks` list). We keep the state local
  // to this component for now — the top-level
  // session's `draft` reference is the live one.
  const [acceptedTitles, setAcceptedTitles] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  // WP-07 Round 3 P0-C: the `titleToId` map is
  // *shared across the Accept pass*, not a fresh
  // `new Map()` per row. When one Accepted row
  // names another Accepted row in its
  // `dependsOnTaskTitles`, the writer needs to
  // resolve the title to the canonical id that
  // `acceptDesignTaskSuggestion` just produced.
  // We track those resolutions here and pass the
  // accumulating map to every Accept call.
  const [titleToId, setTitleToId] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [ignoredTitles, setIgnoredTitles] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const onRowAccept = async (title: string): Promise<void> => {
    const skeleton = body.displayedTasks.find((t) => t.title === title);
    if (!skeleton) return;
    try {
      const result = await acceptDesignTaskSuggestion(draft, {
        title: skeleton.title,
        why: skeleton.why,
        definitionOfDone: skeleton.definitionOfDone,
        sourceKind: body.sourceKind,
        sourceId: body.sourceId,
        sourceNote: skeleton.sourceNote,
        dependsOnTaskTitles: skeleton.dependsOnTitles,
        titleToId,
      });
      const nextAccepted = new Set(acceptedTitles);
      nextAccepted.add(title);
      setAcceptedTitles(nextAccepted);
      // Record the just-produced canonical id so a
      // later Accept with a matching `dependsOnTitles`
      // entry can resolve it without a fresh lookup.
      const nextMap = new Map(titleToId);
      nextMap.set(title, result.canonicalId);
      setTitleToId(nextMap);
    } catch (err) {
      assistantSession.setError(
        err instanceof Error ? err.message : 'Failed to accept suggestion.',
      );
    }
  };
  const onRowIgnore = (title: string): void => {
    const next = new Set(ignoredTitles);
    next.add(title);
    setIgnoredTitles(next);
  };
  const allResolved = body.displayedTasks.every(
    (t) => acceptedTitles.has(t.title) || ignoredTitles.has(t.title),
  );
  // WP-07 Round 4 P0-3: the host owns the *whole-draft*
  // transition. The per-row Accept path is now
  // side-effect-free on the Draft Layer (it only writes
  // the canonical row). When every row is resolved
  // (Accepted OR Ignored) AND the user accepted at
  // least one, we move the Draft to `accepted` so
  // the session can clear it. A user who Ignored
  // everything stays in `suggested` until they hit
  // the top-level Reject / Cancel.
  //
  // We guard with a `lastTransitionedRef` so the
  // effect fires exactly once per draft — the state
  // updates from individual Accepts can otherwise
  // re-trigger it. WP-07 Round 5: the previous
  // try/catch around `draftLayer.transition(...)`
  // silently swallowed unexpected terminal-state
  // conflicts (e.g. the draft was already
  // `accepted` or `rejected` by another path). With
  // `lastTransitionedRef` in place, the only way to
  // hit that path is a genuine contract violation;
  // we let it surface so tests and the host UI can
  // see the conflict, rather than papering over it.
  const lastTransitionedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!allResolved) return;
    if (acceptedTitles.size === 0) return; // pure-ignore: leave the draft in `suggested`
    if (lastTransitionedRef.current === draft.id) return;
    lastTransitionedRef.current = draft.id;
    draftLayer.transition(draft.id, 'accepted');
  }, [allResolved, acceptedTitles.size, draft.id]);
  return (
    <div
      className="v04-ai-capsule-draft-tasks"
      data-testid="v04-intent-capsule-task-suggestions"
      data-source={body.source}
    >
      {body.source === 'local-fallback' && (
        <p
          className="v04-ai-capsule-draft-warning"
          role="status"
          data-testid="v04-intent-capsule-task-suggestions-fallback"
        >
          AI offline — showing the local fallback. You can still Accept any of these or write a task manually.
        </p>
      )}
      {body.displayedTasks.length === 0 ? (
        <p className="v04-ai-capsule-draft-text">No suggestions to show.</p>
      ) : (
        <ul className="v04-ai-capsule-draft-task-list">
          {body.displayedTasks.map((t) => {
            const accepted = acceptedTitles.has(t.title);
            const ignored = ignoredTitles.has(t.title);
            if (accepted || ignored) return null;
            return (
              <li
                key={t.title}
                className="v04-ai-capsule-draft-task-row"
                data-testid="v04-intent-capsule-task-suggestion-row"
                data-task-title={t.title}
              >
                <div className="v04-ai-capsule-draft-task-title">
                  <strong>{t.title}</strong>
                </div>
                <div className="v04-ai-capsule-draft-task-why">Why: {t.why}</div>
                <div className="v04-ai-capsule-draft-task-dod">
                  Done when: {t.definitionOfDone}
                </div>
                {t.dependsOnTitles.length > 0 && (
                  <div className="v04-ai-capsule-draft-task-deps">
                    Depends on: {t.dependsOnTitles.join(', ')}
                  </div>
                )}
                <div className="v04-ai-capsule-draft-task-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void onRowAccept(t.title)}
                    data-testid="v04-intent-capsule-task-suggestion-accept"
                    data-task-title={t.title}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRowIgnore(t.title)}
                    data-testid="v04-intent-capsule-task-suggestion-ignore"
                    data-task-title={t.title}
                  >
                    Ignore
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {allResolved && (
        <p
          className="v04-ai-capsule-draft-complete"
          data-testid="v04-intent-capsule-task-suggestions-done"
        >
          {acceptedTitles.size > 0
            ? `Accepted ${acceptedTitles.size} task${acceptedTitles.size === 1 ? '' : 's'}.`
            : 'Ignored all suggestions.'}
          {' '}
          <Button
            variant="ghost"
            size="sm"
            onClick={onReject}
            data-testid="v04-intent-capsule-task-suggestions-close"
          >
            Close
          </Button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Args builders
// ---------------------------------------------------------------------------

/**
 * Build the `args` object for the given action from the
 * session + packet.
 *
 * Returns `null` when the args could not be built
 * (e.g. a corpus read failed); the caller surfaces the
 * error on the session.
 *
 * Data-read policy: only `search-local` reads from
 * `dataApi`. All other actions are pure functions of
 * the session + packet.
 *
 * WP-06 Round 6 P0-4: surfaces that own the typed
 * args for an action populate `session.actionArgsById`
 * before opening the capsule. The cognitive canvas's
 * `Ask AI` button sets the 3 `canvas-suggest-*`
 * actions' args; this function reads them first, so
 * clicking a chip dispatches with the typed args
 * instead of an empty `{}`.
 */
async function buildArgsForAction(
  actionId: typeof SAFE_ACTION_IDS[number],
  session: ReturnType<typeof useAssistantSession>,
  _packet: ContextPacket,
): Promise<Readonly<Record<string, unknown>> | null> {
  // Surface-supplied args win (the cognitive canvas
  // owns the typed args for its 3 actions; the
  // session carries them across the open).
  const precomputed = session.actionArgsById[actionId];
  if (precomputed) {
    return precomputed;
  }
  if (actionId === ACTION_NAVIGATE) {
    return buildNavigateArgs(session, _packet);
  }
  if (actionId === ACTION_SEARCH_LOCAL) {
    const result = await buildSearchCorpus();
    if (result.error) {
      // All reads failed — surface a recoverable error.
      // Throw so `runAction`'s `catch` routes the message
      // to `assistantSession.setError(...)`.
      throw new Error(result.error);
    }
    return { corpus: result.corpus, maxHits: 20 };
  }
  if (actionId === ACTION_CREATE_FREE_NOTE) {
    return buildCreateNoteArgs(session, _packet);
  }
  if (actionId === ACTION_EXPLAIN_SELECTED) {
    return { question: session.prompt };
  }
  return {};
}

/**
 * Real navigation: build a *typed* `AppLocation` from the
 * user's prompt + the packet, then encode it with
 * `encodeLocationToHash`. Only valid routes are produced;
 * unknown prompts throw (the caller surfaces the error
 * on the session).
 *
 *   - `home`                → mode home (no container).
 *   - `reader`              → shared reader, mode follows
 *                              the packet (cross-mode
 *                              surface, no container).
 *   - `course` / `lecture`  → only when the packet has
 *                              a `course` container.
 *   - `project` / `library` / `evidence` / `output` /
 *     `research-canvas`     → only when the packet has a
 *                              `project` container.
 *   - any other prompt      → error, no fallback.
 */
function buildNavigateArgs(
  session: ReturnType<typeof useAssistantSession>,
  packet: ContextPacket,
): Readonly<Record<string, unknown>> {
  const prompt = session.prompt.trim().toLowerCase();
  if (prompt === '') {
    throw new Error('Navigation target required. Type a shortcut (e.g. "home", "reader", "course", "project").');
  }
  const container = packet.container;
  if (prompt === 'home') {
    const loc = packet.mode === 'study'
      ? { mode: 'study' as const, surface: 'study-home' as const }
      : { mode: 'research' as const, surface: 'research-home' as const };
    return {
      route: encodeLocationToHash(loc),
      label: 'Open Home',
    };
  }
  if (prompt === 'reader') {
    // `reader` is a cross-mode surface; the mode
    // follows the current packet mode.
    const loc = {
      mode: packet.mode,
      surface: 'reader' as const,
    };
    return {
      route: encodeLocationToHash(loc),
      label: 'Open Reader',
    };
  }
  // Container routes — only valid when the packet has
  // a matching container.
  if (container?.kind === 'course' && (prompt === 'course' || prompt === 'lecture')) {
    const loc = {
      mode: 'study' as const,
      surface: prompt as 'course' | 'lecture',
      container: { ...container },
    };
    return {
      route: encodeLocationToHash(loc),
      label: `Open ${prompt}`,
    };
  }
  if (container?.kind === 'project' && ['project', 'library', 'evidence', 'output', 'research-canvas'].includes(prompt)) {
    const loc = {
      mode: 'research' as const,
      surface: prompt as 'project' | 'library' | 'evidence' | 'output' | 'research-canvas',
      container: { ...container },
    };
    return {
      route: encodeLocationToHash(loc),
      label: `Open ${prompt}`,
    };
  }
  // Unknown / unmatched prompt → recoverable error.
  const hint = container
    ? `Try "home", "reader", or one of: ${container.kind === 'course' ? 'course, lecture' : 'project, library, evidence, output, research-canvas'}.`
    : 'Try "home" or "reader". Container routes (course/lecture/project/library/evidence/output/research-canvas) need a container in the current context.';
  throw new Error(`Unknown navigation target "${session.prompt}". ${hint}`);
}

/**
 * Build the `moduleId` for the create-note draft. The
 * gate has already verified the packet's container.kind
 * is `course`; here we just route the course id as
 * the `moduleId` (Study Mode maps courses to modules in
 * the existing v0.3 domain).
 */
function buildCreateNoteArgs(
  session: ReturnType<typeof useAssistantSession>,
  packet: ContextPacket,
): Readonly<Record<string, unknown>> {
  const moduleId = packet.container?.kind === 'course' ? packet.container.id : '';
  return {
    title: session.prompt.slice(0, 60) || 'Untitled',
    body: session.selectedText ?? session.prompt,
    moduleId,
  };
}

interface SearchCorpusResult {
  readonly corpus: readonly {
    readonly id: string;
    readonly label: string;
    readonly preview?: string;
  }[];
  /** Non-null when at least one read failed AND we have nothing to show. */
  readonly error: string | null;
}

/**
 * Build the search corpus from `dataApi`. This is the
 * *only* place in the UI that talks to `dataApi`, and
 * it runs *only* for the `search-local` action — every
 * other action's args are pure session-derived.
 *
 * Walks `modules → lectures` and `literatureProjects`.
 * A complete read failure surfaces a recoverable
 * error; partial failures are tolerated (results may be
 * incomplete) but the search still runs.
 */
async function buildSearchCorpus(): Promise<SearchCorpusResult> {
  const api = getDataApi();
  const corpus: { id: string; label: string; preview?: string }[] = [];
  let moduleRead = false;
  let moduleFailed = false;
  let projectRead = false;
  let projectFailed = false;
  try {
    const modules = await api.modules.list();
    moduleRead = true;
    for (const m of modules) {
      corpus.push({
        id: `module:${m.id}`,
        label: m.title,
        ...(m.code ? { preview: m.code } : {}),
      });
      try {
        const lectures = await api.lectures.list(m.id);
        for (const l of lectures) {
          corpus.push({
            id: `lecture:${l.id}`,
            label: l.title,
            ...(m.code ? { preview: `Module ${m.code}` } : {}),
          });
        }
      } catch {
        // Per-module read failure is non-fatal; we
        // continue with the modules we did read.
        moduleFailed = true;
      }
    }
  } catch {
    moduleFailed = true;
  }
  try {
    const projects = await api.literatureProjects.list();
    projectRead = true;
    for (const p of projects) {
      corpus.push({
        id: `project:${p.id}`,
        label: p.name,
        ...(p.description ? { preview: p.description } : {}),
      });
    }
  } catch {
    // The project list is not always available (a local
    // workspace with no project data). Treat a
    // single-source failure as non-fatal.
    projectFailed = true;
  }
  if (!moduleRead && !projectRead) {
    return {
      corpus: [],
      error:
        'Search unavailable: workspace data could not be read. Try again or switch workspace.',
    };
  }
  const partialError = moduleFailed || projectFailed
    ? 'Some workspace data could not be read; results may be incomplete.'
    : null;
  return { corpus, error: partialError };
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

/**
 * Tiny provider snapshot. The router itself owns the
 * real probe; the Capsule uses this fast path to render
 * the "Cloud AI" / "Local AI" pill and to disable the
 * AI chip in a local workspace.
 */
function probeProviderSnapshot(flavour: 'local' | 'sync'): ProviderAvailability {
  if (flavour === 'local') return { aiAvailable: false, providerName: 'none' };
  const api = getDataApi();
  return { aiAvailable: api.supports('ai.chat' as Capability), providerName: 'cloud' };
}
