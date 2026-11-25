/**
 * StudyKit v0.4 — `repositories/memoryCanvasRepository`
 *
 * In-memory implementation of the `CanvasRepository`
 * contract. Mirrors the pattern of `MemoryRepository` in
 * `domain/repository.ts`: a pure JS store with subscribe
 * support, used by the application use-case tests and
 * by future spike work that wants to run without
 * IndexedDB.
 *
 * The implementation is *deliberately* small. It does
 * not try to match Dexie's exact query semantics
 * (compound indexes, etc.); it just gives the use cases
 * a stable contract to drive. Anything that needs real
 * IndexedDB goes through `dexieCanvasRepository.ts`.
 */

import type {
  CanvasNodeSummary,
  CanvasRelation,
  CanvasView,
  CanvasViewSnapshot,
  CognitiveRole,
  FreeNode,
  ObjectPlacement,
  UndoLineage,
} from '../domain/canvas';
import { defaultCognitiveRole, refKey, sameRef } from '../domain/canvas';
import type { ContainerRef } from '../domain/workspace';
import type {
  CanvasListener,
  CanvasRepository,
  CanvasTransaction,
  Unsubscribe,
} from './canvas';
import { EMPTY_VIEW_ID, emptyViewSnapshot } from './canvas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function nodeSummaryForFree(node: FreeNode): CanvasNodeSummary {
  return {
    ref: { kind: 'free', id: node.id },
    body: node.body,
    role: node.hintRole === 'free' ? 'free' : node.hintRole,
    missing: false,
  };
}

