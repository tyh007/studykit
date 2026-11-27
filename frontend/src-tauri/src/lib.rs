// StudyKit v0.4 — Tauri 2 desktop library entry (WP-09B Round 1)
//
// The Rust runtime owns:
//   1. The Tauri 2 host (window, CSP) — unchanged from WP-09A.
//   2. The `tauri-plugin-dialog` plugin (folder picker) — new.
//   3. A narrow IPC command surface — see `ipc` module.
//
// The dialog plugin is the ONLY new permission this packet
// introduces. It exposes a native folder picker that returns an
// absolute path; it does NOT expose arbitrary filesystem reads
// to the WebView. SQLite / filesystem IO happens entirely
// inside the Rust commands in `ipc.rs` and `workspace/*`, so
// the WebView has zero direct access to either.

pub mod desktop_bridge;
pub mod ipc;
pub mod local_ai;
pub mod mcp;
pub mod workspace;

/// Boot the Tauri application. Called from `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(desktop_bridge::plugin())
        .setup(|app| {
            desktop_bridge::register(app.handle());
            // v0.5 P6b: local MCP access, if the user turned it on.
            mcp::setup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::choose_and_create_workspace,
            ipc::choose_and_open_workspace,
            ipc::reopen_last_workspace,
            ipc::close_workspace,
            ipc::get_workspace_health,
            ipc::choose_and_import_pdf_asset_v1,
            ipc::read_workspace_asset_v1,
            ipc::discard_workspace_asset_v1,
            ipc::read_object_v1,
            ipc::read_all_objects_v1,
            ipc::transact_v1,
            ipc::read_domain_records_v1,
            ipc::transact_domain_records_v1,
            ipc::import_legacy_snapshot_v1,
            ipc::rollback_legacy_migration_v1,
            ipc::get_latest_legacy_migration_v1,
            ipc::create_workspace_backup_v1,
            ipc::save_quick_capture_v1,
            ipc::list_quick_captures_v1,
            ipc::archive_quick_capture_v1,
            ipc::discover_local_ai_v1,
            ipc::local_ai_chat_v1,
            desktop_bridge::get_global_shortcut_status_v1,
            mcp::mcp_status_v1,
            mcp::mcp_set_enabled_v1,
            mcp::mcp_respond_v1,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|_, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = workspace::close_workspace();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_subsystem_is_in_scope() {
        // Smoke test: every public module is reachable.
        let _ = workspace::SUPPORTED_FORMAT_VERSION;
        let _ = workspace::SUPPORTED_SCHEMA_VERSION;
        let _ = ipc::choose_and_create_workspace;
    }
}
