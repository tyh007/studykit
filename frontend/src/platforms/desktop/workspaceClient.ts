/**
 * StudyKit v0.4 — WP-09B Round 1 (Correction Gate)
 *
 * `platforms/desktop/workspaceClient`
 *
 * The narrow, typed surface that wraps the Tauri IPC commands
 * the Rust shell exposes. The client owns:
 *
 *   - The full command set: workspace lifecycle
 *     (`chooseAndCreate`, `chooseAndOpen`, `reopenLast`,
 *     `close`, `getHealth`) and the knowledge-object CRUD
 *     (`readObject`, `readAllObjects`, `transact`).
 *   - A single `TauriInvoke` function. The production
 *     constructor resolves to `@tauri-apps/api/core`'s `invoke`
 *     through a top-level import (Vite bundles it into the
 *     desktop bundle). Tests inject their own typed function.
 *   - A typed `WorkspaceIpcError` envelope that surfaces every
 *     Rust error to the rest of the desktop code with the
 *     stable `STUDYKIT_*` kind discriminator.
 *
 * The client is honest about runtime availability. When
 * `__TAURI_INTERNALS__` is absent (a normal browser tab, a
 * Vitest run), every command throws a
 * `WorkspaceIpcError` with kind `STUDYKIT_NO_LAST_WORKSPACE`.
 * There is no silent fallback, no require(), no fake
 * production path.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Wire types — stable contract with the Rust IPC.
// ---------------------------------------------------------------------------

/** Error kinds exposed by the Rust workspace manager. */
export type WorkspaceErrorKind =
  | 'STUDYKIT_PATH_REJECTED'
  | 'STUDYKIT_NOT_A_WORKSPACE'
  | 'STUDYKIT_FORMAT_TOO_NEW'
  | 'STUDYKIT_MANIFEST_CORRUPT'
  | 'STUDYKIT_DB_UNUSABLE'
  | 'STUDYKIT_CREATION_FAILED'
  | 'STUDYKIT_ANOTHER_OPEN'
  | 'STUDYKIT_NO_LAST_WORKSPACE'
  | 'STUDYKIT_VALIDATION_FAILED';

/** Stable IPC error envelope. The `kind` is the discriminator; `message`
 *  is for logs and the developer-facing channel. */
export interface WorkspaceErrorShape {
  readonly kind: WorkspaceErrorKind;
  readonly message: string;
}

/** Knowledge-object kinds allowed by the contract. Mirrors `domain/repository`. */
export type KnowledgeObjectKind =
  | 'source'
  | 'note'
  | 'concept'
  | 'question'
  | 'claim'
  | 'evidence'
  | 'task'
  | 'output';

/** Knowledge-object states allowed by the contract. */
export type KnowledgeObjectState = 'active' | 'archived' | 'trashed';

/** Provenance of a knowledge object. */
export type KnowledgeObjectAuthorType = 'user' | 'ai' | 'imported';

/** Container pairing allowed by the strict validation boundary. */
export type KnowledgeObjectContainerMode = 'study' | 'research';
export type KnowledgeObjectContainerKind = 'course' | 'project';

