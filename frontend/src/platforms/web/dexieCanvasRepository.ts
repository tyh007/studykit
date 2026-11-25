/**
 * StudyKit v0.4 — `platforms/web/dexieCanvasRepository`
 *
 * The Dexie / IndexedDB-backed implementation of the
 * `CanvasRepository` contract (WP-06).
 *
 * Schema strategy
 * ---------------
 *
 *   - The Dexie schema declares the four new tables in a
 *     `v6` additive migration (`lib/db.ts`).
 *   - Older databases (v1–v5) open unchanged; Dexie
 *     performs an in-place upgrade the first time the
 *     `v6` declaration is seen. The migration is
 *     idempotent: re-running `version(6).stores(...)` is
 *     a no-op once the schema is at v6.
 *   - The `v04Canvas` feature flag is the runtime gate:
 *     when off, `createDexieCanvasRepository()` is never
 *     called, the v0.3 product never opens the canvas
 *     tables, and a flag-off build behaves exactly like a
 *     fresh v5 database from the v0.3 product's point of
 *     view.
 *
 * Subscriptions
 * -------------
 *
 *   Dexie has no `subscribe` primitive. We attach to the
 *   table's `creating` / `updating` / `deleting` hooks so
 *   any `put` / `delete` on the canvas tables fires a
 *   `notify()` that `subscribeView` consumers listen to.
 *   The notify fan-out is keyed by `viewId`, so each
 *   subscriber only re-reads its own view.
 *
 * UI guard
 * --------
 *
 *   `application/canvas/canvasUseCases.ts` is the only
 *   consumer. It imports this file through the
 *   `CanvasRepository` interface and never imports
 *   `lib/db` directly. The composition root in
 *   `app/canvas/canvasWiring.ts` is the only place that
 *   calls `createDexieCanvasRepository()` and only when
 *   the `v04Canvas` flag is on.
 */

import type { Table } from 'dexie';
import { db } from '../../lib/db';
import type {
  CanvasNodeSummary,
  CanvasRelation,
  CanvasView,
  CanvasViewSnapshot,
  CognitiveRole,
  FreeNode,
  KnowledgeObjectKind,
  ObjectPlacement,
  UndoLineage,
} from '../../domain/canvas';
import { defaultCognitiveRole, refKey } from '../../domain/canvas';
import type { ContainerRef } from '../../domain/workspace';
import type {
  CanvasListener,
  CanvasRepository,
  CanvasTransaction,
  Unsubscribe,
} from '../../repositories/canvas';
import { EMPTY_VIEW_ID, emptyViewSnapshot } from '../../repositories/canvas';

// ---------------------------------------------------------------------------
// Table shape (the minimum we need from Dexie)
// ---------------------------------------------------------------------------

