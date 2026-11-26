// StudyKit v0.4 — WP-09B Round 1 — IPC commands
//
// Narrow, typed surface that the WebView can call. We expose
// exactly five commands, plus an `app_config_dir` resolver that
// hides the platform-specific `BaseDirectory` lookup from the
// frontend.
//
// All commands return `Result<T, WorkspaceError>` so the
// frontend receives a stable `{ kind: "STUDYKIT_*", message }`
// shape on failure.

use std::path::PathBuf;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::workspace;
pub use crate::workspace::ipc_types::{DomainRecordRow, DomainTransactOp, StoredRow, TransactOp};

/// Wire a single round-trip wrapper for `create_workspace` that
/// opens the native folder picker, runs the chosen-folder guard,
/// and returns the summary. Round 1 does this in two steps
/// (`pick_folder` then `create_workspace`) so the test suite can
/// drive the manager without a GUI.
#[tauri::command]
pub async fn choose_and_create_workspace(
    app: tauri::AppHandle,
    display_name: String,
) -> Result<workspace::OpenWorkspaceSummary, workspace::WorkspaceError> {
    let parent = pick_folder_blocking(&app).ok_or_else(|| {
        workspace::WorkspaceError::new(
            workspace::ErrorKind::PathRejected,
            "user cancelled the folder picker",
        )
    })?;
    let config_dir = app_config_dir(&app)?;
    workspace::create_workspace(&config_dir, &parent, &display_name)
}

#[tauri::command]
pub async fn choose_and_open_workspace(
    app: tauri::AppHandle,
) -> Result<workspace::OpenWorkspaceSummary, workspace::WorkspaceError> {
    let parent = pick_folder_blocking(&app).ok_or_else(|| {
        workspace::WorkspaceError::new(
            workspace::ErrorKind::PathRejected,
            "user cancelled the folder picker",
        )
    })?;
    let config_dir = app_config_dir(&app)?;
    workspace::open_workspace(&config_dir, &parent)
}

#[tauri::command]
pub async fn reopen_last_workspace(
    app: tauri::AppHandle,
) -> Result<workspace::OpenWorkspaceSummary, workspace::WorkspaceError> {
    let config_dir = app_config_dir(&app)?;
    workspace::reopen_last_workspace(&config_dir)
}

#[tauri::command]
pub async fn close_workspace() -> Result<(), workspace::WorkspaceError> {
    workspace::close_workspace()
}

#[tauri::command]
pub async fn get_workspace_health() -> Result<workspace::WorkspaceHealth, workspace::WorkspaceError>
{
    workspace::get_workspace_health()
}

// ---------------------------------------------------------------------------
// Native source assets (WP-11R2A).
//
// The WebView never receives or submits an arbitrary file path. Rust owns
// the picker and resolves every later operation from a generated asset id.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn choose_and_import_pdf_asset_v1(
    app: tauri::AppHandle,
) -> Result<Option<workspace::assets::WorkspaceAssetSummary>, workspace::WorkspaceError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("PDF document", &["pdf"])
        .blocking_pick_file();
    let Some(source) = selected else {
        return Ok(None);
    };
    let source = source.into_path().map_err(|err| {
        workspace::WorkspaceError::path_rejected(format!(
            "selected PDF is not a local filesystem path: {err}"
        ))
    })?;
    let root = workspace::with_open(|open: &mut workspace::OpenWorkspace| Ok(open.root.clone()))?;
    workspace::assets::import_pdf(&root, &source).map(Some)
}

#[tauri::command]
pub async fn read_workspace_asset_v1(
    asset_id: String,
) -> Result<tauri::ipc::Response, workspace::WorkspaceError> {
    let root = workspace::with_open(|open: &mut workspace::OpenWorkspace| Ok(open.root.clone()))?;
    workspace::assets::read(&root, &asset_id).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn discard_workspace_asset_v1(asset_id: String) -> Result<(), workspace::WorkspaceError> {
    let root = workspace::with_open(|open: &mut workspace::OpenWorkspace| Ok(open.root.clone()))?;
    workspace::assets::discard(&root, &asset_id)
}

// ---------------------------------------------------------------------------
// Knowledge-object IPC commands (WP-09B Round 1).
//
// These are intentionally narrow: each accepts a small typed
// payload and returns a small typed payload. The Rust side is
// the only writer to `knowledge_objects`; the WebView sees
// strictly typed JSON.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn read_object_v1(id: String) -> Result<Option<StoredRow>, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::db::read_object(&open.connection, &id).map(|opt| {
            opt.map(|stored| StoredRow {
                id: stored.id,
                kind: stored.kind,
                body: stored.body,
                state: stored.state,
                author_type: stored.author_type,
                container_workspace_id: stored.container_workspace_id,
                container_mode: stored.container_mode,
                container_kind: stored.container_kind,
                container_id: stored.container_id,
                created_at: stored.created_at,
                updated_at: stored.updated_at,
            })
        })
    })
}