/** The knowledge-object payload that crosses the IPC boundary. */
export interface KnowledgeObjectRow {
  readonly id: string;
  readonly kind: KnowledgeObjectKind;
  readonly body: string;
  readonly state: KnowledgeObjectState;
  readonly author_type: KnowledgeObjectAuthorType;
  readonly container_workspace_id: string | null;
  readonly container_mode: KnowledgeObjectContainerMode | null;
  readonly container_kind: KnowledgeObjectContainerKind | null;
  readonly container_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Subset of `workspace.json` returned by the Rust side. */
export interface WorkspaceManifestSummary {
  readonly schema: string;
  readonly id: string;
  readonly formatVersion: number;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Returned by `chooseAndCreateWorkspace`, `chooseAndOpenWorkspace`,
 *  and `reopenLastWorkspace`. */
export interface OpenWorkspaceSummary {
  readonly root: string;
  readonly manifest: WorkspaceManifestSummary;
}

/** Returned by `getWorkspaceHealth`. */
export interface WorkspaceHealth {
  readonly root: string;
  readonly manifest_id: string;
  readonly display_name: string;
  readonly format_version: number;
  readonly schema_version: number;
  readonly integrity: string;
  readonly has_knowledge_objects: boolean;
  readonly recovered_after_crash?: boolean;
}

export interface MigrationSummary {
  readonly run_id: string;
  readonly status: 'completed' | 'rolled_back';
  readonly source_hash: string;
  readonly source_count: number;
  readonly imported_count: number;
  readonly backup_path: string;
}

export interface BackupSummary {
  readonly path: string;
  readonly created_at: string;
  readonly database_sha256: string;
  readonly asset_files: number;
}

export interface QuickCapture {
  readonly id: string;
  readonly body: string;
  readonly source_kind: 'text' | 'clipboard' | 'url' | 'file';
  readonly status: 'inbox' | 'archived';
  readonly privacy: 'private';
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LocalAiDiscovery {
  readonly reachable: boolean;
  readonly endpoint: string;
  readonly models: readonly string[];
  readonly error: string | null;
}

export interface LocalAiMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LocalAiChatResponse {
  readonly content: string;
  readonly provider: 'ollama';
  readonly model: string;
}

export interface GlobalShortcutStatus {
  readonly shortcut: string;
  readonly available: boolean;
  readonly error: string | null;
}

/** Metadata for a PDF copied into the currently open workspace. */
export interface WorkspaceAssetSummary {
  readonly asset_id: string;
  readonly original_filename: string;
  readonly mime_type: 'application/pdf';
  readonly size_bytes: number;
  readonly content_hash: string;
  readonly stored_at: string;
}

/** A typed wrapper around the wire error so callers can `throw` it. */
export class WorkspaceIpcError extends Error {
  readonly kind: WorkspaceErrorKind;
  readonly detail: WorkspaceErrorShape;

  constructor(shape: WorkspaceErrorShape) {
    super(`${shape.kind}: ${shape.message}`);
    this.kind = shape.kind;
    this.detail = shape;
    this.name = 'WorkspaceIpcError';
  }
}

/** A single operation inside an atomic `transact_v1` call. */
export type TransactOperation =
  | { readonly op: 'put'; readonly row: KnowledgeObjectRow }
  | { readonly op: 'delete'; readonly id: string };

/** The payload that crosses the IPC boundary for `transact_v1`. */
export interface TransactPayload {
  readonly operations: ReadonlyArray<TransactOperation>;
}

export interface DomainRecordRow {
  readonly namespace: string;
  readonly entity_type: string;
  readonly id: string;
  readonly payload: string;
  readonly updated_at: string;
}

export type DomainTransactOperation =
  | { readonly op: 'put'; readonly row: DomainRecordRow }
  | {
      readonly op: 'delete';
      readonly namespace: string;
      readonly entity_type: string;
      readonly id: string;
    };

export interface DomainTransactPayload {
  readonly operations: ReadonlyArray<DomainTransactOperation>;
}

/** The narrow typed function used by `WorkspaceClient`. Tests inject
 *  their own implementation; production wires the
 *  `@tauri-apps/api/core` `invoke` directly. */
export type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

// ---------------------------------------------------------------------------
// Runtime detection.
// ---------------------------------------------------------------------------

/**
 * Return `true` iff the current global scope is a Tauri 2 host.
 * The check is a structural `typeof` test on the host marker;
 * it never reads private fields from the internals object.
 */
export function hasTauriRuntime(): boolean {
  const g = globalThis as { __TAURI_INTERNALS__?: unknown };
  return typeof g.__TAURI_INTERNALS__ === 'object' && g.__TAURI_INTERNALS__ !== null;
}

// ---------------------------------------------------------------------------
// IPC envelope surfacing.
// ---------------------------------------------------------------------------

function isWorkspaceErrorShape(value: unknown): value is WorkspaceErrorShape {
  if (value === null || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; message?: unknown };
  return typeof v.kind === 'string' && typeof v.message === 'string';
}

/**
 * Detect whether the runtime is a Tauri host. Used by the
 * browser-tab / test path so the adapter surfaces a clean
 * `STUDYKIT_NO_LAST_WORKSPACE` instead of crashing.
 */
function noTauriError(cmd: string): WorkspaceIpcError {
  return new WorkspaceIpcError({
    kind: 'STUDYKIT_NO_LAST_WORKSPACE',
    message: `cannot invoke '${cmd}': no Tauri runtime present`,
  });
}

// ---------------------------------------------------------------------------
// Public API — one method per Rust command.
// ---------------------------------------------------------------------------

export interface WorkspaceClient {
  readonly hasTauriRuntime: boolean;

