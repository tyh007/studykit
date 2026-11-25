# ADR-001 — No router dependency for WP-02

Status: Accepted (WP-02, 2026-07-20)

## Context

WP-02 needs:

- URL-addressable positions inside the App Shell
  (`#/<workspace>/<mode>/<container>`).
- Browser back / forward and reload restore.
- A minimal in-memory history stack so Mode switching and
  Container switching feel right.
- No new top-level npm dependency unless strictly necessary.

The v0.3 product is a single-file React tree (`App.tsx` with a
`sidebarMode` enum and direct component swaps) and ships no router.
The v0.4 plan defers a real router until after WP-04 / WP-05 land,
because the container shapes (Course, Project) and AI Intent
Capsule are still moving.

## Decision

WP-02 does NOT add `react-router` (or any router). Instead it
ships a hand-rolled `LocationStore` that:

1. Owns a `Location` value (workspace, mode, container, params).
2. Mirrors the value into `location.hash` so reload + deep-link
   survive.
3. Listens to `hashchange` / `popstate` and reconciles.
4. Persists a sessionStorage snapshot for cold restarts.
5. Exposes `push` and `replace` so callers can opt into history
   entries.

This is ~120 lines of pure TypeScript. It reuses the existing
`domain/workspace` `AppLocation` shape (already JSON-serialisable
in WP-00) and the `feature-flags` `v04Shell` gate from WP-01.

## Why not just `react-router`?

- v0.4 deliverables (WP-04 Study, WP-05 Research, WP-06 Canvas,
  WP-07 Collaboration) will each introduce new container shapes
  and a Capsule. Choosing a router now would either force us to
  either rewrite every route twice (now and again in WP-09
  Desktop) or pick a router that may not match what WP-05 actually
  needs (Research lineage paths, evidence deep links, citation
  audit links).
- A hash-based location store satisfies every WP-02 acceptance
  criterion (back/forward/reload/恢复) without any new dependency.
- The current StudyKit bundle already warns about chunk size; a
  router adds 8–15KB gzipped on its own. The minimal store fits
  inside the existing chunk.

## Consequences

- WP-03+ can introduce a real router when the URL grammar
  stabilises. The `LocationStore` interface is intentionally small
  (`get`, `subscribe`, `push`, `replace`) so the swap is local.
- The new components import the location store from `app/shell`,
  which is allowed to depend on `domain/`. The shell never imports
  from `components/literature/*` directly — it always goes through
  the legacy adapters in `app/shell/legacyAdapters/*`.
- Reload restore is best-effort: a `?resume=1` flag in the URL is
  honoured when present; otherwise we read the sessionStorage
  snapshot. Both are cleared on sign-out / workspace switch.

## Alternatives considered

- `react-router-dom@6` — overkill for three routes today.
- `wouter` — same footprint but still a dep; no WP-02 need.
- A custom event bus with no URL persistence — would fail reload.

## Re-evaluation trigger

If WP-04 / WP-05 land and need nested routes, param validation
across multiple segments, or transition animations driven by the
router, revisit this ADR. Until then, the hash-based store is the
smallest thing that satisfies WP-02 without pre-deciding WP-05.
