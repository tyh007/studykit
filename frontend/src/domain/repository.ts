/**
 * StudyKit v0.4 — Repository contract
 *
 * This is the *minimum* surface area WP-00 needs so the new v0.4 code
 * (and the future Dexie / SQLite adapters) can be tested in isolation.
 *
 * It is intentionally small:
 *   - `getObject` / `queryObjects` for read paths.
 *   - `transact` for atomic writes.
 *   - `subscribe` for live updates (used by the future App Shell).
 *   - `exportSnapshot` for the future backup/import flow.
 *
 * Constraints inherited from the v0.4 system design:
 *   - UI components must never import Dexie tables, the SQLite client,
 *     or the HTTP client directly (ADR-004).
 *   - Web keeps Dexie/IndexedDB; Desktop will use Tauri + SQLite.
 *     Both adapters must satisfy this same contract.
 *   - WP-00 does *not* implement either adapter; it only ships the
 *     contract and an in-memory `MemoryRepository` for tests.
 */

import type { ContainerRef } from './workspace';

// ---------------------------------------------------------------------------
// Knowledge object
// ---------------------------------------------------------------------------

/**
 * The union of canonical object kinds in v0.4 (PRD §4.3, system design §4.2).
 * This is deliberately separate from v0.3 types like `Module` / `Lecture` —
 * migration of v0.3 data is out of scope for WP-00.
 */
export type KnowledgeObjectKind =
  | 'source'
  | 'note'
  | 'concept'
  | 'question'
  | 'claim'
  | 'evidence'
  | 'task'
  | 'output';

export const KNOWLEDGE_OBJECT_KINDS: readonly KnowledgeObjectKind[] = [
  'source',
  'note',
  'concept',
  'question',
  'claim',
  'evidence',
  'task',
  'output',
] as const;

export function isKnowledgeObjectKind(value: unknown): value is KnowledgeObjectKind {
  return (
    value === 'source' ||
    value === 'note' ||
    value === 'concept' ||
    value === 'question' ||
    value === 'claim' ||
    value === 'evidence' ||
    value === 'task' ||
    value === 'output'
  );
}

export type ObjectState = 'active' | 'archived' | 'trashed';
export type AuthorType = 'user' | 'ai' | 'imported';

/**
 * A canonical, cross-mode knowledge object. Body is intentionally a
 * single string in WP-00; richer rich-text bodies will be added in
 * later packets without breaking the contract.
 */
export interface KnowledgeObject {
  readonly id: string;
  readonly kind: KnowledgeObjectKind;
  readonly body: string;
  readonly state: ObjectState;
  readonly authorType: AuthorType;
  readonly createdAt: string; // ISO timestamp
  readonly updatedAt: string; // ISO timestamp
  /** Container this object is filed under (course or project). Optional. */
  readonly container?: ContainerRef;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface ObjectQuery {
  readonly kind?: KnowledgeObjectKind;
  /** Restrict to objects filed under this container. */
  readonly containerId?: string;
  /** Free-text search over `body`. Adapter-defined semantics. */
  readonly text?: string;
  readonly limit?: number;
  readonly offset?: number;
  /** Restrict to objects in a given state. Defaults to `active`. */
  readonly state?: ObjectState;
}

export function isObjectQuery(value: unknown): value is ObjectQuery {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== undefined && !isKnowledgeObjectKind(v.kind)) return false;
  if (v.containerId !== undefined && typeof v.containerId !== 'string') return false;
  if (v.text !== undefined && typeof v.text !== 'string') return false;
  if (v.limit !== undefined && (typeof v.limit !== 'number' || v.limit < 0)) return false;
  if (v.offset !== undefined && (typeof v.offset !== 'number' || v.offset < 0)) return false;
  if (v.state !== undefined && v.state !== 'active' && v.state !== 'archived' && v.state !== 'trashed') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

/**
 * A write handle passed to `Repository.transact`. Implementations must
 * make the whole callback atomic — either every `put` / `delete` applies
 * or none of them do.
 */
export interface RepositoryTransaction {
  put(object: KnowledgeObject): void;
  delete(id: string): void;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type QueryListener = (objects: readonly KnowledgeObject[]) => void;
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'json' | 'studykit-bundle';

export interface ExportOptions {
  /** What to include in the snapshot. */
  readonly scope?: 'workspace' | 'container' | 'selection';
  /**
   * Required when `scope === 'container'`. Must be a non-empty string.
   * Implementations MUST throw if it is missing or empty rather than
   * silently fall back to a workspace-wide export — that would leak
   * objects from other containers and break the user's scope intent.
   */
  readonly containerId?: string;
  /**
   * Required when `scope === 'selection'`. Must be a non-empty list.
   * Implementations MUST throw if it is missing or empty rather than
   * silently fall back to a workspace-wide export.
   */
  readonly objectIds?: readonly string[];
  readonly format?: ExportFormat;
}

export interface ExportArtifact {
  readonly schemaVersion: number;
  readonly producedAt: string;
  readonly format: ExportFormat;
  /** Serialised payload. JSON for `'json'`, opaque for `'studykit-bundle'`. */
  readonly payload: string;
  /** Object ids included in the snapshot, in stable order. */
  readonly objectIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * The contract every persistence adapter must implement. Adapters live
 * under `frontend/src/platforms/<web|desktop>/`. The Web adapter will
 * keep using Dexie/IndexedDB; the future Desktop adapter will use
 * Tauri + SQLite. WP-00 ships neither — only the contract and the
 * in-memory `MemoryRepository` used by tests.
 */
export interface StudyKitRepository {
  getObject(id: string): Promise<KnowledgeObject | null>;
  queryObjects(query: ObjectQuery): Promise<KnowledgeObject[]>;
  transact<T>(fn: (tx: RepositoryTransaction) => T | Promise<T>): Promise<T>;
  subscribe(query: ObjectQuery, listener: QueryListener): Unsubscribe;
  /**
   * Build an export artifact.
   *
   * MUST throw when `scope === 'container'` is requested without a
   * non-empty `containerId`, or when `scope === 'selection'` is
   * requested without a non-empty `objectIds`. Silently falling back
   * to a workspace-wide export is a data-leak hazard.
   */
  exportSnapshot(options: ExportOptions): Promise<ExportArtifact>;
}

// ---------------------------------------------------------------------------
// In-memory adapter (for tests + future spike work)
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory implementation. Not a production store. It exists so:
 *   1. Contract tests can be written today, before the Dexie / SQLite
 *      adapters land.
 *   2. UI spike work in later packets can run without a database.
 */
export class MemoryRepository implements StudyKitRepository {
  private readonly objects = new Map<string, KnowledgeObject>();
  private readonly listeners = new Set<{
    query: ObjectQuery;
    listener: QueryListener;
  }>();

