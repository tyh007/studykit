/**
 * StudyKit v0.4 — `application/runtime` barrel
 *
 * The single place application code, features, and the composition
 * root import runtime capabilities from. Platform adapters under
 * `platforms/{web,desktop}/` produce these values; this barrel just
 * re-exports the contract.
 */

export type {
  RuntimeCapabilities,
  RuntimeKind,
  RuntimePlatform,
} from './runtimeCapabilities';
export { createEmptyRuntimeCapabilities } from './runtimeCapabilities';