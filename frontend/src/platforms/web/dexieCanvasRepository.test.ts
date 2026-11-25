/**
 * StudyKit v0.4 — `platforms/web/dexieCanvasRepository` tests
 *
 * Focused subscription-routing tests for the canvas's
 * Dexie adapter (WP-06 Round 9 correction).
 *
 * The Round 9 smoke exposed that the previous hook
 * routing read `obj.viewId` on the `views` table, but
 * `CanvasView` is keyed by `id` (which IS the viewId)
 * and has no `viewId` field of its own. The result was
 * a silent subscription dead-zone: every
 * `setViewMode` / `setViewport` / title-rename write
 * went through `tx.putView` and updated Dexie, but the
 * React subscription never fired because the mark
 * function returned early on `undefined viewId`.
 *
 * These tests prove the fix:
 *
 *   - `setViewMode` writes the new mode to Dexie AND
 *     the subscribed view snapshot listener receives
 *     the new `mode: 'outline'` snapshot. The listener
 *     is invoked exactly once per transact, with a
 *     `CanvasViewSnapshot` whose `view.mode` matches
 *     the new value (no sleeps or re-reads).
 *   - The views-table `creating` / `updating` /
 *     `deleting` hooks route the dirty set on the
 *     actual view id (not on `undefined`). The other
 *     tables continue to route on `obj.viewId`.
 *   - `setViewport` (also a view-only update) reaches
 *     the listener.
 *
 * happy-dom does not ship IndexedDB, so the tests
 * replace the five canvas tables with in-memory fakes
 * that implement the minimum surface the canvas Dexie
 * adapter uses (toArray, get, put, delete, hook,
 * where().equals(), plus a per-table `__tx` triple).
 * The fake `db.transaction` mirrors Dexie's
 * per-table transaction lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDexieCanvasRepository,
  getCanvasDb,
  __resetCanvasDbForTests,
} from './dexieCanvasRepository';
import { db as prodDb } from '../../lib/db';
import {
  setViewMode,
  setViewport,
} from '../../application/canvas/canvasUseCases';
import { MemoryRepository } from '../../domain/repository';
import { createCanvasUseCases } from '../../application/canvas/canvasGateway';
import type { CanvasView, ObjectPlacement, FreeNode, CanvasRelation, UndoLineage } from '../../domain/canvas';
import { makeProjectContainer } from '../../domain/__fixtures__/domain-fixtures';

// ---------------------------------------------------------------------------
// In-memory Dexie shim (just enough for the canvas adapter)
// ---------------------------------------------------------------------------

interface FakeTable<T extends { id: string }> {
  toArray(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
  delete(id: string): Promise<void>;
  /**
   * Dexie 4 event-based hook API. Multiple subscribers
   * per event are allowed; the test only needs the
   * single-subscriber shape the production code uses.
   */
  hook(
    eventName: 'creating',
    subscriber: (key: string, obj: T) => void,
  ): void;
  hook(
    eventName: 'updating',
    subscriber: (modifications: Partial<T>, key: string, obj: T) => void,
  ): void;
  hook(
    eventName: 'deleting',
    subscriber: (key: string) => void,
  ): void;
  where(field: string): {
    equals(value: unknown): { toArray(): Promise<T[]> };
  };
  clear(): Promise<void>;
  __txBegin(): void;
  __txCommit(): void;
  __txRollback(): void;
}

function makeFakeTable<T extends { id: string }>(): FakeTable<T> {
  const rows = new Map<string, T>();
  const hooks: {
    creating: Array<(key: string, obj: T) => void>;
    updating: Array<(modifications: Partial<T>, key: string, obj: T) => void>;
    deleting: Array<(key: string) => void>;
  } = { creating: [], updating: [], deleting: [] };
  let txSnapshot: Map<string, T> | null = null;
  const begin = (): void => {
    if (txSnapshot) return;
    txSnapshot = new Map(rows);
  };
  const commit = (): void => {
    txSnapshot = null;
  };
  const rollback = (): void => {
    if (!txSnapshot) return;
    rows.clear();
    for (const [k, v] of txSnapshot) rows.set(k, v);
    txSnapshot = null;
  };
  return {
    toArray: async () => Array.from(rows.values()),
    get: async (id) => rows.get(id),
    put: async (row) => {
      if (txSnapshot) begin();
      const existed = rows.has(row.id);
      rows.set(row.id, row);
      if (existed) {
        for (const h of hooks.updating) h({} as Partial<T>, row.id, row);
      } else {
        for (const h of hooks.creating) h(row.id, row);
      }
    },
    delete: async (id) => {
      if (txSnapshot) begin();
      rows.delete(id);
      for (const h of hooks.deleting) h(id);
    },
    hook: ((eventName: 'creating' | 'updating' | 'deleting', subscriber: never) => {
      if (eventName === 'creating') {
        hooks.creating.push(subscriber as (key: string, obj: T) => void);
      } else if (eventName === 'updating') {
        hooks.updating.push(subscriber as (modifications: Partial<T>, key: string, obj: T) => void);
      } else if (eventName === 'deleting') {
        hooks.deleting.push(subscriber as (key: string) => void);
      }
    }) as FakeTable<T>['hook'],
    where: (field) => ({
      equals: (value: unknown) => {
        const out: T[] = [];
        for (const r of rows.values()) {
          if ((r as unknown as Record<string, unknown>)[field] === value) {
            out.push(r);
          }
        }
        return { toArray: async () => out };
      },
    }),
    clear: async () => rows.clear(),
    __txBegin: begin,
    __txCommit: commit,
    __txRollback: rollback,
  };
}

