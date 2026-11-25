import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopSourceAssetBridge } from './sourceAssetBridge.desktop';
import type { WorkspaceClient } from './workspaceClient';

function client(overrides: Partial<WorkspaceClient>): WorkspaceClient {
  return {
    hasTauriRuntime: true,
    chooseAndCreateWorkspace: vi.fn(), chooseAndOpenWorkspace: vi.fn(),
    reopenLastWorkspace: vi.fn(), closeWorkspace: vi.fn(), getWorkspaceHealth: vi.fn(),
    readObject: vi.fn(), readAllObjects: vi.fn(), transact: vi.fn(),
    readDomainRecords: vi.fn(), transactDomainRecords: vi.fn(),
    ...overrides,
  } as WorkspaceClient;
}

afterEach(() => vi.restoreAllMocks());

describe('desktop source asset bridge', () => {
  it('acquires a native PDF without exposing a filesystem path', async () => {
    const c = client({
      chooseAndImportPdfAsset: vi.fn().mockResolvedValue({
        asset_id: 'asset-1', original_filename: '研究.pdf', mime_type: 'application/pdf',
        size_bytes: 5, content_hash: 'abc', stored_at: '2026-08-08T00:00:00Z',
      }),
      readWorkspaceAsset: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45])),
      discardWorkspaceAsset: vi.fn(),
    });
    const acquired = await createDesktopSourceAssetBridge(c).choosePdf();
    expect(acquired?.assetId).toBe('asset-1');
    expect(acquired?.file.name).toBe('研究.pdf');
    expect(acquired?.file.size).toBe(5);
    expect(acquired).not.toHaveProperty('path');
  });

  it('discards the copied asset if the binary read fails', async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const c = client({
      chooseAndImportPdfAsset: vi.fn().mockResolvedValue({
        asset_id: 'asset-2', original_filename: 'bad.pdf', mime_type: 'application/pdf',
        size_bytes: 3, content_hash: 'abc', stored_at: '2026-08-08T00:00:00Z',
      }),
      readWorkspaceAsset: vi.fn().mockRejectedValue(new Error('read failed')),
      discardWorkspaceAsset: discard,
    });
    await expect(createDesktopSourceAssetBridge(c).choosePdf()).rejects.toThrow('read failed');
    expect(discard).toHaveBeenCalledWith('asset-2');
  });
});
