/**
 * StudyKit v0.4 — `features/study/StudyHome` (WP-11R2)
 *
 * The Study Mode landing surface. WP-11R2 reshapes the
 * top-level page to put **Resume** before **Create**:
 *
 *   - The Continue section is now the visual primary
 *     (most recent questions or, when none, the most
 *     recent lectures).
 *   - The Courses list is the *secondary* action.
 *   - The "New course" entry is collapsed into a
 *     small "New course" button — it no longer
 *     competes with the Resume affordance.
 *
 * Behaviour is otherwise unchanged: the page reads via
 * the dataApi gateway and the Study repository, hands
 * the host the navigation callbacks. The host maps
 * the callbacks to `locationStore.push`.
 */
import React from 'react';
import { Button } from '../../shared/ui/Button';
import { Surface } from '../../shared/ui/Surface';
import { Pill } from '../../shared/ui/Pill';
import { useStudyDeps } from './studyContext';
import { getDataApi } from '../../application/dataApi';
import type { Module, Lecture } from '../../types';
import type { StudyQuestion } from '../../domain/study';

export interface StudyHomeProps {
  readonly initialAddOpen?: boolean;
  readonly onOpenCourse: (courseId: string) => void;
  readonly onResumeQuestion: (input: { courseId: string; lectureId: string; questionId: string }) => void;
  readonly onOpenReview: () => void;
}

interface CourseRow {
  readonly course: Module;
  readonly lectureCount: number;
  readonly recentQuestionCount: number;
  readonly mostRecentLecture: Lecture | null;
}

