/**
 * StudyKit v0.4 — WP-09B Round 1 (Correction Gate)
 *
 * `platforms/desktop/workspaceClient` tests.
 *
 * The tests verify the typed `WorkspaceClient` without
 * touching `globalThis.__desktopRepoBridge__` or relying on a
 * test-only global. We inject a stub `TauriInvoke` through the
 * public constructor and confirm every command routes to the
 * correct Rust IPC with the correct payload, surfaces a stable
 * `WorkspaceIpcError` on a Rust envelope, and degrades cleanly
 * outside a Tauri host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceClient,
  createTauriWorkspaceClient,
  hasTauriRuntime,
  WorkspaceIpcError,
  type OpenWorkspaceSummary,
  type TauriInvoke,
  type TransactPayload,
  type WorkspaceClient,
  type WorkspaceHealth,
} from './workspaceClient';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';
type InternalsCarrier = { [TAURI_INTERNALS_KEY]?: unknown };

const originalInternals = (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY];

class StubInvoke {
  calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  responses = new Map<string, unknown>();
  errors = new Map<string, { kind: string; message: string }>();

  setResponse(cmd: string, value: unknown): void {
    this.responses.set(cmd, value);
  }

  setError(cmd: string, kind: string, message: string): void {
    this.errors.set(cmd, { kind, message });
  }

  build(): TauriInvoke {
    return async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      this.calls.push({ cmd, args });
      if (this.errors.has(cmd)) {
        throw this.errors.get(cmd);
      }
      if (this.responses.has(cmd)) {
        return this.responses.get(cmd) as T;
      }
      throw new Error(`stub: no response for '${cmd}'`);
    };
  }
}

beforeEach(() => {
  delete (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY];
});

afterEach(() => {
  if (originalInternals === undefined) {
    delete (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY];
  } else {
    (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY] = originalInternals;
  }
});

function withTauriHost(): void {
  (globalThis as InternalsCarrier)[TAURI_INTERNALS_KEY] = {};
}

// ---------------------------------------------------------------------------
// hasTauriRuntime
// ---------------------------------------------------------------------------

describe('hasTauriRuntime', () => {
  it('returns false when globalThis is clean', () => {
    expect(hasTauriRuntime()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is present', () => {
    withTauriHost();
    expect(hasTauriRuntime()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Client surface under a Tauri host
// ---------------------------------------------------------------------------

describe('createWorkspaceClient under Tauri host', () => {
  it('routes every command to the expected Rust IPC', async () => {
    withTauriHost();
    const stub = new StubInvoke();
    const summary: OpenWorkspaceSummary = {
      root: '/tmp/example',
      manifest: {
        schema: 'studykit.workspace/1',
        id: 'abc',
        formatVersion: 1,
        displayName: 'Demo',
        createdAt: '2026-07-29T00:00:00Z',
        updatedAt: '2026-07-29T00:00:00Z',
      },
    };
    const health: WorkspaceHealth = {
      root: '/tmp/example',
      manifest_id: 'abc',
      display_name: 'Demo',
      format_version: 1,
      schema_version: 1,
      integrity: 'ok',
      has_knowledge_objects: false,
    };
    stub.setResponse('choose_and_create_workspace', summary);
    stub.setResponse('choose_and_open_workspace', summary);
    stub.setResponse('reopen_last_workspace', summary);
    stub.setResponse('close_workspace', undefined);
    stub.setResponse('get_workspace_health', health);
    stub.setResponse('read_object_v1', null);
    stub.setResponse('read_all_objects_v1', []);
    stub.setResponse('transact_v1', undefined);
    stub.setResponse('read_domain_records_v1', []);
    stub.setResponse('transact_domain_records_v1', undefined);
    stub.setResponse('choose_and_import_pdf_asset_v1', {
      asset_id: 'asset-1',
      original_filename: 'paper.pdf',
      mime_type: 'application/pdf',
      size_bytes: 3,
      content_hash: 'sha256',
      stored_at: '2026-07-29T00:00:00Z',
    });
    stub.setResponse('read_workspace_asset_v1', new Uint8Array([1, 2, 3]).buffer);
    stub.setResponse('discard_workspace_asset_v1', undefined);

    const client: WorkspaceClient = createWorkspaceClient(stub.build());

    expect(client.hasTauriRuntime).toBe(true);

    expect(await client.chooseAndCreateWorkspace('Demo')).toEqual(summary);
    expect(stub.calls[0]).toEqual({
      cmd: 'choose_and_create_workspace',
      args: { displayName: 'Demo' },
    });

    expect(await client.chooseAndOpenWorkspace()).toEqual(summary);
    expect(stub.calls[1]).toEqual({ cmd: 'choose_and_open_workspace', args: {} });

    expect(await client.reopenLastWorkspace()).toEqual(summary);
    expect(stub.calls[2]).toEqual({ cmd: 'reopen_last_workspace', args: {} });

    await client.closeWorkspace();
    expect(stub.calls[3]).toEqual({ cmd: 'close_workspace', args: {} });

    expect(await client.getWorkspaceHealth()).toEqual(health);
    expect(stub.calls[4]).toEqual({ cmd: 'get_workspace_health', args: {} });

    expect(await client.readObject('foo')).toBeNull();
    expect(stub.calls[5]).toEqual({ cmd: 'read_object_v1', args: { id: 'foo' } });

    expect(await client.readAllObjects()).toEqual([]);
    expect(stub.calls[6]).toEqual({ cmd: 'read_all_objects_v1', args: {} });

    const payload: TransactPayload = {
      operations: [{ op: 'put', row: stubRow('a') }],
    };
    await client.transact(payload);
    expect(stub.calls[7]).toEqual({
      cmd: 'transact_v1',
      args: { operations: payload.operations },
    });

    expect(await client.readDomainRecords('study')).toEqual([]);
    expect(stub.calls[8]).toEqual({
      cmd: 'read_domain_records_v1',
      args: { namespace: 'study' },
    });
    await client.transactDomainRecords({ operations: [] });
    expect(stub.calls[9]).toEqual({
      cmd: 'transact_domain_records_v1',
      args: { operations: [] },
    });

    expect(await client.chooseAndImportPdfAsset?.()).toMatchObject({ asset_id: 'asset-1' });
    expect(stub.calls[10]).toEqual({ cmd: 'choose_and_import_pdf_asset_v1', args: {} });
    expect(await client.readWorkspaceAsset?.('asset-1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(stub.calls[11]).toEqual({
      cmd: 'read_workspace_asset_v1',
      args: { assetId: 'asset-1' },
    });
    await client.discardWorkspaceAsset?.('asset-1');
    expect(stub.calls[12]).toEqual({
      cmd: 'discard_workspace_asset_v1',
      args: { assetId: 'asset-1' },
    });
    expect(stub.calls).toHaveLength(13);
  });

  it('surfaces a stable WorkspaceIpcError envelope from the Rust side', async () => {
    withTauriHost();
    const stub = new StubInvoke();
    stub.setError('get_workspace_health', 'STUDYKIT_DB_UNUSABLE', 'corrupt sqlite');
    const client = createWorkspaceClient(stub.build());
    await expect(client.getWorkspaceHealth()).rejects.toBeInstanceOf(WorkspaceIpcError);
    await expect(client.getWorkspaceHealth()).rejects.toMatchObject({
      kind: 'STUDYKIT_DB_UNUSABLE',
      detail: { message: 'corrupt sqlite' },
    });
  });

  it('wraps unknown IPC failures as STUDYKIT_DB_UNUSABLE', async () => {
    withTauriHost();
    const stub = new StubInvoke();
    const client = createWorkspaceClient(stub.build());
    try {
      await client.getWorkspaceHealth();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceIpcError);
      expect((err as WorkspaceIpcError).kind).toBe('STUDYKIT_DB_UNUSABLE');
    }
  });
});

// ---------------------------------------------------------------------------
// Outside a Tauri host — every command must fail closed.
// ---------------------------------------------------------------------------

describe('createWorkspaceClient outside Tauri host', () => {
  it('reports hasTauriRuntime=false and fails every command', async () => {
    const stub = new StubInvoke();
    const client = createWorkspaceClient(stub.build());
    expect(client.hasTauriRuntime).toBe(false);
    await expect(client.getWorkspaceHealth()).rejects.toMatchObject({
      kind: 'STUDYKIT_NO_LAST_WORKSPACE',
    });
    await expect(client.reopenLastWorkspace()).rejects.toMatchObject({
      kind: 'STUDYKIT_NO_LAST_WORKSPACE',
    });
    // The stub is never called because the runtime is missing.
    expect(stub.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Production constructor wires the real @tauri-apps/api/core invoke.
// We mock the import path to keep the test isolated from Tauri.
// ---------------------------------------------------------------------------

describe('createTauriWorkspaceClient', () => {
  it('routes every public method through the injected invoke and is the production constructor', async () => {
    withTauriHost();
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const stub: TauriInvoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ cmd, args });
      switch (cmd) {
        case 'choose_and_create_workspace':
        case 'choose_and_open_workspace':
        case 'reopen_last_workspace':
          return {
            root: '/tmp/example',
            manifest: {
              schema: 'studykit.workspace/1',
              id: 'abc',
              formatVersion: 1,
              displayName: 'Demo',
              createdAt: '2026-07-30T00:00:00Z',
              updatedAt: '2026-07-30T00:00:00Z',
            },
          } as unknown as T;
        case 'get_workspace_health':
          return {
            root: '/tmp/example',
            manifest_id: 'abc',
            display_name: 'Demo',
            format_version: 1,
            schema_version: 1,
            integrity: 'ok',
            has_knowledge_objects: false,
          } as unknown as T;
        case 'close_workspace':
        case 'transact_v1':
        case 'transact_domain_records_v1':
          return undefined as unknown as T;
        case 'read_object_v1':
        case 'read_all_objects_v1':
        case 'read_domain_records_v1':
        default:
          return undefined as unknown as T;
      }
    };
    // The production constructor: every command must reach
    // the underlying `invoke` through the production
    // `createWorkspaceClient` wrapper.
    const client = createTauriWorkspaceClient(stub);
    expect(client.hasTauriRuntime).toBe(true);
    await client.chooseAndCreateWorkspace('Demo');
    await client.chooseAndOpenWorkspace();
    await client.reopenLastWorkspace();
    await client.closeWorkspace();
    await client.getWorkspaceHealth();
    await client.readObject('x');
    await client.readAllObjects();
    await client.transact({ operations: [] });
    await client.readDomainRecords('study');
    await client.transactDomainRecords({ operations: [] });
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toEqual([
      'choose_and_create_workspace',
      'choose_and_open_workspace',
      'reopen_last_workspace',
      'close_workspace',
      'get_workspace_health',
      'read_object_v1',
      'read_all_objects_v1',
      'transact_v1',
      'read_domain_records_v1',
      'transact_domain_records_v1',
    ]);
    // `chooseAndCreateWorkspace` must pass the display name as
    // a typed `displayName` field, not a free-form object.
    expect(calls[0].args).toEqual({ displayName: 'Demo' });
    // `transact` must serialise the operations payload verbatim.
    expect(calls[7].args).toEqual({ operations: [] });
    expect(calls[8].args).toEqual({ namespace: 'study' });
    expect(calls[9].args).toEqual({ operations: [] });
  });

  it('without an override, the production constructor still type-checks and hasTauriRuntime reflects the host', () => {
    withTauriHost();
    // We can construct the production client in the test
    // environment; it will lazy-import `@tauri-apps/api/core`,
    // which may throw when the package is not installed, so we
    // wrap in a try/catch. The contract is that the function
    // exists and the surface is correct.
    let hasTauriSurface = false;
    try {
      const client = createTauriWorkspaceClient();
      hasTauriSurface =
        typeof client.chooseAndCreateWorkspace === 'function' &&
        typeof client.reopenLastWorkspace === 'function' &&
        typeof client.transact === 'function' &&
        typeof client.transactDomainRecords === 'function';
    } catch {
      // happy-dom without @tauri-apps/api installed may throw
      // here; that is acceptable for the smoke check.
    }
    expect(hasTauriSurface).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper: build a minimal legal row for transact tests.
// ---------------------------------------------------------------------------

function stubRow(id: string) {
  return {
    id,
    kind: 'note' as const,
    body: 'body',
    state: 'active' as const,
    author_type: 'user' as const,
    container_workspace_id: null,
    container_mode: null,
    container_kind: null,
    container_id: null,
    created_at: '2026-07-29T00:00:00Z',
    updated_at: '2026-07-29T00:00:00Z',
  };
}
