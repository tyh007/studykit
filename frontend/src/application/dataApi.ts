/**
 * StudyKit v0.4 — `application/dataApi` (converged)
 *
 * Single switch point between the v0.3 `/api` backend and the
 * local Dexie backend. Exposes BOTH a functional shape
 * (`dataApi.modules.list(...)`) AND legacy-compatible named
 * exports (`modulesApi`, `lecturesApi`,
 * `literatureProjectsApi`, `literaturePapersApi`) that route
 * through the same gateway.
 *
 * Components import from here; they never `if (local)` and
 * they never import from `lib/api` or `lib/literature-api`
 * directly. The gateway is the only place that knows which
 * backend is active.
 *
 * In a `local` workspace, any operation the local backend does
 * not support (paper metadata writes, reading lists, AI,
 * Zotero, sync, source document uploads, exports) throws a
 * `UnsupportedInLocalWorkspaceError` BEFORE the call can hit
 * the network. The error is rendered the same way as a
 * network error, so the user never silently loses data.
 *
 * Capability mapping (WP-02 Gate §3 blocker D — 5th round):
 *   - `wrapLocalUnsupported(capability, name, inner)` wraps
 *     every method of an API with the SAME capability gate.
 *   - `wrapLocalUnsupportedWithMap(capabilityMap, name, inner)`
 *     wraps each method with the capability named in the map.
 *     Used for the AI / Zotero APIs where some methods are
 *     read-only config (e.g. `profiles`) and others mutate
 *     (`chat`, `extract`). A missing key falls back to the
 *     default capability.
 */

import * as remoteApi from '../lib/api';
import * as remoteLitApi from '../lib/literature-api';
import * as remoteCanvasApi from '../lib/literature-canvas-api';
import {
  getDataApi,
  UnsupportedInLocalWorkspaceError,
  type DataApi,
  type Capability,
} from './dataGateway';
import { useDataApi } from './useDataApi';

export {
  getDataApi,
  setWorkspaceFlavour,
  getWorkspaceFlavour,
  __setWebPortForTests,
  __resetWebPortForTests,
  UnsupportedInLocalWorkspaceError,
  type DataApi,
  type Capability,
} from './dataGateway';
export { useDataApi } from './useDataApi';
// Re-export the hook for capability checks. `useSupports` uses
// the current workspace flavour; consumers don't have to
// import `useDataApi` themselves.

// ---------------------------------------------------------------------------
// Capability check helper. Use this from a top-level component
// to disable buttons that would otherwise call a sync-only
// method. Keeps the "is this local?" decision in the gateway.
// ---------------------------------------------------------------------------

export function useSupports(capability: Capability): boolean {
  const api = useDataApi();
  return api.supports(capability);
}

// ---------------------------------------------------------------------------
// Local-only guard.
// ---------------------------------------------------------------------------

function requireLocalSupports(api: DataApi, capability: Capability, op: string): void {
  if (!api.supports(capability)) {
    throw new UnsupportedInLocalWorkspaceError(
      op,
      'Sign in to a sync workspace to use this action.',
    );
  }
}

// ---------------------------------------------------------------------------
// Legacy-compatible named exports. Source-compatible with the
// v0.3 `lib/api` and `lib/literature-api` clients.
// ---------------------------------------------------------------------------

function getApi(): DataApi {
  return getDataApi();
}

export const modulesApi = {
  list: () => getApi().modules.list(),
  create: (data: { title: string; code?: string; academic_term?: string; colour?: string }) =>
    getApi().modules.create(data),
  update: (id: string, data: Record<string, unknown>) =>
    getApi().modules.update(id, data as never),
  delete: (id: string) => getApi().modules.delete(id),
  restore: (id: string) => {
    requireLocalSupports(getApi(), 'sync.push', 'modulesApi.restore');
    return remoteApi.modulesApi.restore(id);
  },
  permanentDelete: (id: string) => {
    requireLocalSupports(getApi(), 'sync.push', 'modulesApi.permanentDelete');
    return remoteApi.modulesApi.permanentDelete(id);
  },
};

export const lecturesApi = {
  list: (moduleId: string) => getApi().lectures.list(moduleId),
  create: (data: { module_id: string; title: string; lecture_date?: string; week_label?: string }) =>
    getApi().lectures.create(data),
  update: (id: string, data: Record<string, unknown>) =>
    getApi().lectures.update(id, data as never),
  delete: (id: string) => getApi().lectures.delete(id),
  restore: (id: string) => {
    requireLocalSupports(getApi(), 'sync.push', 'lecturesApi.restore');
    return remoteApi.lecturesApi.restore(id);
  },
  permanentDelete: (id: string) => {
    requireLocalSupports(getApi(), 'sync.push', 'lecturesApi.permanentDelete');
    return remoteApi.lecturesApi.permanentDelete(id);
  },
};

