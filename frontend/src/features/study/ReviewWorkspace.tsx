/**
 * StudyKit v0.4 — `features/study/ReviewWorkspace`
 *
 * The Review flow (PRD §5.2 + Flow S3): from a list of
 * unresolved questions, the user can:
 *
 *   1. **Recall** — type their own answer, then Reveal to
 *      see the source + the AI feedback.
 *   2. **Reveal** — go straight to the source + the AI
 *      feedback without typing anything.
 *   3. Mark each question as `understood` / `uncertain` /
 *      `review-later`. There is no streak, no scoring, no
 *      "complete 5 a day" — the system never forces a
 *      count.
 *
 * The component reads unresolved questions through
 * `useStudyDeps()` (the Study repository), groups by
 * container, and lets the user walk one at a time. There is
 * no maximum; the user can exit at any point.
 *
 * Source boundary
 * ---------------
 *
 *   - The Repository is the only path to Dexie.
 *   - `markReview` is the only state transition this
 *     component triggers.
 *   - No AI call is made here — Review is about *the
 *     user's* memory, not about generating more content.
 */

import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Surface } from '../../shared/ui/Surface';
import { Pill } from '../../shared/ui/Pill';
import { useStudyDeps } from './studyContext';
import { markReview } from '../../application/study/studyUseCases';
import type {
  StudyAttempt,
  StudyFeedback,
  StudyQuestion,
  ReviewState,
} from '../../domain/study';
import { isCompleteSourceLocator } from '../../domain/study';

export interface ReviewWorkspaceProps {
  /** Optional: pre-select a question id (e.g. when opened from a course). */
  readonly initialQuestionId?: string;
  /** Optional: pre-select a course container id. */
  readonly initialContainerId?: string;
  /** The host navigates back to a lecture when the user clicks "Open lecture". */
  readonly onOpenLecture: (input: { courseId: string; lectureId: string; questionId: string }) => void;
  /** The user closed Review; return to whatever brought them here. */
  readonly onExit: () => void;
}

type Reveal =
  | { kind: 'hidden' }
  | { kind: 'recalling' }
  | { kind: 'revealed'; recall: string };

