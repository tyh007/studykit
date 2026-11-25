/**
 * StudyKit v0.4 — WP-09B Round 1 (Correction Gate, Final Delta)
 *
 * `platforms/desktop/sqliteStudyKitRepository`
 *
 * The desktop implementation of the `StudyKitRepository`
 * contract from `frontend/src/domain/repository.ts`. The
 * adapter speaks to Rust through a single typed
 * `WorkspaceClient`; it never touches `globalThis`, never
 * imports `@tauri-apps/api` directly, and never falls back to
 * a different command than the contract promises.
 *
 * # Workspace lifecycle (Bound state)
 *
 * The adapter is **bound** to one workspace for its entire
 * lifetime. The bound state is set in one of two ways:
 *
 *   - `initialSummary` is non-null: the workspace is already
 *     open. The adapter never calls `reopenLastWorkspace`.
 *   - `initialSummary` is null: the first operation that needs
 *     rows calls `reopenLastWorkspace` exactly once. On success
 *     the adapter marks itself bound and never calls reopen
 *     again — even after a `transact` invalidates the row cache
 *     and re-reads.
 *
 * # IPC commands used
 *
 *   - `reopen_last_workspace` — at most once per adapter, only
 *     when `initialSummary` is null and the cache is empty.
 *   - `read_object_v1` — every `getObject(id)` call, regardless
 *     of cache state. The cache is for `queryObjects` /
 *     `exportSnapshot` / `subscribe`; `getObject` is always a
 *     single-row read so the cache is not a useful cache.
 *   - `read_all_objects_v1` — only when the row cache is empty
 *     and we are already bound. A `transact` invalidates the
 *     cache and re-reads through this command; it never calls
 *     `reopen_last_workspace`.
 *   - `transact_v1` — one call per `transact(fn)`. The whole
 *     batch lands inside a single SQLite transaction on the
 *     Rust side.
 *
 * # Validation
 *
 * The frontend mapping in `rowToObject` is a strict boundary:
 * the Rust side already validates the values, and the WebView
 * narrows them again. Unknown `author_type`, malformed
 * `mode` / `kind` pairs, partial containers, or partial
 * container fields all throw a `WorkspaceIpcError` with kind
 * `STUDYKIT_VALIDATION_FAILED`. We never default an unknown
 * `container_kind` to `'project'`.
 */

import type {
  ExportArtifact,
  ExportFormat,
  ExportOptions,
  KnowledgeObject,
  KnowledgeObjectKind,
  ObjectQuery,
  ObjectState,
  QueryListener,
  RepositoryTransaction,
  StudyKitRepository,
  Unsubscribe,
} from '../../domain/repository';
import type {
  KnowledgeObjectAuthorType,
  KnowledgeObjectContainerKind,
  KnowledgeObjectContainerMode,
  KnowledgeObjectKind as WireKind,
  KnowledgeObjectRow,
  KnowledgeObjectState,
  TransactOperation,
  WorkspaceClient,
} from './workspaceClient';
import { WorkspaceIpcError } from './workspaceClient';

const VALID_KINDS: ReadonlySet<KnowledgeObjectKind> = new Set<KnowledgeObjectKind>([
  'source',
  'note',
  'concept',
  'question',
  'claim',
  'evidence',
  'task',
  'output',
]);

const VALID_STATES: ReadonlySet<ObjectState> = new Set<ObjectState>([
  'active',
  'archived',
  'trashed',
]);

const VALID_AUTHOR_TYPES: ReadonlySet<KnowledgeObjectAuthorType> = new Set<KnowledgeObjectAuthorType>([
  'user',
  'ai',
  'imported',
]);

const VALID_CONTAINER_MODES: ReadonlySet<KnowledgeObjectContainerMode> = new Set<KnowledgeObjectContainerMode>([
  'study',
  'research',
]);

const VALID_CONTAINER_KINDS: ReadonlySet<KnowledgeObjectContainerKind> = new Set<KnowledgeObjectContainerKind>([
  'course',
  'project',
]);

const ALLOWED_CONTAINER_PAIRS: ReadonlySet<string> = new Set([
  'study|course',
  'research|project',
]);

function validationError(message: string): WorkspaceIpcError {
  return new WorkspaceIpcError({
    kind: 'STUDYKIT_VALIDATION_FAILED',
    message,
  });
}

