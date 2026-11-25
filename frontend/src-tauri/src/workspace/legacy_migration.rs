use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::ipc_types::DomainRecordRow;
use super::manager::{OpenWorkspace, BACKUPS_DIR};
use super::{Result, WorkspaceError};

#[derive(Debug, Clone, Serialize)]
pub struct MigrationSummary {
    pub run_id: String,
    pub status: String,
    pub source_hash: String,
    pub source_count: usize,
    pub imported_count: usize,
    pub backup_path: String,
}

fn sha256(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

fn count_snapshot_rows(snapshot: &serde_json::Value) -> Result<usize> {
    let tables = snapshot
        .get("tables")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            WorkspaceError::validation_failed("legacy snapshot must contain a tables object")
        })?;
    let mut count = 0;
    for rows in tables.values() {
        count += rows
            .as_array()
            .ok_or_else(|| {
                WorkspaceError::validation_failed("legacy snapshot table must be an array")
            })?
            .len();
    }
    Ok(count)
}

fn existing_summary(open: &OpenWorkspace, run_id: &str) -> Result<Option<MigrationSummary>> {
    open.connection
        .query_row(
            "SELECT id, status, source_hash, source_count, imported_count, backup_path \
             FROM migration_runs WHERE id = ?1",
            params![run_id],
            |row| {
                Ok(MigrationSummary {
                    run_id: row.get(0)?,
                    status: row.get(1)?,
                    source_hash: row.get(2)?,
                    source_count: row.get::<_, i64>(3)? as usize,
                    imported_count: row.get::<_, i64>(4)? as usize,
                    backup_path: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|err| WorkspaceError::db_unusable(format!("read migration run: {err}")))
}

pub fn import(
    open: &mut OpenWorkspace,
    run_id: &str,
    snapshot_json: &str,
    expected_hash: &str,
    records: &[DomainRecordRow],
) -> Result<MigrationSummary> {
    Uuid::parse_str(run_id)
        .map_err(|_| WorkspaceError::validation_failed("migration run id must be a UUID"))?;
    if snapshot_json.len() > 100 * 1024 * 1024 {
        return Err(WorkspaceError::validation_failed(
            "legacy snapshot exceeds 100 MiB",
        ));
    }
    let actual_hash = sha256(snapshot_json.as_bytes());
    if actual_hash != expected_hash {
        return Err(WorkspaceError::validation_failed(
            "legacy snapshot hash mismatch",
        ));
    }
    if let Some(existing) = existing_summary(open, run_id)? {
        if existing.status == "completed" && existing.source_hash == actual_hash {
            return Ok(existing);
        }
        return Err(WorkspaceError::validation_failed(
            "migration run id already exists with a different state",
        ));
    }
    let snapshot: serde_json::Value = serde_json::from_str(snapshot_json)
        .map_err(|_| WorkspaceError::validation_failed("legacy snapshot is invalid JSON"))?;
    let source_count = count_snapshot_rows(&snapshot)?;

    let folder = open.root.join(BACKUPS_DIR).join(format!(
        "legacy-migration-{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        &run_id[..8]
    ));
    fs::create_dir_all(&folder).map_err(|err| {
        WorkspaceError::creation_failed(format!("create migration backup directory: {err}"))
    })?;
    let backup_path = folder.join("dexie-snapshot.json");
    let temp_path = folder.join("dexie-snapshot.json.tmp");
    fs::write(&temp_path, snapshot_json.as_bytes()).map_err(|err| {
        WorkspaceError::creation_failed(format!("write migration snapshot: {err}"))
    })?;
    fs::rename(&temp_path, &backup_path).map_err(|err| {
        WorkspaceError::creation_failed(format!("commit migration snapshot: {err}"))
    })?;

    let created_at = Utc::now().to_rfc3339();
    let transaction = open
        .connection
        .transaction()
        .map_err(|err| WorkspaceError::db_unusable(format!("begin legacy migration: {err}")))?;
    transaction
        .execute(
            "INSERT INTO migration_runs \
             (id, kind, status, source_hash, backup_path, source_count, imported_count, created_at) \
             VALUES (?1, 'dexie-v9', 'running', ?2, ?3, ?4, 0, ?5)",
            params![
                run_id,
                actual_hash,
                backup_path.to_string_lossy(),
                source_count as i64,
                created_at
            ],
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("create migration run: {err}")))?;

    for row in records {
        let collision: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM domain_records \
                 WHERE namespace = ?1 AND entity_type = ?2 AND id = ?3)",
                params![row.namespace, row.entity_type, row.id],
                |db_row| db_row.get::<_, i64>(0),
            )
            .map(|value| value != 0)
            .map_err(|err| {
                WorkspaceError::db_unusable(format!("check migration collision: {err}"))
            })?;
        if collision {
            return Err(WorkspaceError::validation_failed(format!(
                "migration would overwrite {}/{}/{}",
                row.namespace, row.entity_type, row.id
            )));
        }
        transaction
            .execute(
                "INSERT INTO domain_records \
                 (namespace, entity_type, id, payload, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    row.namespace,
                    row.entity_type,
                    row.id,
                    row.payload,
                    row.updated_at
                ],
            )
            .map_err(|err| WorkspaceError::db_unusable(format!("insert migrated record: {err}")))?;
        transaction
            .execute(
                "INSERT INTO migration_records \
                 (run_id, namespace, entity_type, id, payload_hash) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    run_id,
                    row.namespace,
                    row.entity_type,
                    row.id,
                    sha256(row.payload.as_bytes())
                ],
            )
            .map_err(|err| {
                WorkspaceError::db_unusable(format!("journal migrated record: {err}"))
            })?;
    }
    let completed_at = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE migration_runs SET status = 'completed', imported_count = ?2, \
             completed_at = ?3 WHERE id = ?1",
            params![run_id, records.len() as i64, completed_at],
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("complete migration run: {err}")))?;
    transaction
        .commit()
        .map_err(|err| WorkspaceError::db_unusable(format!("commit legacy migration: {err}")))?;

    Ok(MigrationSummary {
        run_id: run_id.to_string(),
        status: "completed".to_string(),
        source_hash: actual_hash,
        source_count,
        imported_count: records.len(),
        backup_path: backup_path.to_string_lossy().into_owned(),
    })
}