export function ReviewWorkspace(props: ReviewWorkspaceProps): React.ReactElement {
  const deps = useStudyDeps();
  const [questions, setQuestions] = React.useState<readonly StudyQuestion[]>([]);
  const [attempts, setAttempts] = React.useState<Record<string, readonly StudyAttempt[]>>({});
  const [feedback, setFeedback] = React.useState<Record<string, readonly StudyFeedback[]>>({});
  const [active, setActive] = React.useState<string | null>(null);
  const [reveal, setReveal] = React.useState<Reveal>({ kind: 'hidden' });
  const [recallText, setRecallText] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    // The queue shows every question the user has captured
    // but not yet marked `understood`. We do NOT filter by
    // status — a question moves through `open` → `answered`
    // (when the user saves an attempt) → `reviewed` (when
    // the user marks a review state), and the Review queue
    // should see them all the way through. The `understood`
    // filter is applied after the read so a `reviewed` +
    // `understood` question leaves the queue immediately.
    const filter: Parameters<typeof deps.repository.listQuestions>[0] = {
      limit: 100,
    };
    if (props.initialContainerId) {
      (filter as { containerId?: string }).containerId = props.initialContainerId;
    }
    const qs = await deps.repository.listQuestions(filter);
    const allUnresolved = qs.filter((q) => q.review !== 'understood');
    setQuestions(allUnresolved);
    if (props.initialQuestionId && allUnresolved.find((q) => q.id === props.initialQuestionId)) {
      setActive(props.initialQuestionId);
    } else if (allUnresolved[0]) {
      setActive(allUnresolved[0].id);
    }
    const a: Record<string, readonly StudyAttempt[]> = {};
    const f: Record<string, readonly StudyFeedback[]> = {};
    for (const q of allUnresolved) {
      a[q.id] = await deps.repository.listAttemptsForQuestion(q.id);
      f[q.id] = await deps.repository.listFeedbackForQuestion(q.id);
    }
    setAttempts(a);
    setFeedback(f);
    setLoading(false);
  }, [deps.repository, props.initialContainerId, props.initialQuestionId]);

  React.useEffect(() => {
    void reload();
    const unsub = deps.repository.subscribe(() => {
      void reload();
    });
    return () => {
      unsub();
    };
  }, [reload, deps.repository]);

  React.useEffect(() => {
    setReveal({ kind: 'hidden' });
    setRecallText('');
  }, [active]);

  const current = active ? questions.find((q) => q.id === active) : null;
  const currentAttempts = current ? attempts[current.id] ?? [] : [];
  const currentFeedback = current ? feedback[current.id] ?? [] : [];

  const handleReveal = (): void => {
    setReveal(reveal.kind === 'recalling' ? { kind: 'revealed', recall: recallText } : { kind: 'revealed', recall: '' });
  };

  const handleMark = async (review: ReviewState): Promise<void> => {
    if (!current) return;
    await markReview(deps, {
      questionId: current.id,
      review,
      containerId: current.container?.id ?? '',
      lectureId: current.locator?.lectureId ?? 'unknown',
    });
    const idx = questions.findIndex((q) => q.id === current.id);
    const next = questions[idx + 1];
    if (next) {
      setActive(next.id);
    } else {
      setActive(null);
    }
  };

  return (
    <div className="v04-review-workspace" data-testid="v04-review-workspace">
      <header className="v04-review-workspace-header">
        <h1>Review</h1>
        <p className="v04-review-workspace-lede">
          Recall first, then reveal. Mark each question as you go. There is no
          streak and no required count — exit whenever you want.
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={props.onExit}
          data-testid="v04-review-exit"
        >
          Exit review
        </Button>
      </header>

      {loading && <p className="v04-review-workspace-status">Loading…</p>}
      {!loading && questions.length === 0 && (
        <Surface level="sunken" className="v04-review-workspace-empty" data-testid="v04-review-empty">
          <p>No open questions. Capture a question in a lecture to start a review queue.</p>
        </Surface>
      )}

      {questions.length > 0 && (
        <div className="v04-review-workspace-layout">
          <aside className="v04-review-workspace-queue" aria-label="Question queue">
            <ul data-testid="v04-review-queue">
              {questions.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    className={`v04-review-queue-button ${active === q.id ? 'active' : ''}`}
                    onClick={() => setActive(q.id)}
                    data-testid="v04-review-queue-item"
                  >
                    <span className="v04-review-queue-body">{q.body}</span>
                    <Pill tone={q.review === 'unreviewed' ? 'neutral' : 'primary'}>{q.review}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="v04-review-workspace-card" aria-label="Active question">
            {current ? (
              <Surface level="surface" data-testid="v04-review-card">
                <header className="v04-review-card-header">
                  <h2>{current.body}</h2>
                  <div className="v04-review-card-meta">
                    {current.locator && (
                      <Pill tone={isCompleteSourceLocator(current.locator) ? 'primary' : 'neutral'}>
                        {current.locator.kind} {current.locator.lectureId}
                      </Pill>
                    )}
                    <Pill tone="neutral">{current.status}</Pill>
                  </div>
                </header>

                {reveal.kind === 'hidden' && (
                  <div className="v04-review-card-recall" data-testid="v04-review-recall">
                    <label className="v04-review-card-label">
                      Recall (your own answer)
                      <textarea
                        className="v04-review-card-textarea"
                        value={recallText}
                        onChange={(e) => setRecallText(e.target.value)}
                        rows={4}
                        data-testid="v04-review-recall-input"
                      />
                    </label>
                    <div className="v04-review-card-actions">
                      <Button
                        type="button"
                        onClick={() => setReveal({ kind: 'recalling' })}
                        data-testid="v04-review-recall-button"
                      >
                        Save recall & reveal
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleReveal}
                        data-testid="v04-review-reveal-button"
                      >
                        Reveal
                      </Button>
                    </div>
                  </div>
                )}

                {(reveal.kind === 'recalling' || reveal.kind === 'revealed') && (
                  <div className="v04-review-card-revealed" data-testid="v04-review-revealed">
                    {currentAttempts.length > 0 && (
                      <div className="v04-review-card-attempts">
                        <h3>Your attempt</h3>
                        {currentAttempts.map((a) => (
                          <p key={a.id} className="v04-review-card-attempt">{a.body}</p>
                        ))}
                      </div>
                    )}
                    {currentFeedback.length > 0 && (
                      <div className="v04-review-card-feedback">
                        <h3>Feedback</h3>
                        {currentFeedback.map((f) => (
                          <Surface key={f.id} level="sunken" className="v04-review-card-feedback-item">
                            <header className="v04-review-card-feedback-header">
                              <Pill tone={f.authorType === 'ai' ? 'primary' : 'neutral'}>
                                {f.authorType === 'ai' ? 'AI' : 'You'}
                              </Pill>
                              <Pill tone="neutral">{f.provenance.provider}</Pill>
                            </header>
                            <p>{f.body}</p>
                          </Surface>
                        ))}
                      </div>
                    )}
                    {currentAttempts.length === 0 && currentFeedback.length === 0 && (
                      <p className="v04-review-card-empty">
                        You have not written an attempt or feedback for this question.
                      </p>
                    )}
                    {current.locator && isCompleteSourceLocator(current.locator) && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          props.onOpenLecture({
                            courseId: current.container?.id ?? '',
                            lectureId: current.locator?.lectureId ?? '',
                            questionId: current.id,
                          })
                        }
                        data-testid="v04-review-open-lecture"
                      >
                        Open source
                      </Button>
                    )}
                    <div className="v04-review-card-mark">
                      <Button
                        type="button"
                        onClick={() => handleMark('understood')}
                        data-testid="v04-review-mark-understood"
                      >
                        Understood
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleMark('uncertain')}
                        data-testid="v04-review-mark-uncertain"
                      >
                        Uncertain
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleMark('review-later')}
                        data-testid="v04-review-mark-later"
                      >
                        Review later
                      </Button>
                    </div>
                  </div>
                )}
              </Surface>
            ) : (
              <Surface level="sunken" data-testid="v04-review-no-active">
                <p>All questions reviewed. Capture a new one in a lecture to keep going.</p>
              </Surface>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
