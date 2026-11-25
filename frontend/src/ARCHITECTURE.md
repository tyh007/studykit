# `frontend/src/` — Architecture (v0.4)

> Status: WP-00 baseline. This document is the contract for *where new
> code lives* under the v0.4 layering. The v0.3 product continues to
> run unchanged; new code only enters the new boundaries described
> here.

## 1. Why a new boundary

The v0.4 decision log (D-019) and implementation handoff both
require an incremental refactor: a baseline guard that lets new
features land safely without a big-bang rewrite. To make that safe
we need to fix the **dependency direction** before any feature work
starts.

### 1.1 The rule, in one sentence

> Every arrow points **inward** toward `domain/`. Outer layers may
> depend on inner layers; inner layers must never depend on outer
> layers. `app/` is the only exception — it is the composition root
> and may reach into every other layer to wire the product together.

### 1.2 The diagram

```
                          ┌─────────────────────────────────────┐
                          │       app/  (composition root)     │  ← feature flags, route glue, boot
                          └─────────────────────────────────────┘
                                              │
                                              ▼
                          ┌─────────────────────────────────────┐
                          │              features/              │  ← UI slices (study, research, …)
                          └─────────────────────────────────────┘
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
                ┌───────────────────────┐           ┌───────────────────────┐
                │     application/      │           │       platforms/      │
                │  (use cases, services)│           │  (Dexie, Tauri, …)    │
                └───────────────────────┘           └───────────────────────┘
                          │                                       │
                          └───────────────────┬───────────────────┘
                                              ▼
                          ┌─────────────────────────────────────┐
                          │  repositories/  (contract surface)  │  ← StudyKitRepository
                          └─────────────────────────────────────┘
                                              │
                                              ▼
                          ┌─────────────────────────────────────┐
                          │          domain/  (pure types)      │  ← WorkspaceMode, AppLocation, AIDraft, …
                          └─────────────────────────────────────┘

       shared/  is an independent UI/utility layer. It does not import
       from any business or platform layer; features/ and app/ MAY
       import from it.
```

Two things the diagram makes explicit that the old one did not:

- `platforms/` is **next to** `application/`, not at the bottom of
  the chain. A platform adapter *implements* the
  `StudyKitRepository` contract — it depends on the contract, not
  the other way around.
- `app/` is at the top. It is the only layer allowed to reach
  across the whole graph to wire features, application services,
  adapters, and the repository contract into a runnable product.

### 1.3 The dependency table

The same rules in tabular form. The "May import from" column is
**exhaustive** — anything not listed is forbidden, including
imports from new layer peers of the same kind.

| Layer          | May import from                                                            | Must not import from                                              |
|----------------|-----------------------------------------------------------------------------|---------------------------------------------------------------------|
| `domain/`      | *(nothing — pure types, no React, no Dexie, no fetch, no env)*             | every other layer                                                   |
| `repositories/`| `domain/`                                                                  | `application/`, `platforms/`, `app/`, `features/`, `shared/`, `components/` |
| `application/` | `domain/`, `repositories/`                                                 | `platforms/`, `app/`, `features/`, `shared/`, `components/`         |
| `platforms/`   | `domain/`, `repositories/`                                                 | `application/`, `app/`, `features/`, `shared/`, `components/`       |
| `shared/`      | *(only `shared/` itself and external npm packages)*                         | `domain/`, `repositories/`, `application/`, `platforms/`, `features/`, `app/`, `components/` |
| `features/`    | `domain/`, `repositories/`, `application/`, `shared/`, legacy `components/` *(legacy adapter only)* | `platforms/`, `app/`, other `features/*` slices, shared `components/` (except the legacy adapter) |
| `app/`         | `domain/`, `repositories/`, `application/`, `platforms/`, `features/`, `shared/`, legacy `components/` | *(composition root — has no "must not", but should only import what it needs to wire the product)* |

A few things this table pins down that the old version left vague:

- `app/` is allowed to import `features/`. Without that, there is
  no composition root that can mount the UI.
- `features/` is **not** allowed to import `platforms/` or `app/`.
  The composition root, not a feature, chooses which platform
  adapter to bind.
- `application/` is **not** allowed to import `platforms/` or
  `app/`. Use cases must run against the `StudyKitRepository`
  contract, not a concrete adapter, and they must not read feature
  flags — the composition root reads flags and passes the result
  in.
- `shared/` is genuinely independent. It does not import from any
  other new layer. Only the UI/composition layers (`features/` and
  `app/`) depend on it; the pure inner layers stay independent.

These rules are checked by humans today. A future Work Packet will
add a CI lint that greps the import graph; that lives in WP-01 or
later, not in WP-00.

## 2. What's in WP-00

`domain/` — the *contracts*:

- `workspace.ts` — `WorkspaceMode`, `ContainerRef`, `AppLocation`,
  `SurfaceKind`, and the `sameAppLocation` deep-equality helper.
