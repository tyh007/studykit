/**
 * StudyKit v0.4 — `app/v04/researchRouter` (composition root)
 *
 * A small surface that picks the right Research
 * component for the current `AppLocation`. Mounted
 * inside the v04 shell when the `v04Research` flag is
 * on; returns `null` when off so the v0.3 / WP-04
 * surface tree is unaffected.
 *
 * The router is *intentionally* minimal: it is a
 * one-file switch over the location's `surface`
 * field. Adding a new Research surface means
 * (a) add the `SurfaceKind` to `domain/workspace.ts`,
 * (b) add a `case` here. We do not reach for a real
 * router library — the location is a discriminated
 * union, and the surface tree is shallow.
 *
 * WP-06 Round 6 P0-2 + P0-3:
 *   - The cognitive-canvas branch reads from
 *     `useCanvasRuntime()` (the *single* source of
 *     truth for the cognitive canvas's use cases
 *     and repository). The router NEVER calls
 *     `createDexieCanvasRepository()` itself —
 *     doing so would create a parallel Dexie
 *     instance and silently lose live updates.
 *   - The `useCanvasRuntime()` call is unconditional
 *     (always at the top of the function, before any
 *     early return) so the Rules of Hooks are
 *     preserved across route transitions. The
 *     previous version called `useCanvasUseCases()`
 *     inside a conditional branch, which produced a
 *     "different number of hooks" warning when the
 *     user navigated from the evidence surface to
 *     the cognitive canvas.
 */

import React from 'react';
import { isFeatureEnabled } from '../feature-flags';
import { useLocation, locationStore } from './locationStore';
import { makeAppLocation, type ContainerRef } from '../../domain/workspace';
import { useCanvasRuntime } from './canvasWiringContext';
import type { CanvasObjectRef } from '../../domain/canvas';

const ResearchHome = React.lazy(() => import('../../features/research/ResearchHome').then((module) => ({ default: module.ResearchHome })));
const ProjectHome = React.lazy(() => import('../../features/research/ProjectHome').then((module) => ({ default: module.ProjectHome })));
const Discovery = React.lazy(() => import('../../features/research/Discovery').then((module) => ({ default: module.Discovery })));
const Library = React.lazy(() => import('../../features/research/Library').then((module) => ({ default: module.Library })));
const Sources = React.lazy(() => import('../../features/research/Sources').then((module) => ({ default: module.Sources })));
const EvidenceWorkspace = React.lazy(() => import('../../features/research/EvidenceWorkspace').then((module) => ({ default: module.EvidenceWorkspace })));
const ResearchReader = React.lazy(() => import('../../features/research/ResearchReader').then((module) => ({ default: module.ResearchReader })));
const DesignWorkspace = React.lazy(() => import('../../features/research/DesignWorkspace').then((module) => ({ default: module.DesignWorkspace })));
const TaskDetail = React.lazy(() => import('../../features/research/TaskDetail').then((module) => ({ default: module.TaskDetail })));
const OutputWorkspace = React.lazy(() => import('../../features/research/OutputWorkspace').then((module) => ({ default: module.OutputWorkspace })));
const CognitiveCanvasView = React.lazy(() => import('../../features/canvas/CognitiveCanvasView').then((module) => ({ default: module.CognitiveCanvasView })));