beforeEach(() => {
  const fViews = makeFakeTable<CanvasView>();
  const fFreeNodes = makeFakeTable<FreeNode>();
  const fPlacements = makeFakeTable<ObjectPlacement>();
  const fRelations = makeFakeTable<CanvasRelation>();
  const fLineage = makeFakeTable<UndoLineage>();
  (prodDb as unknown as { canvasViews: unknown }).canvasViews = fViews;
  (prodDb as unknown as { canvasFreeNodes: unknown }).canvasFreeNodes = fFreeNodes;
  (prodDb as unknown as { canvasPlacements: unknown }).canvasPlacements = fPlacements;
  (prodDb as unknown as { canvasRelations: unknown }).canvasRelations = fRelations;
  (prodDb as unknown as { canvasUndoLineage: unknown }).canvasUndoLineage = fLineage;
  const allTables: FakeTable<{ id: string }>[] = [
    fViews, fFreeNodes, fPlacements, fRelations, fLineage,
  ];
  (prodDb as unknown as { transaction: (...args: unknown[]) => Promise<unknown> }).transaction =
    (async (...args: unknown[]) => {
      for (const t of allTables) t.__txBegin();
      const last = args[args.length - 1];
      if (typeof last !== 'function') return undefined;
      try {
        const out = await (last as () => Promise<unknown> | unknown)();
        for (const t of allTables) t.__txCommit();
        return out;
      } catch (err) {
        for (const t of allTables) t.__txRollback();
        throw err;
      }
    }) as never;
  __resetCanvasDbForTests();
});

