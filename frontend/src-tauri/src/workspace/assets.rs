use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::manager::{ASSETS_DIR, ASSETS_ORIGINALS, ASSETS_TEMP};
use super::{Result, WorkspaceError};

pub const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024;
const PDF_HEADER: &[u8; 5] = b"%PDF-";
const ASSET_PREFIX: &str = "asset-";

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceAssetSummary {
    pub asset_id: String,
    pub original_filename: String,
    pub mime_type: &'static str,
    pub size_bytes: u64,
    pub content_hash: String,
    pub stored_at: String,
}

fn validate_asset_id(asset_id: &str) -> Result<()> {
    let uuid = asset_id.strip_prefix(ASSET_PREFIX).ok_or_else(|| {
        WorkspaceError::validation_failed("workspace asset id has an invalid prefix")
    })?;
    Uuid::parse_str(uuid)
        .map_err(|_| WorkspaceError::validation_failed("workspace asset id is not valid"))?;
    Ok(())
}

fn checked_dir(root: &Path, segments: &[&str]) -> Result<PathBuf> {
    let canonical_root = fs::canonicalize(root).map_err(|err| {
        WorkspaceError::path_rejected(format!("resolve workspace root for asset IO: {err}"))
    })?;
    let mut path = root.to_path_buf();
    for segment in segments {
        path.push(segment);
    }
    let canonical = fs::canonicalize(&path).map_err(|err| {
        WorkspaceError::path_rejected(format!("resolve workspace asset directory: {err}"))
    })?;
    if !canonical.starts_with(&canonical_root) {
        return Err(WorkspaceError::path_rejected(
            "workspace asset directory escapes the open workspace",
        ));
    }
    Ok(canonical)
}

fn original_path(root: &Path, asset_id: &str) -> Result<PathBuf> {
    validate_asset_id(asset_id)?;
    Ok(checked_dir(root, &[ASSETS_DIR, ASSETS_ORIGINALS])?.join(format!("{asset_id}.pdf")))
}

