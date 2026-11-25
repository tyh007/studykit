/**
 * StudyKit v0.4 — `dataGateway` integration tests
 *
 * Real CRUD flows against the local port. We install an
 * in-memory `WebPort` via the `__setWebPortForTests` API the
 * gateway exposes; this is the same path production uses to
 * swap platforms (e.g. desktop WP-09).
 *
 * happy-dom does not ship IndexedDB, so we cannot use the
 * real Dexie. The fake keeps the same Promise + `where()`
 * shape so the gateway code path is exercised exactly as it
 * would be in production.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataApi, setWorkspaceFlavour, __setWebPortForTests, __resetWebPortForTests } from './dataGateway';
import type { Module, Lecture, LiteratureProject, LiteraturePaper } from '../types';
import type { WebPort } from '../platforms/web';

interface FakeTable<T> {
  toArray: () => Promise<T[]>;
  get: (id: string) => Promise<T | undefined>;
  put: (row: T) => Promise<void>;
  delete: (id: string) => Promise<void>;
  where: (field: string) => { equals: (v: unknown) => { toArray: () => Promise<T[]> } };
}

function makeFakeTable<T extends { id: string }>(): FakeTable<T> {
  const rows = new Map<string, T>();
  return {
    toArray: async () => Array.from(rows.values()),
    get: async (id) => rows.get(id),
    put: async (row) => {
      rows.set(row.id, row);
    },
    delete: async (id) => {
      rows.delete(id);
    },
    where: (field: string) => ({
      equals: (v: unknown) => ({
        toArray: async () =>
          Array.from(rows.values()).filter((r) => (r as unknown as Record<string, unknown>)[field] === v),
      }),
    }),
  };
}

function makeFakePort(): WebPort {
  // Build a port that satisfies the `WebPort` interface on top
  // of the fake Dexie tables.
  const modulesTable = makeFakeTable<Module>();
  const lecturesTable = makeFakeTable<Lecture>();
  const projectsTable = makeFakeTable<LiteratureProject>();
  const papersTable = makeFakeTable<LiteraturePaper>();
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
          (
            await lecturesTable.where('module_id').equals(moduleId).toArray()
          ),
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

function sortBySortOrder<T extends { sort_order?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// Now import the dataGateway AFTER the mock is in place.
import './dataGateway';

describe('dataGateway — local CRUD', () => {
  let port: WebPort;
  beforeEach(() => {
    port = makeFakePort();
    __setWebPortForTests(port);
    setWorkspaceFlavour('local');
  });
  afterEach(() => {
    setWorkspaceFlavour('sync');
    __resetWebPortForTests();
  });

  it('creates and lists a module in Dexie (local workspace)', async () => {
    const api = getDataApi('local');
    const mod = await api.modules.create({ title: 'Calculus' });
    expect(mod.id).toMatch(/^mod_/);
    expect(mod.title).toBe('Calculus');
    const all = await api.modules.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(mod.id);
  });

  it('persists a module across `reload` (re-instantiation)', async () => {
    const api = getDataApi('local');
    await api.modules.create({ title: 'Algebra' });
    // The data survives the test because Dexie rows live in the
    // fake table; the gateway code path is identical to
    // production.
    const fresh = getDataApi('local');
    const all = await fresh.modules.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Algebra');
  });

  it('lists lectures by module_id (parent → child relationship)', async () => {
    const api = getDataApi('local');
    const mod = await api.modules.create({ title: 'M' });
    const otherMod = await api.modules.create({ title: 'M2' });
    await api.lectures.create({ module_id: mod.id, title: 'L1' });
    await api.lectures.create({ module_id: mod.id, title: 'L2' });
    await api.lectures.create({ module_id: otherMod.id, title: 'L3' });
    const list = await api.lectures.list(mod.id);
    expect(list).toHaveLength(2);
    expect(list.map((l) => l.title).sort()).toEqual(['L1', 'L2']);
  });

  it('refuses to mutate a sync module from a local context', async () => {
    // Seed a sync module directly through the port.
    await port.modules.put({
      id: 'sync-mod-1',
      workspace_id: 'ws-sync',
      title: 'Sync module',
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as Module);
    const api = getDataApi('local');
    // Local list filters out the sync row.
    const all = await api.modules.list();
    expect(all.find((m) => m.id === 'sync-mod-1')).toBeUndefined();
    // Local update on the sync id throws.
    await expect(api.modules.update('sync-mod-1', { title: 'hijack' })).rejects.toThrow(/local workspace/);
    // Local delete on the sync id throws.
    await expect(api.modules.delete('sync-mod-1')).rejects.toThrow(/local workspace/);
  });

  it('updates a module and reflects the new title', async () => {
    const api = getDataApi('local');
    const mod = await api.modules.create({ title: 'Old' });
    const updated = await api.modules.update(mod.id, { title: 'New' });
    expect(updated.title).toBe('New');
    const all = await api.modules.list();
    expect(all[0]?.title).toBe('New');
  });

  it('deletes a module and removes it from the list', async () => {
    const api = getDataApi('local');
    const mod = await api.modules.create({ title: 'X' });
    const res = await api.modules.delete(mod.id);
    expect(res.success).toBe(true);
    const all = await api.modules.list();
    expect(all).toHaveLength(0);
  });

  it('creates literature projects and papers in Dexie', async () => {
    const api = getDataApi('local');
    const proj = await api.literatureProjects.create({ name: 'Sleep' });
    expect(proj.id).toMatch(/^proj_/);
    // Papers list requires a special `create` path that hits
    // the remote API in WP-02; local-only paper creation lands
    // in WP-05. The list/read path is what we verify here.
    const list = await api.literaturePapers.list(proj.id, 'library');
    expect(list).toEqual([]);
  });

  it('flavour flag flips the gateway between local Dexie and remote /api', async () => {
    const local = getDataApi('local');
    await local.modules.create({ title: 'L-mod' });
    const remote = getDataApi('sync');
    // The sync impl calls `remote.modulesApi.list()` which in
    // a happy-dom test environment will fail (no fetch backend).
    // We only assert that the impls are *different*; the
    // network call is exercised by E2E / browser tests.
    expect(remote).not.toBe(local);
    expect(remote.flavour).toBe('sync');
    expect(local.flavour).toBe('local');
  });
});
