/**
 * StudyKit v0.4 — `features/study/UnderstandDrawer`
 *
 * The Understand flow (PRD §5.2 + Flow S2): from a
 * selection in the lecture, the user can:
 *
 *   1. **Type their own question + explanation** in the
 *      free-text area first. This is the default; "先作答
 *      不是强制" means the user can also Skip / Close at
 *      any time.
 *   2. **Save the attempt** — turns the typed content
 *      into a persisted `StudyQuestion` + `StudyAttempt`,
 *      transitions the drawer into the `ready-to-ask`
 *      phase where the user can ask the AI for feedback
 *      OR continue without AI.
 *   3. **Ask the AI for feedback** — submits the question
 *      + the user's attempt + the source passage to the
 *      AI Interaction Kernel. AI feedback is a *draft*;
 *      Accept / Reject / Continue without AI are the
 *      only outcomes. Failure preserves the user's text,
 *      the selection, the locator, the focus, and offers
 *      Retry / Continue.
 *   4. **Continue without AI** — the user types the
 *      feedback themselves (or keeps the attempt as-is).
 *
 * Source boundary
 * ---------------
 *
 *   - All persistence goes through `useStudyDeps()` — the
 *     `StudyRepository` is the only place that touches the
 *     Dexie tables.
 *   - The AI call goes through the kernel's `ProviderRouter`
 *     + `DraftLayer`. The drawer NEVER imports `lib/api`,
 *     `lib/db` or any AI client directly.
 *   - The user content (`questionBody`, `attemptBody`) is
 *     user-authored; the AI content (`feedbackBody`) is
 *     kept in a Draft Layer record and only written to
 *     the repository on `accept`.
 *
 * State machine (WP-04 Gate fix)
 * ------------------------------
 *
 *   The previous version had one phase (`composing`) and
 *   mutated the closure after `setPhase` to attach
 *   `question` and `attemptId`. That was a real bug:
 *   `setPhase` schedules a re-render; the new state
 *   object was `{ kind: 'composing' }` and the mutation
 *   affected the *old* `phase` variable, not the new one.
 *   React then re-rendered, the mutation was lost, and
 *   the "Ask AI" / "Continue without AI" block never
 *   appeared.
 *
 *   The fix is the discriminated union below. Every phase
 *   that needs the question / attempt id carries them
 *   *as state* — there is no closure mutation, no cast,
 *   no `(phase as { question?: ... }).question` trick.
 *   `Reject` transitions back to `ready-to-ask` (NOT
 *   `composing`); the user can ask the AI again or
 *   continue without AI without re-typing the question.
 *
 *   The state machine:
 *
 *   composing
 *     -- saveAttempt --> ready-to-ask (question, attemptId)
 *   ready-to-ask
 *     -- ask --> requesting (question, attemptId)
 *     -- continue-without-ai --> closed (host callback)
 *   requesting
 *     -- success --> reviewing (question, attemptId, draftId)
 *     -- failure --> failed (question, attemptId, draftId, error)
 *   reviewing
 *     -- accept --> closed (host callback, persisted)
 *     -- reject --> ready-to-ask (question, attemptId)  ← the
 *                     user can re-ask or continue without AI
 *   failed
 *     -- retry --> requesting
 *     -- continue-without-ai --> closed
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Surface } from '../../shared/ui/Surface';
import { Pill } from '../../shared/ui/Pill';
import { useStudyDeps } from './studyContext';
import {
  createQuestion,
  saveAttempt,
  requestFeedback,
  acceptFeedback,
  rejectFeedback,
  recordUserFeedback,
} from '../../application/study/studyUseCases';
import { draftLayer } from '../../features/ai/kernel/draftLayer';
import type { ContainerRef } from '../../domain/workspace';
import type { SourceLocator, StudyQuestion, StudyFeedback } from '../../domain/study';
import { isCompleteSourceLocator } from '../../domain/study';

export interface UnderstandDrawerProps {
  readonly courseId: string;
  /** The lecture the user is reading. */
  readonly lectureId: string;
  /** The source the user picked — a pointer back to a passage. */
  readonly locator: SourceLocator | null;
  /** The text the user selected. */
  readonly selectionText: string;
  /** Container ref to stamp on the question (the course). */
  readonly container: ContainerRef;
  /**
   * When the user Accepts AI feedback, the host navigates
   * to Review. When the user types their own feedback, the
   * host stays on the Lecture Focus.
   */
  readonly onCompleted: (input: { questionId: string; feedbackId?: string }) => void;
  /** The user closed the drawer (Skip / Esc). */
  readonly onClose: () => void;
  /**
   * The most recent "draft-input" recovery entry for this
   * (container, lecture). Restored when the user opens the
   * drawer after a reload / AI failure.
   */
  readonly initialPrompt?: string;
}