pub fn rollback(open: &mut OpenWorkspace, run_id: &str) -> Result<MigrationSummary> {
    let existing = existing_summary(open, run_id)?
        .ok_or_else(|| WorkspaceError::validation_failed("migration run does not exist"))?;
    if existing.status == "rolled_back" {
        return Ok(existing);
    }
    if existing.status != "completed" {
        return Err(WorkspaceError::validation_failed(
            "only completed migrations can be rolled back",
        ));
    }
    let transaction = open
        .connection
        .transaction()
        .map_err(|err| WorkspaceError::db_unusable(format!("begin migration rollback: {err}")))?;
    let mut stmt = transaction
        .prepare(
            "SELECT namespace, entity_type, id, payload_hash \
             FROM migration_records WHERE run_id = ?1",
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("prepare migration rollback: {err}")))?;
    let rows = stmt
        .query_map(params![run_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|err| WorkspaceError::db_unusable(format!("query migration rollback: {err}")))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|err| {
            WorkspaceError::db_unusable(format!("read migration rollback row: {err}"))
        })?;
    drop(stmt);

    for (namespace, entity_type, id, imported_hash) in &rows {
        let payload: Option<String> = transaction
            .query_row(
                "SELECT payload FROM domain_records \
                 WHERE namespace = ?1 AND entity_type = ?2 AND id = ?3",
                params![namespace, entity_type, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| WorkspaceError::db_unusable(format!("read rollback target: {err}")))?;
        let payload = payload.ok_or_else(|| {
            WorkspaceError::validation_failed(format!(
                "cannot rollback: migrated record {namespace}/{entity_type}/{id} is missing"
            ))
        })?;
        if sha256(payload.as_bytes()) != *imported_hash {
            return Err(WorkspaceError::validation_failed(format!(
                "cannot rollback: migrated record {namespace}/{entity_type}/{id} was edited"
            )));
        }
    }
    for (namespace, entity_type, id, _) in &rows {
        transaction
            .execute(
                "DELETE FROM domain_records \
                 WHERE namespace = ?1 AND entity_type = ?2 AND id = ?3",
                params![namespace, entity_type, id],
            )
            .map_err(|err| WorkspaceError::db_unusable(format!("delete rollback target: {err}")))?;
    }
    let rolled_back_at = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE migration_runs SET status = 'rolled_back', rolled_back_at = ?2 \
             WHERE id = ?1",
            params![run_id, rolled_back_at],
        )
        .map_err(|err| {
            WorkspaceError::db_unusable(format!("complete migration rollback: {err}"))
        })?;
    transaction
        .commit()
        .map_err(|err| WorkspaceError::db_unusable(format!("commit migration rollback: {err}")))?;
    Ok(MigrationSummary {
        status: "rolled_back".to_string(),
        ..existing
    })
}

