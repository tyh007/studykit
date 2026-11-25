//! WP-11 large-workspace performance gate.
//!
//! Creates an isolated temporary native workspace, inserts 10,000 objects in
//! one transaction, then measures an indexed read, a durable single-object
//! save, and a warm close/reopen. It never touches a user workspace.

use std::time::{Duration, Instant};

use rusqlite::params;
use studykit_desktop_lib::workspace::{
    close_workspace, create_workspace, db, get_workspace_health, open_workspace, with_open,
    WorkspaceError,
};

const OBJECT_COUNT: usize = 10_000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sandbox = tempfile::tempdir()?;
    let workspace_root = sandbox.path().join("WP-11 大型 Workspace");
    let app_config = sandbox.path().join("app-config");
    std::fs::create_dir_all(&workspace_root)?;
    std::fs::create_dir_all(&app_config)?;

    create_workspace(&app_config, &workspace_root, "WP-11 Large Workspace")?;

    let bulk_started = Instant::now();
    with_open(|open| {
        let tx = open
            .connection
            .transaction()
            .map_err(|err| WorkspaceError::db_unusable(format!("benchmark begin: {err}")))?;
        {
            let mut statement = tx
                .prepare_cached(
                    "INSERT INTO knowledge_objects (id, kind, body, state, author_type, \
                     container_workspace_id, container_mode, container_kind, container_id, \
                     created_at, updated_at) \
                     VALUES (?1, 'note', ?2, 'active', 'user', NULL, 'study', 'course', ?3, ?4, ?4)",
                )
                .map_err(|err| WorkspaceError::db_unusable(format!("benchmark prepare: {err}")))?;
            for index in 0..OBJECT_COUNT {
                statement
                    .execute(params![
                        format!("benchmark-{index:05}"),
                        format!("Study note {index}"),
                        format!("course-{}", index % 100),
                        "2026-07-31T12:00:00Z",
                    ])
                    .map_err(|err| {
                        WorkspaceError::db_unusable(format!("benchmark insert: {err}"))
                    })?;
            }
        }
        tx.commit()
            .map_err(|err| WorkspaceError::db_unusable(format!("benchmark commit: {err}")))
    })?;
    let bulk = bulk_started.elapsed();

    let query_started = Instant::now();
    let rows = with_open(|open| {
        open.connection
            .query_row(
                "SELECT COUNT(*) FROM knowledge_objects WHERE container_id = ?1",
                ["course-42"],
                |row| row.get::<_, usize>(0),
            )
            .map_err(|err| WorkspaceError::db_unusable(format!("benchmark query: {err}")))
    })?;
    let indexed_query = query_started.elapsed();
    assert_eq!(rows, 100);

    let save_started = Instant::now();
    with_open(|open| {
        open.connection
            .execute(
                "UPDATE knowledge_objects SET body = ?1, updated_at = ?2 WHERE id = ?3",
                params!["Durably updated", "2026-07-31T12:01:00Z", "benchmark-00042"],
            )
            .map(|_| ())
            .map_err(|err| WorkspaceError::db_unusable(format!("benchmark save: {err}")))
    })?;
    let durable_save = save_started.elapsed();

    close_workspace()?;
    let reopen_started = Instant::now();
    open_workspace(&app_config, &workspace_root)?;
    let warm_reopen = reopen_started.elapsed();
    with_open(|open| db::integrity_check(&open.connection))?;
    assert!(get_workspace_health()?.has_knowledge_objects);

    println!(
        "WP-11 large workspace: objects={OBJECT_COUNT} bulk_insert_ms={} indexed_query_ms={} durable_save_ms={} warm_reopen_ms={}",
        bulk.as_millis(), indexed_query.as_millis(), durable_save.as_millis(), warm_reopen.as_millis(),
    );

    assert!(
        indexed_query < Duration::from_millis(300),
        "indexed query exceeded 300 ms"
    );
    assert!(
        durable_save < Duration::from_millis(100),
        "durable save exceeded 100 ms"
    );
    assert!(
        warm_reopen < Duration::from_secs(2),
        "warm reopen exceeded 2 s"
    );
    close_workspace()?;
    Ok(())
}