type Phase =
  | { readonly kind: 'composing' }
  | {
      readonly kind: 'ready-to-ask';
      readonly question: StudyQuestion;
      readonly attemptId: string;
    }
  | {
      readonly kind: 'requesting';
      readonly question: StudyQuestion;
      readonly attemptId: string;
    }
  | {
      readonly kind: 'reviewing';
      readonly question: StudyQuestion;
      readonly attemptId: string;
      readonly draftId: string;
    }
  | {
      readonly kind: 'failed';
      readonly question: StudyQuestion;
      readonly attemptId: string;
      readonly draftId: string;
      readonly error: string;
    };

export function UnderstandDrawer(props: UnderstandDrawerProps): React.ReactElement {
  const deps = useStudyDeps();
  const [phase, setPhase] = React.useState<Phase>({ kind: 'composing' });
  const [questionText, setQuestionText] = React.useState('');
  const [attemptText, setAttemptText] = React.useState(props.initialPrompt ?? '');
  const [userFeedbackText, setUserFeedbackText] = React.useState('');
  // The "Ask AI" prompt is what the user types in the
  // secondary text field. It is sent to the AI as the user
  // question; the attempt + source are appended by the use
  // case.
  const [askPrompt, setAskPrompt] = React.useState('How is my explanation?');

  const sourceComplete = isCompleteSourceLocator(props.locator);

  // ----- handlers ---------------------------------------------------------

  const handleSaveAttempt = async (): Promise<void> => {
    if (questionText.trim().length === 0) return;
    const q = await createQuestion(deps, {
      body: questionText,
      locator: props.locator,
      container: props.container,
    });
    const a = await saveAttempt(deps, {
      questionId: q.id,
      body: attemptText,
      locator: props.locator,
      containerId: props.container.id,
    });
    // Transition to the explicit `ready-to-ask` phase with
    // the question + attempt id on the state itself. No
    // closure mutation, no cast — the next render reads
    // the values from the state object.
    setPhase({ kind: 'ready-to-ask', question: q, attemptId: a.id });
  };

  const handleAsk = async (): Promise<void> => {
    if (phase.kind !== 'ready-to-ask' && phase.kind !== 'failed') return;
    const { question, attemptId } = phase;
    setPhase({ kind: 'requesting', question, attemptId });
    const out = await requestFeedback(deps, {
      questionId: question.id,
      attemptId,
      prompt: askPrompt.trim().length > 0 ? askPrompt : 'How is my explanation?',
      contextText: props.selectionText,
      locator: props.locator,
      containerId: props.container.id,
    });
    if (out.failed) {
      setPhase({
        kind: 'failed',
        question,
        attemptId,
        draftId: out.draftId,
        error: out.error ?? 'AI request failed.',
      });
      return;
    }
    setPhase({ kind: 'reviewing', question, attemptId, draftId: out.draftId });
  };

  const handleAccept = async (): Promise<void> => {
    if (phase.kind !== 'reviewing') return;
    const draft = draftLayer.get(phase.draftId);
    const draftText = draft?.body.kind === 'explanation' ? draft.body.text : '';
    const fb = await acceptFeedback(deps, {
      draftId: phase.draftId,
      questionId: phase.question.id,
      attemptId: phase.attemptId,
      body: draftText,
      locator: props.locator,
      containerId: props.container.id,
      lectureId: props.lectureId,
    });
    props.onCompleted({ questionId: phase.question.id, feedbackId: fb.id });
  };

  const handleReject = async (): Promise<void> => {
    // Reject must NOT throw away the saved question /
    // attempt. We transition to `ready-to-ask` so the
    // user can ask the AI again or continue without AI
    // without re-typing anything.
    if (phase.kind !== 'reviewing') return;
    const { question, attemptId } = phase;
    await rejectFeedback(deps, { draftId: phase.draftId });
    setPhase({ kind: 'ready-to-ask', question, attemptId });
  };

  const handleContinueWithoutAI = async (): Promise<void> => {
    if (phase.kind !== 'ready-to-ask' && phase.kind !== 'failed' && phase.kind !== 'composing') return;
    if (phase.kind === 'composing') {
      // The user closed the drawer before saving anything;
      // there is no question to continue from. Just close.
      props.onCompleted({ questionId: '' });
      return;
    }
    const { question, attemptId } = phase;
    const body = userFeedbackText.trim().length > 0 ? userFeedbackText : attemptText;
    if (body.trim().length === 0) {
      // Nothing to record; just close.
      props.onCompleted({ questionId: question.id });
      return;
    }
    const fb: StudyFeedback = await recordUserFeedback(deps, {
      draftId: '',
      questionId: question.id,
      attemptId,
      body,
      locator: props.locator,
      containerId: props.container.id,
      lectureId: props.lectureId,
    });
    props.onCompleted({ questionId: question.id, feedbackId: fb.id });
  };

  // ----- render -----------------------------------------------------------

  return (
    <Surface
      level="floating"
      glass
      className="v04-understand-drawer"
      data-testid="v04-understand-drawer"
    >
      <header className="v04-understand-drawer-header">
        <h3>Understand</h3>
        <Pill tone={sourceComplete ? 'primary' : 'neutral'}>
          {sourceComplete ? 'Source available' : 'No source'}
        </Pill>
      </header>

      {(phase.kind === 'composing' || phase.kind === 'ready-to-ask') && (
        <>
          <label className="v04-understand-drawer-label">
            Your question
            <textarea
              className="v04-understand-drawer-textarea"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="What do you want to understand?"
              rows={2}
              data-testid="v04-understand-question"
              disabled={phase.kind === 'ready-to-ask'}
            />
          </label>
          <label className="v04-understand-drawer-label">
            Your own explanation (try first, then optionally ask AI)
            <textarea
              className="v04-understand-drawer-textarea"
              value={attemptText}
              onChange={(e) => setAttemptText(e.target.value)}
              placeholder="Type your own explanation in your own words…"
              rows={5}
              data-testid="v04-understand-attempt"
              disabled={phase.kind === 'ready-to-ask'}
            />
          </label>
          {phase.kind === 'composing' && (
            <div className="v04-understand-drawer-actions">
              <Button
                type="button"
                onClick={handleSaveAttempt}
                disabled={questionText.trim().length === 0}
                data-testid="v04-understand-save-attempt"
              >
                Save attempt
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={props.onClose}
                data-testid="v04-understand-close"
              >
                Close
              </Button>
            </div>
          )}
        </>
      )}

      {phase.kind === 'ready-to-ask' && (
        <div className="v04-understand-drawer-ask" data-testid="v04-understand-ask-block">
          <p className="v04-understand-drawer-status">
            Attempt saved. You can ask the AI for feedback or continue without it.
          </p>
          <label className="v04-understand-drawer-label">
            Ask the AI (optional)
            <textarea
              className="v04-understand-drawer-textarea"
              value={askPrompt}
              onChange={(e) => setAskPrompt(e.target.value)}
              rows={2}
              data-testid="v04-understand-ask-prompt"
            />
          </label>
          <div className="v04-understand-drawer-actions">
            <Button
              type="button"
              onClick={handleAsk}
              data-testid="v04-understand-ask"
            >
              Ask AI
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleContinueWithoutAI}
              data-testid="v04-understand-continue-without-ai"
            >
              Continue without AI
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'requesting' && (
        <p className="v04-understand-drawer-status" data-testid="v04-understand-requesting">
          Asking the AI…
        </p>
      )}

      {phase.kind === 'failed' && (
        <div className="v04-understand-drawer-failed" data-testid="v04-understand-failed">
          <p role="alert" className="v04-understand-drawer-error">
            AI is not reachable: {phase.error}
          </p>
          <p className="v04-understand-drawer-status">
            Your text, selection and source are preserved. You can retry or continue
            without AI.
          </p>
          <div className="v04-understand-drawer-actions">
            <Button
              type="button"
              onClick={handleAsk}
              data-testid="v04-understand-retry"
            >
              Retry
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleContinueWithoutAI}
              data-testid="v04-understand-failed-continue"
            >
              Continue without AI
            </Button>
          </div>
          <label className="v04-understand-drawer-label">
            Your own feedback (optional)
            <textarea
              className="v04-understand-drawer-textarea"
              value={userFeedbackText}
              onChange={(e) => setUserFeedbackText(e.target.value)}
              rows={3}
              data-testid="v04-understand-user-feedback"
            />
          </label>
        </div>
      )}

      {phase.kind === 'reviewing' && (
        <div className="v04-understand-drawer-review" data-testid="v04-understand-review">
          <p className="v04-understand-drawer-status">AI feedback (draft). Review before accepting.</p>
          <pre className="v04-understand-drawer-draft" data-testid="v04-understand-draft">
            {(() => {
              const d = draftLayer.get(phase.draftId);
              return d?.body.kind === 'explanation' ? d.body.text : '';
            })()}
          </pre>
          <div className="v04-understand-drawer-actions">
            <Button
              type="button"
              onClick={handleAccept}
              data-testid="v04-understand-accept"
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleReject}
              data-testid="v04-understand-reject"
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </Surface>
  );
}
