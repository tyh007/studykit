export interface AcquiredPdfAsset {
  readonly assetId: string;
  readonly file: File;
  readonly contentHash: string;
  readonly storedAt: string;
  readonly sizeBytes: number;
}

/** Narrow application boundary for PDFs owned by a native workspace. */
export interface SourceAssetBridge {
  readonly kind: 'native';
  choosePdf(): Promise<AcquiredPdfAsset | null>;
  getBlob(assetId: string): Promise<Blob | null>;
  getObjectUrl(assetId: string): Promise<string | null>;
  releaseObjectUrl(assetId: string): void;
  discard(assetId: string): Promise<void>;
}
