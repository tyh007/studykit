/**
 * StudyKit v0.4 — `application/dataGateway`
 *
 * Single switch point between two data backends for the legacy
 * v0.3 surface tree:
 *
 *   - `'local'`  → Dexie / IndexedDB through the `WebPort`
 *                  interface in `platforms/web`. No account, no
 *                  network, no server. Local rows carry
 *                  `workspace_id === 'local'` and the gateway
 *                  refuses to read, write, or delete rows that
 *                  belong to any other workspace.
 *   - `'sync'`   → The existing v0.3 `/api` fetch clients
 *                  (`lib/api`, `lib/literature-api`). The legacy
 *                  behaviour, kept intact.
 *
 * The gateway is the only place that knows which backend is
 * active. Components import `dataApi` from `application/dataApi`;
 * they never `if (local)` themselves, and they never import
 * from `lib/api` directly. The workspace flavour comes from
 * `application/workspaceFlavour`, the single source of truth
 * for "is the user on a local workspace or a sync workspace?".
 *
 * `dataGateway` does NOT import `lib/db` — the Dexie port lives
 * in `platforms/web`. Tests inject an in-memory port.
 *
 * Capabilities: a `local` workspace only supports a small
 * subset of the v0.3 surface (modules / lectures / literature
 * projects CRUD + literature papers read). Anything else —
 * paper metadata writes, reading lists, AI, Zotero, sync,
 * exports, file uploads — throws `UnsupportedInLocalWorkspaceError`
 * before the call can hit the network. The UI surfaces the
 * error the same way it surfaces a network error.
 */

import * as remote from '../lib/api';
import * as litRemote from '../lib/literature-api';
import { createWebPort, type WebPort } from '../platforms/web';
import type {
  Module,
  Lecture,
  LiteratureProject,
  LiteraturePaper,
  SourceDocument,
  SourcePage,
} from '../types';

// ---------------------------------------------------------------------------
// Errors + capabilities
// ---------------------------------------------------------------------------

export type WorkspaceFlavour = 'local' | 'sync';

/**
 * Thrown when the local workspace receives a write or read
 * that the local backend cannot perform. UI surfaces this with
 * a "Sync workspace required" message; the network is never
 * contacted.
 */
export class UnsupportedInLocalWorkspaceError extends Error {
  readonly operation: string;
  constructor(operation: string, hint?: string) {
    super(
      `Operation "${operation}" is not available in a local workspace.${hint ? ' ' + hint : ''}`,
    );
    this.name = 'UnsupportedInLocalWorkspaceError';
    this.operation = operation;
  }
}

export type Capability =
  | 'modules.crud'
  | 'lectures.crud'
  | 'literatureProjects.crud'
  | 'literaturePapers.list'
  | 'literaturePapers.crud'
  | 'literatureCustomFields.crud'
  | 'readingLists.crud'
  | 'paperNotes.crud'
  | 'paperRelations.crud'
  | 'citations.crud'
  | 'ai.chat'
  | 'ai.status'
  | 'ai.settings'
  | 'zotero.connect'
  | 'zotero.import'
  | 'sync.push'
  | 'sync.pull'
  | 'sourceDocuments.upload'
  | 'exports.create'
  | 'literatureCanvas.crud';

const LOCAL_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'modules.crud',
  'lectures.crud',
  'literatureProjects.crud',
  'literaturePapers.list',
]);

const SYNC_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'modules.crud',
  'lectures.crud',
  'literatureProjects.crud',
  'literaturePapers.list',
  'literaturePapers.crud',
  'readingLists.crud',
  'paperNotes.crud',
  'paperRelations.crud',
  'citations.crud',
  'ai.chat',
  'ai.status',
  'ai.settings',
  'zotero.connect',
  'zotero.import',
  'sync.push',
  'sync.pull',
  'sourceDocuments.upload',
  'exports.create',
  'literatureCanvas.crud',
]);

// ---------------------------------------------------------------------------
// Domain types (gateway input shape)
// ---------------------------------------------------------------------------

