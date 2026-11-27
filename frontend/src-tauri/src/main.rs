// StudyKit v0.4 — Tauri 2 desktop shell (`src-tauri/src/main.rs`)
//
// WP-09A scope:
//   - Load the existing React frontend build (no copy, no rebuild).
//   - Open one main window with sane default / minimum size.
//   - Register zero custom Rust commands, including commands that
//     read the clipboard,
//     scan the filesystem, or attach a global hotkey. Those are
//     future WP-09B/09C work, each gated by their own capability
//     and explicit user opt-in.
//
// Permission rule (per the v0.4 system design §9): Tauri
// capabilities are intentionally minimal. The default capability
// file shipped in `capabilities/default.json` only grants
// read-only application metadata. Additional permissions are
// added per plugin in later packets.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // v0.5 P6b: `StudyKit --mcp-stdio` is the MCP bridge that AI agents
    // launch; it talks to the running app and never opens a window.
    if std::env::args().any(|a| a == "--mcp-stdio") {
        std::process::exit(studykit_desktop_lib::mcp::run_stdio_bridge());
    }
    studykit_desktop_lib::run();
}
