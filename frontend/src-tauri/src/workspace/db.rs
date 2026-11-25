// StudyKit v0.4 — WP-09B Round 1
//
// SQLite foundation. The schema is intentionally small:
//
//   schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)
//   workspace_meta(key TEXT PRIMARY KEY, value TEXT)
//   knowledge_objects(
//     id              TEXT PRIMARY KEY,
//     kind            TEXT NOT NULL,
//     body            TEXT NOT NULL,
//     state           TEXT NOT NULL,
//     author_type     TEXT NOT NULL,
//     container_workspace_id TEXT,
//     container_mode          TEXT,
//     container_kind          TEXT,
//     container_id            TEXT,
//     created_at     TEXT NOT NULL,
//     updated_at     TEXT NOT NULL
//   )
//
//   CREATE INDEX ix_knowledge_objects_kind_state ON knowledge_objects(kind, state);
//   CREATE INDEX ix_knowledge_objects_container_id ON knowledge_objects(container_id);
//   CREATE INDEX ix_knowledge_objects_updated_at ON knowledge_objects(updated_at);
//   domain_records(namespace, entity_type, id, payload, updated_at)
//
// The schema is versioned through `schema_migrations`. Migration
// scripts run inside one BEGIN/COMMIT, are idempotent (re-running
// an applied version is a no-op), and refuse to open a database
// whose latest version is higher than what this binary knows.
//
// After every successful open we run `PRAGMA integrity_check`.
// A failing check returns `DatabaseUnusable` and the workspace
// must NOT be opened.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use super::error::{Result, WorkspaceError};

/// Highest schema version this binary knows how to apply.
pub const SUPPORTED_SCHEMA_VERSION: i64 = 3;

/// Open a SQLite connection with the project's standard pragmas.
/// Foreign keys are enforced; the journal is in WAL mode so
/// concurrent reads do not block a write; `synchronous=NORMAL`
/// gives us a fast durable write without the full fsync cost.
pub fn open_connection(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path).map_err(|err| {
        WorkspaceError::db_unusable(format!(
            "failed to open SQLite file '{}': {err}",
            db_path.display()
        ))
    })?;
    conn.pragma_update(None, "journal_mode", &"WAL")
        .map_err(|err| {
            WorkspaceError::db_unusable(format!("PRAGMA journal_mode=WAL failed: {err}"))
        })?;
    conn.pragma_update(None, "foreign_keys", &"ON")
        .map_err(|err| {
            WorkspaceError::db_unusable(format!("PRAGMA foreign_keys=ON failed: {err}"))
        })?;
    conn.pragma_update(None, "synchronous", &"NORMAL")
        .map_err(|err| {
            WorkspaceError::db_unusable(format!("PRAGMA synchronous=NORMAL failed: {err}"))
        })?;
    Ok(conn)
}

/// Run `PRAGMA integrity_check`. The expected output is the single
/// row "ok" on a healthy database. Anything else is unusable.
pub fn integrity_check(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(|err| {
        WorkspaceError::db_unusable(format!("PRAGMA integrity_check failed: {err}"))
    })?;
    let mut rows = stmt.query([]).map_err(|err| {
        WorkspaceError::db_unusable(format!("PRAGMA integrity_check failed: {err}"))
    })?;
    let mut problems: Vec<String> = Vec::new();
    while let Some(row) = rows.next().map_err(|err| {
        WorkspaceError::db_unusable(format!("PRAGMA integrity_check failed: {err}"))
    })? {
        let value: String = row.get(0).map_err(|err| {
            WorkspaceError::db_unusable(format!("integrity_check row error: {err}"))
        })?;
        if value != "ok" {
            problems.push(value);
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(WorkspaceError::db_unusable(format!(
            "PRAGMA integrity_check reported: {}",
            problems.join("; ")
        )))
    }
}

/// Read the highest applied schema version. Returns `0` for an
/// empty database.
pub fn read_schema_version(conn: &Connection) -> Result<i64> {
    // Always ensure `schema_migrations` exists so the read works
    // even on a fresh, empty database.
    ensure_schema_migrations_table(conn)?;
    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("read_schema_version failed: {err}")))?;
    Ok(version)
}

