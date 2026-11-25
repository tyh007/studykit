/**
 * StudyKit v0.4 — Web platform port
 *
 * The smallest interface `application/dataGateway` needs to read
 * and write the local workspace's IndexedDB tables. The desktop
 * spike (WP-09) will provide a `DesktopPort` that satisfies the
 * same shape against Tauri + SQLite.
 *
 * The port is deliberately NOT the `StudyKitRepository` contract:
 * WP-02 only needs local CRUD for modules / lectures /
 * literature projects / literature papers (read). Writes for
 * paper metadata, AI / reading lists / Zotero / sync stay on
 * the v0.3 `/api` backend via the existing `lib/api` clients.
 *
 * Implementations:
 *   - `createWebPort()`  — real Dexie / IndexedDB, used in
 *     production. `dataGateway` consumes this through the
 *     `WebPort` interface, never imports `db` itself.
 *
 * `dataGateway` is the only place that calls into the port.
 * Components import `dataApi` from `application/dataApi`; the
 * platform adapter is invisible above the gateway.
 */

import { db } from '../../lib/db';
import type {
  Module,
  Lecture,
  LiteratureProject,
  LiteraturePaper,
  SourceDocument,
  SourcePage,
} from '../../types';

export interface WebPort {
  modules: {
    list(): Promise<Module[]>;
    get(id: string): Promise<Module | undefined>;
    put(row: Module): Promise<void>;
    delete(id: string): Promise<void>;
  };
  lectures: {
    listByModule(moduleId: string): Promise<Lecture[]>;
    get(id: string): Promise<Lecture | undefined>;
    put(row: Lecture): Promise<void>;
    delete(id: string): Promise<void>;
  };
  literatureProjects: {
    list(): Promise<LiteratureProject[]>;
    get(id: string): Promise<LiteratureProject | undefined>;
    put(row: LiteratureProject): Promise<void>;
    delete(id: string): Promise<void>;
  };
  literaturePapers: {
    listByProject(projectId: string): Promise<LiteraturePaper[]>;
  };
  sourceDocuments?: {
    get(id: string): Promise<SourceDocument | undefined>;
    getPages(id: string): Promise<SourcePage[]>;
    putWithPages(document: SourceDocument, pages: ReadonlyArray<SourcePage>): Promise<void>;
    deleteWithPages(id: string): Promise<void>;
  };
}

/**
 * Note on naming (WP-02 Gate §3 blocker 7): the WP-02 plan
 * called this surface "WebRepository". The honest answer is
 * that this is the minimum-shape port the data gateway needs
 * for WP-02's CRUD subset, not the full `StudyKitRepository`
 * contract defined in `domain/repository`. Calling it
 * `WebRepository` would imply a 1:1 mapping to that contract,
 * which does not exist yet — the full repository lands with
 * WP-03+ Knowledge Objects. We therefore keep the honest
 * `WebPort` name; the gateway imports the concrete object
 * through this interface, the desktop spike (WP-09) will
 * provide a `DesktopPort` that satisfies the same shape, and
 * `repositories/` exposes the full `StudyKitRepository`
 * contract separately. The ADR for this naming choice is
 * `frontend/docs/adr/0007-webport-vs-webrepository.md`.
 */

function sortBySortOrder<T extends { sort_order?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Real Dexie-backed port. The `application/dataGateway` calls
 * this through the `WebPort` interface; the gateway never
 * imports `lib/db` directly.
 */
export function createWebPort(): WebPort {
  return {
    modules: {
      list: async () => sortBySortOrder(await db.modules.toArray()),
      get: async (id) => db.modules.get(id),
      put: async (row) => {
        await db.modules.put(row);
      },
      delete: async (id) => {
        await db.modules.delete(id);
      },
    },
    lectures: {
      listByModule: async (moduleId) =>
        sortBySortOrder(await db.lectures.where('module_id').equals(moduleId).toArray()),
      get: async (id) => db.lectures.get(id),
      put: async (row) => {
        await db.lectures.put(row);
      },
      delete: async (id) => {
        await db.lectures.delete(id);
      },
    },
    literatureProjects: {
      list: async () => db.literatureProjects.toArray(),
      get: async (id) => db.literatureProjects.get(id),
      put: async (row) => {
        await db.literatureProjects.put(row);
      },
      delete: async (id) => {
        await db.literatureProjects.delete(id);
      },
    },
    literaturePapers: {
      listByProject: async (projectId) =>
        db.literaturePapers.where('project_id').equals(projectId).toArray(),
    },
    sourceDocuments: {
      get: async (id) => db.sourceDocuments.get(id),
      getPages: async (id) =>
        db.sourcePages.where('source_document_id').equals(id).sortBy('page_number'),
      putWithPages: async (document, pages) => {
        await db.transaction('rw', db.sourceDocuments, db.sourcePages, async () => {
          await db.sourceDocuments.put(document);
          await db.sourcePages.bulkPut([...pages]);
        });
      },
      deleteWithPages: async (id) => {
        await db.transaction('rw', db.sourceDocuments, db.sourcePages, async () => {
          await db.sourcePages.where('source_document_id').equals(id).delete();
          await db.sourceDocuments.delete(id);
        });
      },
    },
  };
}