  async getObject(id: string): Promise<KnowledgeObject | null> {
    return this.objects.get(id) ?? null;
  }

  async queryObjects(query: ObjectQuery): Promise<KnowledgeObject[]> {
    const state = query.state ?? 'active';
    const offset = query.offset ?? 0;
    const limit = query.limit ?? Number.POSITIVE_INFINITY;
    const all: KnowledgeObject[] = [];
    for (const obj of this.objects.values()) {
      if (query.kind && obj.kind !== query.kind) continue;
      if (obj.state !== state) continue;
      if (query.containerId && obj.container?.id !== query.containerId) continue;
      if (query.text && !obj.body.toLowerCase().includes(query.text.toLowerCase())) {
        continue;
      }
      all.push(obj);
    }
    // Stable order by id for deterministic tests.
    all.sort((a, b) => a.id.localeCompare(b.id));
    return all.slice(offset, offset + limit);
  }

  async transact<T>(fn: (tx: RepositoryTransaction) => T | Promise<T>): Promise<T> {
    const staged = new Map<string, KnowledgeObject | null>();
    const tx: RepositoryTransaction = {
      put: (object) => {
        staged.set(object.id, object);
      },
      delete: (id) => {
        staged.set(id, null);
      },
    };
    const result = await fn(tx);
    for (const [id, value] of staged) {
      if (value === null) {
        this.objects.delete(id);
      } else {
        this.objects.set(id, value);
      }
    }
    this.notify();
    return result;
  }

  subscribe(query: ObjectQuery, listener: QueryListener): Unsubscribe {
    const entry = { query, listener };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  async exportSnapshot(options: ExportOptions): Promise<ExportArtifact> {
    const format: ExportFormat = options.format ?? 'json';
    const scope = options.scope ?? 'workspace';
    // Guard the scope parameters. Falling back to a workspace-wide
    // export when a caller explicitly asked for a narrower scope is a
    // privacy / data-leak hazard: a UI that forgot to wire a
    // `containerId` would otherwise silently export the *whole*
    // workspace. We refuse instead, so the bug is caught at the
    // boundary rather than at the user's expense.
    if (scope === 'container' && (!options.containerId || options.containerId.length === 0)) {
      throw new Error(
        'exportSnapshot: scope="container" requires a non-empty containerId.',
      );
    }
    if (
      scope === 'selection' &&
      (!options.objectIds || options.objectIds.length === 0)
    ) {
      throw new Error(
        'exportSnapshot: scope="selection" requires non-empty objectIds.',
      );
    }
    let ids: string[];
    if (scope === 'selection' && options.objectIds) {
      ids = [...options.objectIds];
    } else if (scope === 'container' && options.containerId) {
      const all = await this.queryObjects({ containerId: options.containerId });
      ids = all.map((o) => o.id);
    } else {
      ids = Array.from(this.objects.keys()).sort();
    }
    const objects = ids
      .map((id) => this.objects.get(id))
      .filter((o): o is KnowledgeObject => o !== undefined);
    return {
      schemaVersion: 1,
      producedAt: new Date(0).toISOString(),
      format,
      payload: JSON.stringify({ objects }),
      objectIds: ids,
    };
  }

  private notify(): void {
    for (const { query, listener } of this.listeners) {
      void this.queryObjects(query).then((results) => listener(results));
    }
  }
}
