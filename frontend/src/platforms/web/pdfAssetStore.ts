/**
 * StudyKit v0.4 — `platforms/web/pdfAssetStore`
 *
 * IndexedDB-backed Blob store for locally-imported
 * PDFs. The store keeps a *single* table
 * (`researchPdfBlobs`) keyed by the `WorkAsset.id`.
 * The Blob is opaque to the rest of the app: the
 * `WorkAsset.ref` is the `WorkAsset.id` itself, and
 * the Reader asks the store for the Blob at render
 * time. A `URL.createObjectURL(blob)` cache keeps
 * object URLs stable for the lifetime of the page so
 * the PDF.js worker doesn't re-decode on every
 * re-render.
 *
 * Why a dedicated store (not the existing Dexie
 * `researchWorkAssets` table)? Dexie indexes don't
 * accept Blobs efficiently on every platform, and
 * storing the raw bytes in a separate table makes the
 * "export snapshot" path (WP-11) easy to reason about:
 * the bytes live in one place, the metadata in
 * another.
 *
 * Cleanup: `URL.revokeObjectURL` is called from the
 * Reader when the asset id changes, so a long
 * research session doesn't leak object URLs. The
 * `clear()` helper is provided for the test seam
 * only.
 */

const DB_NAME = 'StudyKitPDFBlobs';
const DB_VERSION = 1;
const STORE = 'researchPdfBlobs';

interface StoredPdf {
  assetId: string;
  blob: Blob;
  contentHash: string;
  pageCount?: number;
  storedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'assetId' });
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error ?? new Error('Failed to open PDF blob store.'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = (): void => resolve(req.result);
        req.onerror = (): void => reject(req.error ?? new Error('IndexedDB request failed.'));
        t.oncomplete = (): void => db.close();
        t.onerror = (): void => {
          db.close();
          reject(t.error ?? new Error('IndexedDB transaction failed.'));
        };
      }),
  );
}

export interface PdfAssetMeta {
  readonly assetId: string;
  readonly contentHash: string;
  readonly pageCount?: number;
  readonly storedAt: string;
  readonly sizeBytes: number;
}

export class PdfAssetStore {
  /** Cached object URLs, one per assetId. */
  private readonly urlCache = new Map<string, string>();

  async put(input: {
    assetId: string;
    blob: Blob;
    contentHash: string;
    pageCount?: number;
  }): Promise<PdfAssetMeta> {
    const stored: StoredPdf = {
      assetId: input.assetId,
      blob: input.blob,
      contentHash: input.contentHash,
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
      storedAt: new Date().toISOString(),
    };
    await tx('readwrite', (s) => s.put(stored) as IDBRequest<unknown>);
    // If we had a previous URL, drop it.
    const prev = this.urlCache.get(input.assetId);
    if (prev) {
      try {
        URL.revokeObjectURL(prev);
      } catch {
        // ignore
      }
      this.urlCache.delete(input.assetId);
    }
    return {
      assetId: input.assetId,
      contentHash: input.contentHash,
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
      storedAt: stored.storedAt,
      sizeBytes: input.blob.size,
    };
  }

  async get(assetId: string): Promise<Blob | null> {
    const row = (await tx('readonly', (s) => s.get(assetId) as IDBRequest<StoredPdf | undefined>)) ?? null;
    return row?.blob ?? null;
  }

  async getMeta(assetId: string): Promise<PdfAssetMeta | null> {
    const row = (await tx('readonly', (s) => s.get(assetId) as IDBRequest<StoredPdf | undefined>)) ?? null;
    if (!row) return null;
    return {
      assetId: row.assetId,
      contentHash: row.contentHash,
      ...(row.pageCount !== undefined ? { pageCount: row.pageCount } : {}),
      storedAt: row.storedAt,
      sizeBytes: row.blob.size,
    };
  }

  /**
   * Return an `object URL` for the asset. The URL is
   * stable across calls; the caller MUST call
   * `releaseObjectUrl(assetId)` when done so the
   * browser can release the underlying blob.
   */
  async getObjectUrl(assetId: string): Promise<string | null> {
    const cached = this.urlCache.get(assetId);
    if (cached) return cached;
    const blob = await this.get(assetId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urlCache.set(assetId, url);
    return url;
  }

  releaseObjectUrl(assetId: string): void {
    const url = this.urlCache.get(assetId);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      this.urlCache.delete(assetId);
    }
  }

  async delete(assetId: string): Promise<void> {
    this.releaseObjectUrl(assetId);
    await tx('readwrite', (s) => s.delete(assetId) as IDBRequest<unknown>);
  }

  async clear(): Promise<void> {
    for (const url of this.urlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    this.urlCache.clear();
    await tx('readwrite', (s) => s.clear() as IDBRequest<unknown>);
  }
}

export const pdfAssetStore = new PdfAssetStore();

/**
 * Test-only reset. Wipes the IndexedDB store and
 * the in-memory object URL cache.
 */
export function __resetPdfAssetStoreForTests(): void {
  void pdfAssetStore.clear();
}
