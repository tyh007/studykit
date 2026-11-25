# `frontend/src-tauri/` — StudyKit desktop shell (WP-09B Round 1)

This folder is the Tauri 2 desktop wrapper for the StudyKit v0.4
React frontend. It is **not** a copy of the application — the
Tauri shell loads the existing Vite build (`frontend/dist/`) and
runs the React bundle in the OS WebView.

## What this shell owns

- Window configuration (title, default size, minimum size,
  centered launch).
- Capability allowlist (`capabilities/default.json`) with exactly
  one read-only permission group: `core:app:default`. The
  Tauri dialog plugin does NOT appear in the allowlist because
  the WebView never invokes it directly — the picker is driven
  exclusively from Rust inside our IPC commands.
- Eight typed IPC commands: `choose_and_create_workspace`,
  `choose_and_open_workspace`, `reopen_last_workspace`,
  `close_workspace`, `get_workspace_health`, `read_object_v1`,
  `read_all_objects_v1`, `transact_v1`. The first five manage
  the workspace lifecycle; the last three expose the SQLite
  knowledge-object CRUD inside one atomic `transact_v1` round
  trip per JS call.
- A Rust workspace manager that owns a single open SQLite
  connection, enforces the single-open invariant, and persists
  a `last_workspace` pointer to the AppConfig directory.
- Frontend `devUrl` points at the running Vite server
  (`http://localhost:5173`); production `frontendDist` points at
  `../dist` so the desktop binary loads the existing build with
  no copy.

## What this shell deliberately does NOT do

- No filesystem scan beyond the user-picked workspace directory.
- No clipboard read, no global hotkey, no updater, no Ollama
  HTTP probe (deferred to WP-09B Round 2 / 09C).
- No menu bar / tray icon — the native window decorations ship
  with the default close / minimise / zoom controls and nothing
  else.
- No custom Dexie migration. The desktop SQLite and the Web
  IndexedDB are two separate stores; Round 2 / Round 3 will
  bridge them only if the user opts in.

## Why `rusqlite` instead of `tauri-plugin-sql`

`tauri-plugin-sql` locks the SQLite file path under
`tauri::api::path::BaseDirectory::AppConfig`. WP-09B requires the
SQLite file to live **at the user-selected workspace directory**,
which is an arbitrary absolute path returned by the native folder
picker. A narrow `rusqlite` adapter lets us open the SQLite file
at exactly the chosen path, enforce `manifest` + `formatVersion`
checks before any IO, run migrations inside one BEGIN/COMMIT, and
reject path traversal / symlink tricks / foreign directories.

## Required local toolchain

The desktop build requires:

1. **Rust toolchain** — `rustup`, `cargo`, and the platform
   default target.
   ```bash
   rustup default stable
   rustup target add aarch64-apple-darwin   # macOS Apple Silicon
   rustup target add x86_64-apple-darwin    # macOS Intel
   rustup target add x86_64-pc-windows-msvc # Windows
   ```
2. **Tauri CLI v2** — installed as a dev dependency in this
   folder.
   ```bash
   cd frontend/src-tauri
   npm install
   ```

On macOS also install Xcode Command Line Tools
(`xcode-select --install`); on Windows install the
"Desktop development with C++" Visual Studio workload.

## Local development (Tauri dev)

The dev workflow boots Vite for the React side and Tauri for
the desktop shell side:

```bash
# Terminal 1 — Vite dev server
cd frontend
npm run dev

# Terminal 2 — Tauri dev shell that loads http://localhost:5173
cd frontend/src-tauri
npm run dev:desktop
```

The first launch downloads and compiles the Tauri Rust
dependencies, which can take several minutes. Subsequent
launches are incremental.

## Unsigned development build

For a CI sanity check that the Rust side compiles without
needing a code-signing identity:

```bash
cd frontend/src-tauri
npm run build:desktop:unsigned
```

The resulting binary is written to
`frontend/src-tauri/target/release/studykit-desktop` (path
depends on the platform). It runs without `.app` / `.dmg`
packaging so it can be exercised without notarisation.

> The unsigned build requires the PNG / ICO / ICNS icons listed
> in `tauri.conf.json` because Tauri bakes them into the binary.
> Generate them once via `npm run tauri -- icon ../public/favicon.svg`
> before the first build.

## External dependencies for the next packet

- **Code signing & notarisation** for macOS and Windows — these
  cannot run in the implementation environment and are deferred
  to WP-09B Round 2, which also adds the workspace chooser UX
  and the SQLite adapter (already shipped).
- **Icon generation** — see `icons/README.md`.

## Runtime detection on the frontend side

The frontend detects the desktop host through the Tauri 2 host
marker `window.__TAURI_INTERNALS__`. The detector in
`frontend/src/platforms/desktop/runtime.desktop.ts` reads only
the structural presence of that marker; it never inspects
private fields. OS diagnostics come from the WebView's public
`navigator`. `hostVersion` stays empty until a future adapter
initialises it through Tauri's public async API. Application
code reads the resulting `RuntimeCapabilities` from
`getActiveRuntimeCapabilities()` in
`frontend/src/platforms/runtime.ts` — never from the `window`
symbol directly. The `shared/import-boundaries.test.ts` guard
enforces this rule for the `shared/` layer; the same rule
applies by code review to `application/` and `features/`.

## Frontend IPC bridge

`frontend/src/platforms/desktop/workspaceClient.ts` owns the
typed surface that wraps every IPC command. The production
constructor `createTauriWorkspaceClient` imports
`@tauri-apps/api/core`'s `invoke` directly; tests inject their
own typed `TauriInvoke` through `createWorkspaceClient`. The
adapter never falls back to a different command than the
contract promises, never reads `globalThis.__TAURI_INTERNALS__`
directly, and never calls `require()` at runtime.