export function ResearchRouter(): React.ReactElement | null {
  // ============================================================
  // Hooks — every one of these runs on every render,
  // regardless of the flag or location state. The flag
  // and location are only consulted *after* the hook
  // set, in the early-return branches below. This keeps
  // the hook order stable across route transitions.
  // ============================================================
  const flagOn = isFeatureEnabled('v04Research');
  const location = useLocation();
  // P0-3: this hook is called *unconditionally* at
  // the top of the function. The previous shape
  // called `useCanvasUseCases()` inside the
  // `cognitive-canvas` branch only, which is a
  // Rules of Hooks violation when the route changes.
  const canvasRuntime = useCanvasRuntime();

  if (!flagOn) return null;
  if (location.mode !== 'research') return null;

  if (location.surface === 'research-home') {
    return (
      <ResearchHome
        initialAddOpen={location.params?.add === '1'}
        onOpenProject={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'project', container }),
          );
        }}
      />
    );
  }

  if (location.surface === 'project' && location.container) {
    return (
      <ProjectHome
        projectId={location.container.id}
        initialDetailsOpen={(location.params ?? {})['details'] === '1'}
        onOpenDiscovery={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'reader', container, params: { view: 'discovery' } }),
          );
        }}
        onOpenLibrary={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'library', container }),
          );
        }}
        onOpenEvidence={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'evidence', container }),
          );
        }}
        onOpenCanvas={(projectId) => {
          const container: ContainerRef = { workspaceId: null, mode: 'research', kind: 'project', id: projectId };
          locationStore.push(makeAppLocation({ mode: 'research', surface: 'cognitive-canvas', container }));
        }}
        onOpenReader={(input) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: input.projectId,
          };
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'reader',
              container,
              surfaceId: input.workId,
            }),
          );
        }}
        onOpenDesign={(input) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: input.projectId,
          };
          // The optional `questionId` is forwarded as a
          // URL param so `DesignWorkspace` can preserve
          // the link when it calls `createDesignSpec`.
          // The router only stores strings in `params`,
          // so an absent id becomes `params = {}`.
          const params: Record<string, string> = {};
          if (input.questionId) params.question = input.questionId;
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'design',
              container,
              params: Object.keys(params).length === 0 ? undefined : params,
            }),
          );
        }}
        onOpenTask={(input) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: input.projectId,
          };
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'task-detail',
              container,
              surfaceId: input.taskId,
            }),
          );
        }}
        // WP-10 Round 1: open an existing Output.
        onOpenOutput={(input) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: input.projectId,
          };
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'output',
              container,
              surfaceId: input.outputId,
            }),
          );
        }}
      />
    );
  }

  if (location.surface === 'design' && location.container) {
    // The optional `params.question` carries the
    // Research Question id the workspace should
    // anchor the initial DesignSpec to. The router
    // surfaces it as a string; the workspace
    // validates it before calling `createDesignSpec`.
    const questionId = (location.params?.question ?? '').trim();
    return (
      <DesignWorkspace
        projectId={location.container.id}
        {...(questionId ? { questionId } : {})}
        onBackToProject={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'project', container }),
          );
        }}
      />
    );
  }

  if (location.surface === 'task-detail' && location.container) {
    const taskId = location.surfaceId;
    if (!taskId) return null;
    return (
      <TaskDetail
        projectId={location.container.id}
        taskId={taskId}
        onBackToProject={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'project', container }),
          );
        }}
        onOpenQuestion={({ projectId }) => {
          // WP-07 ships a Questions surface as a future
          // packet; for now the deep link returns to the
          // design workspace so the user can keep moving.
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'design', container }),
          );
        }}
        onOpenDecision={({ projectId }) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'design', container }),
          );
        }}
      />
    );
  }

  if (location.surface === 'library' && location.container) {
    // WP-11R2: the user-facing "Sources" surface
    // merges Library + Discovery into a single
    // destination with sub-states. The legacy
    // `<Library>` component is still rendered inside
    // the `<Sources>` wrapper, so the data and
    // behaviour are byte-for-byte unchanged — only
    // the chrome is new.
    const view = (location.params ?? {})['view'] === 'search' ? 'search' : 'library';
    return (
      <Sources
        projectId={location.container.id}
        initialView={view}
        initialAdd={(location.params ?? {})['add'] === '1'}
        onOpenReader={(input) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: input.projectId,
          };
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'reader',
              container,
              surfaceId: input.workId,
            }),
          );
        }}
        onBackToProject={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'project', container }),
          );
        }}
      />
    );
  }

  if (location.surface === 'reader' && location.container) {
    // The reader surface is dual-purpose: when the
    // `params.view` is `discovery`, render the
    // Discovery modal; otherwise render the actual
    // `ResearchReader` for the `surfaceId` Work.
    const view = (location.params ?? {})['view'];
    if (view === 'discovery') {
      return (
        <Discovery
          projectId={location.container.id}
          onClose={(projectId) => {
            const container: ContainerRef = {
              workspaceId: null,
              mode: 'research',
              kind: 'project',
              id: projectId,
            };
            locationStore.push(
              makeAppLocation({ mode: 'research', surface: 'project', container }),
            );
          }}
          onOpenLibrary={(projectId) => {
            const container: ContainerRef = {
              workspaceId: null,
              mode: 'research',
              kind: 'project',
              id: projectId,
            };
            locationStore.push(
              makeAppLocation({ mode: 'research', surface: 'library', container }),
            );
          }}
        />
      );
    }
    if (location.surfaceId) {
      return (
        <ResearchReader
          projectId={location.container.id}
          workId={location.surfaceId}
          onBackToLibrary={(projectId) => {
            const container: ContainerRef = {
              workspaceId: null,
              mode: 'research',
              kind: 'project',
              id: projectId,
            };
            locationStore.push(
              makeAppLocation({ mode: 'research', surface: 'library', container }),
            );
          }}
          onOpenEvidence={(projectId) => {
            const container: ContainerRef = {
              workspaceId: null,
              mode: 'research',
              kind: 'project',
              id: projectId,
            };
            locationStore.push(
              makeAppLocation({ mode: 'research', surface: 'evidence', container }),
            );
          }}
        />
      );
    }
  }

  if (location.surface === 'evidence' && location.container) {
    return (
      <EvidenceWorkspace
        projectId={location.container.id}
        onBackToProject={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'project', container }),
          );
        }}
        onOpenLibrary={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          // WP-11R2: the empty Evidence state sends the
          // user to the Sources surface (which renders
          // the Library list + the unified Add panel).
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'library',
              container,
              params: { view: 'library' },
            }),
          );
        }}
        onOpenWork={(input) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: input.projectId,
          };
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'reader',
              container,
              surfaceId: input.workId,
            }),
          );
        }}
        cognitiveCanvasAvailable={Boolean(canvasRuntime)}
        onOpenCanvas={({ projectId, evidenceIds, claimIds }) => {
          const viewId = `canvas-${projectId}`;
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          // Persist the selection as URL-safe params
          // (the `AppLocation` `params` field is string-only).
          const params: Record<string, string> = {};
          if (evidenceIds.length > 0) params.evidence = evidenceIds.join(',');
          if (claimIds.length > 0) params.claim = claimIds.join(',');
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'cognitive-canvas',
              container,
              surfaceId: viewId,
              params,
            }),
          );
        }}
      />
    );
  }

  if (location.surface === 'output' && location.container) {
    // WP-10 Round 1: Evidence-backed Output workspace.
    // The `outputId` rides on `location.surfaceId`;
    // navigating back to the project just pushes the
    // `project` surface (the same call shape as the
    // design / task-detail branches above).
    const outputId = location.surfaceId ?? '';
    return (
      <OutputWorkspace
        projectId={location.container.id}
        outputId={outputId}
        onBackToProject={(projectId) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'project', container }),
          );
        }}
        onJumpToEvidence={({ projectId, evidenceId }) => {
          // Open the Evidence workspace with the
          // Evidence selected. The router does not
          // yet pass the Evidence id down (Round 2
          // wiring); the workspace reads from the
          // snapshot.
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'evidence', container }),
          );
          void evidenceId;
        }}
        onJumpToClaim={({ projectId }) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({ mode: 'research', surface: 'evidence', container }),
          );
        }}
        onOpenReader={({ projectId, workId }) => {
          const container: ContainerRef = {
            workspaceId: null,
            mode: 'research',
            kind: 'project',
            id: projectId,
          };
          locationStore.push(
            makeAppLocation({
              mode: 'research',
              surface: 'reader',
              container,
              surfaceId: workId,
            }),
          );
        }}
      />
    );
  }

  if (location.surface === 'cognitive-canvas' && location.container) {
    // WP-06 Cognitive Canvas. Mounted only when
    // `v04Canvas` is on. The `CanvasUseCasesProvider`
    // (mounted in `V04Shell`) builds the *single*
    // `CanvasRuntime { useCases, repository }` value
    // object; this router reads it via the
    // `useCanvasRuntime()` hook — and NEVER calls
    // `createDexieCanvasRepository()` itself.
    if (!isFeatureEnabled('v04Canvas')) {
      return null;
    }
    if (!canvasRuntime) {
      return (
        <div
          role="status"
          aria-live="polite"
          data-testid="cognitive-canvas-unavailable"
          style={{ padding: '1rem' }}
        >
          Cognitive canvas is unavailable: the research + study repositories are not wired in this shell.
        </div>
      );
    }
    const viewId = location.surfaceId ?? `canvas-${location.container.id}`;
    const projectId = location.container.id;
    const evidenceIds = (location.params?.evidence ?? '').split(',').filter(Boolean);
    const claimIds = (location.params?.claim ?? '').split(',').filter(Boolean);
    const initialRefs: CanvasObjectRef[] = [
      ...evidenceIds.map((id) => ({ kind: 'knowledge' as const, id, objectKind: 'evidence' as const })),
      ...claimIds.map((id) => ({ kind: 'knowledge' as const, id, objectKind: 'claim' as const })),
    ];
    return (
      <CognitiveCanvasView
        viewId={viewId}
        useCases={canvasRuntime.useCases}
        repository={canvasRuntime.repository}
        initialRefs={initialRefs}
      />
    );
  }

  return null;
}
