# `repositories/`

Contract surface for persistence. Re-exports `StudyKitRepository`
and related types from `domain/`. Future packets (WP-01 / WP-02)
will add:

- `getActiveRepository(): StudyKitRepository` — adapter factory
  bound at app boot;
- a `WebRepository` that wraps the existing Dexie tables without
  migrating the on-disk schema.

## Import rules

`repositories/` is the **contract surface** for persistence. It
sits between `domain/` (which defines the types) and every
adapter that implements the contract.

- `repositories/*` MAY import only from `domain/*`.
- `repositories/*` MUST NOT import from `application/`,
  `platforms/`, `app/`, `features/`, `shared/`, or
  `components/`.
- Features and application services SHOULD import the
  `StudyKitRepository` interface from `repositories/*` rather
  than reaching into `domain/*` directly. The contract and its
  re-exports are the public surface; the underlying domain types
  are an implementation detail that may evolve.

### Why the rules matter

- `repositories/` is a thin contract layer. Pulling in
  `application/` or `features/` would make it a service registry
  instead of a contract, and would lock use cases to the type
  definitions of a particular storage adapter.
- Adapters live in `platforms/`. Keeping `repositories/` free of
  `platforms/` imports means the contract itself stays runtime-
  agnostic — both the Web (Dexie) and the future Desktop (Tauri
  + SQLite) adapters can implement it without inheriting any
  other layer's assumptions.