pub fn latest(open: &OpenWorkspace) -> Result<Option<MigrationSummary>> {
    open.connection
        .query_row(
            "SELECT id, status, source_hash, source_count, imported_count, backup_path \
             FROM migration_runs ORDER BY created_at DESC LIMIT 1",
            [],
            |row| {
                Ok(MigrationSummary {
                    run_id: row.get(0)?,
                    status: row.get(1)?,
                    source_hash: row.get(2)?,
                    source_count: row.get::<_, i64>(3)? as usize,
                    imported_count: row.get::<_, i64>(4)? as usize,
                    backup_path: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|err| WorkspaceError::db_unusable(format!("read latest migration: {err}")))
}

pub fn backup_path(summary: &MigrationSummary) -> PathBuf {
    PathBuf::from(&summary.backup_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{db, manifest::write_manifest};
    use tempfile::tempdir;

    fn open_workspace() -> (tempfile::TempDir, OpenWorkspace) {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(BACKUPS_DIR)).unwrap();
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        db::apply_pending_migrations(&mut connection).unwrap();
        let manifest = write_manifest(
            root.path(),
            "00000000-0000-4000-8000-000000000002",
            "Migration test",
        )
        .unwrap();
        let open = OpenWorkspace {
            root: root.path().to_path_buf(),
            manifest,
            connection,
            recovered_after_crash: false,
        };
        (root, open)
    }

    fn row() -> DomainRecordRow {
        DomainRecordRow {
            namespace: "study".into(),
            entity_type: "question".into(),
            id: "q-1".into(),
            payload: r#"{"id":"q-1","body":"Why?"}"#.into(),
            updated_at: "2026-07-30T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn import_is_idempotent_and_rollback_is_safe() {
        let (_root, mut open) = open_workspace();
        let snapshot =
            r#"{"schema":"studykit.dexie-snapshot/1","tables":{"studyQuestions":[{"id":"q-1"}]}}"#;
        let hash = sha256(snapshot.as_bytes());
        let run = Uuid::new_v4().to_string();
        let first = import(&mut open, &run, snapshot, &hash, &[row()]).unwrap();
        assert_eq!(first.imported_count, 1);
        let second = import(&mut open, &run, snapshot, &hash, &[row()]).unwrap();
        assert_eq!(second.run_id, first.run_id);
        assert!(backup_path(&first).exists());
        let rolled_back = rollback(&mut open, &run).unwrap();
        assert_eq!(rolled_back.status, "rolled_back");
        assert_eq!(
            open.connection
                .query_row("SELECT COUNT(*) FROM domain_records", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn rollback_refuses_user_edits() {
        let (_root, mut open) = open_workspace();
        let snapshot = r#"{"tables":{"studyQuestions":[{"id":"q-1"}]}}"#;
        let hash = sha256(snapshot.as_bytes());
        let run = Uuid::new_v4().to_string();
        import(&mut open, &run, snapshot, &hash, &[row()]).unwrap();
        open.connection
            .execute(
                "UPDATE domain_records SET payload = '{\"id\":\"q-1\",\"body\":\"edited\"}'",
                [],
            )
            .unwrap();
        assert!(rollback(&mut open, &run).is_err());
    }
}
