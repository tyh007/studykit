# `platforms/`

Platform-specific adapters. Each subfolder owns a runtime target:

- `platforms/web/` — Dexie / IndexedDB, browser files, web auth.
- `platforms/desktop/` — Tauri IPC client, SQLite adapter, OS
  keychain. (Not created by WP-00; spike work begins in WP-08.)

The rule: every call into a platform-specific API must be wrapped in
an adapter under here. Nothing above this layer imports Dexie tables,
Tauri commands, or `fetch` directly.

## Import rules

`platforms/` implements the `StudyKitRepository` *contract* that
lives in `repositories/`. It must not depend on anything that
would couple it to a specific use case, a specific feature, or
the composition root.

- `platforms/*` MAY import from `domain/*`, `repositories/*`.
- `platforms/*` MUST NOT import from `application/`, `app/`,
  `features/`, `shared/`, or `components/`.

### Why the rules matter

- A platform adapter implements the contract, it does not consume
  use cases. Reaching into `application/` would invert the
  dependency: the platform would be calling the use case, instead
  of the use case calling through the contract.
- A platform adapter must not know about feature flags. The
  composition root reads flags and decides which adapter (Web or
  Desktop) to bind.
- A platform adapter must not import UI. It is a headless
  persistence / IO layer; the surface it exposes is the
  `StudyKitRepository` interface, not React components.
