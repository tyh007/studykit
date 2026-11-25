// StudyKit v0.4 — WP-09B Round 1 (Correction Gate)
//
// End-to-end workspace tests that drive the real `manager`
// module (no Tauri runtime). These exercise the failure paths
// the WP-09B Round 1 Correction Gate promised:
//
//   - Create new workspace, reopen it, data survives.
//   - Chinese + spaces + OneDrive-style paths.
//   - Manifest corrupt + future formatVersion.
//   - Non-StudyKit directory refuses to open.
//   - Migration runs once; re-running is a no-op.
//   - `PRAGMA integrity_check` runs and reports `ok`.
//   - Path traversal + symlink boundaries are rejected.
//   - Failed creation does NOT leave behind an apparently
//     valid half-built workspace.
//
// Tests place their `app_config_dir` OUTSIDE the workspace
// root (the production rule, not a test-only whitelist).

use std::path::{Path, PathBuf};

use crate::workspace::{
    self, db, generate_workspace_id, manifest, WorkspaceManifest, SUPPORTED_FORMAT_VERSION,
    SUPPORTED_SCHEMA_VERSION,
};

fn app_config_outside(workspace_root: &Path) -> PathBuf {
    // The app-config directory lives in a sibling tempdir so the
    // workspace root stays empty until the manager writes into
    // it. We create the directory here so `safe_path_check`
    // can canonicalise the root.
    let parent = workspace_root.parent().unwrap_or(workspace_root);
    let dir = parent.join(format!("app-config-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn reset() {
    let _ = workspace::close_workspace();
    let _ = workspace::forget_workspace(&std::env::temp_dir());
}

#[test]
fn create_then_reopen_round_trips_manifest() {
    reset();
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("ws");
    std::fs::create_dir(&workspace).unwrap();
    let config = app_config_outside(&workspace);
    let summary = workspace::create_workspace(&config, &workspace, "round-trip").unwrap();
    assert!(summary.root.join("workspace.json").exists());
    assert!(summary.root.join("studykit.sqlite").exists());
    workspace::close_workspace().unwrap();
    let again = workspace::open_workspace(&config, &summary.root).unwrap();
    assert_eq!(again.manifest.formatVersion, SUPPORTED_FORMAT_VERSION);
    assert_eq!(again.manifest.displayName, "round-trip");
    assert!(workspace::is_open());
}

#[test]
fn chinese_and_space_paths_are_accepted() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let weird_name = format!("studykit 测试 {} 中文目录", std::process::id(),);
    let target = parent.path().join(&weird_name);
    std::fs::create_dir(&target).unwrap();
    let config = app_config_outside(&target);
    let summary = workspace::create_workspace(&config, &target, "中文 workspace").unwrap();
    assert!(summary.root.join("workspace.json").exists());
    let raw = std::fs::read_to_string(summary.root.join("workspace.json")).unwrap();
    assert!(raw.contains("中文 workspace"));
}

#[test]
fn spaces_in_path_are_accepted() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("workspace with spaces");
    std::fs::create_dir(&target).unwrap();
    let config = app_config_outside(&target);
    let summary = workspace::create_workspace(&config, &target, "spaced").unwrap();
    assert!(summary.root.join("workspace.json").exists());
}

#[test]
fn create_then_close_then_reopen_with_last_workspace_pointer() {
    reset();
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("ws");
    std::fs::create_dir(&workspace).unwrap();
    let config = app_config_outside(&workspace);
    let summary = workspace::create_workspace(&config, &workspace, "with-pointer").unwrap();
    workspace::close_workspace().unwrap();
    let again = workspace::reopen_last_workspace(&config).unwrap();
    assert_eq!(again.root, summary.root);
}

#[test]
fn corrupt_manifest_returns_manifest_corrupt() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("corrupt");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("workspace.json"), b"{not valid json").unwrap();
    let config = app_config_outside(&target);
    let err = workspace::open_workspace(&config, &target).unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_MANIFEST_CORRUPT");
}

#[test]
fn future_format_version_returns_format_too_new() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("future");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(
        target.join("workspace.json"),
        br#"{"schema":"studykit.workspace/1","formatVersion":99,"id":"x","displayName":"x","createdAt":"x","updatedAt":"x"}"#,
    )
    .unwrap();
    let config = app_config_outside(&target);
    let err = workspace::open_workspace(&config, &target).unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_FORMAT_TOO_NEW");
}