function nodeSummaryForKnowledge(
  ref: { id: string; objectKind: import('../domain/repository').KnowledgeObjectKind },
  body: string,
  missing: boolean,
  roleOverride?: CognitiveRole,
): CanvasNodeSummary {
  const role = roleOverride ?? defaultCognitiveRole(ref.objectKind);
  return {
    ref: { kind: 'knowledge', id: ref.id, objectKind: ref.objectKind },
    body,
    role,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Memory adapter
// ---------------------------------------------------------------------------

export class MemoryCanvasRepository implements CanvasRepository {
  private readonly views = new Map<string, CanvasView>();
  private readonly freeNodes = new Map<string, FreeNode>();
  private readonly placements = new Map<string, ObjectPlacement>();
  private readonly relations = new Map<string, CanvasRelation>();
  private readonly lineage = new Map<string, UndoLineage[]>(); // viewId -> stack
  private readonly listeners = new Set<{
    viewId: string;
    listener: CanvasListener;
  }>();
  private revision = 0;
  /** Knowledge bodies keyed by canonical id, so the
   *  snapshot can fill in the `body` of a `knowledge`
   *  ref. Tests inject these via `seedKnowledge`. */
  private readonly knowledgeBodies = new Map<
    string,
    { objectKind: import('../domain/repository').KnowledgeObjectKind; body: string; missing: boolean }
  >();

  /** Test helper: pre-populate the body for a `knowledge`
   *  ref so the snapshot has something to display. */
  seedKnowledge(
    id: string,
    objectKind: import('../domain/repository').KnowledgeObjectKind,
    body: string,
    missing = false,
  ): void {
    this.knowledgeBodies.set(id, { objectKind, body, missing });
  }

  async getView(viewId: string): Promise<CanvasView | null> {
    return this.views.get(viewId) ?? null;
  }

  async listViewsForContainer(container: ContainerRef): Promise<CanvasView[]> {
    const out: CanvasView[] = [];
    for (const v of this.views.values()) {
      if (v.container.mode === container.mode && v.container.id === container.id) {
        out.push(v);
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  async getViewSnapshot(viewId: string): Promise<CanvasViewSnapshot> {
    const view = this.views.get(viewId);
    if (!view) {
      return emptyViewSnapshot(viewId);
    }
    const freeNodes: FreeNode[] = [];
    const placements: ObjectPlacement[] = [];
    const relations: CanvasRelation[] = [];
    for (const fn of this.freeNodes.values()) {
      if (fn.viewId === viewId) freeNodes.push(fn);
    }
    for (const p of this.placements.values()) {
      if (p.viewId === viewId) placements.push(p);
    }
    for (const r of this.relations.values()) {
      if (r.viewId === viewId) relations.push(r);
    }
    const nodes = new Map<string, CanvasNodeSummary>();
    for (const fn of freeNodes) {
      // FreeNode is a *node*, not a placement; surface the
      // ref under the same key the placement would use.
      nodes.set(refKey({ kind: 'free', id: fn.id }), nodeSummaryForFree(fn));
    }
    for (const p of placements) {
      const key = refKey(p.ref);
      if (p.ref.kind === 'free') {
        const fn = this.freeNodes.get(p.ref.id);
        if (fn) {
          nodes.set(key, nodeSummaryForFree(fn));
        } else {
          nodes.set(key, {
            ref: p.ref,
            body: '',
            role: 'free',
            missing: true,
          });
        }
      } else {
        const k = this.knowledgeBodies.get(p.ref.id);
        nodes.set(
          key,
          nodeSummaryForKnowledge(
            { id: p.ref.id, objectKind: p.ref.objectKind },
            k?.body ?? '',
            k?.missing ?? p.missing,
          ),
        );
      }
    }
    return {
      view,
      freeNodes,
      placements,
      relations,
      nodes,
      revision: this.revision,
    };
  }

  async transact<T>(fn: (tx: CanvasTransaction) => T | Promise<T>): Promise<T> {
    const stagedViews = new Map<string, CanvasView | null>();
    const stagedFree = new Map<string, FreeNode | null>();
    const stagedPlacements = new Map<string, ObjectPlacement | null>();
    const stagedRelations = new Map<string, CanvasRelation | null>();
    const stagedLineage = new Map<string, UndoLineage[]>();
    const lineageFor = (viewId: string): UndoLineage[] => {
      const existing = stagedLineage.get(viewId);
      if (existing) return existing;
      const copy = [...(this.lineage.get(viewId) ?? [])];
      stagedLineage.set(viewId, copy);
      return copy;
    };
    const tx: CanvasTransaction = {
      putView: (view) => {
        stagedViews.set(view.id, view);
      },
      putFreeNode: (node) => {
        stagedFree.set(node.id, node);
      },
      deleteFreeNode: (id) => {
        stagedFree.set(id, null);
      },
      putPlacement: (placement) => {
        stagedPlacements.set(placement.id, placement);
      },
      deletePlacement: (id) => {
        stagedPlacements.set(id, null);
      },
      putRelation: (relation) => {
        stagedRelations.set(relation.id, relation);
      },
      deleteRelation: (id) => {
        stagedRelations.set(id, null);
      },
      appendLineage: (line) => {
        lineageFor(line.viewId).push(line);
      },
      popLineage: (viewId) => {
        const stack = lineageFor(viewId);
        return stack.pop() ?? null;
      },
    };
    const result = await fn(tx);
    for (const [id, value] of stagedViews) {
      if (value === null) this.views.delete(id);
      else this.views.set(id, value);
    }
    for (const [id, value] of stagedFree) {
      if (value === null) this.freeNodes.delete(id);
      else this.freeNodes.set(id, value);
    }
    for (const [id, value] of stagedPlacements) {
      if (value === null) this.placements.delete(id);
      else this.placements.set(id, value);
    }
    for (const [id, value] of stagedRelations) {
      if (value === null) this.relations.delete(id);
      else this.relations.set(id, value);
    }
    for (const [viewId, stack] of stagedLineage) {
      this.lineage.set(viewId, stack);
    }
    this.revision += 1;
    this.notifyAll();
    return result;
  }

  subscribeView(viewId: string, listener: CanvasListener): Unsubscribe {
    const entry = { viewId, listener };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  async listLineage(viewId: string, limit = 50): Promise<UndoLineage[]> {
    const stack = this.lineage.get(viewId) ?? [];
    return stack.slice(-limit).reverse();
  }

  // --- Test-only helpers ---

  /** @internal Returns the live relation row, bypassing the
   *  readonly typing. Tests use it to assert canonical
   *  state without going through the snapshot path. */
  __rawRelation(id: string): CanvasRelation | undefined {
    return this.relations.get(id);
  }

  /** @internal Returns the live placement row. */
  __rawPlacement(id: string): ObjectPlacement | undefined {
    return this.placements.get(id);
  }

  /** @internal Returns the live free node. */
  __rawFreeNode(id: string): FreeNode | undefined {
    return this.freeNodes.get(id);
  }

  // --- Internal ---

  private notifyAll(): void {
    // Notify every listener. The view + the cognitive-
    // canvas adapter both subscribe to the same viewId;
    // we must call *every* listener or the adapter
    // never re-renders. Snapshot once per viewId
    // to avoid redundant `getViewSnapshot` calls,
    // but call each listener with that snapshot.
    const snapshotByView = new Map<string, Promise<CanvasViewSnapshot>>();
    for (const { viewId, listener } of Array.from(this.listeners)) {
      let snapPromise = snapshotByView.get(viewId);
      if (!snapPromise) {
        snapPromise = this.getViewSnapshot(viewId);
        snapshotByView.set(viewId, snapPromise);
      }
      void snapPromise.then((snapshot) => listener(snapshot));
    }
  }
}

// Re-export a couple of things tests reach for.
export { sameRef };