#[tauri::command]
pub async fn read_all_objects_v1() -> Result<Vec<StoredRow>, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        use rusqlite::params;
        let mut stmt = open
            .connection
            .prepare(
                "SELECT id, kind, body, state, author_type, \
                        container_workspace_id, container_mode, container_kind, container_id, \
                        created_at, updated_at \
                 FROM knowledge_objects",
            )
            .map_err(|err| {
                workspace::WorkspaceError::db_unusable(format!("read_all prepare: {err}"))
            })?;
        let rows = stmt
            .query_map(params![], |row| {
                Ok(StoredRow {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    body: row.get(2)?,
                    state: row.get(3)?,
                    author_type: row.get(4)?,
                    container_workspace_id: row.get(5)?,
                    container_mode: row.get(6)?,
                    container_kind: row.get(7)?,
                    container_id: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|err| {
                workspace::WorkspaceError::db_unusable(format!("read_all query: {err}"))
            })?;
        let mut out = Vec::new();
        for row in rows {
            let row = row.map_err(|err| {
                workspace::WorkspaceError::db_unusable(format!("read_all row: {err}"))
            })?;
            out.push(row);
        }
        Ok(out)
    })
}

/// Atomic batch write. All `put` and `delete` operations land
/// inside a single SQLite transaction; partial failures roll
/// back the whole batch. The contract promise is that one
/// `transact(fn)` invocation in the WebView produces exactly
/// one IPC round-trip and one SQLite transaction on disk.
#[tauri::command]
pub async fn transact_v1(operations: Vec<TransactOp>) -> Result<(), workspace::WorkspaceError> {
    // Step 1 — strict validation of every operation in the
    // batch. A single failure aborts the whole transaction
    // BEFORE we open a SQLite transaction, so the IPC layer
    // never partially commits when the WebView sends a bad
    // row.
    workspace::validation::validate_ops(&operations)
        .map_err(|err| workspace::WorkspaceError::validation_failed(err.message))?;

    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        let tx = open.connection.transaction().map_err(|err| {
            workspace::WorkspaceError::db_unusable(format!("transact begin: {err}"))
        })?;
        for op in operations.iter() {
            match op {
                TransactOp::Put { row } => {
                    tx.execute(
                        "INSERT OR REPLACE INTO knowledge_objects (\
                            id, kind, body, state, author_type, \
                            container_workspace_id, container_mode, container_kind, container_id, \
                            created_at, updated_at \
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                        rusqlite::params![
                            row.id,
                            row.kind,
                            row.body,
                            row.state,
                            row.author_type,
                            row.container_workspace_id,
                            row.container_mode,
                            row.container_kind,
                            row.container_id,
                            row.created_at,
                            row.updated_at,
                        ],
                    )
                    .map_err(|err| {
                        // This is a defensive fallback:
                        // validate_ops already filtered out
                        // bad data, so reaching this branch
                        // means SQLite rejected a row the Rust
                        // validator accepted. Surface it as
                        // validation_failed so the WebView
                        // treats the whole batch as rejected.
                        workspace::WorkspaceError::validation_failed(format!(
                            "transact put failed at SQLite: {err}"
                        ))
                    })?;
                }
                TransactOp::Delete { id } => {
                    tx.execute(
                        "DELETE FROM knowledge_objects WHERE id = ?1",
                        rusqlite::params![id],
                    )
                    .map_err(|err| {
                        workspace::WorkspaceError::validation_failed(format!(
                            "transact delete failed at SQLite: {err}"
                        ))
                    })?;
                }
            }
        }
        tx.commit().map_err(|err| {
            workspace::WorkspaceError::db_unusable(format!("transact commit: {err}"))
        })?;
        Ok(())
    })
}

fn validate_domain_part(label: &str, value: &str) -> Result<(), workspace::WorkspaceError> {
    if value.is_empty()
        || value.len() > 128
        || value.contains('\0')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(workspace::WorkspaceError::validation_failed(format!(
            "invalid domain record {label}"
        )));
    }
    Ok(())
}

fn validate_domain_id(value: &str) -> Result<(), workspace::WorkspaceError> {
    if value.is_empty() || value.len() > 1024 || value.contains('\0') {
        return Err(workspace::WorkspaceError::validation_failed(
            "invalid domain record id",
        ));
    }
    Ok(())
}

