/**
 * StudyKit v0.4 — `platforms/desktop` barrel
 *
 * Re-exports the desktop adapter. The barrel exists so the
 * composition root can import desktop implementations from a
 * single stable path (`platforms/desktop`), and so the desktop
 * surface can grow (SQLite adapter, workspace chooser, …) under
 * one folder without forcing importers to chase filenames.
 *
 * Import rules from `frontend/src/ARCHITECTURE.md` §1.3 still
 * apply: only `app/` is allowed to import this barrel from
 * above. Application services, features, and shared primitives
 * go through `application/runtime/runtimeCapabilities`.
 */

export {
  hasTauriRuntime,
  createDesktopRuntimeCapabilities,
  detectDesktopRuntimeCapabilities,
} from './runtime.desktop';
export {
  createTauriWorkspaceClient,
  createWorkspaceClient,
  WorkspaceIpcError,
} from './workspaceClient';
export type {
  OpenWorkspaceSummary,
  WorkspaceClient,
  WorkspaceHealth,
  WorkspaceErrorKind,
  MigrationSummary,
  BackupSummary,
  QuickCapture,
  LocalAiDiscovery,
  LocalAiMessage,
  LocalAiChatResponse,
  GlobalShortcutStatus,
  WorkspaceAssetSummary,
} from './workspaceClient';
export { createDesktopSourceAssetBridge } from './sourceAssetBridge.desktop';
export { createDesktopSqliteRepository } from './sqliteStudyKitRepository';
export {
  DesktopDomainRecordStore,
  decodeDomainRow,
  deleteDomainRecord,
  putDomainRecord,
} from './domainRecordStore';
export type {
  DecodedDomainRecord,
  DomainNamespace,
} from './domainRecordStore';
export {
  SqliteStudyRepository,
  createSqliteStudyRepository,
} from './sqliteStudyRepository';
export {
  SqliteResearchRepository,
  createSqliteResearchRepository,
} from './sqliteResearchRepository';
export {
  SqliteCanvasRepository,
  createSqliteCanvasRepository,
} from './sqliteCanvasRepository';
export { createDesktopLegacyPort } from './desktopLegacyPort';
export {
  inspectLegacyData,
  migrateLegacyData,
  type LegacyMigrationPreview,
} from './legacyMigration';
