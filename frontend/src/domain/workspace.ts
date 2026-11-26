/**
 * StudyKit v0.4 — Workspace / Mode / Location contracts
 *
 * These types describe the *future* v0.4 information architecture. They are
 * intentionally additive: the v0.3 `Module` / `LiteratureProject` / `Lecture`
 * types in `src/types.ts` are not removed or rewritten by WP-00. Existing
 * components continue to read their own types; new code that wants to
 * participate in v0.4 imports from here.
 *
 * Rule of thumb (per D-001 / D-019 in the v0.4 decision log):
 *   - `WorkspaceMode` is a *working context*, not a data silo.
 *   - `ContainerRef` is a reference, never a copy.
 *   - `AppLocation` is a *pure data* descriptor of where the user is.
 *     It must be JSON-serialisable so it can be restored, deep-linked,
 *     and round-tripped through a future router without losing state.
 */

// ---------------------------------------------------------------------------
// Workspace mode
// ---------------------------------------------------------------------------

/**
 * The two top-level working contexts in v0.4.
 *
 *  - `study`    — Course / Lecture / Review / Study Canvas.
 *  - `research` — Project / Library / Evidence / Research Canvas / Output.
 *
 * Both modes share a single object model and a single repository; the mode
 * is metadata that scopes views, selection defaults, and AI guidance.
 */
export type WorkspaceMode = 'study' | 'research';

export const WORKSPACE_MODES: readonly WorkspaceMode[] = ['study', 'research'] as const;

/**
 * Type guard. Useful at trust boundaries (URL params, IPC, persisted
 * preferences) where the value is `unknown`.
 */
export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === 'study' || value === 'research';
}

// ---------------------------------------------------------------------------
// Container reference
// ---------------------------------------------------------------------------

/**
 * What kind of named container the location is scoped to. A `course` lives
 * in Study Mode; a `project` lives in Research Mode. The pair
 * `(mode, kind)` is fixed — `kind` is derivable from `mode`, but carrying
 * it explicitly makes UI components cheaper to render and prevents
 * silent cross-mode aliasing.
 */
export type ContainerKind = 'course' | 'project';

export interface ContainerRef {
  /** Workspace this container lives in. `null` = the local default workspace. */
  readonly workspaceId: string | null;
  /** Which mode the container belongs to. */
  readonly mode: WorkspaceMode;
  /** Discriminator so consumers don't have to inspect `mode` to render. */
  readonly kind: ContainerKind;
  /** Stable id of the container (UUID/ULID, never path-derived). */
  readonly id: string;
}

/**
 * Type guard for `ContainerRef`. Used at trust boundaries (URL params,
 * IPC payloads, persisted preferences) where the value is `unknown`.
 *
 * Rejects any pairing other than `(mode='study', kind='course')` or
 * `(mode='research', kind='project')`. A research container cannot
 * pretend to be a course, and vice versa.
 */
export function isContainerRef(value: unknown): value is ContainerRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.workspaceId !== null && typeof v.workspaceId !== 'string') return false;
  if (!isWorkspaceMode(v.mode)) return false;
  if (v.kind === 'course' && v.mode !== 'study') return false;
  if (v.kind === 'project' && v.mode !== 'research') return false;
  if (v.kind !== 'course' && v.kind !== 'project') return false;
  if (typeof v.id !== 'string') return false;
  return true;
}

/** Build a `course` ref. Pure function — no validation of the id format. */
export function courseContainer(workspaceId: string | null, id: string): ContainerRef {
  return { workspaceId, mode: 'study', kind: 'course', id };
}

