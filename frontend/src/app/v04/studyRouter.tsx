/**
 * StudyKit v0.4 — `app/v04/studyRouter` (composition root)
 *
 * A small surface that picks the right Study component for
 * the current `AppLocation`. Mounted inside the v04 shell
 * when the `v04Study` flag is on; returns `null` when off so
 * the legacy Study (v0.3) is unaffected.
 *
 * The router is *intentionally* minimal: it is a one-file
 * switch over the location's `surface` field. Adding a new
 * Study surface means (a) add the `SurfaceKind` to
 * `domain/workspace.ts`, (b) add a `case` here. We do not
 * reach for a real router library — the location is a
 * discriminated union, and the surface tree is shallow.
 */

import React from 'react';
import { isFeatureEnabled } from '../feature-flags';
import { useLocation, locationStore } from './locationStore';
import { makeAppLocation } from '../../domain/workspace';
import type { ContainerRef } from '../../domain/workspace';
import { useStore } from '../../store/useStore';
import { useCanvasRuntime } from './canvasWiringContext';

const StudyHome = React.lazy(() => import('../../features/study/StudyHome').then((module) => ({ default: module.StudyHome })));
const CourseHome = React.lazy(() => import('../../features/study/CourseHome').then((module) => ({ default: module.CourseHome })));
const ReviewWorkspace = React.lazy(() => import('../../features/study/ReviewWorkspace').then((module) => ({ default: module.ReviewWorkspace })));
const CognitiveCanvasView = React.lazy(() => import('../../features/canvas/CognitiveCanvasView').then((module) => ({ default: module.CognitiveCanvasView })));

function openLecture(courseId: string, lectureId: string, questionId?: string): void {
  // Lecture Focus is the only remaining v0.3 leaf. Keep its narrow
  // selection contract in sync before changing the canonical location.
  const legacyStore = useStore.getState();
  legacyStore.selectModule(courseId);
  legacyStore.selectLecture(lectureId);

  const container: ContainerRef = {
    workspaceId: null,
    mode: 'study',
    kind: 'course',
    id: courseId,
  };
  locationStore.push(
    makeAppLocation({
      mode: 'study',
      surface: 'lecture',
      container,
      surfaceId: lectureId,
      ...(questionId ? { params: { questionId } } : {}),
    }),
  );
}

export function StudyRouter(): React.ReactElement | null {
  const flagOn = isFeatureEnabled('v04Study');
  const location = useLocation();
  const canvasRuntime = useCanvasRuntime();
  if (!flagOn) return null;
  if (location.mode !== 'study') return null;

  // study-home (no container) — top-level Study Home.
  if (location.surface === 'study-home') {
    return (
      <StudyHome
        initialAddOpen={location.params?.add === '1'}
        onOpenCourse={(courseId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'study',
            kind: 'course',
            id: courseId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'study', surface: 'course', container }),
          );
        }}
        onResumeQuestion={(input) => {
          openLecture(input.courseId, input.lectureId, input.questionId);
        }}
        onOpenReview={() => {
          locationStore.push(makeAppLocation({ mode: 'study', surface: 'review' }));
        }}
      />
    );
  }

  // course (container required) — Course Home.
  if (location.surface === 'course' && location.container) {
    return (
      <CourseHome
        courseId={location.container.id}
        initialAddOpen={location.params?.add === '1'}
        onOpenLecture={(input) => {
          openLecture(input.courseId, input.lectureId, input.questionId);
        }}
        onOpenReview={() => {
          const initial = location.container;
          if (!initial) {
            locationStore.push(makeAppLocation({ mode: 'study', surface: 'review' }));
            return;
          }
          const params: Record<string, string> = { containerId: initial.id };
          locationStore.push(
            makeAppLocation({ mode: 'study', surface: 'review', params }),
          );
        }}
      />
    );
  }

  // review (Review workspace) — optionally pre-select a
  // course / question from the URL params.
  if (location.surface === 'review') {
    const params = location.params ?? {};
    return (
      <ReviewWorkspace
        {...(params['containerId'] ? { initialContainerId: params['containerId'] } : {})}
        {...(params['questionId'] ? { initialQuestionId: params['questionId'] } : {})}
        onOpenLecture={(input) => {
          openLecture(input.courseId, input.lectureId, input.questionId);
        }}
        onExit={() => {
          locationStore.push(makeAppLocation({ mode: 'study', surface: 'study-home' }));
        }}
      />
    );
  }

  if (location.surface === 'study-canvas' && location.container) {
    if (!isFeatureEnabled('v04Canvas')) return null;
    if (!canvasRuntime) {
      return <p role="status" data-testid="cognitive-canvas-unavailable">Cognitive canvas is unavailable in this workspace.</p>;
    }
    return (
      <CognitiveCanvasView
        viewId={location.surfaceId ?? `canvas-${location.container.id}`}
        useCases={canvasRuntime.useCases}
        repository={canvasRuntime.repository}
      />
    );
  }

  return null;
}
