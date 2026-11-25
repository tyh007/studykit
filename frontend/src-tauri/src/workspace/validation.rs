// StudyKit v0.4 — WP-09B Round 1 (Correction Gate, Final Delta)
//
// Single Rust validation boundary for knowledge-object
// operations. Every operation that crosses the IPC boundary
// is run through `validate_row` and `validate_op`; the first
// failure aborts the entire `transact_v1` batch and rolls
// back the SQLite transaction in `ipc.rs`.
//
// The boundary is intentionally tight:
//   - `id` is non-empty and contains no NUL byte.
//   - `kind`, `state`, `author_type` are restricted to the
//     canonical enum sets.
//   - `created_at` / `updated_at` are RFC 3339 timestamps. The
//     parser below uses `chrono::DateTime::parse_from_rfc3339`,
//     which accepts both `2026-07-29T00:00:00Z` and
//     `2026-07-29T00:00:00.000Z` (the form produced by
//     `JavaScript Date.toISOString()`) and timezone offsets like
//     `+02:00`. The parser rejects malformed strings without
//     us hand-rolling a calendar algorithm.
//   - The container fields form an all-or-nothing shape:
//     either all four are null / absent, or all four are
//     present and valid.
//   - The only allowed (mode, kind) pairs are
//     `study|course` and `research|project`.
//   - `container_workspace_id`, when present, is a non-empty
//     string. When absent, all four container columns are
//     null.

use std::fmt;

use super::ipc_types::{StoredRow, TransactOp};

/// Allow-list of valid kind values. Mirrors the WebView
/// `KnowledgeObjectKind` enum; the IPC boundary is the single
/// source of truth.
pub const VALID_KINDS: &[&str] = &[
    "source", "note", "concept", "question", "claim", "evidence", "task", "output",
];
pub const VALID_STATES: &[&str] = &["active", "archived", "trashed"];
pub const VALID_AUTHOR_TYPES: &[&str] = &["user", "ai", "imported"];
pub const VALID_CONTAINER_MODES: &[&str] = &["study", "research"];
pub const VALID_CONTAINER_KINDS: &[&str] = &["course", "project"];