fn validate_domain_pair(
    namespace: &str,
    entity_type: &str,
) -> Result<(), workspace::WorkspaceError> {
    let allowed = match namespace {
        "study" => matches!(
            entity_type,
            "question" | "attempt" | "feedback" | "recovery"
        ),
        "research" => matches!(
            entity_type,
            "project"
                | "query_spec"
                | "run"
                | "candidate"
                | "work"
                | "work_asset"
                | "evidence"
                | "claim"
                | "link"
                | "conflict"
                | "question"
                | "hypothesis"
                | "design_spec"
                | "method_decision"
                | "risk"
                | "milestone"
                | "task"
                // WP-10 Round 1: Evidence-backed Output.
                // The four entity types live alongside
                // the research slice's existing rows in
                // the same `domain_records` table. There
                // is no parallel SQLite table; the only
                // Rust change required is the allowlist
                // extension below.
                | "output"
                | "output_section"
                | "output_statement"
                | "statement_support"
                | "statement_citation"
                | "ai_thread"
                | "ai_message"
                | "ai_draft_decision"
        ),
        "canvas" => matches!(
            entity_type,
            "view" | "free_node" | "placement" | "relation" | "lineage"
        ),
        "legacy" => matches!(
            entity_type,
            "module"
                | "lecture"
                | "source_document"
                | "source_page"
                | "literature_project"
                | "literature_paper"
        ),
        _ => false,
    };
    if allowed {
        Ok(())
    } else {
        Err(workspace::WorkspaceError::validation_failed(
            "unsupported domain namespace/entity_type pair",
        ))
    }
}

fn validate_domain_row(row: &DomainRecordRow) -> Result<(), workspace::WorkspaceError> {
    validate_domain_part("namespace", &row.namespace)?;
    validate_domain_part("entity_type", &row.entity_type)?;
    validate_domain_pair(&row.namespace, &row.entity_type)?;
    validate_domain_id(&row.id)?;
    if row.payload.len() > 2 * 1024 * 1024 {
        return Err(workspace::WorkspaceError::validation_failed(
            "domain record payload exceeds 2 MiB",
        ));
    }
    let payload: serde_json::Value = serde_json::from_str(&row.payload).map_err(|_| {
        workspace::WorkspaceError::validation_failed("domain record payload is not valid JSON")
    })?;
    if !payload.is_object() {
        return Err(workspace::WorkspaceError::validation_failed(
            "domain record payload must be a JSON object",
        ));
    }
    if payload.get("id").and_then(serde_json::Value::as_str) != Some(row.id.as_str()) {
        return Err(workspace::WorkspaceError::validation_failed(
            "domain record payload id does not match envelope id",
        ));
    }
    chrono::DateTime::parse_from_rfc3339(&row.updated_at).map_err(|_| {
        workspace::WorkspaceError::validation_failed("domain record updated_at must be RFC3339")
    })?;
    Ok(())
}

/// Read all rows in one namespace. Filtering and domain-specific
/// validation stay in the strongly typed frontend adapter.
#[tauri::command]
pub async fn read_domain_records_v1(
    namespace: String,
) -> Result<Vec<DomainRecordRow>, workspace::WorkspaceError> {
    validate_domain_part("namespace", &namespace)?;
    if !matches!(
        namespace.as_str(),
        "study" | "research" | "canvas" | "legacy"
    ) {
        return Err(workspace::WorkspaceError::validation_failed(
            "unsupported domain namespace",
        ));
    }
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        let mut stmt = open
            .connection
            .prepare(
                "SELECT namespace, entity_type, id, payload, updated_at \
                 FROM domain_records WHERE namespace = ?1 \
                 ORDER BY entity_type, id",
            )
            .map_err(|err| {
                workspace::WorkspaceError::db_unusable(format!(
                    "read domain records prepare: {err}"
                ))
            })?;
        let rows = stmt
            .query_map(rusqlite::params![namespace], |row| {
                Ok(DomainRecordRow {
                    namespace: row.get(0)?,
                    entity_type: row.get(1)?,
                    id: row.get(2)?,
                    payload: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|err| {
                workspace::WorkspaceError::db_unusable(format!("read domain records query: {err}"))
            })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| {
                workspace::WorkspaceError::db_unusable(format!("read domain records row: {err}"))
            })?);
        }
        Ok(out)
    })
}