pub fn read_meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM workspace_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| WorkspaceError::db_unusable(format!("read workspace metadata: {err}")))
}

pub fn write_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO workspace_meta(key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|err| WorkspaceError::db_unusable(format!("write workspace metadata: {err}")))?;
    Ok(())
}

/// Ensure the `schema_migrations` bookkeeping table exists. Safe
/// to call repeatedly; the `IF NOT EXISTS` clause makes it a
/// no-op on subsequent runs.
fn ensure_schema_migrations_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\
            version INTEGER PRIMARY KEY, \
            applied_at TEXT NOT NULL \
        );",
    )
    .map_err(|err| {
        WorkspaceError::db_unusable(format!("failed to create schema_migrations table: {err}"))
    })?;
    Ok(())
}

/// Apply every migration that has not yet been applied, in order.
/// Idempotent: re-running an already-applied version is a no-op.
pub fn apply_pending_migrations(conn: &mut Connection) -> Result<()> {
    ensure_schema_migrations_table(conn)?;
    let current = read_schema_version(conn)?;
    if current > SUPPORTED_SCHEMA_VERSION {
        return Err(WorkspaceError::db_unusable(format!(
            "database schema version {current} is newer than this binary supports ({SUPPORTED_SCHEMA_VERSION})"
        )));
    }
    for version in (current + 1)..=SUPPORTED_SCHEMA_VERSION {
        // We use a SAVEPOINT instead of a top-level transaction
        // so the migration bookkeeping (`INSERT INTO
        // schema_migrations`) and the COMMIT/ROLLBACK live in
        // the same SQLite transaction.
        conn.execute_batch(&format!("SAVEPOINT migrate_{version};"))
            .map_err(|err| {
                WorkspaceError::db_unusable(format!(
                    "failed to begin savepoint for v{version}: {err}"
                ))
            })?;
        let result = (|| -> Result<()> {
            apply_migration_via_deref(conn, version)?;
            record_migration_via_deref(conn, version)?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch(&format!("RELEASE migrate_{version};"))
                    .map_err(|err| {
                        WorkspaceError::db_unusable(format!(
                            "failed to release savepoint for v{version}: {err}"
                        ))
                    })?;
            }
            Err(err) => {
                let _ = conn.execute_batch(&format!(
                    "ROLLBACK TO migrate_{version}; RELEASE migrate_{version};"
                ));
                return Err(err);
            }
        }
    }
    Ok(())
}

/// Run the migration DDL through `&mut Connection`. The DDL is
/// idempotent (`CREATE TABLE IF NOT EXISTS`) so even if the
/// version row was lost in a previous crash, re-running the DDL
/// does not corrupt an already-migrated database.
fn apply_migration_via_deref(conn: &mut Connection, version: i64) -> Result<()> {
    match version {
        1 => migration_v1(conn),
        2 => migration_v2(conn),
        3 => migration_v3(conn),
        other => Err(WorkspaceError::db_unusable(format!(
            "no migration script registered for schema version {other}"
        ))),
    }
}

/// Record the applied version in `schema_migrations`. Same
/// savepoint as the DDL — either both land or neither does.
fn record_migration_via_deref(conn: &mut Connection, version: i64) -> Result<()> {
    let applied_at = current_iso8601();
    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![version, applied_at],
    )
    .map_err(|err| {
        WorkspaceError::db_unusable(format!(
            "failed to record schema_migrations row for v{version}: {err}"
        ))
    })?;
    Ok(())
}