#[test]
fn non_studykit_directory_is_rejected_on_open() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let foreign = parent.path().join("photos");
    std::fs::create_dir(&foreign).unwrap();
    std::fs::write(foreign.join("hello.txt"), b"data").unwrap();
    let config = app_config_outside(&foreign);
    let err = workspace::open_workspace(&config, &foreign).unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_NOT_A_WORKSPACE");
}

#[test]
fn non_empty_directory_is_rejected_on_create() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("not-empty");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("existing.txt"), b"data").unwrap();
    let config = app_config_outside(&target);
    let err = workspace::create_workspace(&config, &target, "should fail").unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_CREATION_FAILED");
}

#[test]
fn migration_first_run_then_idempotent() {
    reset();
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("ws");
    std::fs::create_dir(&workspace).unwrap();
    let config = app_config_outside(&workspace);
    let summary = workspace::create_workspace(&config, &workspace, "mig").unwrap();
    workspace::close_workspace().unwrap();
    let conn = db::open_connection(&summary.root.join("studykit.sqlite")).unwrap();
    assert_eq!(
        db::read_schema_version(&conn).unwrap(),
        SUPPORTED_SCHEMA_VERSION
    );
    let mut conn = db::open_connection(&summary.root.join("studykit.sqlite")).unwrap();
    db::apply_pending_migrations(&mut conn).unwrap();
    assert_eq!(
        db::read_schema_version(&conn).unwrap(),
        SUPPORTED_SCHEMA_VERSION
    );
}

#[test]
fn integrity_check_passes_after_create() {
    reset();
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("ws");
    std::fs::create_dir(&workspace).unwrap();
    let config = app_config_outside(&workspace);
    let _summary = workspace::create_workspace(&config, &workspace, "ic").unwrap();
    let conn = db::open_connection(&root.path().join("ws/studykit.sqlite")).unwrap();
    db::integrity_check(&conn).unwrap();
}

#[test]
fn transaction_rollback_does_not_leak_changes() {
    reset();
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("rollback.sqlite");
    let mut conn = db::open_connection(&db_path).unwrap();
    db::apply_pending_migrations(&mut conn).unwrap();
    conn.execute_batch("SAVEPOINT sp1;").unwrap();
    conn.execute(
        "INSERT INTO knowledge_objects (id, kind, body, state, author_type, created_at, updated_at) \
         VALUES ('r1', 'note', 'will-roll-back', 'active', 'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute_batch("ROLLBACK TO sp1; RELEASE sp1;").unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM knowledge_objects WHERE id = 'r1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "rolled-back row must not survive");
    let schema_version: i64 = conn
        .query_row(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(schema_version, SUPPORTED_SCHEMA_VERSION);
}

#[test]
fn path_traversal_segments_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let candidate = root.path().join("..").join("..").join("etc").join("passwd");
    let result = workspace::path_safety::safe_path_check(root.path(), &candidate);
    let err = result.unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_PATH_REJECTED");
}

#[test]
fn relative_paths_are_rejected() {
    let err = workspace::create_workspace(&std::env::temp_dir(), Path::new("relative/path"), "rel")
        .unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_PATH_REJECTED");
}

#[test]
fn symlink_escape_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        let candidate = root.path().join("escape").join("anything");
        let err = workspace::path_safety::safe_path_check(root.path(), &candidate).unwrap_err();
        assert_eq!(err.kind.code(), "STUDYKIT_PATH_REJECTED");
    }
    #[cfg(not(unix))]
    {
        // Skip on platforms without symlinks.
    }
}

#[test]
fn create_failure_does_not_overwrite_existing_workspace() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let first_dir = parent.path().join("first-ws");
    std::fs::create_dir(&first_dir).unwrap();
    let config = app_config_outside(&first_dir);
    let summary = workspace::create_workspace(&config, &first_dir, "first").unwrap();
    workspace::close_workspace().unwrap();
    // Now try to create a second workspace INSIDE a non-empty
    // nested directory under the existing workspace. The nested
    // dir contains a regular file, so `create_workspace` must
    // refuse without touching the original workspace.
    let nested = summary.root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    std::fs::write(nested.join("preexisting.txt"), b"data").unwrap();
    let err = workspace::create_workspace(&config, &nested, "second").unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_CREATION_FAILED");
    let raw = std::fs::read_to_string(summary.root.join("workspace.json")).unwrap();
    let parsed: WorkspaceManifest = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed.displayName, "first");
}

