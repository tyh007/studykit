/**
 * StudyKit v0.4 — `application/runtime/runtimeCapabilities` tests
 *
 * Pure tests for the contract shape. They live in `application/`
 * (not in `platforms/`) because the contract itself is part of
 * the application layer; the platform adapters are tested
 * separately in `platforms/runtimeCapabilities.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  createEmptyRuntimeCapabilities,
  type RuntimeCapabilities,
} from './runtimeCapabilities';

describe('application/runtime/runtimeCapabilities', () => {
  it('returns an immutable "nothing supported" snapshot', () => {
    const snap = createEmptyRuntimeCapabilities('web', 'macos');
    expect(snap.runtime).toBe('web');
    expect(snap.platform).toBe('macos');
    expect(snap.hostVersion).toBe('');
    expect(snap.supportsNativeFileSystem).toBe(false);
    expect(snap.supportsGlobalShortcut).toBe(false);
    expect(snap.supportsAutoUpdate).toBe(false);
    expect(snap.supportsLocalAiDiscovery).toBe(false);
    // Object.freeze at the factory level keeps consumers honest.
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('exposes a non-mutating default for callers that want a safe baseline', () => {
    const snap: RuntimeCapabilities = createEmptyRuntimeCapabilities('web');
    // Type-level: assigning a fresh booleans is fine, but the
    // snapshot itself rejects writes. We use the typed read to
    // confirm the shape, and assert runtime/hostVersion shape.
    expect(snap.runtime).toBe('web');
    expect(typeof snap.hostVersion).toBe('string');
  });
});