export interface ModuleCreate {
  title: string;
  code?: string;
  academic_term?: string;
  colour?: string;
}
export interface LectureCreate {
  module_id: string;
  title: string;
  lecture_date?: string;
  week_label?: string;
}
export interface LiteratureProjectCreate {
  name: string;
  description?: string;
  template_id?: string;
}

export interface DataApi {
  readonly flavour: WorkspaceFlavour;
  /** True when the flavour supports the capability. */
  supports(cap: Capability): boolean;
  modules: ModulesApi;
  lectures: LecturesApi;
  literatureProjects: LiteratureProjectsApi;
  literaturePapers: LiteraturePapersApi;
  sourceDocuments: SourceDocumentsApi;
}

export interface ModulesApi {
  list(): Promise<Module[]>;
  create(data: ModuleCreate): Promise<Module>;
  update(id: string, data: Partial<Module>): Promise<Module>;
  delete(id: string): Promise<{ success: boolean }>;
}
export interface LecturesApi {
  list(moduleId: string): Promise<Lecture[]>;
  create(data: LectureCreate): Promise<Lecture>;
  update(id: string, data: Partial<Lecture>): Promise<Lecture>;
  delete(id: string): Promise<{ success: boolean }>;
}
export interface LiteratureProjectsApi {
  list(): Promise<LiteratureProject[]>;
  create(data: LiteratureProjectCreate): Promise<LiteratureProject>;
  update(id: string, data: Partial<LiteratureProject>): Promise<LiteratureProject>;
  delete(id: string): Promise<{ success: boolean }>;
}
export interface LiteraturePapersApi {
  list(projectId: string, status?: 'library' | 'trash'): Promise<LiteraturePaper[]>;
}
export interface SourceDocumentsApi {
  get(id: string): Promise<SourceDocument | undefined>;
  getPages(id: string): Promise<SourcePage[]>;
  putWithPages(document: SourceDocument, pages: ReadonlyArray<SourcePage>): Promise<void>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCAL_WORKSPACE_ID = 'local';

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${rand}`;
}

function requireLocalOwned<T extends { workspace_id?: string }>(
  row: T | undefined,
  id: string,
  kind: string,
): T {
  if (!row) throw new Error(`${kind} ${id} not found`);
  if (row.workspace_id !== LOCAL_WORKSPACE_ID) {
    throw new Error(
      `${kind} ${id} does not belong to the local workspace; refusing to mutate it`,
    );
  }
  return row;
}

/**
 * Lectures don't carry `workspace_id` directly. We verify
 * ownership transitively: a local lecture must belong to a
 * local module. The sync backend uses server-side validation
 * so this is purely a local-workspace safety check.
 */
async function requireLocalLectureOwned(
  port: WebPort,
  id: string,
): Promise<void> {
  const existing = await port.lectures.get(id);
  if (!existing) throw new Error(`Lecture ${id} not found`);
  const parent = await port.modules.get(existing.module_id);
  if (!parent || parent.workspace_id !== LOCAL_WORKSPACE_ID) {
    throw new Error(
      `Lecture ${id} is attached to a non-local module; refusing to mutate it`,
    );
  }
}

// ---------------------------------------------------------------------------
// Local port-backed implementations
// ---------------------------------------------------------------------------

function makeLocalModules(port: WebPort): ModulesApi {
  return {
    async list() {
      const rows = await port.modules.list();
      // Hard isolation: even if Dexie somehow contains a row
      // with a different workspace_id, the local surface
      // never exposes it.
      return rows.filter((r) => r.workspace_id === LOCAL_WORKSPACE_ID);
    },
    async create(data) {
      const row: Module = {
        id: uid('mod'),
        workspace_id: LOCAL_WORKSPACE_ID,
        title: data.title,
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.academic_term !== undefined ? { academic_term: data.academic_term } : {}),
        ...(data.colour !== undefined ? { colour: data.colour } : {}),
        sort_order: Date.now(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await port.modules.put(row);
      return row;
    },
    async update(id, data) {
      const existing = await port.modules.get(id);
      requireLocalOwned(existing, id, 'Module');
      const next: Module = {
        ...(existing as Module),
        ...data,
        id: (existing as Module).id,
        workspace_id: LOCAL_WORKSPACE_ID,
        updated_at: nowIso(),
      };
      await port.modules.put(next);
      return next;
    },
    async delete(id) {
      const existing = await port.modules.get(id);
      requireLocalOwned(existing, id, 'Module');
      await port.modules.delete(id);
      return { success: true };
    },
  };
}

function makeLocalLectures(port: WebPort): LecturesApi {
  return {
    async list(moduleId) {
      // Verify the parent module is local before listing.
      const parent = await port.modules.get(moduleId);
      if (!parent) return [];
      if (parent.workspace_id !== LOCAL_WORKSPACE_ID) return [];
      return port.lectures.listByModule(moduleId);
    },
    async create(data) {
      // Refuse to attach a local lecture to a non-local module.
      const parent = await port.modules.get(data.module_id);
      requireLocalOwned(parent, data.module_id, 'Module');
      const row: Lecture = {
        id: uid('lec'),
        module_id: data.module_id,
        title: data.title,
        ...(data.lecture_date !== undefined ? { lecture_date: data.lecture_date } : {}),
        ...(data.week_label !== undefined ? { week_label: data.week_label } : {}),
        sort_order: Date.now(),
        settings_json: {
          cornell_mode: false,
          layout: 'slide_left_notes_right',
          export_defaults: {
            include_cornell_cues: true,
            include_annotations: true,
            include_page_numbers: true,
            template: 'classic',
          },
        },
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await port.lectures.put(row);
      return row;
    },
    async update(id, data) {
      await requireLocalLectureOwned(port, id);
      const existing = await port.lectures.get(id);
      // existing is non-null here; requireLocalLectureOwned threw otherwise.
      const next: Lecture = { ...(existing as Lecture), ...data, updated_at: nowIso() };
      await port.lectures.put(next);
      return next;
    },
    async delete(id) {
      await requireLocalLectureOwned(port, id);
      await port.lectures.delete(id);
      return { success: true };
    },
  };
}

function makeLocalLiteratureProjects(port: WebPort): LiteratureProjectsApi {
  return {
    async list() {
      const rows = await port.literatureProjects.list();
      return rows.filter((r) => r.workspace_id === LOCAL_WORKSPACE_ID);
    },
    async create(data) {
      const row: LiteratureProject = {
        id: uid('proj'),
        workspace_id: LOCAL_WORKSPACE_ID,
        name: data.name,
        ...(data.description !== undefined ? { description: data.description } : {}),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await port.literatureProjects.put(row);
      return row;
    },
    async update(id, data) {
      const existing = await port.literatureProjects.get(id);
      requireLocalOwned(existing, id, 'Literature project');
      const next: LiteratureProject = {
        ...(existing as LiteratureProject),
        ...data,
        id: (existing as LiteratureProject).id,
        workspace_id: LOCAL_WORKSPACE_ID,
        updated_at: nowIso(),
      };
      await port.literatureProjects.put(next);
      return next;
    },
    async delete(id) {
      const existing = await port.literatureProjects.get(id);
      requireLocalOwned(existing, id, 'Literature project');
      await port.literatureProjects.delete(id);
      return { success: true };
    },
  };
}

function makeLocalLiteraturePapers(port: WebPort): LiteraturePapersApi {
  return {
    async list(projectId) {
      // Refuse to list papers for a non-local project.
      const proj = await port.literatureProjects.get(projectId);
      requireLocalOwned(proj, projectId, 'Literature project');
      const rows = await port.literaturePapers.listByProject(projectId);
      // WP-02 Gate §3 blocker 9 (5th-round tightening):
      // strict paper-level workspace isolation. A row
      // belongs to the local workspace ONLY if it carries
      // `workspace_id === 'local'`. Rows without a
      // `workspace_id` (legacy data, sync leftovers, or a
      // future cross-workspace import) are NEVER returned.
      // Any legacy data migration is the responsibility of
      // a dedicated `repositories/` path (WP-03+), not
      // implicit in the local list filter.
      return rows.filter((row) => {
        const wid = (row as { workspace_id?: string }).workspace_id;
        return wid === LOCAL_WORKSPACE_ID;
      });
    },
  };
}

function makeLocalSourceDocuments(port: WebPort): SourceDocumentsApi {
  const sourcePort = (): NonNullable<WebPort['sourceDocuments']> => {
    if (!port.sourceDocuments) {
      throw new UnsupportedInLocalWorkspaceError('sourceDocuments.local');
    }
    return port.sourceDocuments;
  };
  return {
    get: (id) => sourcePort().get(id),
    getPages: (id) => sourcePort().getPages(id),
    async putWithPages(document, pages) {
      await requireLocalLectureOwned(port, document.lecture_id);
      await sourcePort().putWithPages(document, pages);
    },
    delete: (id) => sourcePort().deleteWithPages(id),
  };
}

// ---------------------------------------------------------------------------
// Sync (v0.3 /api fetch) implementations
// ---------------------------------------------------------------------------

const syncModules: ModulesApi = {
  list: () => remote.modulesApi.list(),
  create: (data) => remote.modulesApi.create(data),
  update: (id, data) => remote.modulesApi.update(id, data),
  delete: (id) => remote.modulesApi.delete(id),
};

const syncLectures: LecturesApi = {
  list: (moduleId) => remote.lecturesApi.list(moduleId),
  create: (data) => remote.lecturesApi.create(data),
  update: (id, data) => remote.lecturesApi.update(id, data),
  delete: (id) => remote.lecturesApi.delete(id),
};

const syncLiteratureProjects: LiteratureProjectsApi = {
  list: () => litRemote.literatureProjectsApi.list(),
  create: (data) => litRemote.literatureProjectsApi.create(data),
  update: (id, data) => litRemote.literatureProjectsApi.update(id, data),
  delete: (id) => litRemote.literatureProjectsApi.delete(id),
};

const syncLiteraturePapers: LiteraturePapersApi = {
  list: (projectId, status) => litRemote.literaturePapersApi.list(projectId, status),
};
const syncSourceDocuments: SourceDocumentsApi = {
  get: (id) => remote.sourceDocumentsApi.get(id),
  getPages: (id) => remote.sourceDocumentsApi.getPages(id),
  putWithPages: async () => {
    throw new Error('Direct source metadata writes are only available in a local workspace.');
  },
  delete: async () => {
    throw new Error('Direct source metadata deletion is only available in a local workspace.');
  },
};

// ---------------------------------------------------------------------------
// Flavour + factory
// ---------------------------------------------------------------------------

let currentFlavour: WorkspaceFlavour = 'sync';

export function setWorkspaceFlavour(flavour: WorkspaceFlavour): void {
  currentFlavour = flavour;
}

export function getWorkspaceFlavour(): WorkspaceFlavour {
  return currentFlavour;
}

let defaultPort: WebPort = createWebPort();

/**
 * Replace the port (used by tests). Production never calls
 * this; it is `__setWebPortForTests` semantics without
 * polluting the public surface.
 */
export function __setWebPortForTests(port: WebPort): void {
  defaultPort = port;
}

/** Composition-root hook used by the native desktop workspace. */
export function setLocalDataPort(port: WebPort): void {
  defaultPort = port;
}

export function __resetWebPortForTests(): void {
  defaultPort = createWebPort();
}

export function resetLocalDataPort(): void {
  defaultPort = createWebPort();
}

function buildApi(flavour: WorkspaceFlavour): DataApi {
  if (flavour === 'local') {
    const port = defaultPort;
    return {
      flavour: 'local',
      supports: (cap) => LOCAL_CAPABILITIES.has(cap),
      modules: makeLocalModules(port),
      lectures: makeLocalLectures(port),
      literatureProjects: makeLocalLiteratureProjects(port),
      literaturePapers: makeLocalLiteraturePapers(port),
      sourceDocuments: makeLocalSourceDocuments(port),
    };
  }
  return {
    flavour: 'sync',
    supports: (cap) => SYNC_CAPABILITIES.has(cap),
    modules: syncModules,
    lectures: syncLectures,
    literatureProjects: syncLiteratureProjects,
    literaturePapers: syncLiteraturePapers,
    sourceDocuments: syncSourceDocuments,
  };
}

export function getDataApi(flavour: WorkspaceFlavour = currentFlavour): DataApi {
  return buildApi(flavour);
}
