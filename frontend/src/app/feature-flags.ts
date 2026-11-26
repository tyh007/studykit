/**
 * StudyKit v0.4 — Feature flags
 *
 * Why this exists (per the v0.4 implementation handoff):
 *   "feature flags: v04Shell, v04Assistant, v04Research; default off;
 *    do not let flags scatter as magic booleans inside components."
 *
 * Design:
 *   - Every flag is declared in `FEATURE_FLAGS` with a *typed* id and
 *     a *default* value. The defaults are all `false` so a fresh build
 *     behaves exactly like the v0.3 product.
 *   - Components read flags through `isFeatureEnabled('v04Assistant')`,
 *     never through `if (v04Assistant)` or `import.meta.env.VITE_*`.
 *   - For dev / QA, a single localStorage key
 *     `studykit.v04.feature.<flagId>` can flip a flag at runtime. The
 *     override is *intentionally* opt-in and *intentionally* not exposed
 *     in shipping UI.
 *   - The composition root can provide deployment-specific defaults
 *     (for example, the desktop Alpha ships the already-gated v0.4
 *     slices while the Web rollout remains off by default).
 *   - Tests can call `__setFeatureFlagForTests` to flip a flag without
 *     touching localStorage, and `__resetFeatureFlagsForTests` to put
 *     everything back to defaults.
 *
 * Out of scope for WP-00:
 *   - Server-issued flags (no remote config in v0.4 Alpha);
 *   - Per-user / per-workspace variants (one global set for now);
 *   - A UI surface for toggling flags (settings page is WP-01 work).
 */

// ---------------------------------------------------------------------------
// Flag registry
// ---------------------------------------------------------------------------

/**
 * The set of v0.4 feature flags known at compile time. Adding a flag
 * here forces every callsite that uses it to be updated if the id
 * changes, which is the whole point.
 */
export type FeatureFlagId =
  | 'v04Shell'       // New app shell, mode switch, route resume boundary (WP-02)
  | 'v04Assistant'   // System-level Intent Capsule / Action Layer (WP-03)
  | 'v04Study'       // Study Vertical Slice: Lecture → Attempt → AI Feedback → Review (WP-04)
  | 'v04Research'    // Research Mode longitudinal path (WP-05)
  | 'v04Canvas'      // Cognitive Canvas adapter: object placement, free nodes, relations, outline (WP-06)
  | 'v04Collaboration' // Collaboration Foundation: membership/roles, comments, mentions, shared tasks, activity, Private Scratch publish preview, presence/realtime spike (WP-08)
  | 'v04CollabGateway' // WP-08 Round 2: real async collaboration HTTP gateway (outbox/inbox). Off by default; the smoke test flips it on via the dev seam.
  | 'v05Workbench'; // v0.5 P1: project workbench for Research (explorer + tabbed editors). ADR-003.

export const FEATURE_FLAGS: readonly FeatureFlagId[] = [
  'v04Shell',
  'v04Assistant',
  'v04Study',
  'v04Research',
  'v04Canvas',
  'v04Collaboration',
  'v04CollabGateway',
  'v05Workbench',
] as const;

export function isFeatureFlagId(value: unknown): value is FeatureFlagId {
  return (
    value === 'v04Shell' ||
    value === 'v04Assistant' ||
    value === 'v04Study' ||
    value === 'v04Research' ||
    value === 'v04Canvas' ||
    value === 'v04Collaboration' ||
    value === 'v04CollabGateway' ||
    value === 'v05Workbench'
  );
}

/** Compile-time registry of defaults. Add new flags here, not in components. */
export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlagId, boolean>> = Object.freeze({
  v04Shell: false,
  v04Assistant: false,
  v04Study: false,
  v04Research: false,
  v04Canvas: false,
  v04Collaboration: false,
  v04CollabGateway: false,
  v05Workbench: false,
});

/** Short description of each flag, for the future settings page and logs. */
export const FEATURE_FLAG_DESCRIPTIONS: Readonly<Record<FeatureFlagId, string>> = Object.freeze({
  v04Shell:
    'New app shell with Workspace → Mode → Container navigation, replacing the modules/literature/canvas sidebar.',
  v04Assistant:
    'System-level Intent Capsule and Action Layer (⌘K) with provenance, draft layer, and undo. Not a chat sidebar.',
  v04Study:
    'Study Vertical Slice: Lecture → Attempt → AI Feedback → Review, with local-first persistence and Verified Thought Loop.',
  v04Research:
    'Research Mode longitudinal path: Project Home → Library → Evidence → Claim → Output.',
  v04Canvas:
    'Cognitive Canvas adapter: shared placement of canonical objects + free nodes, semantic relations (preview/accept), and Outline alternative. Does not replace the Literature Canvas engine.',
  v04Collaboration:
    'Collaboration Foundation: project membership/roles, comments, mentions, shared tasks, activity history, Private Scratch publish preview, presence/realtime spike with async fallback, conflict detection. Single-user and offline use are not regressed.',
  v04CollabGateway:
    'WP-08 Round 2: HTTP async collaboration gateway (outbox/inbox) with conflict detection. The smoke test flips this on via the dev seam; production keeps it off until the production server (WP-10) ships. When off, the cross-user op log is a no-op and the slice behaves like the Round 1 build.',
  v05Workbench:
    'v0.5 Research workbench (ADR-003): a project opens as one workspace with an explorer and tabbed editors instead of separate full pages. Requires v04Research.',
});

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