  // Workspace lifecycle
  chooseAndCreateWorkspace(displayName: string): Promise<OpenWorkspaceSummary>;
  chooseAndOpenWorkspace(): Promise<OpenWorkspaceSummary>;
  reopenLastWorkspace(): Promise<OpenWorkspaceSummary>;
  closeWorkspace(): Promise<void>;
  getWorkspaceHealth(): Promise<WorkspaceHealth>;

  // Knowledge-object CRUD
  readObject(id: string): Promise<KnowledgeObjectRow | null>;
  readAllObjects(): Promise<ReadonlyArray<KnowledgeObjectRow>>;
  transact(payload: TransactPayload): Promise<void>;
  readDomainRecords(namespace: string): Promise<ReadonlyArray<DomainRecordRow>>;
  transactDomainRecords(payload: DomainTransactPayload): Promise<void>;

  importLegacySnapshot?(
    runId: string,
    snapshotJson: string,
    sourceHash: string,
    records: ReadonlyArray<DomainRecordRow>,
  ): Promise<MigrationSummary>;
  rollbackLegacyMigration?(runId: string): Promise<MigrationSummary>;
  getLatestLegacyMigration?(): Promise<MigrationSummary | null>;
  createWorkspaceBackup?(): Promise<BackupSummary>;
  saveQuickCapture?(body: string, sourceKind?: QuickCapture['source_kind']): Promise<QuickCapture>;
  listQuickCaptures?(): Promise<ReadonlyArray<QuickCapture>>;
  archiveQuickCapture?(id: string): Promise<void>;
  discoverLocalAi?(): Promise<LocalAiDiscovery>;
  localAiChat?(model: string, messages: ReadonlyArray<LocalAiMessage>): Promise<LocalAiChatResponse>;
  getGlobalShortcutStatus?(): Promise<GlobalShortcutStatus>;
  chooseAndImportPdfAsset?(): Promise<WorkspaceAssetSummary | null>;
  readWorkspaceAsset?(assetId: string): Promise<Uint8Array>;
  discardWorkspaceAsset?(assetId: string): Promise<void>;
}

/**
 * Construct a `WorkspaceClient` backed by an injected
 * `TauriInvoke` function. The function MUST come from
 * `@tauri-apps/api/core` in production; tests pass their own
 * stub through this same constructor.
 */
export function createWorkspaceClient(invoke: TauriInvoke): WorkspaceClient {
  const runtimeAvailable = hasTauriRuntime();

  async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!runtimeAvailable) {
      throw noTauriError(cmd);
    }
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      if (err instanceof WorkspaceIpcError) throw err;
      if (isWorkspaceErrorShape(err)) {
        throw new WorkspaceIpcError(err);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkspaceIpcError({
        kind: 'STUDYKIT_DB_UNUSABLE',
        message: `unexpected IPC failure for '${cmd}': ${message}`,
      });
    }
  }

