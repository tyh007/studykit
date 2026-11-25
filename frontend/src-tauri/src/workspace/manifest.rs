// StudyKit v0.4 — WP-09B Round 1
//
// `workspace.json` is the human-readable manifest that sits next
// to `studykit.sqlite`. It carries the workspace id, the format
// version the binary understands, and timestamps. Schema v1:
//
//   {
//     "schema": "studykit.workspace/1",
//     "id": "<uuid-v4>",
//     "formatVersion": 1,
//     "displayName": "<string>",
//     "createdAt": "<iso8601>",
//     "updatedAt": "<iso8601>"
//   }
//
// SQLite schema versions evolve independently from this manifest
// format. Round 2B adds SQLite schema v2 while the workspace
// manifest remains `studykit.workspace/1`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::error::{Result, WorkspaceError};

/// Current manifest schema name. The string is the contract;
/// bumping it without bumping `formatVersion` is a contract break.
pub const MANIFEST_SCHEMA: &str = "studykit.workspace/1";

/// Highest `formatVersion` this binary understands. Opening a
/// workspace whose manifest claims a higher version is refused
/// with `ErrorKind::FormatTooNew`.
pub const SUPPORTED_FORMAT_VERSION: u32 = 1;

/// The manifest written to disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[allow(non_snake_case)]
pub struct WorkspaceManifest {
    pub schema: String,
    pub id: String,
    pub formatVersion: u32,
    pub displayName: String,
    pub createdAt: String,
    pub updatedAt: String,
}

/// Parse + validate a manifest from a UTF-8 JSON blob. Returns
/// `FormatTooNew` when the formatVersion is above what we know
/// how to read; returns `ManifestCorrupt` on any other parse or
/// shape failure.
pub fn parse_manifest(bytes: &[u8]) -> Result<WorkspaceManifest> {
    // We parse as `serde_json::Value` first so we can branch on the
    // numeric range of `formatVersion` without committing to the
    // shape of fields we may not understand yet.
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|err| {
        WorkspaceError::manifest_corrupt(format!("workspace.json is not valid JSON: {err}"))
    })?;
    let obj = value.as_object().ok_or_else(|| {
        WorkspaceError::manifest_corrupt("workspace.json root is not a JSON object")
    })?;

    let schema = obj
        .get("schema")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WorkspaceError::manifest_corrupt("workspace.json is missing 'schema'"))?;
    if schema != MANIFEST_SCHEMA {
        return Err(WorkspaceError::manifest_corrupt(format!(
            "workspace.json schema is '{schema}', expected '{MANIFEST_SCHEMA}'"
        )));
    }

    let format_version = obj
        .get("formatVersion")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| {
            WorkspaceError::manifest_corrupt(
                "workspace.json is missing 'formatVersion' or it is not a number",
            )
        })?;
    if format_version > u64::from(SUPPORTED_FORMAT_VERSION) {
        return Err(WorkspaceError::format_too_new(format!(
            "workspace.json declares formatVersion {format_version}; this binary supports up to {SUPPORTED_FORMAT_VERSION}"
        )));
    }

    let manifest: WorkspaceManifest = serde_json::from_value(value).map_err(|err| {
        WorkspaceError::manifest_corrupt(format!("workspace.json does not match the schema: {err}"))
    })?;
    Ok(manifest)
}

/// Read a manifest from disk. The directory must already contain a
/// readable `workspace.json`.
pub fn read_manifest(workspace_dir: &Path) -> Result<WorkspaceManifest> {
    let path = workspace_dir.join("workspace.json");
    let bytes = std::fs::read(&path).map_err(|err| {
        WorkspaceError::not_a_workspace(format!("cannot read '{}': {err}", path.display()))
    })?;
    parse_manifest(&bytes)
}

/// Write a fresh manifest. Caller guarantees `workspace_dir` is an
/// existing, otherwise-empty directory that already passed the
/// path-safety check.
pub fn write_manifest(
    workspace_dir: &Path,
    id: &str,
    display_name: &str,
) -> Result<WorkspaceManifest> {
    let now = current_iso8601();
    let manifest = WorkspaceManifest {
        schema: MANIFEST_SCHEMA.to_string(),
        id: id.to_string(),
        formatVersion: SUPPORTED_FORMAT_VERSION,
        displayName: display_name.to_string(),
        createdAt: now.clone(),
        updatedAt: now,
    };
    let path = workspace_dir.join("workspace.json");
    let json = serde_json::to_vec_pretty(&manifest).map_err(|err| {
        WorkspaceError::creation_failed(format!("failed to serialise manifest: {err}"))
    })?;
    // Refuse to overwrite an existing manifest. The caller
    // (`create_workspace`) already checked that the directory is
    // non-empty; this is the second line of defence.
    if path.exists() {
        return Err(WorkspaceError::creation_failed(format!(
            "refusing to overwrite existing '{}'",
            path.display()
        )));
    }
    std::fs::write(&path, &json).map_err(|err| {
        WorkspaceError::creation_failed(format!(
            "failed to write manifest to '{}': {err}",
            path.display()
        ))
    })?;
    Ok(manifest)
}

