// StudyKit v0.4 — WP-09B Round 1
//
// Errors that can cross the IPC boundary. We deliberately keep the
// stable code namespace small (`STUDYKIT_*`) so the frontend can
// branch on a closed set of error kinds instead of free-form strings.

use serde::{Serialize, Serializer};

/// Serialize as a stable string code so the frontend can branch on it.
impl Serialize for ErrorKind {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(self.code())
    }
}

/// Stable error codes exposed to the WebView. The frontend uses the
/// code to drive user-facing copy; the `message` field is for logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// Caller passed a path that resolves outside an allowed root,
    /// contains traversal segments, or symlink-chains out of bounds.
    PathRejected,
    /// The chosen directory does not contain a `workspace.json`,
    /// or the manifest is unreadable / not valid JSON.
    NotAStudyKitWorkspace,
    /// The manifest exists but its `formatVersion` is higher than
    /// the version this binary understands.
    FormatTooNew,
    /// The manifest exists but its JSON is corrupt or has the wrong
    /// shape.
    ManifestCorrupt,
    /// The SQLite database is missing, locked, or failed
    /// `PRAGMA integrity_check`.
    DatabaseUnusable,
    /// Workspace creation / migration failed; the directory may be
    /// partially created. The frontend should refuse to treat the
    /// directory as a valid workspace.
    CreationFailed,
    /// A previous workspace is still open. Close it before opening
    /// another. (Single-open invariant for Round 1.)
    AnotherWorkspaceOpen,
    /// No last workspace recorded.
    NoLastWorkspace,
    /// A knowledge-object operation failed strict validation at
    /// the IPC boundary. The whole `transact_v1` batch has been
    /// rolled back; nothing was written.
    ValidationFailed,
}

impl ErrorKind {
    pub fn code(self) -> &'static str {
        match self {
            ErrorKind::PathRejected => "STUDYKIT_PATH_REJECTED",
            ErrorKind::NotAStudyKitWorkspace => "STUDYKIT_NOT_A_WORKSPACE",
            ErrorKind::FormatTooNew => "STUDYKIT_FORMAT_TOO_NEW",
            ErrorKind::ManifestCorrupt => "STUDYKIT_MANIFEST_CORRUPT",
            ErrorKind::DatabaseUnusable => "STUDYKIT_DB_UNUSABLE",
            ErrorKind::CreationFailed => "STUDYKIT_CREATION_FAILED",
            ErrorKind::AnotherWorkspaceOpen => "STUDYKIT_ANOTHER_OPEN",
            ErrorKind::NoLastWorkspace => "STUDYKIT_NO_LAST_WORKSPACE",
            ErrorKind::ValidationFailed => "STUDYKIT_VALIDATION_FAILED",
        }
    }
}

/// Wire-format error. The frontend should treat the `kind` code as
/// stable; the `message` is for the developer / log channel.
#[derive(Debug, thiserror::Error)]
#[error("{kind:?}: {message}")]
pub struct WorkspaceError {
    pub kind: ErrorKind,
    pub message: String,
}

impl WorkspaceError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn path_rejected(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::PathRejected, message)
    }

    pub fn not_a_workspace(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotAStudyKitWorkspace, message)
    }

    pub fn format_too_new(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::FormatTooNew, message)
    }

    pub fn manifest_corrupt(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::ManifestCorrupt, message)
    }

    pub fn db_unusable(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::DatabaseUnusable, message)
    }

    pub fn creation_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::CreationFailed, message)
    }

    pub fn another_open() -> Self {
        Self::new(
            ErrorKind::AnotherWorkspaceOpen,
            "another workspace is already open; close it first",
        )
    }

    pub fn no_last_workspace() -> Self {
        Self::new(ErrorKind::NoLastWorkspace, "no last workspace recorded")
    }

    pub fn validation_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::ValidationFailed, message)
    }
}

// `serde` Serialize for `WorkspaceError` so Tauri can serialise it
// directly into an IPC error response. The wire shape is
// `{ kind: "STUDYKIT_*", message: "..." }`.
impl serde::Serialize for WorkspaceError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("WorkspaceError", 2)?;
        st.serialize_field("kind", &self.kind.code())?;
        st.serialize_field("message", &self.message)?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, WorkspaceError>;