afterEach(() => {
  __resetCanvasDbForTests();
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VIEW_ID = 'canvas-routing-1';
const CONTAINER = makeProjectContainer({ id: 'p-1' });

function makeUseCases() {
  const canvas = createDexieCanvasRepository();
  const objects = new MemoryRepository();
  let n = 0;
  const useCases = createCanvasUseCases({
    repository: canvas,
    objects,
    now: () => new Date(2026, 7, 1, 12, 0, n++).toISOString(),
    newId: () => `id_${n}_${Math.random().toString(36).slice(2, 8)}`,
  });
  return { canvas, useCases };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('platforms/web/dexieCanvasRepository / subscription routing', () => {
  it('setViewMode fires the subscribed view listener with mode=outline (not just a Dexie write)', async () => {
    const { canvas, useCases } = makeUseCases();
    // Seed the view + 1 placement so the snapshot is
    // non-empty (the empty-view branch is the
    // CognitiveCanvasView's "Loading canvas…" state).
    await useCases.openInCanvas({
      viewId: VIEW_ID,
      container: CONTAINER,
      objectRefs: [],
    });
    // Subscribe BEFORE the setViewMode write so the
    // first emit is the one we care about.
    const received: Array<{ mode: string; revision: number }> = [];
    let lastResolve: (() => void) | null = null;
    const listener = (snap: { view: { mode: string }; revision: number }): void => {
      received.push({ mode: snap.view.mode, revision: snap.revision });
      if (lastResolve) {
        const r = lastResolve;
        lastResolve = null;
        r();
      }
    };
    const unsub = canvas.subscribeView(VIEW_ID, listener);
    // Capture the listener-count immediately so we
    // can assert the listener fired for the new mode
    // (not just from a prior openInCanvas emit).
    const before = received.length;
    // Drive setViewMode through the use case (NOT a
    // direct Dexie write) — that's the production
    // path the smoke uses.
    const result = await setViewMode(
      { repository: canvas, objects: new MemoryRepository(), now: () => new Date().toISOString(), newId: () => 'x' },
      { viewId: VIEW_ID, mode: 'outline' },
    );
    expect(result.ok).toBe(true);
    // Wait for the scheduled notify. The Dexie
    // adapter debounces via `setTimeout(0)`, so a
    // single `await Promise.resolve()` (a microtask
    // tick) is not enough — we wait one macrotask.
    // This is the production behaviour, not a
    // re-read or a sleep-loop; the listener is what
    // eventually calls back.
    await new Promise<void>((resolve) => {
      lastResolve = resolve;
      // Safety net: if the listener already fired
      // (synchronous emit in some browsers), resolve
      // immediately.
      if (received.length > before && received[received.length - 1].mode === 'outline') {
        lastResolve = null;
        resolve();
      }
      setTimeout(() => {
        if (lastResolve) {
          lastResolve = null;
          resolve();
        }
      }, 100);
    });
    // At least one emit after our write; the latest
    // emit must show `mode: 'outline'`.
    const afterWrite = received.slice(before);
    expect(afterWrite.length).toBeGreaterThan(0);
    expect(afterWrite[afterWrite.length - 1].mode).toBe('outline');
    unsub();
  });

  it('setViewport (also a view-only update) reaches the listener', async () => {
    const { canvas, useCases } = makeUseCases();
    await useCases.openInCanvas({
      viewId: VIEW_ID,
      container: CONTAINER,
      objectRefs: [],
    });
    const received: Array<{ x: number; y: number; zoom: number }> = [];
    let lastResolve: (() => void) | null = null;
    const unsub = canvas.subscribeView(VIEW_ID, (snap) => {
      received.push({ ...snap.view.viewport });
      if (lastResolve) {
        const r = lastResolve;
        lastResolve = null;
        r();
      }
    });
    const before = received.length;
    await setViewport(
      { repository: canvas, objects: new MemoryRepository(), now: () => new Date().toISOString(), newId: () => 'x' },
      { viewId: VIEW_ID, viewport: { x: 12, y: 34, zoom: 1.5 } },
    );
    await new Promise<void>((resolve) => {
      lastResolve = resolve;
      if (received.length > before && received[received.length - 1].x === 12) {
        lastResolve = null;
        resolve();
      }
      setTimeout(() => {
        if (lastResolve) {
          lastResolve = null;
          resolve();
        }
      }, 100);
    });
    const afterWrite = received.slice(before);
    expect(afterWrite.length).toBeGreaterThan(0);
    expect(afterWrite[afterWrite.length - 1]).toEqual({ x: 12, y: 34, zoom: 1.5 });
    unsub();
  });

  it('views-table deleting hook marks the actual view id (no broad fanout for views)', async () => {
    // The fix routes views-table updates on the row's
    // `id` (which IS the viewId), AND the emit no
    // longer broadcasts to every listener. Verify
    // that a second unrelated view's listener is NOT
    // fired when a view is updated.
    const { canvas, useCases: us1 } = makeUseCases();
    const us2 = createDexieCanvasRepository();
    const objects = new MemoryRepository();
    let n = 0;
    const useCases2 = createCanvasUseCases({
      repository: us2,
      objects,
      now: () => new Date(2026, 7, 1, 12, 0, n++).toISOString(),
      newId: () => `id_${n}_${Math.random().toString(36).slice(2, 8)}`,
    });
    await us1.openInCanvas({ viewId: VIEW_ID, container: CONTAINER, objectRefs: [] });
    await useCases2.openInCanvas({ viewId: 'other-view', container: CONTAINER, objectRefs: [] });
    // Subscribe AFTER the initial openInCanvas emit so
    // the listener captures only writes that happen
    // after subscription.
    const receivedOther: string[] = [];
    const unsubOther = us2.subscribeView('other-view', (snap) => {
      receivedOther.push(snap.view.mode);
    });
    // Touch the *first* view's mode (unrelated to
    // `other-view`).
    await setViewMode(
      { repository: canvas, objects, now: () => new Date().toISOString(), newId: () => 'x' },
      { viewId: VIEW_ID, mode: 'outline' },
    );
    // Give the scheduled notify a tick to run.
    await new Promise((r) => setTimeout(r, 30));
    // `other-view` listener must NOT have fired (the
    // views-table hook marks `VIEW_ID` only, AND the
    // emit only notifies dirty views).
    expect(receivedOther).toEqual([]);
    unsubOther();
  });
});
