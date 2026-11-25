/**
 * StudyKit v0.4 — `features/study/CourseHome` (WP-11R2)
 *
 * Course-scoped landing surface. WP-11R2 fixes the
 * audit Step 3 "Lecture dead-end": when the course
 * has no lectures, the page now shows three start
 * actions that are *all* one click away:
 *
 *   1. **New lecture** — minimal title input, then
 *      push to the lecture surface. The lecture is
 *      created via `getDataApi().lectures.create` (the
 *      same gateway the `create-free-note-draft`
 *      Intent Capsule noteWriter uses; we are not
 *      adding a second writer).
 *   2. **Import slides or PDF** — reuses the legacy
 *      upload path. If the upload is lecture-scoped
 *      (the v0.3 contract requires a lecture before
 *      a `SourceDocument` can be attached), we first
 *      create a blank lecture with a sensible default
 *      title, then open the file picker.
 *   3. **Start blank notes** — create a blank
 *      lecture, push to the lecture surface; the
 *      existing v0.3 Lecture Focus then takes over
 *      the focus. No source required.
 *
 * The page is otherwise unchanged: the "Unresolved
 * questions" + "Lectures" sections still render
 * once there is data. The review affordance is still
 * conditional on `unresolved.length > 0`.
 */
import React from 'react';
import { importStudyPdf } from '../../application/study/importStudyPdf';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { Surface } from '../../shared/ui/Surface';
import { Pill } from '../../shared/ui/Pill';
import { useStudyDeps } from './studyContext';
import { getDataApi, sourceDocumentsApi, useSupports } from '../../application/dataApi';
import type { Module, Lecture } from '../../types';
import type { StudyQuestion } from '../../domain/study';

export interface CourseHomeProps {
  readonly courseId: string;
  readonly initialAddOpen?: boolean;
  /** The host's "open this lecture" callback. */
  readonly onOpenLecture: (input: { courseId: string; lectureId: string; questionId?: string }) => void;
  /** Open the Review workspace. */
  readonly onOpenReview: () => void;
}