function rowToObject(row: KnowledgeObjectRow): KnowledgeObject {
  if (!VALID_KINDS.has(row.kind as KnowledgeObjectKind)) {
    throw validationError(`row has unknown kind '${row.kind}'`);
  }
  if (!VALID_STATES.has(row.state as ObjectState)) {
    throw validationError(`row has unknown state '${row.state}'`);
  }
  if (!VALID_AUTHOR_TYPES.has(row.author_type as KnowledgeObjectAuthorType)) {
    throw validationError(`row has unknown author_type '${row.author_type}'`);
  }

  const containerFields =
    [row.container_id, row.container_mode, row.container_kind] as const;
  const haveContainer = containerFields.some((v) => v !== null && v !== undefined);
  if (haveContainer) {
    if (row.container_id === null || row.container_id === undefined || row.container_id === '') {
      throw validationError('row has partial container: id is missing');
    }
    if (row.container_mode === null || row.container_mode === undefined) {
      throw validationError('row has partial container: mode is missing');
    }
    if (!VALID_CONTAINER_MODES.has(row.container_mode as KnowledgeObjectContainerMode)) {
      throw validationError(`row has unknown container_mode '${row.container_mode}'`);
    }
    if (row.container_kind === null || row.container_kind === undefined) {
      throw validationError('row has partial container: kind is missing');
    }
    if (!VALID_CONTAINER_KINDS.has(row.container_kind as KnowledgeObjectContainerKind)) {
      throw validationError(`row has unknown container_kind '${row.container_kind}'`);
    }
    const pair = `${row.container_mode}|${row.container_kind}`;
    if (!ALLOWED_CONTAINER_PAIRS.has(pair)) {
      throw validationError(`row has invalid container pairing '${pair}'`);
    }
    if (
      row.container_workspace_id !== null &&
      row.container_workspace_id !== undefined &&
      row.container_workspace_id === ''
    ) {
      throw validationError('row has empty container_workspace_id');
    }
  } else {
    if (
      row.container_workspace_id !== null &&
      row.container_workspace_id !== undefined
    ) {
      throw validationError('row has container_workspace_id without other container fields');
    }
  }

  const container = haveContainer
    ? {
        workspaceId: (row.container_workspace_id as string | null) ?? null,
        mode: row.container_mode as KnowledgeObjectContainerMode,
        kind: row.container_kind as KnowledgeObjectContainerKind,
        id: row.container_id as string,
      }
    : undefined;

  return {
    id: row.id,
    kind: row.kind as KnowledgeObjectKind,
    body: row.body,
    state: row.state as ObjectState,
    authorType: row.author_type as KnowledgeObjectAuthorType,
    container,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function objectToRow(object: KnowledgeObject): KnowledgeObjectRow {
  if (!VALID_KINDS.has(object.kind)) {
    throw validationError(`object '${object.id}' has unknown kind '${object.kind}'`);
  }
  if (!VALID_STATES.has(object.state)) {
    throw validationError(`object '${object.id}' has unknown state '${object.state}'`);
  }
  if (!VALID_AUTHOR_TYPES.has(object.authorType)) {
    throw validationError(`object '${object.id}' has unknown author_type '${object.authorType}'`);
  }
  let container_workspace_id: string | null = null;
  let container_mode: KnowledgeObjectContainerMode | null = null;
  let container_kind: KnowledgeObjectContainerKind | null = null;
  let container_id: string | null = null;
  if (object.container !== undefined) {
    container_workspace_id = object.container.workspaceId ?? null;
    container_mode = object.container.mode;
    container_kind = object.container.kind;
    container_id = object.container.id;
    if (!VALID_CONTAINER_MODES.has(container_mode)) {
      throw validationError(`object '${object.id}' has unknown container_mode '${container_mode}'`);
    }
    if (!VALID_CONTAINER_KINDS.has(container_kind)) {
      throw validationError(`object '${object.id}' has unknown container_kind '${container_kind}'`);
    }
    if (!ALLOWED_CONTAINER_PAIRS.has(`${container_mode}|${container_kind}`)) {
      throw validationError(
        `object '${object.id}' has invalid container pairing '${container_mode}|${container_kind}'`,
      );
    }
    if (container_id === '') {
      throw validationError(`object '${object.id}' has empty container.id`);
    }
  }
  return {
    id: object.id,
    kind: object.kind as WireKind,
    body: object.body,
    state: object.state as KnowledgeObjectState,
    author_type: object.authorType,
    container_workspace_id,
    container_mode,
    container_kind,
    container_id,
    created_at: object.createdAt,
    updated_at: object.updatedAt,
  };
}

export interface DesktopSqliteRepositoryDeps {
  readonly client: WorkspaceClient;
  /**
   * Optional pre-loaded summary. When present, the workspace
   * is treated as already-open and the adapter never calls
   * `reopenLastWorkspace`. When absent, the first operation
   * that needs rows calls `reopenLastWorkspace` exactly once.
   */
  readonly initialSummary?: { readonly root: string } | null;
}

/**
 * Construct a `StudyKitRepository` backed by the desktop
 * SQLite workspace. The adapter is bound to one workspace for
 * its lifetime; it never reopens a workspace that is already
 * bound.
 */
export function createDesktopSqliteRepository(
  deps: DesktopSqliteRepositoryDeps,
): StudyKitRepository {
  const { client } = deps;
  let workspaceBound = deps.initialSummary != null;
  let binding: Promise<void> | null = null;
  let cachedRows: ReadonlyArray<KnowledgeObjectRow> | null = null;
  const listeners = new Map<symbol, { query: ObjectQuery; listener: QueryListener }>();

  async function bind(): Promise<void> {
    if (workspaceBound) return;
    if (binding === null) {
      binding = client.reopenLastWorkspace()
        .then(() => {
          workspaceBound = true;
        })
        .finally(() => {
          binding = null;
        });
    }
    await binding;
  }

  async function loadAllRows(): Promise<ReadonlyArray<KnowledgeObjectRow>> {
    await bind();
    const rows = await client.readAllObjects();
    cachedRows = rows;
    return rows;
  }

  function invalidateCache(): void {
    cachedRows = null;
  }

  function notify(): void {
    const rows = cachedRows ?? [];
    for (const { query, listener } of listeners.values()) {
      void filterRows(rows, query).then((matched) => listener(matched));
    }
  }

  async function filterRows(
    rows: ReadonlyArray<KnowledgeObjectRow>,
    query: ObjectQuery,
  ): Promise<ReadonlyArray<KnowledgeObject>> {
    const matched: KnowledgeObject[] = [];
    for (const row of rows) {
      const obj = rowToObject(row);
      if (!matchesQuery(obj, query)) continue;
      matched.push(obj);
    }
    matched.sort((a, b) => a.id.localeCompare(b.id));
    return matched;
  }

  return {
    // `getObject` is a single-row read. We always go through
    // `client.readObject` so the cache is irrelevant — no
    // second reopen, no re-bind, just one IPC round-trip.
    async getObject(id) {
      await bind();
      const row = await client.readObject(id);
      return row ? rowToObject(row) : null;
    },
    async queryObjects(query) {
      const rows = await loadAllRows();
      const matched = await filterRows(rows, query);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? Number.POSITIVE_INFINITY;
      return matched.slice(offset, offset + limit);
    },
    async transact<T>(fn: (tx: RepositoryTransaction) => T | Promise<T>): Promise<T> {
      const staged: TransactOperation[] = [];
      const tx: RepositoryTransaction = {
        put(object) {
          staged.push({ op: 'put', row: objectToRow(object) });
        },
        delete(id) {
          staged.push({ op: 'delete', id });
        },
      };
      const result = await fn(tx);
      if (staged.length > 0) {
        // The bind must happen BEFORE the IPC call so the
        // Rust side can accept the transact on the open
        // workspace. (A fresh `unbound` adapter cannot call
        // transact without first reopening.)
        await bind();
        await client.transact({ operations: staged });
        // The Rust side committed. Refresh the row cache by
        // reading again — we never call `reopenLastWorkspace`
        // here.
        invalidateCache();
        await loadAllRows();
        notify();
      }
      return result;
    },
    subscribe(query, listener): Unsubscribe {
      const key = Symbol('desktopRepoSubscribe');
      listeners.set(key, { query, listener });
      void (async () => {
        const rows = await loadAllRows();
        const matched = await filterRows(rows, query);
        listener(matched);
      })();
      return () => {
        listeners.delete(key);
      };
    },
    async exportSnapshot(options: ExportOptions): Promise<ExportArtifact> {
      const format: ExportFormat = options.format ?? 'json';
      if (options.scope === 'container' && (!options.containerId || options.containerId.length === 0)) {
        throw new Error('exportSnapshot: scope="container" requires a non-empty containerId.');
      }
      if (
        options.scope === 'selection' &&
        (!options.objectIds || options.objectIds.length === 0)
      ) {
        throw new Error('exportSnapshot: scope="selection" requires non-empty objectIds.');
      }
      const rows = await loadAllRows();
      const all = await filterRows(rows, {});
      let ids: readonly string[];
      if (options.scope === 'selection' && options.objectIds) {
        ids = [...options.objectIds];
      } else if (options.scope === 'container' && options.containerId) {
        ids = all.filter((o) => o.container?.id === options.containerId).map((o) => o.id);
      } else {
        ids = all.map((o) => o.id);
      }
      const byId = new Map(all.map((o) => [o.id, o] as const));
      const objects = ids
        .map((id) => byId.get(id))
        .filter((o): o is KnowledgeObject => o !== undefined);
      return {
        schemaVersion: 1,
        producedAt: new Date().toISOString(),
        format,
        payload: JSON.stringify({ objects }),
        objectIds: ids,
      };
    },
  };
}

function matchesQuery(obj: KnowledgeObject, query: ObjectQuery): boolean {
  if (query.kind && obj.kind !== query.kind) return false;
  const state = query.state ?? 'active';
  if (obj.state !== state) return false;
  if (query.containerId && obj.container?.id !== query.containerId) return false;
  if (query.text && !obj.body.toLowerCase().includes(query.text.toLowerCase())) {
    return false;
  }
  return true;
}
