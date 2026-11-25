/**
 * StudyKit v0.4 — `features/study/LectureFocusAdapter`
 *
 * Adapts the v0.3 Lecture Focus surface (PDF/Slide viewer +
 * NoteEditor) so the Study slice can:
 *
 *   - Render a "Capture / Understand" button next to the
 *     existing `OpenIntentCapsuleButton`. The button opens
 *     the `UnderstandDrawer` with the user's current
 *     selection (or, when there is no selection, the active
 *     paragraph in the NoteEditor).
 *   - Pass a `SourceLocator` derived from the lecture's
 *     active source document + the current page (or the
 *     selection). A `selection`-kind locator is used when
 *     there is no `active_source_document_id`.
 *   - Continue using the existing `NoteEditor` for free
 *     note capture. The adapter does NOT replace or
 *     rewrite the editor — it is a thin compatibility
 *     shim.
 *
 * Why an adapter, not a rewrite?
 *
 *   - The v0.3 NoteEditor is a 1,400-line TipTap surface
 *     with autosave, equation support, citation picker,
 *     image upload, and a debounced flush. A rewrite would
 *     cost a Packet of its own. The adapter layers the
 *     Study slice ON TOP without touching the editor.
 *   - Per WP-04 Gate "适配现有 Lecture/NoteEditor，不重写".
 *
 * Source boundary
 * ---------------
 *
 *   - All Study writes go through `useStudyDeps()`. The
 *     adapter does NOT import `lib/db` or `lib/api` for
 *     Study operations; it only reads the lecture / source
 *     / page through the existing `useStore` (the v0.3
 *     store) which is the public source of truth for the
 *     active document.
 */

import React from 'react';
import { useStore } from '../../store/useStore';
import { UnderstandDrawer } from './UnderstandDrawer';
import { useStudyDeps } from './studyContext';
import type { ContainerRef } from '../../domain/workspace';
import type { SourceLocator } from '../../domain/study';
import { nowIso } from '../../domain/study';

export interface LectureFocusAdapterProps {
  readonly courseId: string;
  readonly lectureId: string;
  /** When the user Accepts / Continues, the host may close the drawer. */
  readonly onCompleted?: (input: { questionId: string; feedbackId?: string }) => void;
}

interface SelectionState {
  readonly text: string;
  readonly locator: SourceLocator | null;
}

function useActiveSelection(): SelectionState {
  const lecture = useStore((s) => s.lectures.find((l) => l.id === s.selectedLectureId));
  const document_ = useStore((s) => s.currentDocument);
  const page = useStore((s) => s.currentPages[s.selectedPageIndex]);
  // The NoteEditor does not currently expose its text
  // selection through a stable channel; we use a
  // `selectionchange` listener scoped to the document so
  // the drawer always sees the latest text + the
  // corresponding locator.
  const [text, setText] = React.useState('');
  React.useEffect(() => {
    const onSel = (): void => {
      const sel = window.getSelection();
      const t = sel ? sel.toString() : '';
      setText(t);
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
    };
  }, []);
  const locator: SourceLocator | null = React.useMemo(() => {
    if (!lecture) return null;
    if (document_ && page) {
      return {
        kind: 'page',
        lectureId: lecture.id,
        sourceDocumentId: document_.id,
        pageNumber: page.page_number,
        excerpt: text.length > 0 ? text.slice(0, 240) : undefined,
        capturedAt: nowIso(),
      };
    }
    if (text.length > 0) {
      return {
        kind: 'selection',
        lectureId: lecture.id,
        excerpt: text.slice(0, 240),
        capturedAt: nowIso(),
      };
    }
    return {
      kind: 'paragraph',
      lectureId: lecture.id,
      paragraphIndex: 0,
      capturedAt: nowIso(),
    };
  }, [lecture, document_, page, text]);
  return { text, locator };
}

export function LectureFocusAdapter(props: LectureFocusAdapterProps): React.ReactElement | null {
  const deps = useStudyDeps();
  const [open, setOpen] = React.useState(false);
  const sel = useActiveSelection();
  const container: ContainerRef = React.useMemo(
    () => ({
      workspaceId: null,
      mode: 'study',
      kind: 'course',
      id: props.courseId,
    }),
    [props.courseId],
  );

  // When the user opens the drawer after a reload, the
  // most recent `draft-input` recovery entry for this
  // (container, lecture) is pre-loaded into the attempt
  // field. The actual restore happens inside the
  // `UnderstandDrawer`; we just hand the entry through.
  const [initialPrompt, setInitialPrompt] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const entries = await deps.repository.listRecentRecovery(props.courseId, props.lectureId);
      if (cancelled) return;
      const draftInput = entries.find((e) => e.key === 'draft-input');
      if (draftInput) setInitialPrompt(draftInput.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, props.courseId, props.lectureId, deps.repository]);

  return (
    <div className="v04-lecture-focus-adapter" data-testid="v04-lecture-focus-adapter">
      <div className="v04-lecture-focus-cta">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOpen(true)}
          data-testid="v04-lecture-focus-open-understand"
        >
          Capture / Understand
        </button>
      </div>
      {open && (
        <UnderstandDrawer
          courseId={props.courseId}
          lectureId={props.lectureId}
          locator={sel.locator}
          selectionText={sel.text}
          container={container}
          onCompleted={(out) => {
            setOpen(false);
            setInitialPrompt(undefined);
            props.onCompleted?.(out);
          }}
          onClose={() => {
            setOpen(false);
            setInitialPrompt(undefined);
          }}
          {...(initialPrompt !== undefined ? { initialPrompt } : {})}
        />
      )}
    </div>
  );
}
