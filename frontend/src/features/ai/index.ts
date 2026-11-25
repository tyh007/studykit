/**
 * StudyKit v0.4 — `features/ai` barrel
 *
 * Re-exports the public surface of the AI Interaction
 * Kernel + Universal Intent Capsule feature slice.
 *
 * The slice is a pure *consumer* of `domain`,
 * `application`, and `shared`. It MUST NOT import from
 * `lib/api`, `lib/literature-api`, or any AI client
 * directly — the dataApi gateway is the only allowed
 * seam.
 */

export * from './kernel';

export {
  IntentCapsule,
  type IntentCapsuleProps,
} from './ui/IntentCapsule';
export {
  IntentCapsuleProvider,
  type IntentCapsuleProviderProps,
} from './ui/IntentCapsuleProvider';
export { openCapsule, closeCapsule, type OpenCapsuleInput } from './ui/openCapsule';
export { OpenIntentCapsuleButton, type OpenIntentCapsuleButtonProps } from './ui/OpenIntentCapsuleButton';