/** Build a `project` ref. */
export function projectContainer(workspaceId: string | null, id: string): ContainerRef {
  return { workspaceId, mode: 'research', kind: 'project', id };
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * The kind of surface a user is currently looking at. This list is the
 * *minimum* set WP-00 needs to round-trip a location. Future Work Packets
 * (WP-01 / WP-02 / WP-04 / WP-05) may add to it without breaking
 * existing code as long as they update the `isSurfaceKind` guard.
 */
export type SurfaceKind =
  | 'home'            // Top-level Home / Continue
  | 'study-home'      // Study Mode Home
  | 'course'          // Course Home
  | 'lecture'         // Lecture Focus
  | 'study-canvas'    // Study Canvas
  | 'review'          // Review queue
  | 'research-home'   // Research Mode Home
  | 'project'         // Project Home
  | 'design'          // Research Design Workspace (WP-07)
  | 'task-detail'     // Research Task detail (WP-07)
  | 'library'         // Project Library
  | 'reader'          // Shared Source Reader
  | 'evidence'        // Evidence & Claims
  | 'research-canvas' // Research Canvas
  | 'cognitive-canvas' // Cognitive Canvas (WP-06, v0.4)
  | 'output'          // Output Editor
  | 'workbench'       // v0.5 Research project workbench (ADR-003)
  | 'search'          // Global Search
  | 'settings';       // Settings

export function isSurfaceKind(value: unknown): value is SurfaceKind {
  switch (value) {
    case 'home':
    case 'study-home':
    case 'course':
    case 'lecture':
    case 'study-canvas':
    case 'review':
    case 'research-home':
    case 'project':
    case 'design':
    case 'task-detail':
    case 'library':
    case 'reader':
    case 'evidence':
    case 'research-canvas':
    case 'cognitive-canvas':
    case 'output':
    case 'workbench':
    case 'search':
    case 'settings':
      return true;
    default:
      return false;
  }
}

/** Surfaces that require a `ContainerRef` to be meaningful. */
export const CONTAINER_SCOPED_SURFACES: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
  'course',
  'lecture',
  'study-canvas',
  'project',
  'design',
  'task-detail',
  'library',
  'evidence',
  'research-canvas',
  'cognitive-canvas',
  'output',
  'workbench',
]);

/**
 * Surfaces that are valid in *both* Study and Research mode. Anything
 * not in this set is owned by exactly one mode (see `SURFACES_BY_MODE`).
 *
 * `home`      — top-level Home / Continue.
 * `reader`    — Shared Source Reader (`/source/:sourceId` per PRD §10),
 *               used by both modes to open a source.
 * `search`    — Global Search.
 * `settings`  — Local data / AI / sync / export settings.
 */
export const CROSS_MODE_SURFACES: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
  'home',
  'reader',
  'search',
  'settings',
]);

/**
 * Canonical set of *mode-specific* surfaces for each mode. This set
 * intentionally excludes the cross-mode surfaces above; they are not
 * owned by any single mode.
 */
export const SURFACES_BY_MODE: Readonly<Record<WorkspaceMode, ReadonlySet<SurfaceKind>>> = {
  study: new Set<SurfaceKind>([
    'study-home',
    'course',
    'lecture',
    'study-canvas',
    'review',
  ]),
  research: new Set<SurfaceKind>([
    'research-home',
    'project',
    'design',
    'task-detail',
    'library',
    'evidence',
    'research-canvas',
    'cognitive-canvas',
    'output',
    'workbench',
  ]),
};

/**
 * True if `surface` can appear in the given `mode`. Cross-mode surfaces
 * are always allowed; mode-specific surfaces are restricted to the
 * mode that owns them.
 */
export function isSurfaceCompatibleWithMode(
  surface: SurfaceKind,
  mode: WorkspaceMode,
): boolean {
  if (CROSS_MODE_SURFACES.has(surface)) return true;
  return SURFACES_BY_MODE[mode].has(surface);
}

// ---------------------------------------------------------------------------
// App location
// ---------------------------------------------------------------------------

/**
 * A pure, JSON-serialisable description of "where the user is".
 *
 * `AppLocation` is the *only* type in WP-00 that the future router,
 * deep-link resolver, and `RouteResumeBoundary` will round-trip. It is
 * deliberately small — selection state, drafts, and AI sessions are not
 * embedded; they are stored in their own stores and rehydrated by id.
 */
export interface AppLocation {
  /** Current working mode. */
  readonly mode: WorkspaceMode;
  /** What the user is looking at. */
  readonly surface: SurfaceKind;
  /**
   * Optional container (course / project) the location is scoped to.
   * Required for surfaces in `CONTAINER_SCOPED_SURFACES`.
   */
  readonly container?: ContainerRef;
  /**
   * Optional id of the specific entity inside the surface
   * (lecture id, canvas view id, source id, output id, ...).
   */
  readonly surfaceId?: string;
  /**
   * Optional auxiliary parameters that don't deserve a typed field —
   * e.g. `tab=notes|citations` inside a Lecture Focus.
   *
   * Values must be strings; callers serialise numbers / booleans themselves.
   */
  readonly params?: Readonly<Record<string, string>>;
}

