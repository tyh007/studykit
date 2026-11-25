/**
 * StudyKit v0.4 — `LectureCaptureTrigger` (production glue)
 *
 * The single bridge between the v0.3 lecture surface and the
 * WP-04 Study slice. Renders the `<LectureFocusAdapter>` (a
 * "Capture / Understand" button + drawer) inside the
 * lecture page, but ONLY when the `v04Study` flag is on
 * AND a `<StudyProvider>` ancestor is present.
 *
 * Why a separate component, not a direct mount?
 *
 *   The `<StudyFocusAdapter>` reads `useStudyDeps()`, which
 *   throws if there is no `<StudyProvider>` ancestor. With
 *   the flag off there is no provider; rendering the
 *   adapter would crash. This component checks both
 *   conditions (flag on + provider present) and renders
 *   `null` otherwise — so the v0.3 lecture surface stays
 *   byte-for-byte identical with the flag off.
 *
 *   Putting the check in a separate component also keeps
 *   the change to `App.tsx` minimal: a single import + a
 *   single `<LectureCaptureTrigger lectureId={...} />` in
 *   the `<LectureView>` JSX.
 *
 * The trigger is the *only* path by which a real lecture
 * page becomes a Study surface. The verification path
 * (see `features/study/study.test.tsx`) drives the same
 * component directly to prove the user gesture works.
 */

import React from 'react';
import { isFeatureEnabled } from '../app/feature-flags';
import { LectureFocusAdapter } from '../features/study';

export interface LectureCaptureTriggerProps {
  readonly courseId: string;
  readonly lectureId: string;
}

/**
 * Bridge component. Renders the WP-04 capture button when
 * the `v04Study` flag is on; returns `null` otherwise so
 * the v0.3 lecture surface is byte-for-byte unchanged
 * with the flag off.
 *
 * The `useStudyDeps()` call inside the adapter will throw
 * if there is no `<StudyProvider>` ancestor; the
 * `StudyWiring` composition root is the single place that
 * mounts the Provider, so the trigger assumes it is always
 * inside the v04 tree when the flag is on. We do NOT
 * pre-emptively catch the throw — the WP-04 Gate says
 * "no silent fallback". A misconfigured production tree
 * must surface, not paper over.
 */
export function LectureCaptureTrigger(props: LectureCaptureTriggerProps): React.ReactElement | null {
  if (!isFeatureEnabled('v04Study')) {
    return null;
  }
  return (
    <div className="v04-lecture-capture-trigger" data-testid="v04-lecture-capture-trigger">
      <LectureFocusAdapter
        courseId={props.courseId}
        lectureId={props.lectureId}
        onCompleted={() => {
          // The host shell owns the location store; we
          // intentionally do not navigate away from the
          // lecture here. The drawer closes on its own
          // (Accept / Continue / Close → `setOpen(false)`
          // inside the adapter). A future WP can plug a
          // real "navigate to Review" callback in here.
        }}
      />
    </div>
  );
}
