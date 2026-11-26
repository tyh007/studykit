/**
 * StudyKit v0.5 — Research workbench routes (ADR-003 §3).
 *
 * The workbench URL encodes only the active editor:
 *
 *   #/research/workbench/<projectId>?open=<kind>:<id>
 *
 * Every pre-workbench project URL (project, library, reader, evidence,
 * output, design, task-detail, cognitive-canvas) maps to the editor it
 * showed, so old links and bookmarks keep working.
 */

import { isFeatureEnabled } from '../feature-flags';
import { makeAppLocation, type AppLocation, type ContainerRef } from '../../domain/workspace';
import type { EditorInput } from '../../features/workbench/workbenchState';

/** Research editor kinds registered in the workbench (P1). */
export type ResearchEditorKind =
  | 'overview'
  | 'library'
  | 'search'
  | 'work'
  | 'evidence'
  | 'output'
  | 'design'
  | 'task'
  | 'canvas';

const RESEARCH_EDITOR_KINDS: ReadonlySet<string> = new Set<ResearchEditorKind>([
  'overview', 'library', 'search', 'work', 'evidence', 'output', 'design', 'task', 'canvas',
]);

/** Project-scoped Research surfaces the workbench replaces. */
const WORKBENCH_SURFACES: ReadonlySet<AppLocation['surface']> = new Set<AppLocation['surface']>([
  'workbench', 'project', 'library', 'reader', 'evidence', 'output', 'design', 'task-detail', 'cognitive-canvas',
]);

export function isWorkbenchEnabled(): boolean {
  return isFeatureEnabled('v05Workbench') && isFeatureEnabled('v04Research');
}

/** True when `location` should render as the Research workbench. */
export function isWorkbenchLocation(location: AppLocation): boolean {
  return (
    isWorkbenchEnabled() &&
    location.mode === 'research' &&
    location.container?.kind === 'project' &&
    WORKBENCH_SURFACES.has(location.surface)
  );
}

function projectContainer(projectId: string): ContainerRef {
  return { workspaceId: null, mode: 'research', kind: 'project', id: projectId };
}

export function encodeOpenParam(input: EditorInput): string {
  return `${input.kind}:${input.id}`;
}

export function decodeOpenParam(value: string | undefined): EditorInput | null {
  if (!value) return null;
  const at = value.indexOf(':');
  if (at <= 0 || at === value.length - 1) return null;
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!RESEARCH_EDITOR_KINDS.has(kind)) return null;
  return { kind, id };
}

/** Location for the workbench of `projectId`, optionally focused on `input`. */
export function workbenchLocation(projectId: string, input?: EditorInput | null): AppLocation {
  return makeAppLocation({
    mode: 'research',
    surface: 'workbench',
    container: projectContainer(projectId),
    ...(input ? { params: { open: encodeOpenParam(input) } } : {}),
  });
}

/**
 * The editor a project-scoped location asks for, or null when it only
 * names the project (the workbench then restores its saved tabs).
 */
export function editorInputForLocation(location: AppLocation): EditorInput | null {
  const projectId = location.container?.id;
  if (!projectId || location.mode !== 'research') return null;
  const params = location.params ?? {};
  switch (location.surface) {
    case 'workbench':
      return decodeOpenParam(params.open);
    case 'project':
      return params.details === '1' ? { kind: 'overview', id: projectId, params: { details: '1' } } : null;
    case 'library':
      return params.view === 'search'
        ? { kind: 'search', id: projectId }
        : params.add === '1'
          ? { kind: 'library', id: projectId, params: { add: '1' } }
          : { kind: 'library', id: projectId };
    case 'reader':
      if (params.view === 'discovery') return { kind: 'search', id: projectId };
      return location.surfaceId ? { kind: 'work', id: location.surfaceId } : { kind: 'library', id: projectId };
    case 'evidence':
      return { kind: 'evidence', id: projectId };
    case 'output':
      return location.surfaceId ? { kind: 'output', id: location.surfaceId } : { kind: 'overview', id: projectId };
    case 'design':
      return {
        kind: 'design',
        id: projectId,
        ...(params.question ? { params: { question: params.question } } : {}),
      };
    case 'task-detail':
      return location.surfaceId ? { kind: 'task', id: location.surfaceId } : { kind: 'overview', id: projectId };
    case 'cognitive-canvas': {
      const canvasParams: Record<string, string> = {};
      if (params.evidence) canvasParams.evidence = params.evidence;
      if (params.claim) canvasParams.claim = params.claim;
      return {
        kind: 'canvas',
        id: location.surfaceId ?? `canvas-${projectId}`,
        ...(Object.keys(canvasParams).length > 0 ? { params: canvasParams } : {}),
      };
    }
    default:
      return null;
  }
}