/**
 * Type guard for `AppLocation`. Used at trust boundaries (URL params,
 * IPC, persisted preferences) where the value is `unknown`.
 *
 * Enforces every invariant of an `AppLocation`:
 *   1. `mode` is a known `WorkspaceMode`.
 *   2. `surface` is a known `SurfaceKind`.
 *   3. If `surface` is container-scoped, a `container` MUST be present.
 *   4. `surface` must be compatible with `mode` (cross-mode surfaces
 *      are always allowed; mode-specific surfaces are restricted).
 *   5. If `container` is present, `container.mode` MUST equal `mode`.
 */
export function isAppLocation(value: unknown): value is AppLocation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isWorkspaceMode(v.mode)) return false;
  if (!isSurfaceKind(v.surface)) return false;
  if (v.container !== undefined && !isContainerRef(v.container)) return false;
  // Invariant 3: container-scoped surfaces need a container.
  if (!v.container && CONTAINER_SCOPED_SURFACES.has(v.surface)) return false;
  // Invariant 4: surface must be compatible with mode.
  if (!isSurfaceCompatibleWithMode(v.surface, v.mode)) return false;
  // Invariant 5: container.mode must match the location's mode.
  if (v.container && (v.container as ContainerRef).mode !== v.mode) return false;
  if (v.surfaceId !== undefined && typeof v.surfaceId !== 'string') return false;
  if (v.params !== undefined) {
    if (typeof v.params !== 'object' || v.params === null) return false;
    for (const [, pv] of Object.entries(v.params)) {
      if (typeof pv !== 'string') return false;
    }
  }
  return true;
}

/**
 * Build an `AppLocation` with explicit invariants. Throws on the same
 * invariants the trust-boundary guard enforces, so call sites fail fast
 * during development.
 */
export function makeAppLocation(input: {
  mode: WorkspaceMode;
  surface: SurfaceKind;
  container?: ContainerRef;
  surfaceId?: string;
  params?: Readonly<Record<string, string>>;
}): AppLocation {
  // Invariant 5: container.mode must match the location's mode.
  if (input.container && input.container.mode !== input.mode) {
    throw new Error(
      `Container mode "${input.container.mode}" does not match location mode "${input.mode}".`,
    );
  }
  // Invariant 4: surface must be compatible with mode.
  if (!isSurfaceCompatibleWithMode(input.surface, input.mode)) {
    throw new Error(
      `Surface "${input.surface}" is not compatible with mode "${input.mode}".`,
    );
  }
  // Invariant 3: container-scoped surfaces need a container.
  if (!input.container && CONTAINER_SCOPED_SURFACES.has(input.surface)) {
    throw new Error(
      `Surface "${input.surface}" requires a ContainerRef but none was provided.`,
    );
  }
  // Normalise: only include defined fields, freeze for safety.
  const loc: AppLocation = Object.freeze({
    mode: input.mode,
    surface: input.surface,
    ...(input.container ? { container: Object.freeze({ ...input.container }) } : {}),
    ...(input.surfaceId !== undefined ? { surfaceId: input.surfaceId } : {}),
    ...(input.params ? { params: Object.freeze({ ...input.params }) } : {}),
  });
  return loc;
}

/** Compare two `AppLocation`s for deep equality (used by route resume). */
export function sameAppLocation(a: AppLocation, b: AppLocation): boolean {
  if (a === b) return true;
  if (a.mode !== b.mode) return false;
  if (a.surface !== b.surface) return false;
  if (a.surfaceId !== b.surfaceId) return false;
  if (Boolean(a.container) !== Boolean(b.container)) return false;
  if (a.container && b.container) {
    if (a.container.id !== b.container.id) return false;
    if (a.container.workspaceId !== b.container.workspaceId) return false;
    if (a.container.kind !== b.container.kind) return false;
  }
  const ap = a.params ?? {};
  const bp = b.params ?? {};
  const akeys = Object.keys(ap);
  const bkeys = Object.keys(bp);
  if (akeys.length !== bkeys.length) return false;
  for (const k of akeys) {
    if (ap[k] !== bp[k]) return false;
  }
  return true;
}
