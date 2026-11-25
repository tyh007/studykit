/**
 * StudyKit v0.4 — `platforms/` barrel
 *
 * Re-exports the Web / Desktop adapters and the runtime single
 * resolution point. The composition root (`app/`) imports from
 * here; inner layers (`application/`, `features/`, `shared/`)
 * MUST NOT — they go through `application/runtime/runtimeCapabilities`.
 */

export * from './runtime';
export {
  hasTauriRuntime,
  createDesktopRuntimeCapabilities,
  detectDesktopRuntimeCapabilities,
} from './desktop';
export { createWebRuntimeCapabilities, detectWebPlatform } from './web/runtime.web';