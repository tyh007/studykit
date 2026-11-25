use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{Result, WorkspaceError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuickCapture {
    pub id: String,
    pub body: String,
    pub source_kind: String,
    pub visibility: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn validate_body(body: &str) -> Result<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(WorkspaceError::validation_failed(
            "quick capture body cannot be empty",
        ));
    }
    if trimmed.len() > 200_000 {
        return Err(WorkspaceError::validation_failed(
            "quick capture body exceeds 200000 bytes",
        ));
    }
    Ok(trimmed.to_string())
}

pub fn save(conn: &rusqlite::Connection, body: &str, source_kind: &str) -> Result<QuickCapture> {
    let body = validate_body(body)?;
    if !matches!(source_kind, "text" | "clipboard" | "url" | "file") {
        return Err(WorkspaceError::validation_failed(
            "unsupported quick capture source kind",
        ));
    }
    let now = Utc::now().to_rfc3339();
    let capture = QuickCapture {
        id: Uuid::new_v4().to_string(),
        body,
        source_kind: source_kind.to_string(),
        visibility: "private".to_string(),
        status: "inbox".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO quick_captures \
         (id, body, source_kind, visibility, status, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            capture.id,
            capture.body,
            capture.source_kind,
            capture.visibility,
            capture.status,
            capture.created_at,
            capture.updated_at
        ],
    )
    .map_err(|err| WorkspaceError::db_unusable(format!("save quick capture: {err}")))?;
    Ok(capture)
}

pub fn list(conn: &rusqlite::Connection) -> Result<Vec<QuickCapture>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, body, source_kind, visibility, status, created_at, updated_at \
             FROM quick_captures WHERE status = 'inbox' ORDER BY updated_at DESC",
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("list quick captures: {err}")))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(QuickCapture {
                id: row.get(0)?,
                body: row.get(1)?,
                source_kind: row.get(2)?,
                visibility: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|err| WorkspaceError::db_unusable(format!("query quick captures: {err}")))?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|err| WorkspaceError::db_unusable(format!("read quick capture row: {err}")))
}

pub fn archive(conn: &rusqlite::Connection, id: &str) -> Result<()> {
    if id.is_empty() || id.contains('\0') {
        return Err(WorkspaceError::validation_failed(
            "quick capture id is invalid",
        ));
    }
    let changed = conn
        .execute(
            "UPDATE quick_captures SET status = 'archived', updated_at = ?2 \
             WHERE id = ?1 AND status = 'inbox'",
            params![id, Utc::now().to_rfc3339()],
        )
        .map_err(|err| WorkspaceError::db_unusable(format!("archive quick capture: {err}")))?;
    if changed == 0 {
        return Err(WorkspaceError::validation_failed(
            "quick capture does not exist",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::db;

    fn connection() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        db::apply_pending_migrations(&mut conn).unwrap();
        conn
    }

    #[test]
    fn save_list_archive_round_trip() {
        let conn = connection();
        let saved = save(&conn, "  a thought  ", "text").unwrap();
        assert_eq!(saved.body, "a thought");
        assert_eq!(saved.visibility, "private");
        assert_eq!(list(&conn).unwrap(), vec![saved.clone()]);
        archive(&conn, &saved.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_and_unknown_sources() {
        let conn = connection();
        assert!(save(&conn, " ", "text").is_err());
        assert!(save(&conn, "ok", "background-clipboard").is_err());
    }
}