/// One frontend domain transaction maps to one SQLite
/// transaction. Every envelope is checked before BEGIN.
#[tauri::command]
pub async fn transact_domain_records_v1(
    operations: Vec<DomainTransactOp>,
) -> Result<(), workspace::WorkspaceError> {
    if operations.len() > 10_000 {
        return Err(workspace::WorkspaceError::validation_failed(
            "domain transaction exceeds 10000 operations",
        ));
    }
    for op in &operations {
        match op {
            DomainTransactOp::Put { row } => validate_domain_row(row)?,
            DomainTransactOp::Delete {
                namespace,
                entity_type,
                id,
            } => {
                validate_domain_part("namespace", namespace)?;
                validate_domain_part("entity_type", entity_type)?;
                validate_domain_pair(namespace, entity_type)?;
                validate_domain_id(id)?;
            }
        }
    }
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        let tx = open.connection.transaction().map_err(|err| {
            workspace::WorkspaceError::db_unusable(format!("domain transaction begin: {err}"))
        })?;
        for op in &operations {
            match op {
                DomainTransactOp::Put { row } => {
                    tx.execute(
                        "INSERT OR REPLACE INTO domain_records \
                         (namespace, entity_type, id, payload, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![
                            row.namespace,
                            row.entity_type,
                            row.id,
                            row.payload,
                            row.updated_at
                        ],
                    )
                    .map_err(|err| {
                        workspace::WorkspaceError::db_unusable(format!(
                            "domain transaction put: {err}"
                        ))
                    })?;
                }
                DomainTransactOp::Delete {
                    namespace,
                    entity_type,
                    id,
                } => {
                    tx.execute(
                        "DELETE FROM domain_records \
                         WHERE namespace = ?1 AND entity_type = ?2 AND id = ?3",
                        rusqlite::params![namespace, entity_type, id],
                    )
                    .map_err(|err| {
                        workspace::WorkspaceError::db_unusable(format!(
                            "domain transaction delete: {err}"
                        ))
                    })?;
                }
            }
        }
        tx.commit().map_err(|err| {
            workspace::WorkspaceError::db_unusable(format!("domain transaction commit: {err}"))
        })
    })
}

// ---------------------------------------------------------------------------
// WP-09 close-out commands: migration, backup, inbox, local AI.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn import_legacy_snapshot_v1(
    run_id: String,
    snapshot_json: String,
    source_hash: String,
    records: Vec<DomainRecordRow>,
) -> Result<workspace::legacy_migration::MigrationSummary, workspace::WorkspaceError> {
    if records.len() > 100_000 {
        return Err(workspace::WorkspaceError::validation_failed(
            "legacy migration exceeds 100000 records",
        ));
    }
    let mut keys = std::collections::HashSet::new();
    for row in &records {
        validate_domain_row(row)?;
        let key = (&row.namespace, &row.entity_type, &row.id);
        if !keys.insert(key) {
            return Err(workspace::WorkspaceError::validation_failed(
                "legacy migration contains duplicate record keys",
            ));
        }
    }
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::legacy_migration::import(open, &run_id, &snapshot_json, &source_hash, &records)
    })
}

#[tauri::command]
pub async fn rollback_legacy_migration_v1(
    run_id: String,
) -> Result<workspace::legacy_migration::MigrationSummary, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::legacy_migration::rollback(open, &run_id)
    })
}

#[tauri::command]
pub async fn get_latest_legacy_migration_v1(
) -> Result<Option<workspace::legacy_migration::MigrationSummary>, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::legacy_migration::latest(open)
    })
}

#[tauri::command]
pub async fn create_workspace_backup_v1(
) -> Result<workspace::backup::BackupSummary, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| workspace::backup::create(open))
}

#[tauri::command]
pub async fn save_quick_capture_v1(
    body: String,
    source_kind: String,
) -> Result<workspace::quick_capture::QuickCapture, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::quick_capture::save(&open.connection, &body, &source_kind)
    })
}

#[tauri::command]
pub async fn list_quick_captures_v1(
) -> Result<Vec<workspace::quick_capture::QuickCapture>, workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::quick_capture::list(&open.connection)
    })
}

#[tauri::command]
pub async fn archive_quick_capture_v1(id: String) -> Result<(), workspace::WorkspaceError> {
    workspace::with_open(|open: &mut workspace::OpenWorkspace| {
        workspace::quick_capture::archive(&open.connection, &id)
    })
}

#[tauri::command]
pub async fn discover_local_ai_v1() -> crate::local_ai::LocalAiDiscovery {
    crate::local_ai::discover()
}