export function CourseHome(props: CourseHomeProps): React.ReactElement {
  const deps = useStudyDeps();
  const [course, setCourse] = React.useState<Module | null>(null);
  const [lectures, setLectures] = React.useState<readonly Lecture[]>([]);
  const [questions, setQuestions] = React.useState<readonly StudyQuestion[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [newLectureTitle, setNewLectureTitle] = React.useState('');
  const [creatingLecture, setCreatingLecture] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(props.initialAddOpen ?? false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const canImportSource = useSupports('sourceDocuments.upload');
  const canImportMaterial = canImportSource || Boolean(deps.sourceAssets);

  React.useEffect(() => {
    if (props.initialAddOpen) setShowAdd(true);
  }, [props.initialAddOpen]);

  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const dataApi = getDataApi();
      const mods = await dataApi.modules.list();
      const c = mods.find((m) => m.id === props.courseId) ?? null;
      setCourse(c);
      const ls = c ? await dataApi.lectures.list(c.id) : [];
      setLectures(ls);
      const qs = await deps.repository.listQuestions({ containerId: props.courseId });
      setQuestions(qs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load course.');
    } finally {
      setLoading(false);
    }
  }, [deps.repository, props.courseId]);

  React.useEffect(() => {
    void reload();
    const unsub = deps.repository.subscribe(() => {
      void reload();
    });
    return () => {
      unsub();
    };
  }, [reload, deps.repository]);

  const unresolved = questions.filter(
    (q) => q.review !== 'understood' && q.status !== 'reviewed',
  );

  /**
   * The three start actions. They all share the same
   * "create a Lecture first, then act" shape — the
   * difference is the source (typed title / imported
   * file / nothing).
   */
  const createBlankLectureAndOpen = async (
    input: { title: string },
  ): Promise<{ id: string; title: string } | null> => {
    const title = input.title.trim();
    if (!title) return null;
    setCreatingLecture(true);
    setStartError(null);
    try {
      const dataApi = getDataApi();
      const lecture = await dataApi.lectures.create({
        module_id: props.courseId,
        title,
      });
      // Optimistic reload so the new lecture appears
      // in the list when the user returns.
      await reload();
      props.onOpenLecture({ courseId: props.courseId, lectureId: lecture.id });
      return { id: lecture.id, title: lecture.title };
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Could not create lecture.');
      return null;
    } finally {
      setCreatingLecture(false);
    }
  };

  const handleCreateLecture = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const created = await createBlankLectureAndOpen({ title: newLectureTitle });
    if (created) setNewLectureTitle('');
  };

  const handleStartBlankNotes = async (): Promise<void> => {
    const today = new Date();
    const stamp = today.toISOString().slice(0, 10);
    await createBlankLectureAndOpen({ title: `Blank notes · ${stamp}` });
  };

  const handleImportClick = async (): Promise<void> => {
    setStartError(null);
    if (deps.sourceAssets) {
      setCreatingLecture(true);
      try {
        const result = await importStudyPdf(deps.sourceAssets, { courseId: props.courseId });
        if (!result) return;
        await reload();
        props.onOpenLecture({ courseId: props.courseId, lectureId: result.lecture.id });
      } catch (err) {
        setStartError(err instanceof Error ? err.message : 'Could not import this PDF.');
      } finally {
        setCreatingLecture(false);
      }
      return;
    }
    if (!canImportSource) {
      setStartError('Material import is not available in this workspace yet. Start blank notes now, or use a sync workspace for slide/PDF import.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setCreatingLecture(true);
    setStartError(null);
    try {
      const title = file.name.replace(/\.(pdf|pptx?|key)$/i, '').trim() || `Imported · ${new Date().toISOString().slice(0, 10)}`;
      const lecture = await getDataApi().lectures.create({ module_id: props.courseId, title });
      await sourceDocumentsApi.upload(lecture.id, file);
      await reload();
      props.onOpenLecture({ courseId: props.courseId, lectureId: lecture.id });
    } catch (err) {
      await reload();
      setStartError(err instanceof Error ? err.message : 'Could not import this material.');
    } finally {
      setCreatingLecture(false);
    }
  };

  return (
    <div className="v04-course-home" data-testid="v04-course-home">
      {loading && <p className="v04-course-home-empty">Loading…</p>}
      {error && (
        <Surface level="surface" role="alert" className="v04-course-home-error">
          <p>{error}</p>
        </Surface>
      )}
      {!loading && !course && (
        <Surface level="sunken" className="v04-course-home-empty" data-testid="v04-course-home-missing">
          <p>This course is not available. It may have been deleted or moved.</p>
        </Surface>
      )}
      {course && (
        <>
          <header className="v04-course-home-header">
            <h1>{course.title}</h1>
            <p className="v04-course-home-lede">
              Resume a lecture, capture the next question, or jump to the open questions
              from this course.
            </p>
          </header>

          {/*
            Empty-course start actions. The audit Step 3
            verdict was "create one from the main sidebar"
            but the sidebar only had New course, not New
            lecture. The three actions below close the
            dead-end.
          */}
          {(lectures.length === 0 || showAdd) && (
            <section
              className="v04-course-home-section v04-course-home-start"
              aria-label="Start this course"
              data-testid="v04-course-home-start"
            >
              <div className="v04-course-home-section-header">
                <h2>{lectures.length === 0 ? 'Start this course' : 'Add to this course'}</h2>
                {lectures.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Close</Button>
                ) : null}
              </div>
              <div className="v04-course-home-start-actions" data-testid="v04-course-home-start-actions">
                <form
                  className="v04-course-home-start-action"
                  onSubmit={handleCreateLecture}
                  data-testid="v04-course-home-new-lecture-form"
                >
                  <label htmlFor="v04-new-lecture-title" className="text-meta">New lecture</label>
                  <Input
                    id="v04-new-lecture-title"
                    value={newLectureTitle}
                    onChange={(e) => setNewLectureTitle(e.currentTarget.value)}
                    placeholder="e.g. Lecture 1 — Memory models"
                    disabled={creatingLecture}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={creatingLecture || !newLectureTitle.trim()}
                    data-testid="v04-course-home-new-lecture-submit"
                  >
                    {creatingLecture ? 'Creating…' : 'Create lecture'}
                  </Button>
                </form>
                <div className="v04-course-home-start-action" data-testid="v04-course-home-import-action">
                  <label className="text-meta">{deps.sourceAssets ? 'Import PDF' : 'Import slides or PDF'}</label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleImportClick()}
                    disabled={creatingLecture}
                    data-testid="v04-course-home-import-button"
                    aria-describedby={!canImportMaterial ? 'v04-course-home-import-note' : undefined}
                  >
                    Choose file
                  </Button>
                  {!canImportMaterial ? (
                    <small id="v04-course-home-import-note" className="text-muted">Available in a sync workspace; blank notes remain local.</small>
                  ) : null}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    onChange={(event) => void handleFileSelected(event)}
                    style={{ display: 'none' }}
                    data-testid="v04-course-home-import-input"
                  />
                </div>
                <div className="v04-course-home-start-action" data-testid="v04-course-home-blank-action">
                  <label className="text-meta">Start blank notes</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleStartBlankNotes()}
                    disabled={creatingLecture}
                    data-testid="v04-course-home-blank-button"
                  >
                    Open blank lecture
                  </Button>
                </div>
              </div>
              {startError && (
                <p role="alert" className="v04-course-home-start-error">
                  {startError}
                </p>
              )}
            </section>
          )}

          <section className="v04-course-home-section" aria-label="Unresolved questions">
            <div className="v04-course-home-section-header">
              <h2>Unresolved questions</h2>
              <Button
                type="button"
                size="sm"
                onClick={props.onOpenReview}
                disabled={unresolved.length === 0}
                data-testid="v04-course-home-review-button"
              >
                Open Review ({unresolved.length})
              </Button>
            </div>
            {unresolved.length === 0 && (
              <Surface level="sunken" className="v04-course-home-empty" data-testid="v04-course-home-no-questions">
                <p>
                  No open questions for this course. As you capture questions in lecture
                  they will appear here.
                </p>
              </Surface>
            )}
            {unresolved.length > 0 && (
              <ul className="v04-course-home-question-list" data-testid="v04-course-home-question-list">
                {unresolved.slice(0, 5).map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      className="v04-course-home-question-button"
                      onClick={() =>
                        props.onOpenLecture({
                          courseId: props.courseId,
                          lectureId: q.locator?.lectureId ?? '',
                          questionId: q.id,
                        })
                      }
                      data-testid="v04-course-home-question"
                    >
                      <span className="v04-course-home-question-body">{q.body}</span>
                      <Pill tone="neutral">{q.status}</Pill>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="v04-course-home-section" aria-label="Lectures">
            <div className="v04-course-home-section-header">
              <h2>Lectures</h2>
              {lectures.length > 0 && !showAdd ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(true)} data-testid="v04-course-home-add-toggle">
                  Add
                </Button>
              ) : null}
            </div>
            {lectures.length === 0 && (
              <Surface level="sunken" className="v04-course-home-empty" data-testid="v04-course-home-no-lectures">
                <p>No lectures yet. Pick one of the three start actions above to add the first one.</p>
              </Surface>
            )}
            {lectures.length > 0 && (
              <ul className="v04-course-home-lecture-list" data-testid="v04-course-home-lecture-list">
                {lectures.map((l, index) => (
                  <li key={l.id}>
                    <Surface level="surface" className="v04-course-home-lecture" data-testid="v04-course-home-lecture">
                      <button
                        type="button"
                        className="v04-course-home-lecture-button"
                        onClick={() => props.onOpenLecture({ courseId: props.courseId, lectureId: l.id })}
                        data-testid="v04-course-home-open-lecture"
                      >
                        <span className="v04-course-home-lecture-title">{index === 0 ? `Resume · ${l.title}` : l.title}</span>
                        {l.lecture_date && (
                          <Pill tone="neutral">{l.lecture_date}</Pill>
                        )}
                      </button>
                    </Surface>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
