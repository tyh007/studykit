import type {
  AcquiredPdfAsset,
  SourceAssetBridge,
} from '../../application/assets/sourceAssetBridge';
import {
  WorkspaceIpcError,
  type WorkspaceClient,
  type WorkspaceErrorShape,
} from './workspaceClient';

function unavailable(method: string): WorkspaceIpcError {
  const detail: WorkspaceErrorShape = {
    kind: 'STUDYKIT_DB_UNUSABLE',
    message: `native source asset command '${method}' is unavailable`,
  };
  return new WorkspaceIpcError(detail);
}

export function createDesktopSourceAssetBridge(
  client: WorkspaceClient,
): SourceAssetBridge {
  const objectUrls = new Map<string, string>();

  const read = async (assetId: string): Promise<Uint8Array> => {
    if (!client.readWorkspaceAsset) throw unavailable('read_workspace_asset_v1');
    return client.readWorkspaceAsset(assetId);
  };

  const releaseObjectUrl = (assetId: string): void => {
    const url = objectUrls.get(assetId);
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.delete(assetId);
  };

  return {
    kind: 'native',
    async choosePdf(): Promise<AcquiredPdfAsset | null> {
      if (!client.chooseAndImportPdfAsset) {
        throw unavailable('choose_and_import_pdf_asset_v1');
      }
      const summary = await client.chooseAndImportPdfAsset();
      if (!summary) return null;
      try {
        const bytes = await read(summary.asset_id);
        return {
          assetId: summary.asset_id,
          file: new File([bytes], summary.original_filename, {
            type: summary.mime_type,
            lastModified: Date.parse(summary.stored_at),
          }),
          contentHash: summary.content_hash,
          storedAt: summary.stored_at,
          sizeBytes: summary.size_bytes,
        };
      } catch (error) {
        await client.discardWorkspaceAsset?.(summary.asset_id).catch(() => undefined);
        throw error;
      }
    },
    async getBlob(assetId): Promise<Blob | null> {
      return new Blob([await read(assetId)], { type: 'application/pdf' });
    },
    async getObjectUrl(assetId): Promise<string | null> {
      const existing = objectUrls.get(assetId);
      if (existing) return existing;
      const bytes = await read(assetId);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      objectUrls.set(assetId, url);
      return url;
    },
    releaseObjectUrl,
    async discard(assetId): Promise<void> {
      releaseObjectUrl(assetId);
      if (!client.discardWorkspaceAsset) {
        throw unavailable('discard_workspace_asset_v1');
      }
      await client.discardWorkspaceAsset(assetId);
    },
  };
}