pub fn import_pdf(root: &Path, source: &Path) -> Result<WorkspaceAssetSummary> {
    let source = fs::canonicalize(source)
        .map_err(|err| WorkspaceError::path_rejected(format!("resolve selected PDF: {err}")))?;
    let metadata = fs::metadata(&source)
        .map_err(|err| WorkspaceError::creation_failed(format!("inspect selected PDF: {err}")))?;
    if !metadata.is_file() {
        return Err(WorkspaceError::validation_failed(
            "selected PDF is not a regular file",
        ));
    }
    if metadata.len() == 0 || metadata.len() > MAX_PDF_BYTES {
        return Err(WorkspaceError::validation_failed(format!(
            "selected PDF must be between 1 byte and {} MiB",
            MAX_PDF_BYTES / 1024 / 1024
        )));
    }
    let is_pdf_extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf_extension {
        return Err(WorkspaceError::validation_failed(
            "selected file must have a .pdf extension",
        ));
    }

    let asset_id = format!("{ASSET_PREFIX}{}", Uuid::new_v4());
    let originals = checked_dir(root, &[ASSETS_DIR, ASSETS_ORIGINALS])?;
    let temp_dir = checked_dir(root, &[ASSETS_DIR, ASSETS_TEMP])?;
    let destination = originals.join(format!("{asset_id}.pdf"));
    let temporary = temp_dir.join(format!("{asset_id}.part"));

    let result = (|| -> Result<WorkspaceAssetSummary> {
        let mut input = File::open(&source)
            .map_err(|err| WorkspaceError::creation_failed(format!("open selected PDF: {err}")))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|err| {
                WorkspaceError::creation_failed(format!("create temporary asset: {err}"))
            })?;
        let mut hash = Sha256::new();
        let mut total = 0_u64;
        let mut first = true;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input.read(&mut buffer).map_err(|err| {
                WorkspaceError::creation_failed(format!("read selected PDF: {err}"))
            })?;
            if read == 0 {
                break;
            }
            if first {
                first = false;
                if read < PDF_HEADER.len() || &buffer[..PDF_HEADER.len()] != PDF_HEADER {
                    return Err(WorkspaceError::validation_failed(
                        "selected file does not contain a PDF header",
                    ));
                }
            }
            total += read as u64;
            if total > MAX_PDF_BYTES {
                return Err(WorkspaceError::validation_failed(
                    "selected PDF exceeded the size limit while copying",
                ));
            }
            hash.update(&buffer[..read]);
            output.write_all(&buffer[..read]).map_err(|err| {
                WorkspaceError::creation_failed(format!("write workspace asset: {err}"))
            })?;
        }
        output.flush().map_err(|err| {
            WorkspaceError::creation_failed(format!("flush workspace asset: {err}"))
        })?;
        output.sync_all().map_err(|err| {
            WorkspaceError::creation_failed(format!("sync workspace asset: {err}"))
        })?;
        drop(output);
        fs::rename(&temporary, &destination).map_err(|err| {
            WorkspaceError::creation_failed(format!("commit workspace asset: {err}"))
        })?;

        Ok(WorkspaceAssetSummary {
            asset_id,
            original_filename: source
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Imported PDF.pdf".into()),
            mime_type: "application/pdf",
            size_bytes: total,
            content_hash: format!("{:x}", hash.finalize()),
            stored_at: Utc::now().to_rfc3339(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn read(root: &Path, asset_id: &str) -> Result<Vec<u8>> {
    let path = original_path(root, asset_id)?;
    let entry = fs::symlink_metadata(&path).map_err(|err| {
        WorkspaceError::path_rejected(format!("inspect workspace asset entry: {err}"))
    })?;
    if entry.file_type().is_symlink() || !entry.is_file() {
        return Err(WorkspaceError::path_rejected(
            "workspace asset entry must be a regular file, not a symlink",
        ));
    }
    let canonical_originals = checked_dir(root, &[ASSETS_DIR, ASSETS_ORIGINALS])?;
    let canonical_path = fs::canonicalize(&path)
        .map_err(|err| WorkspaceError::path_rejected(format!("resolve workspace asset: {err}")))?;
    if !canonical_path.starts_with(&canonical_originals) {
        return Err(WorkspaceError::path_rejected(
            "workspace asset escapes assets/originals",
        ));
    }
    let metadata = fs::metadata(&canonical_path).map_err(|err| {
        WorkspaceError::creation_failed(format!("inspect workspace asset: {err}"))
    })?;
    if !metadata.is_file() || metadata.len() > MAX_PDF_BYTES {
        return Err(WorkspaceError::validation_failed(
            "workspace asset is not a readable PDF original",
        ));
    }
    fs::read(canonical_path)
        .map_err(|err| WorkspaceError::creation_failed(format!("read workspace asset: {err}")))
}

pub fn discard(root: &Path, asset_id: &str) -> Result<()> {
    let path = original_path(root, asset_id)?;
    if !path.exists() {
        return Ok(());
    }
    let entry = fs::symlink_metadata(&path).map_err(|err| {
        WorkspaceError::path_rejected(format!("inspect workspace asset entry for discard: {err}"))
    })?;
    if entry.file_type().is_symlink() || !entry.is_file() {
        return Err(WorkspaceError::path_rejected(
            "workspace asset entry must be a regular file, not a symlink",
        ));
    }
    let canonical_originals = checked_dir(root, &[ASSETS_DIR, ASSETS_ORIGINALS])?;
    let canonical_path = fs::canonicalize(&path).map_err(|err| {
        WorkspaceError::path_rejected(format!("resolve workspace asset for discard: {err}"))
    })?;
    if !canonical_path.starts_with(&canonical_originals) {
        return Err(WorkspaceError::path_rejected(
            "workspace asset escapes assets/originals",
        ));
    }
    fs::remove_file(canonical_path)
        .map_err(|err| WorkspaceError::creation_failed(format!("discard workspace asset: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("assets/originals")).unwrap();
        fs::create_dir_all(root.path().join("assets/temp")).unwrap();
        root
    }

    #[test]
    fn import_read_and_discard_round_trip() {
        let root = workspace_root();
        let source_dir = tempfile::tempdir().unwrap();
        let source = source_dir.path().join("研究 paper.pdf");
        fs::write(&source, b"%PDF-1.7\nasset bytes").unwrap();

        let summary = import_pdf(root.path(), &source).unwrap();
        assert!(summary.asset_id.starts_with("asset-"));
        assert_eq!(summary.original_filename, "研究 paper.pdf");
        assert_eq!(
            read(root.path(), &summary.asset_id).unwrap(),
            b"%PDF-1.7\nasset bytes"
        );
        discard(root.path(), &summary.asset_id).unwrap();
        assert!(read(root.path(), &summary.asset_id).is_err());
    }

    #[test]
    fn rejects_extension_or_header_mismatch_without_leaving_temp_files() {
        let root = workspace_root();
        let source_dir = tempfile::tempdir().unwrap();
        let wrong_extension = source_dir.path().join("paper.txt");
        fs::write(&wrong_extension, b"%PDF-1.7\n").unwrap();
        assert!(import_pdf(root.path(), &wrong_extension).is_err());

        let wrong_header = source_dir.path().join("paper.pdf");
        fs::write(&wrong_header, b"not a pdf").unwrap();
        assert!(import_pdf(root.path(), &wrong_header).is_err());
        assert_eq!(
            fs::read_dir(root.path().join("assets/temp"))
                .unwrap()
                .count(),
            0
        );
        assert_eq!(
            fs::read_dir(root.path().join("assets/originals"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn rejects_untrusted_asset_ids() {
        let root = workspace_root();
        assert!(read(root.path(), "../paper").is_err());
        assert!(discard(root.path(), "asset-not-a-uuid").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_originals_symlink_that_escapes_workspace() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("assets/temp")).unwrap();
        symlink(outside.path(), root.path().join("assets/originals")).unwrap();
        let source = root.path().join("paper.pdf");
        fs::write(&source, b"%PDF-1.7\n").unwrap();
        assert!(import_pdf(root.path(), &source).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_asset_file_symlink_without_deleting_its_target() {
        use std::os::unix::fs::symlink;
        let root = workspace_root();
        let originals = root.path().join("assets/originals");
        let victim = originals.join("victim.pdf");
        fs::write(&victim, b"%PDF-1.7\nvictim").unwrap();
        let asset_id = format!("asset-{}", Uuid::new_v4());
        symlink(&victim, originals.join(format!("{asset_id}.pdf"))).unwrap();

        assert!(read(root.path(), &asset_id).is_err());
        assert!(discard(root.path(), &asset_id).is_err());
        assert_eq!(fs::read(&victim).unwrap(), b"%PDF-1.7\nvictim");
    }
}