export function StudyHome(props: StudyHomeProps): React.ReactElement {
  const deps = useStudyDeps();
  const [courses, setCourses] = React.useState<readonly CourseRow[]>([]);
  const [recentQuestions, setRecentQuestions] = React.useState<readonly StudyQuestion[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showNewCourse, setShowNewCourse] = React.useState(props.initialAddOpen ?? false);
  const [newCourseTitle, setNewCourseTitle] = React.useState('');
  const [newCourseError, setNewCourseError] = React.useState<string | null>(null);
  const [creatingCourse, setCreatingCourse] = React.useState(false);

  React.useEffect(() => {
    if (props.initialAddOpen) setShowNewCourse(true);
  }, [props.initialAddOpen]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const dataApi = getDataApi();
        const mods = await dataApi.modules.list();
        const rows: CourseRow[] = [];
        for (const m of mods) {
          const lectures: Lecture[] = await dataApi.lectures.list(m.id);
          const qs = await deps.repository.listQuestions({ containerId: m.id });
          // Pick the most recent lecture (newest
          // `lecture_date` or fallback to the
          // first one) so Resume has a target even
          // when there are no open questions.
          const sorted = [...lectures].sort((a, b) => {
            const ad = a.lecture_date ?? '';
            const bd = b.lecture_date ?? '';
            if (ad !== bd) return bd.localeCompare(ad);
            return (b.created_at ?? '').localeCompare(a.created_at ?? '');
          });
          rows.push({
            course: m,
            lectureCount: lectures.length,
            recentQuestionCount: qs.length,
            mostRecentLecture: sorted[0] ?? null,
          });
        }
        if (cancelled) return;
        setCourses(rows);
        const allQs = await deps.repository.listQuestions({ status: 'open', limit: 5 });
        if (cancelled) return;
        setRecentQuestions(allQs);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load Study Home.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const unsub = deps.repository.subscribe(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [deps.repository]);

  const openReviewCount = recentQuestions.length;

  // Resume priority order:
  //   1. Most recent *open* question (across all
  //      courses) — picks up exactly where the user
  //      left off in the Lecture Focus.
  //   2. Most recent lecture (across all courses) —
  //      covers the common "I just want to keep
  //      reading / re-take notes" case.
  //   3. No courses → show the empty state.
  const resumeQuestion = recentQuestions[0] ?? null;
  const resumeLecture = courses.find((c) => c.mostRecentLecture)?.mostRecentLecture ?? null;
  const resumeCourseId =
    resumeQuestion?.container?.id ??
    courses.find((c) => c.mostRecentLecture?.id === resumeLecture?.id)?.course.id ??
    null;

  const handleCreateCourse = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const title = newCourseTitle.trim();
    if (!title || creatingCourse) return;
    setCreatingCourse(true);
    setNewCourseError(null);
    try {
      const course = await getDataApi().modules.create({ title });
      setNewCourseTitle('');
      setShowNewCourse(false);
      props.onOpenCourse(course.id);
    } catch (err) {
      setNewCourseError(err instanceof Error ? err.message : 'Could not create the course.');
    } finally {
      setCreatingCourse(false);
    }
  };

  return (
    <div className="v04-study-home" data-testid="v04-study-home">
      <header className="v04-study-home-header">
        <h1>Study</h1>
        <p className="v04-study-home-lede">
          Open a course, capture what you notice in lecture, form your own explanation,
          and ask for feedback when you want a check — not because the system told you to.
        </p>
      </header>

      {error && (
        <Surface level="surface" className="v04-study-home-error" role="alert">
          <p>{error}</p>
        </Surface>
      )}

      {/*
        Resume is the visual primary. The audit Step 2
        verdict was that the old "Continue" was a
        dead-end when there were no open questions;
        the WP-11R2 surface now falls back to the
        most recent lecture.
      */}
      {/* With no courses there is nothing to resume: the Courses empty
          state below carries the single call to action instead of two
          sections repeating "no courses yet". */}
      {(loading || courses.length > 0) && (
      <section className="v04-study-home-section v04-study-home-resume" aria-label="Resume" data-testid="v04-study-home-resume">
        <h2>Resume</h2>
        {loading && <p className="v04-study-home-empty">Loading…</p>}
        {!loading && (resumeQuestion || resumeLecture) && (
          <div className="v04-study-home-resume-actions" data-testid="v04-study-home-resume-actions">
            {resumeQuestion && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() =>
                  resumeCourseId
                    ? props.onResumeQuestion({
                        courseId: resumeCourseId,
                        lectureId: resumeQuestion.locator?.lectureId ?? '',
                        questionId: resumeQuestion.id,
                      })
                    : undefined
                }
                data-testid="v04-study-home-resume-question"
              >
                Continue last question
              </Button>
            )}
            {resumeLecture && resumeCourseId && (
              <Button
                type="button"
                variant={resumeQuestion ? 'secondary' : 'primary'}
                size="md"
                onClick={() =>
                  props.onResumeQuestion({
                    courseId: resumeCourseId,
                    lectureId: resumeLecture.id,
                    questionId: '',
                  })
                }
                data-testid="v04-study-home-resume-lecture"
              >
                Open most recent lecture
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={props.onOpenReview}
              disabled={openReviewCount === 0}
              data-testid="v04-study-home-review-button"
            >
              Open Review ({openReviewCount})
            </Button>
          </div>
        )}
        {!loading && recentQuestions.length > 0 && (
          <ul className="v04-study-home-question-list" data-testid="v04-study-home-question-list">
            {recentQuestions.slice(0, 3).map((q) => (
              <li key={q.id} className="v04-study-home-question">
                <button
                  type="button"
                  className="v04-study-home-question-button"
                  onClick={() =>
                    props.onResumeQuestion({
                      courseId: q.container?.id ?? '',
                      lectureId: q.locator?.lectureId ?? '',
                      questionId: q.id,
                    })
                  }
                  data-testid="v04-study-home-resume-question-row"
                >
                  <span className="v04-study-home-question-body">{q.body}</span>
                  {q.locator?.lectureId && (
                    <Pill tone="neutral" data-testid="v04-study-home-question-locator">
                      {q.locator.kind} · {q.locator.lectureId}
                    </Pill>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      <section className="v04-study-home-section" aria-label="Courses" data-testid="v04-study-home-courses">
        <div className="v04-study-home-section-header">
          <h2>Courses</h2>
          {!showNewCourse && courses.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowNewCourse(true);
                setNewCourseError(null);
              }}
              data-testid="v04-study-home-new-course"
            >
              New course
            </Button>
          )}
        </div>
        {showNewCourse && (
          <form
            className="v04-inline-form"
            role="dialog"
            aria-label="New course"
            onSubmit={handleCreateCourse}
            data-testid="v04-study-home-new-course-form"
          >
            <label htmlFor="v04-study-home-new-course-title" className="text-meta">Course name</label>
            <input
              id="v04-study-home-new-course-title"
              autoFocus
              value={newCourseTitle}
              onChange={(e) => setNewCourseTitle(e.target.value)}
              placeholder="e.g. Cognitive psychology"
              disabled={creatingCourse}
            />
            {newCourseError && <p role="alert">{newCourseError}</p>}
            <div className="v04-inline-form-actions">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!newCourseTitle.trim() || creatingCourse}
                data-testid="v04-study-home-new-course-submit"
              >
                {creatingCourse ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowNewCourse(false);
                  setNewCourseError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {courses.length === 0 && !loading && !showNewCourse && (
          <Surface level="sunken" className="v04-study-home-empty" data-testid="v04-study-home-empty-courses">
            <p>
              No courses yet. A course holds your lectures, notes and the questions you capture.
            </p>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                setShowNewCourse(true);
                setNewCourseError(null);
              }}
              data-testid="v04-study-home-new-course"
            >
              New course
            </Button>
          </Surface>
        )}
        {courses.length > 0 && (
          <ul className="v04-study-home-course-list" data-testid="v04-study-home-course-list">
            {courses.map((row) => (
              <li key={row.course.id}>
                <Surface level="surface" className="v04-study-home-course" data-testid="v04-study-home-course">
                  <div className="v04-study-home-course-info">
                    <button
                      type="button"
                      className="v04-study-home-course-title"
                      onClick={() => props.onOpenCourse(row.course.id)}
                      data-testid="v04-study-home-open-course"
                    >
                      {row.course.title}
                    </button>
                    <div className="v04-study-home-course-meta">
                      <Pill tone="neutral">
                        {row.lectureCount} lecture{row.lectureCount === 1 ? '' : 's'}
                      </Pill>
                      <Pill tone={row.recentQuestionCount > 0 ? 'primary' : 'neutral'}>
                        {row.recentQuestionCount} question{row.recentQuestionCount === 1 ? '' : 's'}
                      </Pill>
                    </div>
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
