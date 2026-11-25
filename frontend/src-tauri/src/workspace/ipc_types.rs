// StudyKit v0.4 — WP-09B Round 1 (Correction Gate)
//
// Wire-format types for the knowledge-object IPC surface.
// Lives in the `workspace` module so the strict validation
// boundary (`validation.rs`) can reference it without
// depending on the parent crate's `ipc` module.

use serde::{Deserialize, Serialize};

/// The payload that crosses the IPC boundary for `transact_v1`.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TransactArgs {
    pub operations: Vec<TransactOp>,
}

/// A single operation inside an atomic `transact_v1` call.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TransactOp {
    Put { row: StoredRow },
    Delete { id: String },
}

/// The row shape that the Rust side writes into
/// `knowledge_objects`. Field names are `snake_case` on the
/// wire; the WebView adapter maps them to the camelCase
/// `KnowledgeObject` contract.
#[derive(Deserialize, Serialize, Clone)]
pub struct StoredRow {
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

/// Lossless JSON row for a v0.4 domain aggregate. The composite
/// key prevents identically-named Study and Research entities
/// from colliding while keeping the payload schema owned by the
/// TypeScript domain layer.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct DomainRecordRow {
    pub namespace: String,
    pub entity_type: String,
    pub id: String,
    pub payload: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DomainTransactArgs {
    pub operations: Vec<DomainTransactOp>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DomainTransactOp {
    Put {
        row: DomainRecordRow,
    },
    Delete {
        namespace: String,
        entity_type: String,
        id: String,
    },
}
