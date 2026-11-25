/**
 * StudyKit v0.4 — `repositories/` barrel
 *
 * The contract surface for persistence. Re-exports the
 * `StudyKitRepository` interface and the in-memory
 * `MemoryRepository` from `domain/`. The web/desktop adapters
 * (which implement the contract) live under `platforms/`. WP-02
 * does NOT expose a `getActiveRepository()` factory — the data
 * gateway in `application/dataGateway` is the single switch
 * point for now, and it bypasses the `StudyKitRepository`
 * contract because the v0.3 legacy surface tree calls into the
 * v0.3 fetch / Dexie tables directly.
 */

export type {
  ExportArtifact,
  ExportFormat,
  ExportOptions,
  KnowledgeObject,
  KnowledgeObjectKind,
  ObjectQuery,
  ObjectState,
  AuthorType,
  QueryListener,
  RepositoryTransaction,
  StudyKitRepository,
  Unsubscribe,
} from '../domain/repository';

export {
  KNOWLEDGE_OBJECT_KINDS,
  MemoryRepository,
  isKnowledgeObjectKind,
  isObjectQuery,
} from '../domain/repository';

// WP-06 — Cognitive Canvas contract surface.
export type {
  CanvasListener,
  CanvasRepository,
  CanvasTransaction,
  Unsubscribe as CanvasUnsubscribe,
} from './canvas';
export { CANVAS_UNDO_OPS, emptyViewSnapshot } from './canvas';
export { MemoryCanvasRepository } from './memoryCanvasRepository';

// WP-06 — Production shim that delegates canonical-object
// reads/writes to the WP-04 study + WP-05 research repos
// instead of an in-memory store.
export {
  ShimStudyKitRepository,
  UPGRADEABLE_KINDS,
  UnsupportedKindError,
  isUpgradeableKind,
  paperToKnowledgeObject,
  evidenceToKnowledgeObject,
  claimToKnowledgeObject,
  questionToKnowledgeObject,
  type ShimStudyKitRepositoryDeps,
  type UpgradeableKind,
} from './shimStudyKitRepository';
