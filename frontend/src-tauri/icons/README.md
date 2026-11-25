# `frontend/src-tauri/icons/`

This folder will hold the production application icons
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`).

## WP-09A development placeholder

`icon.png` is a minimal 32×32 placeholder required by
`tauri::generate_context!()` even when `bundle.icon` is unset.
It is sufficient for compilation and local Host Gate builds, but
it is not a product-quality application icon.

## Production icon generation

Generating the macOS `.icns`, Windows `.ico`, and PNG variants
from the StudyKit logo requires either:

1. The `tauri icon` CLI (Rust toolchain + `tauri-apps/cli`
   installed locally), or
2. A raster graphics toolchain (e.g. ImageMagick + `librsvg`).

The Rust toolchain and Tauri CLI are now provisioned. The
PNG/ICO/ICNS generation and explicit bundle icon configuration
remain deferred until the final brand source is selected.

## What to do before shipping the desktop binary

From a workstation with the Rust toolchain installed:

```bash
cd frontend/src-tauri
npm run tauri -- icon ../public/favicon.svg
```

That command renders every required PNG/ICO/ICNS variant into
this folder. After generation, add the resulting paths to the
`bundle.icon` array in `tauri.conf.json` and verify the packaged
application on each target OS.

## Impact on WP-09A Gate

WP-09A does not list nonexistent icon paths in `tauri.conf.json`.
This keeps `cargo check`, `tauri dev`, and
`tauri build --no-bundle` independent of the deferred branding
assets. A distributable `.app` / `.dmg` / `.msi` still requires
generated product icons and target-OS visual verification.