export const literatureProjectsApi = {
  list: () => getApi().literatureProjects.list(),
  create: (data: { name: string; description?: string }) =>
    getApi().literatureProjects.create(data),
  get: (id: string) => {
    // Reading a single project is a sync-only path; the
    // local list() already covers the local case.
    requireLocalSupports(getApi(), 'literatureProjects.crud', 'literatureProjectsApi.get');
    return remoteLitApi.literatureProjectsApi.get(id);
  },
  update: (id: string, data: { name?: string; description?: string }) =>
    getApi().literatureProjects.update(id, data as never),
  delete: (id: string) => getApi().literatureProjects.delete(id),
  restore: (id: string) => {
    requireLocalSupports(getApi(), 'sync.push', 'literatureProjectsApi.restore');
    return remoteLitApi.literatureProjectsApi.restore(id);
  },
};

export const literaturePapersApi = {
  list: (projectId: string, view?: 'library' | 'trash') =>
    getApi().literaturePapers.list(projectId, view),
  create: (paper: unknown) => {
    requireLocalSupports(getApi(), 'literaturePapers.crud', 'literaturePapersApi.create');
    return remoteLitApi.literaturePapersApi.create(paper as never);
  },
  get: (id: string) => {
    requireLocalSupports(getApi(), 'literaturePapers.crud', 'literaturePapersApi.get');
    return remoteLitApi.literaturePapersApi.get(id);
  },
  update: (id: string, updates: Record<string, unknown>) => {
    requireLocalSupports(getApi(), 'literaturePapers.crud', 'literaturePapersApi.update');
    return remoteLitApi.literaturePapersApi.update(id, updates);
  },
  delete: (id: string) => {
    requireLocalSupports(getApi(), 'literaturePapers.crud', 'literaturePapersApi.delete');
    return remoteLitApi.literaturePapersApi.delete(id);
  },
  moveToTrash: (id: string) => {
    requireLocalSupports(getApi(), 'literaturePapers.crud', 'literaturePapersApi.moveToTrash');
    return remoteLitApi.literaturePapersApi.moveToTrash(id);
  },
  restoreFromTrash: (id: string) => {
    requireLocalSupports(getApi(), 'literaturePapers.crud', 'literaturePapersApi.restoreFromTrash');
    return remoteLitApi.literaturePapersApi.restoreFromTrash(id);
  },
  listAnnotations: (paperId: string, page?: number) => {
    requireLocalSupports(getApi(), 'paperNotes.crud', 'literaturePapersApi.listAnnotations');
    return remoteLitApi.literaturePapersApi.listAnnotations(paperId, page);
  },
  createAnnotation: (paperId: string, data: unknown) => {
    requireLocalSupports(getApi(), 'paperNotes.crud', 'literaturePapersApi.createAnnotation');
    return remoteLitApi.literaturePapersApi.createAnnotation(paperId, data);
  },
  updateAnnotation: (annotationId: string, data: unknown) => {
    requireLocalSupports(getApi(), 'paperNotes.crud', 'literaturePapersApi.updateAnnotation');
    return remoteLitApi.literaturePapersApi.updateAnnotation(annotationId, data);
  },
  deleteAnnotation: (annotationId: string) => {
    requireLocalSupports(getApi(), 'paperNotes.crud', 'literaturePapersApi.deleteAnnotation');
    return remoteLitApi.literaturePapersApi.deleteAnnotation(annotationId);
  },
};

// ---------------------------------------------------------------------------
// Per-method capability maps.
//
// `literatureAiApi`: profile / settings / task-defaults methods read or
// mutate the AI configuration. They are gated on `ai.settings`. Chat /
// extract / visionExtract actually invoke a model — they are gated on
// `ai.chat`. This is the honest semantic split; one blanket capability
// would either over-block (settings page unusable) or under-block (chat
// callable in a local workspace).
// ---------------------------------------------------------------------------

const LITERATURE_AI_METHOD_CAPABILITIES: Record<string, Capability> = {
  check: 'ai.status',
  providers: 'ai.settings',
  profiles: 'ai.settings',
  createProfile: 'ai.settings',
  updateProfile: 'ai.settings',
  deleteProfile: 'ai.settings',
  testProfile: 'ai.settings',
  profileModels: 'ai.settings',
  taskDefaults: 'ai.settings',
  updateTaskDefaults: 'ai.settings',
  extract: 'ai.chat',
  visionExtract: 'ai.chat',
  chat: 'ai.chat',
};

export const literatureAiApi = wrapLocalUnsupportedWithMap(
  LITERATURE_AI_METHOD_CAPABILITIES,
  'literatureAiApi',
  remoteLitApi.literatureAiApi,
);

// Zotero: connect / disconnect / status are about the user's external
// account (`zotero.connect`). listCollections / importCollections /
// importCollectionItems / syncEvents actually move data into the workspace
// (`zotero.import`).
const ZOTERO_METHOD_CAPABILITIES: Record<string, Capability> = {
  connect: 'zotero.connect',
  disconnect: 'zotero.connect',
  status: 'zotero.connect',
  listCollections: 'zotero.import',
  importCollections: 'zotero.import',
  importCollectionItems: 'zotero.import',
  syncEvents: 'zotero.import',
};

export const zoteroApi = wrapLocalUnsupportedWithMap(
  ZOTERO_METHOD_CAPABILITIES,
  'zoteroApi',
  remoteLitApi.zoteroApi,
);