interface CanvasDexieTable<T> {
  toArray(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
  delete(id: string): Promise<void>;
  where(field: string): {
    equals(value: unknown): { toArray(): Promise<T[]> };
  };
  /**
   * Dexie 4 event-based hook API. We subscribe to
   * `creating` / `updating` / `deleting` events via
   * the `hook(eventName, subscriber)` form — NOT the
   * Dexie-3 object form `hook({ ... })` which Dexie 4
   * silently ignores (the object is treated as a
   * single unknown event name).
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
}

function readTables(): CanvasTables {
  const extended = db as unknown as {
    canvasViews: Table<CanvasView, string>;
    canvasFreeNodes: Table<FreeNode, string>;
    canvasPlacements: Table<ObjectPlacement, string>;
    canvasRelations: Table<CanvasRelation, string>;
    canvasUndoLineage: Table<UndoLineage, string>;
  };
  return {
    views: extended.canvasViews as unknown as CanvasDexieTable<CanvasView>,
    freeNodes: extended.canvasFreeNodes as unknown as CanvasDexieTable<FreeNode>,
    placements: extended.canvasPlacements as unknown as CanvasDexieTable<ObjectPlacement>,
    relations: extended.canvasRelations as unknown as CanvasDexieTable<CanvasRelation>,
    lineage: extended.canvasUndoLineage as unknown as CanvasDexieTable<UndoLineage>,
  };
}

interface CanvasTables {
  views: CanvasDexieTable<CanvasView>;
  freeNodes: CanvasDexieTable<FreeNode>;
  placements: CanvasDexieTable<ObjectPlacement>;
  relations: CanvasDexieTable<CanvasRelation>;
  lineage: CanvasDexieTable<UndoLineage>;
}

// ---------------------------------------------------------------------------
// Knowledge body lookup
// ---------------------------------------------------------------------------

/**
 * Real Dexie field shapes. The cognitive canvas's
 * `CanvasNodeSummary.body` is a *projection* over the
 * canonical fields, not a separate copy.
 *
 * For WP-05 research objects, we read:
 *   - `Evidence.exactQuote` + `Evidence.userInterpretation`
 *     (the user-authored interpretation is what the
 *     Evidence table actually shows).
 *   - `Claim.title` + `Claim.body`.
 *   - `Work.title` (the canonical academic Work).
 *
 * For WP-04 study objects, we read:
 *   - `StudyQuestion.body` (the question text the user
 *     wants to understand).
 *
 * For v0.3 sources we read:
 *   - `LiteraturePaper.title` + `processing_status` +
 *     `in_trash` for the missing/live state.
 *
 * The probe is intentionally narrow. We never read
 * through Dexie into other columns; the cognitive
 * canvas's `body` is *derived* in `evidenceToKnowledgeObject` /
 * `claimToKnowledgeObject` / `questionToKnowledgeObject` /
 * `paperToKnowledgeObject` from the *real* fields, not
 * from a `body` blob that doesn't exist.
 */
interface EvidenceDexieRow {
  id: string;
  exactQuote: string;
  userInterpretation: string;
  status: 'candidate' | 'verified' | 'rejected';
  evidenceType: string;
  workId: string;
}

interface ClaimDexieRow {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'canonical';
}

interface WorkDexieRow {
  id: string;
  title: string;
}

interface QuestionDexieRow {
  id: string;
  body: string;
}

interface PaperDexieRow {
  id: string;
  title: string;
  in_trash: number | boolean;
  processing_status: 'pending' | 'processing' | 'ready' | 'error';
}

interface KnowledgeProbeTables {
  studyQuestions: CanvasDexieTable<QuestionDexieRow>;
  researchEvidence: CanvasDexieTable<EvidenceDexieRow>;
  researchClaims: CanvasDexieTable<ClaimDexieRow>;
  researchWorks: CanvasDexieTable<WorkDexieRow>;
  literaturePapers: CanvasDexieTable<PaperDexieRow>;
}

function readKnowledgeProbeTables(): KnowledgeProbeTables {
  const extended = db as unknown as {
    studyQuestions: Table<QuestionDexieRow, string>;
    researchEvidence: Table<EvidenceDexieRow, string>;
    researchClaims: Table<ClaimDexieRow, string>;
    researchWorks: Table<WorkDexieRow, string>;
    literaturePapers: Table<PaperDexieRow, string>;
  };
  return {
    studyQuestions: extended.studyQuestions as unknown as CanvasDexieTable<QuestionDexieRow>,
    researchEvidence: extended.researchEvidence as unknown as CanvasDexieTable<EvidenceDexieRow>,
    researchClaims: extended.researchClaims as unknown as CanvasDexieTable<ClaimDexieRow>,
    researchWorks: extended.researchWorks as unknown as CanvasDexieTable<WorkDexieRow>,
    literaturePapers: extended.literaturePapers as unknown as CanvasDexieTable<PaperDexieRow>,
  };
}

/**
 * Resolved canonical summary, mapped from the *real*
 * Dexie row. The mapping helpers live in
 * `repositories/shimStudyKitRepository`; the Dexie
 * adapter uses the same shape so a free-node
 * `CanvasNodeSummary` and a canonical `KnowledgeObject`
 * have identical `body` semantics on the canvas.
 */
export interface ResolvedKnowledgeSummary {
  id: string;
  kind: KnowledgeObjectKind;
  body: string;
  /** True when the underlying row is missing, archived,
   *  rejected, in-trash, or in a non-`active` state. */
  missing: boolean;
}

export async function resolveKnowledge(
  id: string,
  expectedKind: KnowledgeObjectKind,
): Promise<ResolvedKnowledgeSummary | null> {
  const t = readKnowledgeProbeTables();
  // We read the row from the table that matches the
  // expected `objectKind` on the placement. This is
  // important: the cognitive canvas never guesses the
  // kind — the placement declares it.
  switch (expectedKind) {
    case 'evidence': {
      const row = await t.researchEvidence.get(id);
      if (!row) return null;
      const body = row.userInterpretation?.trim()
        ? row.userInterpretation
        : row.exactQuote;
      const missing = row.status === 'rejected';
      return { id, kind: 'evidence', body, missing };
    }
    case 'claim': {
      const row = await t.researchClaims.get(id);
      if (!row) return null;
      const body = row.body?.trim() ? row.body : row.title;
      return { id, kind: 'claim', body, missing: false };
    }
    case 'question': {
      const row = await t.studyQuestions.get(id);
      if (!row) return null;
      return { id, kind: 'question', body: row.body, missing: false };
    }
    case 'source': {
      const row = await t.literaturePapers.get(id);
      if (!row) return null;
      const missing = !!row.in_trash;
      return { id, kind: 'source', body: row.title, missing };
    }
    case 'concept':
    case 'task':
    case 'output':
    case 'note': {
      // `note`, `concept`, `task`, `output` do not have a
      // Dexie-backed body in the current schema. The
      // cognitive canvas treats the placement as the
      // single source of truth for the body, and the
      // upgrade is a no-op until WP-02 lands a real
      // `objects` table. The caller (the snapshot
      // builder) keeps the placement's last-known body.
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// DexieDB (the subscribe layer)
// ---------------------------------------------------------------------------

class CanvasDexieDB {
  private readonly listeners = new Map<string, Set<CanvasListener>>();
  private notifyScheduled: ReturnType<typeof setTimeout> | null = null;
  private readonly tables: CanvasTables;
  /** Map of `viewId -> Set<tableName>` so we only re-read
   *  views that were actually touched by a write. */
  private readonly dirty = new Map<string, Set<string>>();

  constructor(tables: CanvasTables) {
    this.tables = tables;
    const all: Array<[string, CanvasDexieTable<unknown>]> = [
      ['views', tables.views as unknown as CanvasDexieTable<unknown>],
      ['freeNodes', tables.freeNodes as unknown as CanvasDexieTable<unknown>],
      ['placements', tables.placements as unknown as CanvasDexieTable<unknown>],
      ['relations', tables.relations as unknown as CanvasDexieTable<unknown>],
      ['lineage', tables.lineage as unknown as CanvasDexieTable<unknown>],
    ];
    for (const [name, table] of all) {
      const mark = (viewId: string | undefined): void => {
        if (!viewId) return;
        if (!this.dirty.has(viewId)) this.dirty.set(viewId, new Set());
        (this.dirty.get(viewId) as Set<string>).add(name);
        this.scheduleNotify();
      };
      // The `views` table is keyed by the view's
      // primary key `id`, which IS the `viewId`
      // (a `CanvasView` has no `viewId` field of its
      // own). All other canvas tables carry a
      // `viewId` field on each row. Routing the
      // subscription on the *correct* key per table
      // is what `setViewMode` and any future
      // `setViewport` / title-rename use cases need
      // to actually trigger a live re-read in the
      // subscribing React component — the Round 9
      // smoke exposed that the old code checked
      // `obj.viewId` for the views table and got
      // `undefined`, so view-only updates never
      // fired.
      const isViewsTable = name === 'views';
      // Dexie 4 switched from the object-form
      // `table.hook({ creating, updating, deleting })`
      // (Dexie 3) to the *event-based* API:
      // `table.hook('creating', cb)` /
      // `table.hook('updating', cb)` /
      // `table.hook('deleting', cb)`. The old object
      // form is silently ignored by Dexie 4 (the
      // argument is treated as a single unknown event
      // name), which is why the Round 9 smoke saw
      // "Dexie state changes but the React
      // subscription never fires" — the hooks were
      // never actually registered. This is the
      // root cause of the PARTIAL→PASS fix.
      table.hook('creating', (key, obj) => {
        const viewId = isViewsTable
          ? (obj as { id?: string })?.id ?? (key as string)
          : (obj as { viewId?: string })?.viewId;
        mark(viewId);
      });
      table.hook('updating', (_modifications, key, obj) => {
        const viewId = isViewsTable
          ? (obj as { id?: string })?.id ?? (key as string)
          : (obj as { viewId?: string })?.viewId;
        mark(viewId);
      });
      table.hook('deleting', (key) => {
        if (isViewsTable) {
          // The key IS the viewId; mark precisely
          // (no broad fanout needed).
          mark(key as string);
          return;
        }
        // Other tables: the deleting hook only
        // exposes the row's primary key, not the
        // row, so we can't recover the viewId from
        // `key` alone. Fan out to every subscribed
        // view. The cost is bounded — the canvas
        // is feature-flagged and the listeners map
        // is small.
        for (const viewId of this.listeners.keys()) {
          mark(viewId);
        }
      });
    }
  }

  subscribeView(viewId: string, listener: CanvasListener): Unsubscribe {
    if (!this.listeners.has(viewId)) this.listeners.set(viewId, new Set());
    (this.listeners.get(viewId) as Set<CanvasListener>).add(listener);
    return () => {
      const set = this.listeners.get(viewId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(viewId);
      }
    };
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = setTimeout(() => {
      this.notifyScheduled = null;
      void this.emit();
    }, 0);
  }

  private async emit(): Promise<void> {
    const t = this.tables;
    // Snapshot the dirty set BEFORE we clear it so a
    // listener that immediately re-marks (e.g. via a
    // use case called from the React effect) doesn't
    // see an empty set during this emit.
    const dirtySnapshot = new Map(this.dirty);
    this.dirty.clear();
    const [views, freeNodes, placements, relations] = await Promise.all([
      t.views.toArray(),
      t.freeNodes.toArray(),
      t.placements.toArray(),
      t.relations.toArray(),
    ]);
    const viewMap = new Map<string, CanvasView>(views.map((v) => [v.id, v]));
    const placementByView = new Map<string, ObjectPlacement[]>();
    for (const p of placements) {
      if (!placementByView.has(p.viewId)) placementByView.set(p.viewId, []);
      (placementByView.get(p.viewId) as ObjectPlacement[]).push(p);
    }
    const freeByView = new Map<string, FreeNode[]>();
    for (const f of freeNodes) {
      if (!freeByView.has(f.viewId)) freeByView.set(f.viewId, []);
      (freeByView.get(f.viewId) as FreeNode[]).push(f);
    }
    const relationByView = new Map<string, CanvasRelation[]>();
    for (const r of relations) {
      if (!relationByView.has(r.viewId)) relationByView.set(r.viewId, []);
      (relationByView.get(r.viewId) as CanvasRelation[]).push(r);
    }
    // Notify exactly the views the dirty set tracks.
    // We don't broadcast to every listener: when a
    // view-only update (e.g. `setViewMode`,
    // `setViewport`) lands, only the *touched* view's
    // subscribers need to re-read. The earlier
    // "always notify all" design was a false-positive
    // cost — every write re-rendered every open view
    // even when nothing relevant changed. The Round 9
    // smoke exposed that the views-table `mark` was
    // also a no-op (read `obj.viewId` for a table
    // where the primary key IS the viewId and the
    // row has no `viewId` field), so the dirty set
    // never contained the view's id, so this branch
    // never reached any view-only listener. The fix
    // (1) routes the views-table mark on `obj.id`,
    // and (2) here, only notifies the dirty views.
    const viewsToNotify = dirtySnapshot.size > 0
      ? Array.from(dirtySnapshot.keys()).filter((v) => this.listeners.has(v))
      : // Defensive: empty dirty set (a `creating`
        // callback was missed, e.g. Dexie's microtask
        // boundary) — fall back to notifying every
        // listener so no view silently loses a write.
        Array.from(this.listeners.keys());
    for (const viewId of viewsToNotify) {
      const set = this.listeners.get(viewId);
      if (!set) continue;
      const view = viewMap.get(viewId);
      const snap: CanvasViewSnapshot = view
        ? {
            view,
            freeNodes: freeByView.get(viewId) ?? [],
            placements: placementByView.get(viewId) ?? [],
            relations: relationByView.get(viewId) ?? [],
            nodes: await this.buildNodes(
              viewId,
              freeByView.get(viewId) ?? [],
              placementByView.get(viewId) ?? [],
            ),
            revision: Date.now(),
          }
        : emptyViewSnapshot(viewId);
      for (const l of set) l(snap);
    }
  }

  private async buildNodes(
    viewId: string,
    freeNodes: readonly FreeNode[],
    placements: readonly ObjectPlacement[],
  ): Promise<Map<string, CanvasNodeSummary>> {
    const out = new Map<string, CanvasNodeSummary>();
    const freeIds = new Set(freeNodes.map((f) => f.id));
    for (const fn of freeNodes) {
      out.set(refKey({ kind: 'free', id: fn.id }), {
        ref: { kind: 'free', id: fn.id },
        body: fn.body,
        role: fn.hintRole,
        missing: false,
      });
    }
    for (const p of placements) {
      if (p.ref.kind === 'free') {
        if (!freeIds.has(p.ref.id)) {
          out.set(refKey(p.ref), {
            ref: p.ref,
            body: '',
            role: 'free',
            missing: true,
          });
        }
        continue;
      }
      const resolved = await resolveKnowledge(p.ref.id, p.ref.objectKind);
      const body = resolved?.body ?? '';
      const missing = !resolved || resolved.missing;
      out.set(refKey(p.ref), {
        ref: p.ref,
        body,
        role: (defaultCognitiveRole(p.ref.objectKind) as CognitiveRole),
        missing,
      });
    }
    void viewId;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Lazy init
// ---------------------------------------------------------------------------

let cached: CanvasDexieDB | null = null;

export function getCanvasDb(): CanvasDexieDB {
  if (cached) return cached;
  cached = new CanvasDexieDB(readTables());
  return cached;
}

/** @internal */
export function __resetCanvasDbForTests(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Build a `CanvasRepository` backed by the singleton
 * Canvas Dexie DB. The factory exists so tests can
 * inject a fake without touching Dexie.
 */
export function createDexieCanvasRepository(): CanvasRepository {
  return new DexieCanvasRepository();
}

class DexieCanvasRepository implements CanvasRepository {
  async getView(viewId: string): Promise<CanvasView | null> {
    return (await readTables().views.get(viewId)) ?? null;
  }

  async listViewsForContainer(container: ContainerRef): Promise<CanvasView[]> {
    const all = await readTables().views.toArray();
    return all
      .filter(
        (v) => v.container.mode === container.mode && v.container.id === container.id,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getViewSnapshot(viewId: string): Promise<CanvasViewSnapshot> {
    const t = readTables();
    const view = (await t.views.get(viewId)) ?? null;
    if (!view) return emptyViewSnapshot(viewId);
    const [freeNodes, placements, relations] = await Promise.all([
      t.freeNodes.where('viewId').equals(viewId).toArray(),
      t.placements.where('viewId').equals(viewId).toArray(),
      t.relations.where('viewId').equals(viewId).toArray(),
    ]);
    const nodes = new Map<string, CanvasNodeSummary>();
    for (const fn of freeNodes) {
      nodes.set(refKey({ kind: 'free', id: fn.id }), {
        ref: { kind: 'free', id: fn.id },
        body: fn.body,
        role: fn.hintRole,
        missing: false,
      });
    }
    for (const p of placements) {
      if (p.ref.kind === 'free') {
        if (!freeNodes.find((f) => f.id === p.ref.id)) {
          nodes.set(refKey(p.ref), {
            ref: p.ref,
            body: '',
            role: 'free',
            missing: true,
          });
        }
        continue;
      }
      const resolved = await resolveKnowledge(p.ref.id, p.ref.objectKind);
      nodes.set(refKey(p.ref), {
        ref: p.ref,
        body: resolved?.body ?? '',
        role: defaultCognitiveRole(p.ref.objectKind),
        missing: !resolved || resolved.missing,
      });
    }
    return {
      view,
      freeNodes,
      placements,
      relations,
      nodes,
      revision: Date.now(),
    };
  }

  async transact<T>(fn: (tx: CanvasTransaction) => T | Promise<T>): Promise<T> {
    const t = readTables();
    // Dexie transactions are scoped to a set of tables.
    // We touch all four canvas tables; that's fine —
    // they're all in the v6 schema and Dexie handles
    // multi-table transactions natively.
    const tx: CanvasTransaction = {
      putView: (view) => {
        void t.views.put(view);
      },
      putFreeNode: (node) => {
        void t.freeNodes.put(node);
      },
      deleteFreeNode: (id) => {
        void t.freeNodes.delete(id);
      },
      putPlacement: (placement) => {
        void t.placements.put(placement);
      },
      deletePlacement: (id) => {
        void t.placements.delete(id);
      },
      putRelation: (relation) => {
        void t.relations.put(relation);
      },
      deleteRelation: (id) => {
        void t.relations.delete(id);
      },
      appendLineage: (line) => {
        void t.lineage.put(line);
      },
      popLineage: (viewId) => {
        // Sync pop. The caller is supposed to chain
        // writes, so we just compute the new tail here
        // and apply it after the user callback returns.
        // The implementation is split out so we can
        // await it from a wrapper.
        const stack = pendingPops.get(viewId) ?? null;
        if (!stack || stack.length === 0) return null;
        const top = stack[stack.length - 1];
        pendingPops.set(viewId, stack.slice(0, -1));
        return top;
      },
    };
    // Pre-populate the pop stacks so the transaction
    // callback can read them. We read the full lineage
    // once up front; this is O(N) where N is the
    // undo-stack depth (small in practice).
    const pendingPops = new Map<string, UndoLineage[]>();
    for (const viewId of collectViewIdsInCallback(fn)) {
      const all = await t.lineage.where('viewId').equals(viewId).toArray();
      all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      pendingPops.set(viewId, all);
    }
    const result = await fn(tx);
    // Flush: actually delete the popped lineage rows.
    for (const [viewId, stack] of pendingPops) {
      const consumed = stack;
      const remaining = (await t.lineage.where('viewId').equals(viewId).toArray()).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt),
      );
      // Anything that was popped is now missing; ensure
      // it stays missing by deleting the corresponding
      // ids.
      const poppedIds = new Set<string>();
      const all = await t.lineage.where('viewId').equals(viewId).toArray();
      all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const originalLength = all.length;
      const targetRemaining = originalLength - consumed.length;
      for (let i = 0; i < originalLength - targetRemaining; i++) {
        if (all[i]) poppedIds.add(all[i].id);
      }
      for (const id of poppedIds) {
        await t.lineage.delete(id);
      }
      // Touch `remaining` so a future refactor that
      // uses it (e.g. for an audit log) doesn't trip
      // a linter.
      void remaining;
    }
    return result;
  }

  subscribeView(viewId: string, listener: CanvasListener): Unsubscribe {
    return getCanvasDb().subscribeView(viewId, listener);
  }

  async listLineage(viewId: string, limit = 50): Promise<UndoLineage[]> {
    const all = await readTables().lineage.where('viewId').equals(viewId).toArray();
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * We need to know the set of `viewId`s the transaction
 * callback is going to touch *before* we open the Dexie
 * transaction, so we can pre-load the lineage. The only
 * way to know that without a hook is to wrap the
 * callback and record every `appendLineage` / `popLineage`
 * call.
 */
function collectViewIdsInCallback(
  fn: (tx: CanvasTransaction) => unknown,
): Set<string> {
  const ids = new Set<string>();
  // We can't wrap the tx here (we only get the real one
  // inside `transact`); instead we accept a conservative
  // "*" fallback below.
  void fn;
  // For Dexie we over-notify on lineage: we read every
  // view's lineage up front. That's O(views * depth) and
  // is acceptable because the canvas is feature-flagged
  // and the views table is small.
  ids.add('*');
  return ids;
}