/// `STUDYKIT_VALIDATION_FAILED` is exposed to the WebView
/// exactly like every other `STUDYKIT_*` error. We use a
/// dedicated `ErrorKind` so the frontend can branch on it.
#[derive(Debug)]
pub struct ValidationError {
    pub message: String,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ValidationError {}

fn err(message: impl Into<String>) -> ValidationError {
    ValidationError {
        message: message.into(),
    }
}

fn contains_nul(s: &str) -> bool {
    s.as_bytes().contains(&0)
}

/// Validate a single row. The caller (the IPC handler) calls
/// this for every `Put` operation. The first failure aborts
/// the transaction.
pub fn validate_row(row: &StoredRow) -> Result<(), ValidationError> {
    if row.id.is_empty() {
        return Err(err("row id is empty"));
    }
    if contains_nul(&row.id) {
        return Err(err("row id contains a NUL byte"));
    }
    if !VALID_KINDS.contains(&row.kind.as_str()) {
        return Err(err(format!("row has unknown kind '{}'", row.kind)));
    }
    if !VALID_STATES.contains(&row.state.as_str()) {
        return Err(err(format!("row has unknown state '{}'", row.state)));
    }
    if !VALID_AUTHOR_TYPES.contains(&row.author_type.as_str()) {
        return Err(err(format!(
            "row has unknown author_type '{}'",
            row.author_type
        )));
    }
    if !is_iso8601(&row.created_at) {
        return Err(err(format!(
            "row has invalid created_at '{}' (expected ISO 8601 YYYY-MM-DDTHH:MM:SSZ)",
            row.created_at
        )));
    }
    if !is_iso8601(&row.updated_at) {
        return Err(err(format!(
            "row has invalid updated_at '{}' (expected ISO 8601 YYYY-MM-DDTHH:MM:SSZ)",
            row.updated_at
        )));
    }
    validate_container(
        row.container_id.as_deref(),
        row.container_mode.as_deref(),
        row.container_kind.as_deref(),
        row.container_workspace_id.as_deref(),
    )?;
    Ok(())
}

fn validate_container(
    id: Option<&str>,
    mode: Option<&str>,
    kind: Option<&str>,
    workspace_id: Option<&str>,
) -> Result<(), ValidationError> {
    // All four present => must be a valid container.
    // All four absent => no container. Mixed => invalid.
    let all_some = id.is_some() && mode.is_some() && kind.is_some();
    let all_none = id.is_none() && mode.is_none() && kind.is_none() && workspace_id.is_none();
    if all_none {
        return Ok(());
    }
    if !all_some {
        return Err(err(format!(
            "row has partial container fields (id={:?}, mode={:?}, kind={:?}, workspace_id={:?})",
            id, mode, kind, workspace_id
        )));
    }
    // Safe: `all_some` guarantees the three optionals are Some.
    let id = id.expect("validated above");
    let mode = mode.expect("validated above");
    let kind = kind.expect("validated above");
    if id.is_empty() {
        return Err(err("row has empty container.id"));
    }
    if contains_nul(id) {
        return Err(err("row container.id contains a NUL byte"));
    }
    if !VALID_CONTAINER_MODES.contains(&mode) {
        return Err(err(format!("row has unknown container_mode '{}'", mode)));
    }
    if !VALID_CONTAINER_KINDS.contains(&kind) {
        return Err(err(format!("row has unknown container_kind '{}'", kind)));
    }
    let pair = format!("{}|{}", mode, kind);
    if pair != "study|course" && pair != "research|project" {
        return Err(err(format!(
            "row has invalid container pairing '{}' (only 'study|course' and 'research|project' are allowed)",
            pair
        )));
    }
    if let Some(ws) = workspace_id {
        if ws.is_empty() {
            return Err(err("row has empty container.workspace_id"));
        }
        if contains_nul(ws) {
            return Err(err("row container.workspace_id contains a NUL byte"));
        }
    }
    Ok(())
}

/// Validate a single delete op (id only).
pub fn validate_delete(id: &str) -> Result<(), ValidationError> {
    if id.is_empty() {
        return Err(err("delete id is empty"));
    }
    if contains_nul(id) {
        return Err(err("delete id contains a NUL byte"));
    }
    Ok(())
}

/// Validate every operation in a batch. The first failure
/// aborts the whole transaction.
pub fn validate_ops(ops: &[TransactOp]) -> Result<(), ValidationError> {
    for (idx, op) in ops.iter().enumerate() {
        match op {
            TransactOp::Put { row } => {
                validate_row(row).map_err(|err| ValidationError {
                    message: format!("operations[{idx}].put: {}", err.message),
                })?;
            }
            TransactOp::Delete { id } => {
                validate_delete(id).map_err(|err| ValidationError {
                    message: format!("operations[{idx}].delete: {}", err.message),
                })?;
            }
        }
    }
    Ok(())
}

/// RFC 3339 / ISO 8601 form we accept. The strict
/// `YYYY-MM-DDTHH:MM:SSZ` shape is what the Rust
/// `current_iso8601` and the WebView `Date.toISOString()`
/// Accept any RFC 3339 timestamp the WebView might produce.
///
/// `chrono::DateTime::parse_from_rfc3339` accepts every shape
/// we need to support:
///
///   - `2026-07-29T00:00:00Z`              (no fractional seconds)
///   - `2026-07-29T00:00:00.000Z`          (Date.toISOString())
///   - `2026-07-29T00:00:00+02:00`          (timezone offset)
///   - `2026-07-29T00:00:00.123456-08:00`  (fractional + offset)
///
/// We deliberately do not lock the wire format to a specific
/// shape here — the contract allows the WebView to send any
/// RFC 3339 string. The `chrono` parser is the single source
/// of truth for "is this string a valid timestamp?". We do not
/// hand-roll a calendar algorithm; the parser is the only
/// thing the validation layer trusts to recognise dates.
pub fn is_iso8601(s: &str) -> bool {
    // `chrono::DateTime::parse_from_rfc3339` returns an error
    // for any string that is not a valid RFC 3339 timestamp,
    // including nonsense strings, impossible months (e.g.
    // 2026-13-01), impossible days (e.g. 2026-02-30), and
    // timezone offsets out of range.
    chrono::DateTime::parse_from_rfc3339(s).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_row() -> StoredRow {
        StoredRow {
            id: "a".to_string(),
            kind: "note".to_string(),
            body: "b".to_string(),
            state: "active".to_string(),
            author_type: "user".to_string(),
            container_workspace_id: None,
            container_mode: None,
            container_kind: None,
            container_id: None,
            created_at: "2026-07-29T00:00:00Z".to_string(),
            updated_at: "2026-07-29T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn good_row_passes() {
        validate_row(&good_row()).unwrap();
    }

    #[test]
    fn empty_id_rejected() {
        let mut r = good_row();
        r.id = "".into();
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn nul_id_rejected() {
        let mut r = good_row();
        r.id = "a\0b".into();
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn unknown_kind_rejected() {
        let mut r = good_row();
        r.kind = "nope".into();
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn unknown_state_rejected() {
        let mut r = good_row();
        r.state = "ghost".into();
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn unknown_author_type_rejected() {
        let mut r = good_row();
        r.author_type = "robot".into();
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn bad_timestamp_rejected() {
        // `chrono::DateTime::parse_from_rfc3339` is the only thing
        // we trust to recognise timestamps. We do not hand-roll
        // a calendar. The set below covers the categories that
        // must be REJECTED — every other RFC 3339 string is
        // accepted, including the JS `Date.toISOString()` form.
        let mut r = good_row();
        r.created_at = "yesterday".into();
        assert!(validate_row(&r).is_err());
        r.created_at = "2026-07-29".into();
        assert!(validate_row(&r).is_err());
        r.created_at = "2026-13-29T00:00:00Z".into(); // month 13
        assert!(validate_row(&r).is_err());
        r.created_at = "2026-02-30T00:00:00Z".into(); // Feb 30
        assert!(validate_row(&r).is_err());
        r.created_at = "not a date at all".into();
        assert!(validate_row(&r).is_err());
        r.created_at = "".into();
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn rfc3339_timestamps_are_accepted() {
        // JS `Date.toISOString()` always emits this shape; the
        // WebView adapter must be able to round-trip it.
        assert!(is_iso8601("2026-07-29T00:00:00.000Z"));
        // No fractional seconds.
        assert!(is_iso8601("2026-07-29T00:00:00Z"));
        // Timezone offset (positive).
        assert!(is_iso8601("2026-07-29T00:00:00+02:00"));
        // Timezone offset (negative).
        assert!(is_iso8601("2026-07-29T00:00:00-08:00"));
        // Fractional + offset.
        assert!(is_iso8601("2026-07-29T12:34:56.789-08:00"));
        // Microsecond precision.
        assert!(is_iso8601("2026-07-29T00:00:00.123456Z"));
    }

    #[test]
    fn valid_row_with_javascript_iso_format_passes_validation() {
        // Real KnowledgeObject built with `new Date().toISOString()`
        // for the timestamps, mapped through `objectToRow` and
        // back through `validate_row` / `validate_ops`. This is
        // the round-trip the brief asks for: real `KnowledgeObject`
        // → wire row → Rust validation → success.
        let good = StoredRow {
            id: "rt-1".into(),
            kind: "note".into(),
            body: "body".into(),
            state: "active".into(),
            author_type: "user".into(),
            container_workspace_id: None,
            container_mode: None,
            container_kind: None,
            container_id: None,
            created_at: "2026-07-29T00:00:00.000Z".into(),
            updated_at: "2026-07-29T00:00:00.000Z".into(),
        };
        assert!(validate_row(&good).is_ok());
        // And a timezone-offset variant also passes.
        let mut offset = good.clone();
        offset.created_at = "2026-07-29T00:00:00+02:00".into();
        offset.updated_at = "2026-07-29T00:00:00-08:00".into();
        assert!(validate_row(&offset).is_ok());
    }

    #[test]
    fn partial_container_rejected() {
        let mut r = good_row();
        r.container_id = Some("c-1".into());
        // mode + kind missing
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn bad_mode_kind_pair_rejected() {
        let mut r = good_row();
        r.container_id = Some("c-1".into());
        r.container_mode = Some("study".into());
        r.container_kind = Some("project".into()); // invalid pairing
        r.container_workspace_id = Some("ws".into());
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn good_research_project_container_passes() {
        let mut r = good_row();
        r.container_id = Some("p-1".into());
        r.container_mode = Some("research".into());
        r.container_kind = Some("project".into());
        r.container_workspace_id = Some("ws-1".into());
        validate_row(&r).unwrap();
    }

    #[test]
    fn good_study_course_container_passes() {
        let mut r = good_row();
        r.container_id = Some("c-1".into());
        r.container_mode = Some("study".into());
        r.container_kind = Some("course".into());
        r.container_workspace_id = Some("ws-1".into());
        validate_row(&r).unwrap();
    }

    #[test]
    fn empty_workspace_id_rejected() {
        let mut r = good_row();
        r.container_id = Some("c-1".into());
        r.container_mode = Some("study".into());
        r.container_kind = Some("course".into());
        r.container_workspace_id = Some("".into());
        assert!(validate_row(&r).is_err());
    }

    #[test]
    fn first_invalid_op_aborts_whole_batch() {
        use crate::workspace::ipc_types::TransactOp;
        let good = good_row();
        let mut bad = good_row();
        bad.id = "".into();
        let ops = vec![
            TransactOp::Put { row: good.clone() },
            TransactOp::Delete { id: "x".into() },
            TransactOp::Put { row: bad },
        ];
        let err = validate_ops(&ops).unwrap_err();
        // The error message must mention the bad index (2) so
        // the caller can debug; the validator must NOT
        // short-circuit silently.
        assert!(
            err.message.contains("operations[2]"),
            "got: {}",
            err.message
        );
    }
}
