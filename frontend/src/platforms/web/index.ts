/**
 * StudyKit v0.4 — `platforms/web` barrel
 *
 * The Web local adapter. This is the "WebRepository" called for
 * in the WP-02 plan: a small, real adapter that satisfies the
 * minimum surface the data gateway needs (modules / lectures /
 * literature projects / literature papers read), backed by
 * Dexie / IndexedDB. The desktop spike (WP-09) will ship a
 * `DesktopPort` that satisfies the same shape against Tauri +
 * SQLite.
 *
 * The adapter is intentionally NOT the full `StudyKitRepository`
 * contract from `domain/repository` — WP-02 only needs local
 * CRUD for the v0.3 surface tree, and the data gateway is the
 * single switch point that decides which backend is active.
 * The full contract lands with WP-03+ Knowledge Objects.
 *
 * `dataGateway` consumes this through the `WebPort` interface;
 * it never imports `lib/db` directly.
 */

export { createWebPort, type WebPort } from './WebPort';
export { createDexieStudyRepository, getStudyDb, __resetStudyDbForTests, type StudyDexieDB } from './dexieStudyRepository';
export { createDexieResearchRepository, getResearchDb, __resetResearchDbForTests, type ResearchDexieDB } from './dexieResearchRepository';
export { pdfAssetStore, __resetPdfAssetStoreForTests, type PdfAssetMeta } from './pdfAssetStore';
export { createWebRuntimeCapabilities, detectWebPlatform } from './runtime.web';