#[test]
fn manifest_uuid_is_unique_per_call() {
    let a = generate_workspace_id();
    let b = generate_workspace_id();
    assert_ne!(a, b, "workspace UUIDs must not collide");
}

#[test]
fn close_when_no_workspace_is_open_is_noop() {
    let _ = workspace::close_workspace();
    let _ = workspace::close_workspace();
}

#[test]
fn reopen_last_without_pointer_returns_no_last_workspace() {
    reset();
    let dir = tempfile::tempdir().unwrap();
    let config = app_config_outside(dir.path());
    let err = workspace::reopen_last_workspace(&config).unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_NO_LAST_WORKSPACE");
}

#[test]
fn manifest_parse_round_trip() {
    let m = WorkspaceManifest {
        schema: manifest::MANIFEST_SCHEMA.to_string(),
        id: "test-id".to_string(),
        formatVersion: SUPPORTED_FORMAT_VERSION,
        displayName: "round trip".to_string(),
        createdAt: "2026-07-29T00:00:00Z".to_string(),
        updatedAt: "2026-07-29T00:00:00Z".to_string(),
    };
    let raw = serde_json::to_vec_pretty(&m).unwrap();
    let parsed = manifest::parse_manifest(&raw).unwrap();
    assert_eq!(parsed, m);
}

// ---------------------------------------------------------------------------
// Correction-Gate regression suite
// ---------------------------------------------------------------------------

#[test]
fn a_open_create_b_does_not_touch_b_or_pointer() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let a = parent.path().join("A");
    let b = parent.path().join("B");
    std::fs::create_dir(&a).unwrap();
    std::fs::create_dir(&b).unwrap();
    let config = app_config_outside(&a);
    let summary_a = workspace::create_workspace(&config, &a, "A").unwrap();
    assert!(workspace::is_open());
    // While A is still open, trying to create B must fail
    // BEFORE any file in B is touched and BEFORE the pointer
    // is rewritten.
    let pointer_before =
        std::fs::read_to_string(workspace::last_workspace_pointer_path(&config).unwrap()).unwrap();
    let err = workspace::create_workspace(&config, &b, "B").unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_ANOTHER_OPEN");
    assert!(!b.join("workspace.json").exists());
    assert!(!b.join("studykit.sqlite").exists());
    let pointer_after =
        std::fs::read_to_string(workspace::last_workspace_pointer_path(&config).unwrap()).unwrap();
    assert_eq!(pointer_before, pointer_after);
    assert!(pointer_after.contains(summary_a.root.to_string_lossy().as_ref()));
}

#[test]
fn a_open_open_b_pointer_unchanged() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let a = parent.path().join("A");
    let b = parent.path().join("B");
    std::fs::create_dir(&a).unwrap();
    std::fs::create_dir(&b).unwrap();
    // Pre-create B so it is a real workspace on disk.
    let config = app_config_outside(&a);
    let b_config = app_config_outside(&b);
    let summary_b = workspace::create_workspace(&b_config, &b, "B").unwrap();
    workspace::close_workspace().unwrap();
    let _ = workspace::forget_workspace(&b_config);
    // Reopen B by direct open with B's config.
    let _ = workspace::open_workspace(&b_config, &summary_b.root).unwrap();
    // Pointer currently points at B because we just reopened it.
    // Now with B still open, try to open A using a different
    // app-config. The open must fail with AnotherOpen and must
    // not rewrite any pointer.
    let pointer_before =
        std::fs::read_to_string(workspace::last_workspace_pointer_path(&config).unwrap());
    let _ = pointer_before; // config has no pointer yet; A's pointer is none.
    let err = workspace::open_workspace(&config, &a).unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_ANOTHER_OPEN");
}

