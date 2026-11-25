/**
 * StudyKit v0.4 — Test fake for the `WebPort` interface.
 *
 * Implements every method of the real `WebPort` on top of the
 * shared `fakeDbRows` Maps so the local data gateway exercises
 * the same code path as production (Dexie / IndexedDB) without
 * requiring a real browser IndexedDB (happy-dom does not
 * provide one).
 *
 * The fake is intentionally not a no-op: the assertions in the
 * WP-02 Gate §3 suite rely on the *behaviour* — rows put
 * through the gateway must round-trip through the fake port,
 * must be retrievable, and must NOT be visible across workspace
 * boundaries. The same shape as the production port guarantees
 * the gateway's filtering / ownership logic is exercised.
 */

import type { Module, Lecture, LiteratureProject, LiteraturePaper } from '../../../types';
import type { WebPort } from '../../../platforms/web';
import { fakeDbRows, makeFakeTable } from './v04TestEnv';

function sortBySortOrder<T extends { sort_order?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Build a `WebPort` that reads / writes the shared
 * `fakeDbRows` Maps. The Maps are reset between tests by
 * `resetFakeDb()`.
 */
export function makeFakeWebPort(): WebPort {
  const modulesTable = makeFakeTable<Module>(fakeDbRows.modules as unknown as Map<string, Module>);
  const lecturesTable = makeFakeTable<Lecture>(fakeDbRows.lectures as unknown as Map<string, Lecture>);
  const projectsTable = makeFakeTable<LiteratureProject>(fakeDbRows.literatureProjects as unknown as Map<string, LiteratureProject>);
  const papersTable = makeFakeTable<LiteraturePaper>(fakeDbRows.literaturePapers as unknown as Map<string, LiteraturePaper>);
  return {
    modules: {
      list: async () => sortBySortOrder(await modulesTable.toArray()),
      get: async (id) => modulesTable.get(id),
      put: async (row) => modulesTable.put(row),
      delete: async (id) => modulesTable.delete(id),
    },
    lectures: {
      listByModule: async (moduleId) =>
        sortBySortOrder(
          (await lecturesTable.where('module_id').equals(moduleId).toArray()),
        ),
      get: async (id) => lecturesTable.get(id),
      put: async (row) => lecturesTable.put(row),
      delete: async (id) => lecturesTable.delete(id),
    },
    literatureProjects: {
      list: async () => projectsTable.toArray(),
      get: async (id) => projectsTable.get(id),
      put: async (row) => projectsTable.put(row),
      delete: async (id) => projectsTable.delete(id),
    },
    literaturePapers: {
      listByProject: async (projectId) =>
        papersTable.where('project_id').equals(projectId).toArray(),
    },
  };
}