- `surface-status.ts` — discriminated `SurfaceStatus` union
  (loading / ready / empty / offline / error).
- `draft.ts` — `DraftStatus`, `AIDraft`, `DraftProvenance`,
  `DraftOrigin` (the shape future AI work must satisfy per D-008
  and D-016).
- `repository.ts` — `StudyKitRepository` interface plus a
  `MemoryRepository` for tests and spike work.
- `__fixtures__/domain-fixtures.ts` — deterministic test data.
- `index.ts` — barrel.

`app/`:

- `feature-flags.ts` — `v04Shell`, `v04Assistant`, `v04Research`,
  all defaulting to `false`. Single `isFeatureEnabled(id)` entry
  point so flags never become scattered magic booleans. Tests in
  `feature-flags.test.ts`.

`repositories/`:

- `index.ts` — re-exports the contract so features can import
  from one place.
- `README.md` — describes the future adapter factory.

Empty / placeholder directories (with a `README.md` each):

- `application/` — for use-case services (WP-04 / WP-05).
- `platforms/`, `platforms/web/` — Dexie / Tauri adapters (WP-01+).
- `features/` — vertical slices (WP-02 onward).
- `shared/` — design-system primitives (WP-01).

## 3. Legacy adapter strategy

The v0.3 product is a working product. WP-00 is explicitly **not** a
rewrite. The strategy is:

1. **Don't touch existing files.** `App.tsx`, `components/`,
   `lib/`, `store/`, `hooks/`, `styles/`, `index.css` and `types.ts`
   stay where they are and keep their imports.
2. **New v0.4 code lives under the new layers.** When a future
   packet needs a new component, it lives under `features/`
   (or, for headless use cases, `application/`) and imports
   through the layering in §1.3. New code must not import from
   `lib/db.ts` or `lib/api.ts` directly — those are the v0.3
   legacy boundary and will be wrapped by `platforms/*` adapters
   in WP-01+.
3. **Wrap, don't replace.** When WP-01+ introduces a real
   `WebRepository`, it wraps the existing Dexie tables in
   `lib/db.ts`. The on-disk schema is unchanged. The current
   `App.tsx` keeps reading Dexie directly until it is rewritten to
   read from the repository — that rewrite is a separate, additive
   packet (not WP-00).
4. **Canvas is a legacy adapter.** `components/literature/canvas/`
   is the current Research Canvas. Per D-006 / D-014 it eventually
   becomes a *cognitive* canvas view, but for now it is a
   legacy feature. WP-06 will add a `features/canvas/` adapter
   that talks to it; the canvas itself is **not** moved or
   renamed in this packet.
5. **Unsubmitted user changes are off-limits.** The current
   `CanvasToolbar.tsx`, `literature-canvas.css`, and
   `useHorizontalScroller.ts` / `useHorizontalScroller.test.tsx`
   are the user's in-flight work. WP-00 neither reads them nor
   edits them. Any future overlap is handled by a minimal patch
   on a separate commit, after explicit alignment.

## 4. Feature flags

`v04Shell`, `v04Assistant`, `v04Research` all default to **off**.
Read them through `isFeatureEnabled('v04Shell')` etc. — never via
inline booleans or `import.meta.env.VITE_*`. For dev/QA, flip a
flag with:

```js
localStorage.setItem('studykit.v04.feature.v04Shell', '1');
```

…or use `__setFeatureFlagForTests` in test code. The settings page
that lets a user flip flags without devtools is WP-01 work.

## 5. AI is a Draft, never a silent write

Per D-008 and D-016, any future AI write goes through the
`AIDraft` shape in `domain/draft.ts` first. The status field
(`pending` / `accepted` / `rejected` / `superseded`) and the
`DraftProvenance` block (provider, model, generatedAt, sourceScope,
origin) are the minimum the v0.4 architecture guarantees. Future
packets may extend the shape but must not weaken these guarantees.

## 6. What WP-00 does **not** do

- It does not introduce a router, Tauri, CRDT, or a new database.
- It does not migrate the Dexie schema or the v0.3 data.
- It does not start WP-01.
- It does not change the Auth / App UI, the Canvas, the Literature
  Project home, or any legacy component.
- It does not auto-stage, auto-commit, or auto-push.

## 7. Verifying WP-00

```bash
cd frontend
npm test                 # full vitest run; WP-00 suites are additive
npm run typecheck        # tsc -b --noEmit
npm run build            # vite build; smoke-checks imports
git diff --check         # whitespace / conflict-marker guard
git status --short       # must still show the user's uncommitted files
```

The new tests that must pass:

- `src/domain/workspace.test.ts`
- `src/domain/surface-status.test.ts`
- `src/domain/draft.test.ts`
- `src/domain/repository.test.ts`
- `src/app/feature-flags.test.ts`