/// Apply a single migration's DDL through the connection. Each
/// migration must be idempotent because the
/// `apply_pending_migrations` driver checks for `IF NOT EXISTS`
/// in the DDL; even if the version row is missing, re-running
/// the DDL must not corrupt an already-migrated database.
#[allow(dead_code)]
fn apply_migration(_conn: &Connection, version: i64) -> Result<()> {
    // Retained for backward compatibility with code that
    // exercises the migration script directly from tests. The
    // production path uses `apply_migration_via_deref` inside a
    // savepoint.
    match version {
        1 => migration_v1(_conn),
        2 => migration_v2(_conn),
        3 => migration_v3(_conn),
        other => Err(WorkspaceError::db_unusable(format!(
            "no migration script registered for schema version {other}"
        ))),
    }
}

/// Schema v1: knowledge_objects + workspace_meta. The DDL is
/// idempotent and can be applied through any connection that
/// currently has the savepoint open.
fn migration_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspace_meta (\
            key TEXT PRIMARY KEY, \
            value TEXT NOT NULL \
        );

        CREATE TABLE IF NOT EXISTS knowledge_objects (\
            id              TEXT PRIMARY KEY, \
            kind            TEXT NOT NULL, \
            body            TEXT NOT NULL, \
            state           TEXT NOT NULL, \
            author_type     TEXT NOT NULL, \
            container_workspace_id TEXT, \
            container_mode          TEXT, \
            container_kind          TEXT, \
            container_id            TEXT, \
            created_at     TEXT NOT NULL, \
            updated_at     TEXT NOT NULL \
        );

        CREATE INDEX IF NOT EXISTS ix_knowledge_objects_kind_state \
            ON knowledge_objects(kind, state);
        CREATE INDEX IF NOT EXISTS ix_knowledge_objects_container_id \
            ON knowledge_objects(container_id);
        CREATE INDEX IF NOT EXISTS ix_knowledge_objects_updated_at \
            ON knowledge_objects(updated_at);",
    )
    .map_err(|err| WorkspaceError::db_unusable(format!("migration v1 failed: {err}")))?;
    Ok(())
}

/// Schema v2: lossless JSON records for the strongly-typed
/// Study, Research, and Canvas repositories. The TypeScript
/// adapters retain their domain validation; Rust validates the
/// envelope and JSON syntax before this table is written.
fn migration_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS domain_records (\
            namespace   TEXT NOT NULL, \
            entity_type TEXT NOT NULL, \
            id          TEXT NOT NULL, \
            payload     TEXT NOT NULL, \
            updated_at  TEXT NOT NULL, \
            PRIMARY KEY (namespace, entity_type, id) \
        );
        CREATE INDEX IF NOT EXISTS ix_domain_records_namespace_type \
            ON domain_records(namespace, entity_type);
        CREATE INDEX IF NOT EXISTS ix_domain_records_updated_at \
            ON domain_records(updated_at);",
    )
    .map_err(|err| WorkspaceError::db_unusable(format!("migration v2 failed: {err}")))?;
    Ok(())
}

/// Schema v3: migration journal plus the private Quick Capture
/// Inbox. Migration record hashes make rollback refuse rows that
/// the user edited after import.
fn migration_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migration_runs (\
            id              TEXT PRIMARY KEY, \
            kind            TEXT NOT NULL, \
            status          TEXT NOT NULL, \
            source_hash     TEXT NOT NULL, \
            backup_path     TEXT NOT NULL, \
            source_count    INTEGER NOT NULL, \
            imported_count  INTEGER NOT NULL, \
            created_at      TEXT NOT NULL, \
            completed_at    TEXT, \
            rolled_back_at  TEXT \
        );
        CREATE TABLE IF NOT EXISTS migration_records (\
            run_id          TEXT NOT NULL, \
            namespace       TEXT NOT NULL, \
            entity_type     TEXT NOT NULL, \
            id              TEXT NOT NULL, \
            payload_hash    TEXT NOT NULL, \
            PRIMARY KEY (run_id, namespace, entity_type, id), \
            FOREIGN KEY (run_id) REFERENCES migration_runs(id) ON DELETE CASCADE \
        );
        CREATE TABLE IF NOT EXISTS quick_captures (\
            id          TEXT PRIMARY KEY, \
            body        TEXT NOT NULL, \
            source_kind TEXT NOT NULL, \
            visibility  TEXT NOT NULL, \
            status      TEXT NOT NULL, \
            created_at  TEXT NOT NULL, \
            updated_at  TEXT NOT NULL \
        );
        CREATE INDEX IF NOT EXISTS ix_quick_captures_status_updated \
            ON quick_captures(status, updated_at);
        CREATE INDEX IF NOT EXISTS ix_migration_runs_kind_created \
            ON migration_runs(kind, created_at);",
    )
    .map_err(|err| WorkspaceError::db_unusable(format!("migration v3 failed: {err}")))?;
    Ok(())
}