/**
 * Versioned, namespaced key so future flag-system changes don't collide
 * with v0.4 dev overrides. Production builds never read this; only
 * dev/QA does.
 */
export const FEATURE_FLAG_OVERRIDE_PREFIX = 'studykit.v04.feature.' as const;

export function featureFlagOverrideKey(flag: FeatureFlagId): string {
  return `${FEATURE_FLAG_OVERRIDE_PREFIX}${flag}`;
}

// ---------------------------------------------------------------------------
// Storage adapter (kept tiny so tests can override it)
// ---------------------------------------------------------------------------

/**
 * The slice of the storage API the flag system actually needs. Both
 * `localStorage` and an in-memory shim satisfy this shape. We don't
 * import the browser `Storage` type directly so this module can be
 * loaded in tests and on the server without crashing.
 */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryStorage: FlagStorage = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
})();

function resolveStorage(): FlagStorage {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: FlagStorage }).localStorage) {
      return (globalThis as { localStorage: FlagStorage }).localStorage;
    }
  } catch {
    // SSR / sandboxed environment — fall through to memory.
  }
  return memoryStorage;
}

// ---------------------------------------------------------------------------
// In-memory test override (preferred in tests; never used in production)
// ---------------------------------------------------------------------------

const testOverrides = new Map<FeatureFlagId, boolean>();
let runtimeDefaults: Readonly<Partial<Record<FeatureFlagId, boolean>>> =
  Object.freeze({});

/**
 * Configure deployment-specific defaults before React mounts.
 * Explicit storage overrides still win, so QA can disable an
 * individual slice without rebuilding the application.
 */
export function configureFeatureFlagRuntimeDefaults(
  next: Readonly<Partial<Record<FeatureFlagId, boolean>>>,
): void {
  runtimeDefaults = Object.freeze({ ...next });
}

/**
 * @internal
 * Test-only setter. Use `__resetFeatureFlagsForTests` afterwards.
 */
export function __setFeatureFlagForTests(flag: FeatureFlagId, value: boolean): void {
  testOverrides.set(flag, value);
}

/** @internal Clear all test overrides. Safe to call in production (no-op). */
export function __resetFeatureFlagsForTests(): void {
  testOverrides.clear();
  runtimeDefaults = Object.freeze({});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a feature flag. The order of precedence is:
 *   1. Test override (only set by `__setFeatureFlagForTests`).
 *   2. `localStorage` override under `FEATURE_FLAG_OVERRIDE_PREFIX`.
 *   3. A composition-root runtime default.
 *   4. The compile-time default in `FEATURE_FLAG_DEFAULTS`.
 *
 * Components must call this function rather than reading a constant so
 * dev / QA can flip flags without a rebuild.
 */
export function isFeatureEnabled(flag: FeatureFlagId): boolean {
  if (testOverrides.has(flag)) {
    return testOverrides.get(flag) as boolean;
  }
  const override = parseBoolean(resolveStorage().getItem(featureFlagOverrideKey(flag)));
  if (override !== undefined) return override;
  if (runtimeDefaults[flag] !== undefined) {
    return runtimeDefaults[flag] as boolean;
  }
  return FEATURE_FLAG_DEFAULTS[flag];
}

/**
 * Get a snapshot of every flag plus its source. Useful for diagnostics,
 * the future settings page, and tests.
 */
export interface FeatureFlagSnapshot {
  readonly id: FeatureFlagId;
  readonly value: boolean;
  readonly source: 'default' | 'runtime' | 'storage' | 'test';
}

export function getFeatureFlagSnapshot(): readonly FeatureFlagSnapshot[] {
  return FEATURE_FLAGS.map((id) => {
    if (testOverrides.has(id)) {
      return { id, value: testOverrides.get(id) as boolean, source: 'test' as const };
    }
    const override = parseBoolean(resolveStorage().getItem(featureFlagOverrideKey(id)));
    if (override !== undefined) {
      return { id, value: override, source: 'storage' as const };
    }
    if (runtimeDefaults[id] !== undefined) {
      return { id, value: runtimeDefaults[id] as boolean, source: 'runtime' as const };
    }
    return { id, value: FEATURE_FLAG_DEFAULTS[id], source: 'default' as const };
  });
}

/**
 * Persist an override into storage. Mainly useful for the future settings
 * UI. Existing test overrides take precedence over persisted values.
 */
export function setFeatureFlagOverride(flag: FeatureFlagId, value: boolean): void {
  resolveStorage().setItem(featureFlagOverrideKey(flag), value ? '1' : '0');
}

export function clearFeatureFlagOverride(flag: FeatureFlagId): void {
  resolveStorage().removeItem(featureFlagOverrideKey(flag));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseBoolean(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}