// Sync-only — never callable in a local workspace.
export const literatureCustomFieldsApi = wrapLocalUnsupported(
  'literatureCustomFields.crud',
  'literatureCustomFieldsApi',
  remoteLitApi.literatureCustomFieldsApi,
);
export const citationsApi = wrapLocalUnsupported('citations.crud', 'citationsApi', remoteLitApi.citationsApi);
export const readingListsApi = wrapLocalUnsupported('readingLists.crud', 'readingListsApi', remoteLitApi.readingListsApi);
export const paperRelationsApi = wrapLocalUnsupported('paperRelations.crud', 'paperRelationsApi', remoteLitApi.paperRelationsApi);
export const paperNotesApi = wrapLocalUnsupported('paperNotes.crud', 'paperNotesApi', remoteLitApi.paperNotesApi);

// Literature canvas state (nodes / edges / scenes / viewports)
// is a WP-05/06 concern. WP-02 only requires that the existing
// local canvas layout state does not silently hit `/api`; the
// gateway therefore refuses the network-backed persistence
// path in a local workspace and the canvas keeps using its
// in-memory `useLiteratureCanvas` state.
export const literatureCanvasApi = wrapLocalUnsupported(
  'literatureCanvas.crud',
  'literatureCanvasApi',
  remoteCanvasApi.literatureCanvasApi,
);

// ---------------------------------------------------------------------------
// `lib/api` surface that previously was a pass-through. After the 5th-round
// Gate review these are also wrapped: a local workspace must NEVER send a
// stale handler to the network. UI gate is the first line; the gateway is
// the second.
// ---------------------------------------------------------------------------

export const exportsApi = wrapLocalUnsupported('exports.create', 'exportsApi', remoteApi.exportsApi);
export const uploadsApi = wrapLocalUnsupported('sourceDocuments.upload', 'uploadsApi', remoteApi.uploadsApi);
export const sourceDocumentsApi = {
  get: (id: string) => getDataApi().sourceDocuments.get(id),
  getPages: (id: string) => getDataApi().sourceDocuments.getPages(id),
  upload: (...args: Parameters<typeof remoteApi.sourceDocumentsApi.upload>) => {
    if (!getDataApi().supports('sourceDocuments.upload')) {
      throw new UnsupportedInLocalWorkspaceError('sourceDocumentsApi.upload');
    }
    return remoteApi.sourceDocumentsApi.upload(...args);
  },
  process: (...args: Parameters<typeof remoteApi.sourceDocumentsApi.process>) => {
    if (!getDataApi().supports('sourceDocuments.upload')) {
      throw new UnsupportedInLocalWorkspaceError('sourceDocumentsApi.process');
    }
    return remoteApi.sourceDocumentsApi.process(...args);
  },
};

// `syncApi` is split: `push` and `registerDevice` write, `pull` reads. The
// whole object is sync-only; wrapping with two capabilities per method
// makes the failure mode explicit.
const SYNC_METHOD_CAPABILITIES: Record<string, Capability> = {
  push: 'sync.push',
  pull: 'sync.pull',
  registerDevice: 'sync.push',
};
export const syncApi = wrapLocalUnsupportedWithMap(
  SYNC_METHOD_CAPABILITIES,
  'syncApi',
  remoteApi.syncApi,
);

// `authApi` does not depend on the workspace flavour (the user has to
// authenticate BEFORE picking a flavour). Keep as pass-through.
export const authApi = remoteApi.authApi;
export const setAuthToken = remoteApi.setAuthToken;
export const getAuthToken = remoteApi.getAuthToken;
export type SyncPushPayload = remoteApi.SyncPushPayload;
export type SyncPullResponse = remoteApi.SyncPullResponse;
export type AuthResponse = remoteApi.AuthResponse;

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/**
 * Wrap every method of an API with the SAME capability gate. A
 * non-function property is left untouched.
 */
function wrapLocalUnsupported<T extends object>(capability: Capability, name: string, inner: T): T {
  return wrapLocalUnsupportedWithMap({}, name, inner, capability);
}

/**
 * Wrap every method of an API with a per-method capability. Methods
 * not present in the map fall back to `defaultCapability` (when
 * provided) or to a generic `sync.push` gate.
 */
function wrapLocalUnsupportedWithMap<T extends object>(
  methodMap: Record<string, Capability>,
  name: string,
  inner: T,
  defaultCapability: Capability = 'sync.push',
): T {
  const guarded: Record<string | symbol, unknown> = {};
  for (const key of Reflect.ownKeys(inner) as Array<string | symbol>) {
    const value = (inner as Record<string | symbol, unknown>)[key];
    if (typeof value === 'function') {
      const capability = (methodMap as Record<string, Capability | undefined>)[String(key)] ?? defaultCapability;
      const op = `${String(key)} on ${name}`;
      guarded[key] = (...args: unknown[]) => {
        requireLocalSupports(getApi(), capability, op);
        return (value as (...a: unknown[]) => unknown).apply(inner, args);
      };
    } else {
      guarded[key] = value;
    }
  }
  return guarded as T;
}