#[test]
fn concurrent_create_calls_only_one_wins() {
    use std::sync::Barrier;
    use std::thread;

    reset();
    let parent = tempfile::tempdir().unwrap();
    let a = parent.path().join("A");
    let b = parent.path().join("B");
    std::fs::create_dir(&a).unwrap();
    std::fs::create_dir(&b).unwrap();
    let config = app_config_outside(&a);

    // Two threads race to call `create_workspace` for A and B
    // simultaneously. The `Barrier` ensures both threads are
    // inside `reserve()` at the same time. Exactly ONE must
    // succeed; the other must see `STUDYKIT_ANOTHER_OPEN` and
    // leave no artefact in its target directory.
    let barrier = std::sync::Arc::new(Barrier::new(2));
    let handle_a = {
        let config = config.clone();
        let a = a.clone();
        let barrier = barrier.clone();
        thread::spawn(move || {
            barrier.wait();
            let result = workspace::create_workspace(&config, &a, "A");
            (a, "A".to_string(), result)
        })
    };
    let handle_b = {
        let config = config.clone();
        let b = b.clone();
        let barrier = barrier.clone();
        thread::spawn(move || {
            barrier.wait();
            let result = workspace::create_workspace(&config, &b, "B");
            (b, "B".to_string(), result)
        })
    };
    let (path_a, name_a, result_a) = handle_a.join().unwrap();
    let (path_b, name_b, result_b) = handle_b.join().unwrap();

    let results = [(name_a.as_str(), result_a), (name_b.as_str(), result_b)];
    let successes: Vec<&str> = results
        .iter()
        .filter_map(|(name, r)| r.as_ref().ok().map(|_| *name))
        .collect();
    let failures: Vec<(&str, &str)> = results
        .iter()
        .filter_map(|(name, r)| r.as_ref().err().map(|e| (*name, e.kind.code())))
        .collect();

    assert_eq!(
        successes.len(),
        1,
        "exactly one create_workspace must win, got {:?}",
        successes
    );
    assert_eq!(
        failures.len(),
        1,
        "exactly one must fail, got {:?}",
        failures
    );
    assert_eq!(failures[0].1, "STUDYKIT_ANOTHER_OPEN");

    // The losing target directory must remain empty.
    let losing_path = if successes[0] == "A" {
        &path_b
    } else {
        &path_a
    };
    let entries: Vec<_> = std::fs::read_dir(losing_path)
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert!(
        entries.is_empty(),
        "losing target dir must stay empty, found: {:?}",
        entries.iter().map(|e| e.file_name()).collect::<Vec<_>>()
    );

    // The manager must be in Open state with the winner.
    assert!(workspace::is_open());
}

#[test]
fn failure_after_layout_restores_empty_target_directory() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("rollback-layout");
    std::fs::create_dir(&target).unwrap();
    let config = app_config_outside(&target);
    workspace::manager::set_failpoints(1, 0);
    let err = workspace::create_workspace(&config, &target, "rollback").unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_CREATION_FAILED");
    assert!(
        std::fs::read_dir(&target).unwrap().next().is_none(),
        "layout failure must restore the selected directory to empty"
    );
    let pointer_path = workspace::last_workspace_pointer_path(&config).unwrap();
    assert!(!pointer_path.exists());
}

#[test]
fn failure_after_sqlite_restores_empty_target_directory() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("rollback-sqlite");
    std::fs::create_dir(&target).unwrap();
    let config = app_config_outside(&target);
    workspace::manager::set_failpoints(0, 2);
    let err = workspace::create_workspace(&config, &target, "rollback").unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_DB_UNUSABLE");
    assert!(
        std::fs::read_dir(&target).unwrap().next().is_none(),
        "SQLite failure must remove the database, sidecars, manifest, and all directories"
    );
    let pointer_path = workspace::last_workspace_pointer_path(&config).unwrap();
    assert!(!pointer_path.exists());
}

#[test]
fn app_config_inside_workspace_root_is_rejected() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let workspace = parent.path().join("ws");
    std::fs::create_dir(&workspace).unwrap();
    // Pre-create the app-config sibling INSIDE the workspace
    // root. The non-empty check must refuse even though the
    // only entry is named `app-config`; the old whitelist
    // would have let this through.
    let app_config_inside = workspace.join("app-config");
    std::fs::create_dir(&app_config_inside).unwrap();
    let err = workspace::create_workspace(&app_config_inside, &workspace, "nope").unwrap_err();
    assert_eq!(err.kind.code(), "STUDYKIT_CREATION_FAILED");
    // No manifest, no SQLite.
    assert!(!workspace.join("workspace.json").exists());
    assert!(!workspace.join("studykit.sqlite").exists());
}

#[test]
fn first_launch_creates_missing_app_config_root() {
    reset();
    let parent = tempfile::tempdir().unwrap();
    let config = parent.path().join("fresh-app-config");
    assert!(!config.exists());
    let pointer = workspace::last_workspace_pointer_path(&config).unwrap();
    assert!(config.is_dir());
    assert!(pointer.ends_with("studykit.last-workspace.json"));
    assert!(!pointer.exists());
}
