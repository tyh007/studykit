/**
 * StudyKit v0.4 — `app/canvas/canvasWiring`
 *
 * The composition root for the cognitive canvas (WP-06).
 *
 * WP-06 Round 4 P0-B: the previous global
 * `installCanvasWiringDeps()` + `getCanvasUseCases()`
 * factory has been removed. The cognitive canvas no
 * longer:
 *
 *   - Caches at module level (a page that mounted the
 *     V04 shell *after* the cognitive-canvas route
 *     silently fell back to `MemoryRepository`).
 *   - Falls back to `MemoryRepository` with a single
 *     `console.warn` (a "production" surface that is
 *     really a fake).
 *   - Builds its own `createDexieResearchRepository()`
 *     instance, separate from the one
 *     `<ResearchWiring>` provided to the Evidence
 *     workspace (so the cognitive canvas's upgrade
 *     wrote to a *different* Dexie transaction from
 *     the Evidence workspace's reads).
 *
 * The production composition is now a React context
 * (`<CanvasUseCasesProvider>`) that sits inside
 * `<ResearchWiring>` + `<StudyWiring>`, pulls the live
 * `ResearchRepository` / `StudyRepository` from the
 * existing contexts, and rebuilds the `CanvasUseCases`
 * via `useMemo`. Tests inject a fake via
 * `<CanvasUseCasesOverride>`. Missing wiring shows
 * "Cognitive canvas unavailable" — no `MemoryRepository`
 * downgrade.
 *
 * This file remains so the cognitive-canvas use cases
 * (the `addFreeNode`, `upgradeNode`, …) keep their
 * `app/canvas/canvasWiring` import path stable. It
 * re-exports the context + the factory.
 */

export { CanvasFeatureOffError } from '../../application/canvas/canvasGateway';
export {
  CanvasUseCasesProvider,
  CanvasRuntimeOverride,
  useCanvasUseCases,
  useCanvasRuntime,
  type CanvasUseCasesProviderProps,
  type CanvasRuntimeOverrideProps,
  type CanvasRuntime,
} from '../v04/canvasWiringContext';
export {
  getCanvasNotesBackingStore,
  getCanvasSourcesBackingStore,
} from '../../platforms/web/canvasBackingStores';
export { listCanvasPapers, getCanvasPaper } from '../../platforms/web/canvasPaperLookup';

/**
 * The local-workspace `noteBlocks` adapter. The Dexie
 * table is owned by the v0.3 schema (`frontend/src/lib/db.ts`);
 * the shim only needs the upsert + archive operations.
 * Implementation lives in `platforms/web/canvasBackingStores`.
 */
export interface NotesBackingStore {
  upsert(input: { id: string; body: string; authorType: 'user' | 'ai' | 'imported' }): Promise<{ id: string }>;
  archive(id: string): Promise<void>;
}

/**
 * The local-workspace `literaturePapers` adapter.
 * `upsertTitle` writes a new paper row (or no-ops if
 * the id is already taken); `moveToTrash` flips
 * `in_trash = 1`. Implementation lives in
 * `platforms/web/canvasBackingStores`.
 */
export interface SourcesBackingStore {
  upsertTitle(input: { id: string; title: string }): Promise<void>;
  moveToTrash(id: string): Promise<void>;
}