/// Bump `updatedAt` to `now` and persist. Round 1 only calls this
/// in tests; Round 2 will call it on every write that mutates
/// schema-touching state.
pub fn touch_manifest(workspace_dir: &Path, manifest: &mut WorkspaceManifest) -> Result<()> {
    manifest.updatedAt = current_iso8601();
    let path = workspace_dir.join("workspace.json");
    let json = serde_json::to_vec_pretty(manifest).map_err(|err| {
        WorkspaceError::creation_failed(format!("failed to serialise manifest: {err}"))
    })?;
    std::fs::write(&path, &json).map_err(|err| {
        WorkspaceError::creation_failed(format!(
            "failed to write manifest to '{}': {err}",
            path.display()
        ))
    })?;
    Ok(())
}

/// Generate a standards-compliant random v4 UUID. Using the
/// existing `uuid` dependency avoids timestamp collisions when
/// multiple workspaces are created within one clock tick.
pub fn generate_workspace_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn current_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Civil-from-days algorithm (Howard Hinnant). We avoid pulling
    // in `chrono` / `time` for Round 1.
    let days = now / 86_400;
    let secs_of_day = now % 86_400;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z",)
}

/// Howard Hinnant's `civil_from_days`. Returns (year, month, day)
/// for days since the Unix epoch (1970-01-01).
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

    #[test]
    fn parse_rejects_non_json() {
        let err = parse_manifest(b"not json").unwrap_err();
        assert_eq!(err.kind.code(), "STUDYKIT_MANIFEST_CORRUPT");
    }

    #[test]
    fn parse_rejects_wrong_schema() {
        let raw = br#"{"schema":"other/1","formatVersion":1}"#;
        let err = parse_manifest(raw).unwrap_err();
        assert_eq!(err.kind.code(), "STUDYKIT_MANIFEST_CORRUPT");
    }

    #[test]
    fn parse_rejects_future_format_version() {
        let raw = br#"{"schema":"studykit.workspace/1","formatVersion":99,"id":"x","displayName":"x","createdAt":"x","updatedAt":"x"}"#;
        let err = parse_manifest(raw).unwrap_err();
        assert_eq!(err.kind.code(), "STUDYKIT_FORMAT_TOO_NEW");
    }

    #[test]
    fn parse_accepts_current_format() {
        let raw = br#"{"schema":"studykit.workspace/1","formatVersion":1,"id":"a","displayName":"d","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}"#;
        let manifest = parse_manifest(raw).unwrap();
        assert_eq!(manifest.id, "a");
        assert_eq!(manifest.formatVersion, 1);
    }

    #[test]
    fn uuid_is_v4_flavoured() {
        let id = generate_workspace_id();
        // The UUID string layout is
        // `xxxxxxxx-xxxx-Vxxx-Yxxx-xxxxxxxxxxxx` where V is the
        // version nibble and Y is the variant nibble.
        // The character at position 14 is the version nibble;
        // the character at position 19 is the variant nibble.
        let chars: Vec<char> = id.chars().collect();
        assert_eq!(chars.len(), 36, "UUID string length: {id}");
        assert_eq!(chars[8], '-');
        assert_eq!(chars[13], '-');
        assert_eq!(chars[18], '-');
        assert_eq!(chars[23], '-');
        let version = chars[14];
        assert_eq!(version, '4', "version nibble must be '4', got '{version}'",);
        let variant = chars[19];
        assert!(
            matches!(variant, '8' | '9' | 'a' | 'b'),
            "variant nibble must be 8/9/a/b, got '{variant}'",
        );
        // The dashes must be in the canonical positions.
        assert_eq!(id.len(), 36);
    }

    #[test]
    fn civil_from_days_matches_unix_epoch() {
        // 1970-01-01 is day 0.
        let (y, m, d) = civil_from_days(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn civil_from_days_matches_2026_07_28() {
        // 2026-07-28 is day 20662 since the Unix epoch (verified
        // with `date -u -j -f "%Y-%m-%d" "2026-07-28" "+%s"`).
        let (y, m, d) = civil_from_days(20662);
        assert_eq!((y, m, d), (2026, 7, 28));
    }
}
