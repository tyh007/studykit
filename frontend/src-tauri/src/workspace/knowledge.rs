// StudyKit v0.4 — WP-09B Round 1
//
// Knowledge-object row. This is the SQLite-friendly projection
// of the canonical `KnowledgeObject` contract from
// `frontend/src/domain/repository.ts`. The projection flattens
// the optional `container` (a `ContainerRef` in the contract)
// into four columns (`container_workspace_id`,
// `container_mode`, `container_kind`, `container_id`) so the
// schema can carry nullable columns without resorting to JSON
// blobs. Round 1 does NOT actually round-trip through the
// contract — that mapping is Round 2 work, which the IPC
// boundary in `lib.rs` keeps stable by exchanging
// `StoredObject` JSON.
//
// The container columns are nullable to allow objects that are
// not yet filed under any container (the v0.4 contract allows
// `container` to be absent).

use rusqlite::Row;

use super::error::{Result, WorkspaceError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredObject {
    pub id: String,
    pub kind: String,
    pub body: String,
    pub state: String,
    pub author_type: String,
    pub container_workspace_id: Option<String>,
    pub container_mode: Option<String>,
    pub container_kind: Option<String>,
    pub container_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl StoredObject {
    pub fn from_row(row: &Row<'_>) -> Result<Self> {
        let id: String = row
            .get(0)
            .map_err(|err| WorkspaceError::db_unusable(format!("row id: {err}")))?;
        let kind: String = row
            .get(1)
            .map_err(|err| WorkspaceError::db_unusable(format!("row kind: {err}")))?;
        let body: String = row
            .get(2)
            .map_err(|err| WorkspaceError::db_unusable(format!("row body: {err}")))?;
        let state: String = row
            .get(3)
            .map_err(|err| WorkspaceError::db_unusable(format!("row state: {err}")))?;
        let author_type: String = row
            .get(4)
            .map_err(|err| WorkspaceError::db_unusable(format!("row author_type: {err}")))?;
        let container_workspace_id: Option<String> = row.get(5).map_err(|err| {
            WorkspaceError::db_unusable(format!("row container_workspace_id: {err}"))
        })?;
        let container_mode: Option<String> = row
            .get(6)
            .map_err(|err| WorkspaceError::db_unusable(format!("row container_mode: {err}")))?;
        let container_kind: Option<String> = row
            .get(7)
            .map_err(|err| WorkspaceError::db_unusable(format!("row container_kind: {err}")))?;
        let container_id: Option<String> = row
            .get(8)
            .map_err(|err| WorkspaceError::db_unusable(format!("row container_id: {err}")))?;
        let created_at: String = row
            .get(9)
            .map_err(|err| WorkspaceError::db_unusable(format!("row created_at: {err}")))?;
        let updated_at: String = row
            .get(10)
            .map_err(|err| WorkspaceError::db_unusable(format!("row updated_at: {err}")))?;
        Ok(Self {
            id,
            kind,
            body,
            state,
            author_type,
            container_workspace_id,
            container_mode,
            container_kind,
            container_id,
            created_at,
            updated_at,
        })
    }
}
