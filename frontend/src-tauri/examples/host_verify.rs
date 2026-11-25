//! StudyKit v0.4 — WP-09B Round 1 — Host verification example
//!
//! This binary exercises the same workspace manager functions
//! the IPC commands call, end-to-end, against a temporary
//! directory. It is *not* a unit test (see
//! `src/workspace/manager_tests.rs` for those); it is a
//! "Host verification" tool the implementation engineer can
//! run to confirm the manager behaves correctly against a
//! real filesystem path that the GUI's folder picker would
//! otherwise provide.
//!
//! Usage:
//!
//!     cargo run --example host_verify -- /tmp/some/empty/dir
//!
//! The directory must already exist and be empty (the picker
//! would refuse a non-empty directory in the GUI path too).
//!
//! The example does NOT use the user's Documents, Desktop, or
//! OneDrive root directories. It only touches paths the
//! operator passed on the command line.

use std::path::{Path, PathBuf};

use studykit_desktop_lib::workspace::{
    close_workspace, create_workspace, db, get_workspace_health, open_workspace,
    reopen_last_workspace, with_open, WorkspaceError,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!(
            "usage: {} <empty-workspace-dir> [app-config-dir]",
            args.first().map(String::as_str).unwrap_or("host_verify")
        );
        std::process::exit(2);
    }
    let workspace_dir = PathBuf::from(&args[1]);
    let app_config_dir = args
        .get(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_dir.join(".studykit-app-config"));
    std::fs::create_dir_all(&app_config_dir)?;

    println!("== step 1: create_workspace");
    let summary = create_workspace(&app_config_dir, &workspace_dir, "WP-09B Host Verify")?;
    println!(
        "  root = {}\n  manifest.id = {}\n  manifest.formatVersion = {}\n  manifest.displayName = {}",
        summary.root.display(),
        summary.manifest.id,
        summary.manifest.formatVersion,
        summary.manifest.displayName,
    );
    assert!(summary.root.join("workspace.json").exists());
    assert!(summary.root.join("studykit.sqlite").exists());
    assert!(summary.root.join("assets").join("originals").is_dir());
    assert!(summary.root.join("backups").is_dir());
    assert!(summary.root.join("exports").is_dir());

    println!("\n== step 2: integrity_check + initial health");
    with_open(|open| {
        db::integrity_check(&open.connection)
            .map_err(|err| WorkspaceError::db_unusable(format!("integrity check: {err}")))
    })?;
    let health = get_workspace_health()?;
    println!(
        "  health.schema_version = {}\n  health.has_knowledge_objects = {}\n  health.integrity = {}",
        health.schema_version, health.has_knowledge_objects, health.integrity
    );
    assert_eq!(health.format_version, 1);
    assert_eq!(health.schema_version, 1);
    assert_eq!(health.integrity, "ok");
    assert!(!health.has_knowledge_objects);

    println!("\n== step 3: CRUD a KnowledgeObject via transact");
    with_open(|open| {
        let tx = open
            .connection
            .transaction()
            .map_err(|err| WorkspaceError::db_unusable(format!("host verify begin: {err}")))?;
        tx.execute(
            "INSERT OR REPLACE INTO knowledge_objects (\
                id, kind, body, state, author_type, \
                container_workspace_id, container_mode, container_kind, container_id, \
                created_at, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                "host-verify-1",
                "note",
                "Host verify body",
                "active",
                "user",
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                "2026-07-29T00:00:00Z",
                "2026-07-29T00:00:00Z",
            ],
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("host verify insert: {err}")))?;
        tx.commit()
            .map_err(|err| WorkspaceError::db_unusable(format!("host verify commit: {err}")))
    })?;
    let health2 = get_workspace_health()?;
    println!(
        "  post-write health.has_knowledge_objects = {}",
        health2.has_knowledge_objects
    );
    assert!(health2.has_knowledge_objects);

    println!("\n== step 4: close + reopen_last_workspace");
    close_workspace()?;
    let again = reopen_last_workspace(&app_config_dir)?;
    println!("  reopen root = {}", again.root.display());
    assert_eq!(again.root, summary.root);
    assert_eq!(again.manifest.id, summary.manifest.id);

    let health3 = get_workspace_health()?;
    println!(
        "  post-reopen health.has_knowledge_objects = {}",
        health3.has_knowledge_objects
    );
    assert!(health3.has_knowledge_objects);

    println!("\n== step 5: re-open the same path explicitly");
    close_workspace()?;
    let explicit = open_workspace(&app_config_dir, &summary.root)?;
    println!("  explicit-open root = {}", explicit.root.display());
    assert_eq!(explicit.root, summary.root);
    assert!(get_workspace_health()?.has_knowledge_objects);

    println!(
        "\nWP-09B Host verification complete.\nWorkspace root: {}\nManifest path: {}\nSQLite path: {}",
        summary.root.display(),
        summary.root.join("workspace.json").display(),
        summary.root.join("studykit.sqlite").display(),
    );

    Ok(())
}
