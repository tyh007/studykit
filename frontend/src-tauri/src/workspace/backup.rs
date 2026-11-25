use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::DatabaseName;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::manager::{OpenWorkspace, ASSETS_DERIVED, ASSETS_DIR, ASSETS_ORIGINALS, BACKUPS_DIR};
use super::{db, Result, WorkspaceError, SQLITE_FILE_NAME};

const KEEP_SNAPSHOTS: usize = 5;

#[derive(Debug, Clone, Serialize)]
pub struct BackupSummary {
    pub path: String,
    pub created_at: String,
    pub database_sha256: String,
    pub asset_files: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest<'a> {
    schema: &'static str,
    source_workspace_id: &'a str,
    source_display_name: &'a str,
    created_at: &'a str,
    database_sha256: &'a str,
    asset_files: usize,
}

fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).map_err(|err| {
        WorkspaceError::creation_failed(format!("open backup file for hashing: {err}"))
    })?;
    let mut hash = Sha256::new();
    let mut buf = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf).map_err(|err| {
            WorkspaceError::creation_failed(format!("read backup file for hashing: {err}"))
        })?;
        if read == 0 {
            break;
        }
        hash.update(&buf[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn copy_tree(source: &Path, target: &Path) -> Result<usize> {
    if !source.exists() {
        return Ok(0);
    }
    fs::create_dir_all(target).map_err(|err| {
        WorkspaceError::creation_failed(format!("create backup asset directory: {err}"))
    })?;
    let mut count = 0;
    for entry in fs::read_dir(source).map_err(|err| {
        WorkspaceError::creation_failed(format!("read workspace asset directory: {err}"))
    })? {
        let entry = entry.map_err(|err| {
            WorkspaceError::creation_failed(format!("read workspace asset entry: {err}"))
        })?;
        let file_type = entry.file_type().map_err(|err| {
            WorkspaceError::creation_failed(format!("inspect workspace asset: {err}"))
        })?;
        if file_type.is_symlink() {
            return Err(WorkspaceError::creation_failed(
                "backup refuses symlinks inside workspace assets",
            ));
        }
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            count += copy_tree(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), destination).map_err(|err| {
                WorkspaceError::creation_failed(format!("copy workspace asset: {err}"))
            })?;
            count += 1;
        }
    }
    Ok(count)
}

fn rotate(backups_root: &Path) -> Result<()> {
    let mut snapshots: Vec<PathBuf> = fs::read_dir(backups_root)
        .map_err(|err| WorkspaceError::creation_failed(format!("list backups: {err}")))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                && entry.file_name().to_string_lossy().starts_with("snapshot-")
        })
        .map(|entry| entry.path())
        .collect();
    snapshots.sort();
    let remove_count = snapshots.len().saturating_sub(KEEP_SNAPSHOTS);
    for path in snapshots.into_iter().take(remove_count) {
        fs::remove_dir_all(path)
            .map_err(|err| WorkspaceError::creation_failed(format!("rotate old backup: {err}")))?;
    }
    Ok(())
}

/// Create a consistent, directly-openable Workspace snapshot.
/// SQLite's online backup API is used while the source connection
/// remains open; WAL/SHM files are never copied.
pub fn create(open: &OpenWorkspace) -> Result<BackupSummary> {
    let created_at = Utc::now().to_rfc3339();
    let folder_stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f");
    let backups_root = open.root.join(BACKUPS_DIR);
    fs::create_dir_all(&backups_root).map_err(|err| {
        WorkspaceError::creation_failed(format!("create backups directory: {err}"))
    })?;
    let destination = backups_root.join(format!("snapshot-{folder_stamp}"));
    fs::create_dir(&destination)
        .map_err(|err| WorkspaceError::creation_failed(format!("create backup snapshot: {err}")))?;

    let result = (|| -> Result<BackupSummary> {
        let database_path = destination.join(SQLITE_FILE_NAME);
        open.connection
            .backup(DatabaseName::Main, &database_path, None)
            .map_err(|err| {
                WorkspaceError::creation_failed(format!("SQLite online backup failed: {err}"))
            })?;
        let verification = db::open_connection(&database_path)?;
        db::integrity_check(&verification)?;
        drop(verification);

        super::manifest::write_manifest(
            &destination,
            &open.manifest.id,
            &open.manifest.displayName,
        )?;
        let assets_target = destination.join(ASSETS_DIR);
        let mut asset_files = 0;
        asset_files += copy_tree(
            &open.root.join(ASSETS_DIR).join(ASSETS_ORIGINALS),
            &assets_target.join(ASSETS_ORIGINALS),
        )?;
        asset_files += copy_tree(
            &open.root.join(ASSETS_DIR).join(ASSETS_DERIVED),
            &assets_target.join(ASSETS_DERIVED),
        )?;
        fs::create_dir_all(assets_target.join("temp")).map_err(|err| {
            WorkspaceError::creation_failed(format!("create backup temp directory: {err}"))
        })?;
        fs::create_dir_all(destination.join(BACKUPS_DIR)).map_err(|err| {
            WorkspaceError::creation_failed(format!("create nested backups directory: {err}"))
        })?;
        fs::create_dir_all(destination.join("exports")).map_err(|err| {
            WorkspaceError::creation_failed(format!("create backup exports directory: {err}"))
        })?;

        let database_sha256 = hash_file(&database_path)?;
        let metadata = BackupManifest {
            schema: "studykit.backup/1",
            source_workspace_id: &open.manifest.id,
            source_display_name: &open.manifest.displayName,
            created_at: &created_at,
            database_sha256: &database_sha256,
            asset_files,
        };
        let bytes = serde_json::to_vec_pretty(&metadata).map_err(|err| {
            WorkspaceError::creation_failed(format!("serialize backup metadata: {err}"))
        })?;
        fs::write(destination.join("backup.json"), bytes).map_err(|err| {
            WorkspaceError::creation_failed(format!("write backup metadata: {err}"))
        })?;
        Ok(BackupSummary {
            path: destination.to_string_lossy().into_owned(),
            created_at,
            database_sha256,
            asset_files,
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&destination);
    } else {
        rotate(&backups_root)?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn online_snapshot_is_openable_and_copies_assets() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("assets/originals")).unwrap();
        fs::create_dir_all(root.path().join("assets/derived")).unwrap();
        fs::create_dir_all(root.path().join("assets/temp")).unwrap();
        fs::create_dir_all(root.path().join("backups")).unwrap();
        fs::create_dir_all(root.path().join("exports")).unwrap();
        fs::write(root.path().join("assets/originals/paper.pdf"), b"pdf").unwrap();
        let manifest = super::super::manifest::write_manifest(
            root.path(),
            "00000000-0000-4000-8000-000000000001",
            "Backup test",
        )
        .unwrap();
        let db_path = root.path().join(SQLITE_FILE_NAME);
        let mut connection = db::open_connection(&db_path).unwrap();
        db::apply_pending_migrations(&mut connection).unwrap();
        let open = OpenWorkspace {
            root: root.path().to_path_buf(),
            manifest,
            connection,
            recovered_after_crash: false,
        };

        let summary = create(&open).unwrap();
        let snapshot = PathBuf::from(&summary.path);
        assert!(snapshot.join("workspace.json").exists());
        assert!(snapshot.join("assets/originals/paper.pdf").exists());
        assert_eq!(summary.asset_files, 1);
        let conn = db::open_connection(&snapshot.join(SQLITE_FILE_NAME)).unwrap();
        db::integrity_check(&conn).unwrap();
    }
}