#[tauri::command]
pub async fn local_ai_chat_v1(
    model: String,
    messages: Vec<crate::local_ai::LocalAiMessage>,
) -> Result<crate::local_ai::LocalAiChatResponse, workspace::WorkspaceError> {
    crate::local_ai::chat(&model, &messages)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Run the Tauri 2 native folder picker synchronously inside an
/// async command. The plugin's blocking API lives behind
/// `blocking_pick_folder`; we bridge to async with
/// `tokio::task::spawn_blocking` if `tokio` is available, or fall
/// back to `Dialog::file().blocking_pick_folder()` directly.
fn pick_folder_blocking(app: &tauri::AppHandle) -> Option<PathBuf> {
    // The plugin's blocking API is the only synchronous path.
    // Inside an `async` Tauri command the runtime is `tokio`,
    // so calling a blocking API here is acceptable: Tauri
    // serialises command execution and the picker's UI runs on
    // the main thread. We do not wrap it in `spawn_blocking`
    // because the dialog plugin already marshals to the main
    // thread.
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|fp| fp.into_path().ok())
}

/// Resolve the per-app config directory. Round 1 uses the
/// platform's `BaseDirectory::AppConfig`; this is the
/// Tauri-provided location that survives reinstalls and is
/// owned by us. The WebView never reads this directory
/// directly.
fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, workspace::WorkspaceError> {
    app.path().app_config_dir().map_err(|err| {
        workspace::WorkspaceError::creation_failed(format!(
            "failed to resolve AppConfig directory: {err}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_row() -> DomainRecordRow {
        DomainRecordRow {
            namespace: "study".into(),
            entity_type: "question".into(),
            id: "q-1".into(),
            payload: r#"{"id":"q-1","body":"Why?"}"#.into(),
            updated_at: "2026-07-30T12:34:56.000Z".into(),
        }
    }

    #[test]
    fn domain_row_accepts_valid_json_object_and_rfc3339() {
        validate_domain_row(&valid_row()).unwrap();
        let mut compound = valid_row();
        compound.id = "view-1::knowledge:paper/42".into();
        compound.payload = r#"{"id":"view-1::knowledge:paper/42","body":"placement"}"#.into();
        validate_domain_row(&compound).unwrap();
    }

    #[test]
    fn domain_row_rejects_invalid_envelope_and_json() {
        let mut row = valid_row();
        row.namespace = "../study".into();
        assert!(validate_domain_row(&row).is_err());

        let mut row = valid_row();
        row.payload = "[]".into();
        assert!(validate_domain_row(&row).is_err());

        let mut row = valid_row();
        row.updated_at = "not-a-date".into();
        assert!(validate_domain_row(&row).is_err());

        let mut row = valid_row();
        row.entity_type = "project".into();
        assert!(validate_domain_row(&row).is_err());

        let mut row = valid_row();
        row.payload = r#"{"id":"different"}"#.into();
        assert!(validate_domain_row(&row).is_err());
    }

    // WP-10 Round 1: Evidence-backed Output
    // allowlist. The four new entity types live in
    // the `research` namespace; the test guards the
    // positive paths and a regression on a bogus
    // entity type so a future cleanup can't silently
    // strip one of them out.
    #[test]
    fn research_allowlist_accepts_output_entity_types() {
        for entity_type in [
            "output",
            "output_section",
            "output_statement",
            "statement_support",
            "statement_citation",
            "ai_thread",
            "ai_message",
            "ai_draft_decision",
        ] {
            assert!(
                validate_domain_pair("research", entity_type).is_ok(),
                "expected research/{entity_type} to be allowed",
            );
        }
    }

    #[test]
    fn research_allowlist_rejects_unknown_entity_type() {
        // A bogus type stays rejected; this is the
        // regression guard for the allowlist edit.
        assert!(validate_domain_pair("research", "not_a_kind").is_err());
        assert!(validate_domain_pair("research", "").is_err());
    }

    #[test]
    fn output_entity_types_do_not_leak_into_other_namespaces() {
        // The Output entity types are research-scoped.
        // They MUST NOT be writable from any other
        // namespace — a cross-namespace leak would
        // let the Canvas or Legacy slices impersonate
        // research data.
        for entity_type in [
            "output",
            "output_section",
            "output_statement",
            "statement_support",
            "statement_citation",
            "ai_thread",
            "ai_message",
            "ai_draft_decision",
        ] {
            for namespace in ["study", "canvas", "legacy"] {
                assert!(
                    validate_domain_pair(namespace, entity_type).is_err(),
                    "expected {namespace}/{entity_type} to be rejected",
                );
            }
        }
    }

    #[test]
    fn native_study_source_metadata_is_legacy_scoped() {
        assert!(validate_domain_pair("legacy", "source_document").is_ok());
        assert!(validate_domain_pair("legacy", "source_page").is_ok());
        assert!(validate_domain_pair("study", "source_document").is_err());
        assert!(validate_domain_pair("research", "source_page").is_err());
    }
}