/// Round 1 read: fetch a single knowledge object by id, returning
/// `None` if no row exists. Used by the desktop adapter's
/// `getObject`.
pub fn read_object(
    conn: &Connection,
    id: &str,
) -> Result<Option<crate::workspace::knowledge::StoredObject>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, body, state, author_type, \
                    container_workspace_id, container_mode, container_kind, container_id, \
                    created_at, updated_at \
             FROM knowledge_objects WHERE id = ?1",
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("read_object prepare failed: {err}")))?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|err| WorkspaceError::db_unusable(format!("read_object query failed: {err}")))?;
    match rows
        .next()
        .map_err(|err| WorkspaceError::db_unusable(format!("read_object next failed: {err}")))?
    {
        Some(row) => Ok(Some(crate::workspace::knowledge::StoredObject::from_row(
            &row,
        )?)),
        None => Ok(None),
    }
}

fn current_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = now / 86_400;
    let secs_of_day = now % 86_400;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z",)
}

fn civil_from_days(z: u64) -> (i64, u32, u32) {
    let z = z as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn open_temp() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let conn = open_connection(&dir.path().join("test.sqlite")).unwrap();
        (dir, conn)
    }

    #[test]
    fn fresh_database_reports_version_zero() {
        let (_dir, conn) = open_temp();
        assert_eq!(read_schema_version(&conn).unwrap(), 0);
    }

    #[test]
    fn migrations_are_idempotent() {
        let (_dir, mut conn) = open_temp();
        apply_pending_migrations(&mut conn).unwrap();
        assert_eq!(
            read_schema_version(&conn).unwrap(),
            SUPPORTED_SCHEMA_VERSION
        );
        // Re-applying must be a no-op.
        apply_pending_migrations(&mut conn).unwrap();
        assert_eq!(
            read_schema_version(&conn).unwrap(),
            SUPPORTED_SCHEMA_VERSION
        );
        // The DDL itself is idempotent too — re-executing it
        // directly should not error.
        migration_v1(&conn).unwrap();
        migration_v2(&conn).unwrap();
        migration_v3(&conn).unwrap();
    }

    #[test]
    fn v1_database_upgrades_without_touching_knowledge_objects() {
        let (_dir, mut conn) = open_temp();
        ensure_schema_migrations_table(&conn).unwrap();
        migration_v1(&conn).unwrap();
        record_migration_via_deref(&mut conn, 1).unwrap();
        conn.execute(
            "INSERT INTO knowledge_objects \
             (id, kind, body, state, author_type, created_at, updated_at) \
             VALUES ('keep', 'note', 'body', 'active', 'user', \
                     '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z')",
            [],
        )
        .unwrap();

        apply_pending_migrations(&mut conn).unwrap();

        assert_eq!(read_schema_version(&conn).unwrap(), 3);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_objects WHERE id = 'keep'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let domain_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'table' AND name = 'domain_records'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(domain_table, 1);
    }

    #[test]
    fn integrity_check_passes_on_fresh_database() {
        let (_dir, mut conn) = open_temp();
        apply_pending_migrations(&mut conn).unwrap();
        integrity_check(&conn).unwrap();
    }

    #[test]
    fn read_object_returns_none_for_unknown_id() {
        let (_dir, mut conn) = open_temp();
        apply_pending_migrations(&mut conn).unwrap();
        let result = read_object(&conn, "missing").unwrap();
        assert!(result.is_none());
    }
}
