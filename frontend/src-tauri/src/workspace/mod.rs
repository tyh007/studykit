// StudyKit v0.4 — WP-09B Round 1 — workspace subsystem

pub mod assets;
pub mod backup;
pub mod db;
pub mod error;
pub mod ipc_types;
pub mod knowledge;
pub mod legacy_migration;
pub mod manager;
#[cfg(test)]
pub mod manager_tests;
pub mod manifest;
pub mod path_safety;
pub mod quick_capture;
pub mod validation;

pub use db::SUPPORTED_SCHEMA_VERSION;
pub use error::{ErrorKind, Result, WorkspaceError};
pub use manager::{
    close_workspace, create_workspace, forget_workspace, get_workspace_health, is_open,
    last_workspace_pointer_path, open_workspace, reopen_last_workspace, with_open, OpenWorkspace,
    OpenWorkspaceSummary, WorkspaceHealth, ASSETS_DERIVED, ASSETS_DIR, ASSETS_ORIGINALS,
    ASSETS_TEMP, BACKUPS_DIR, EXPORTS_DIR, LAST_WORKSPACE_POINTER_DIR, LAST_WORKSPACE_POINTER_FILE,
    SQLITE_FILE_NAME,
};
pub use manifest::{
    generate_workspace_id, parse_manifest, read_manifest, write_manifest, WorkspaceManifest,
    MANIFEST_SCHEMA, SUPPORTED_FORMAT_VERSION,
};