  return {
    hasTauriRuntime: runtimeAvailable,

    chooseAndCreateWorkspace: (displayName) =>
      call<OpenWorkspaceSummary>('choose_and_create_workspace', { displayName }),
    chooseAndOpenWorkspace: () => call<OpenWorkspaceSummary>('choose_and_open_workspace', {}),
    reopenLastWorkspace: () => call<OpenWorkspaceSummary>('reopen_last_workspace', {}),
    closeWorkspace: () => call<void>('close_workspace', {}),
    getWorkspaceHealth: () => call<WorkspaceHealth>('get_workspace_health', {}),

    readObject: (id) => call<KnowledgeObjectRow | null>('read_object_v1', { id }),
    readAllObjects: () => call<ReadonlyArray<KnowledgeObjectRow>>('read_all_objects_v1', {}),
    transact: (payload) =>
      call<void>('transact_v1', payload as unknown as Record<string, unknown>),
    readDomainRecords: (namespace) =>
      call<ReadonlyArray<DomainRecordRow>>('read_domain_records_v1', { namespace }),
    transactDomainRecords: (payload) =>
      call<void>(
        'transact_domain_records_v1',
        payload as unknown as Record<string, unknown>,
      ),
    importLegacySnapshot: (runId, snapshotJson, sourceHash, records) =>
      call<MigrationSummary>('import_legacy_snapshot_v1', {
        runId,
        snapshotJson,
        sourceHash,
        records,
      }),
    rollbackLegacyMigration: (runId) =>
      call<MigrationSummary>('rollback_legacy_migration_v1', { runId }),
    getLatestLegacyMigration: () =>
      call<MigrationSummary | null>('get_latest_legacy_migration_v1', {}),
    createWorkspaceBackup: () =>
      call<BackupSummary>('create_workspace_backup_v1', {}),
    saveQuickCapture: (body, sourceKind = 'text') =>
      call<QuickCapture>('save_quick_capture_v1', { body, sourceKind }),
    listQuickCaptures: () =>
      call<ReadonlyArray<QuickCapture>>('list_quick_captures_v1', {}),
    archiveQuickCapture: (id) =>
      call<void>('archive_quick_capture_v1', { id }),
    discoverLocalAi: () =>
      call<LocalAiDiscovery>('discover_local_ai_v1', {}),
    localAiChat: (model, messages) =>
      call<LocalAiChatResponse>('local_ai_chat_v1', { model, messages }),
    getGlobalShortcutStatus: () =>
      call<GlobalShortcutStatus>('get_global_shortcut_status_v1', {}),
    chooseAndImportPdfAsset: () =>
      call<WorkspaceAssetSummary | null>('choose_and_import_pdf_asset_v1', {}),
    readWorkspaceAsset: async (assetId) => {
      const bytes = await call<ArrayBuffer | number[]>('read_workspace_asset_v1', {
        assetId,
      });
      return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
    },
    discardWorkspaceAsset: (assetId) =>
      call<void>('discard_workspace_asset_v1', { assetId }),
  };
}

/**
 * Production constructor. Wires the client to the real
 * `@tauri-apps/api/core` `invoke` and the Tauri 2 host marker.
 * Calling this in a non-Tauri environment does NOT crash; it
 * returns a client whose every command surfaces
 * `STUDYKIT_NO_LAST_WORKSPACE`. UI code can detect the
 * situation through `client.hasTauriRuntime`.
 *
   * The optional `invokeOverride` parameter exists only so unit
 * tests can replace the underlying `invoke` with a mock. The
   * production path never passes it. This seam lets Vitest drive
   * the same constructor without attempting a real native IPC.
 */
export function createTauriWorkspaceClient(invokeOverride?: TauriInvoke): WorkspaceClient {
  return createWorkspaceClient(invokeOverride ?? tauriInvoke);
}
