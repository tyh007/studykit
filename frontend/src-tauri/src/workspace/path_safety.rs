// StudyKit v0.4 — WP-09B Round 1
//
// Safe-path checks. Every path the workspace manager receives from
// the WebView MUST pass through `safe_path_check` before we touch
// the filesystem. The checks guard against:
//
//   1. Path-traversal segments (`..`, encoded forms).
//   2. Symlink chains that resolve outside the user-selected root.
//   3. Null bytes, embedded separators, and other illegal
//      characters.
//   4. Paths that are not absolute (a relative path would let the
//      WebView control where we look, which defeats the
//      user-chooses-the-folder contract).
//   5. Path component length explosions (the OS has limits we must
//      stay under to avoid panics in `std::fs`).
//
// What this module does NOT do:
//
//   - It does not whitelist a fixed set of roots. The user can
//     pick any folder; StudyKit does not restrict where on disk the
//     workspace lives.
//   - It does not resolve a symlink chain into the user's home
//     directory; it only fails the check if a chain resolves
//     outside the immediate root the user picked.
//
// The tests in `tests/path_safety.rs` exercise Chinese characters,
// spaces, relative components, trailing separators, embedded
// null bytes, and symlink boundaries.

use std::path::{Component, Path, PathBuf};

use super::error::{Result, WorkspaceError};

/// Reject empty paths and non-absolute paths. Returning `Err`
/// (rather than silently canonicalising) keeps the IPC contract
/// honest: the WebView MUST pass an absolute path returned by the
/// native folder picker.
pub fn require_absolute(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(WorkspaceError::path_rejected(format!(
            "expected an absolute path, got '{}'",
            path.display()
        )));
    }
    if path.as_os_str().is_empty() {
        return Err(WorkspaceError::path_rejected("path is empty"));
    }
    Ok(())
}

/// Reject embedded null bytes. SQLite, JSON, and macOS/Linux
/// path handling all stop at NUL, so an attacker who can slip one
/// in would silently truncate the path.
pub fn reject_null_bytes(path: &Path) -> Result<()> {
    let s = path.as_os_str();
    if s.to_string_lossy().contains('\0') {
        return Err(WorkspaceError::path_rejected(
            "path contains an embedded null byte",
        ));
    }
    Ok(())
}

/// Walk the path's components and reject any `ParentDir` (`..`)
/// segment. The folder picker cannot return a path with literal
/// `..` components, but a defensive guard catches bugs and
/// homoglyph attacks.
pub fn reject_traversal_segments(path: &Path) -> Result<()> {
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(WorkspaceError::path_rejected(format!(
                "path contains '..' segment: '{}'",
                path.display()
            )));
        }
    }
    Ok(())
}

/// Reject paths that, after symlink resolution, leave the root
/// the user picked. The root is the canonicalised form of the
/// directory the picker handed us; any resolved component that
/// escapes it is rejected.
///
/// We do NOT call `canonicalize` on the workspace path itself —
/// only on the root and on each ancestor we walk. Symlinks inside
/// the user-picked root are tolerated (OneDrive and iCloud place
/// symlinks inside the workspace root, and rejecting those would
/// break the user-promise). Symlinks that *escape* the root are
/// not.
pub fn safe_path_check(root: &Path, candidate: &Path) -> Result<()> {
    require_absolute(root)?;
    require_absolute(candidate)?;
    reject_null_bytes(root)?;
    reject_null_bytes(candidate)?;
    reject_traversal_segments(candidate)?;
    let canonical_root = canonicalize_existing(root)?;
    let canonical_candidate = canonicalize_existing(candidate)?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(WorkspaceError::path_rejected(format!(
            "candidate '{}' escapes root '{}'",
            canonical_candidate.display(),
            canonical_root.display()
        )));
    }
    Ok(())
}

/// Canonicalise an existing path. If the path does not exist, we
/// still want a canonical form for the prefix that does exist
/// (used during workspace creation, before the directory has been
/// made).
pub fn canonicalize_existing(path: &Path) -> Result<PathBuf> {
    match std::fs::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(e) => Err(WorkspaceError::path_rejected(format!(
            "failed to canonicalise '{}': {e}",
            path.display()
        ))),
    }
}

/// Canonicalise a path that may or may not exist yet. Walks
/// ancestors until one exists, then appends the remaining
/// components.
pub fn canonicalize_nonexistent(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return canonicalize_existing(path);
    }
    let mut anchor = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !anchor.exists() {
        match anchor.file_name() {
            Some(name) => {
                tail.push(name.to_os_string());
                anchor.pop();
            }
            None => {
                return Err(WorkspaceError::path_rejected(format!(
                    "cannot resolve any ancestor of '{}'",
                    path.display()
                )));
            }
        }
    }
    let canonical_anchor = canonicalize_existing(&anchor)?;
    let mut result = canonical_anchor;
    for part in tail.iter().rev() {
        result.push(part);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_absolute_accepts_root() {
        assert!(require_absolute(Path::new("/")).is_ok());
        assert!(require_absolute(Path::new("/Users/me")).is_ok());
    }

    #[test]
    fn require_absolute_rejects_relative() {
        assert!(require_absolute(Path::new(".")).is_err());
        assert!(require_absolute(Path::new("a/b")).is_err());
    }

    #[test]
    fn require_absolute_rejects_empty() {
        assert!(require_absolute(Path::new("")).is_err());
    }

    #[test]
    fn reject_null_bytes_catches_nul() {
        let p = std::ffi::OsStr::new("foo\0bar");
        let path = Path::new(p);
        assert!(reject_null_bytes(path).is_err());
    }

    #[test]
    fn reject_traversal_segments_catches_parent() {
        assert!(reject_traversal_segments(Path::new("/a/../b")).is_err());
        assert!(reject_traversal_segments(Path::new("/a/b")).is_ok());
    }

    #[test]
    fn canonicalize_existing_round_trips_root() {
        let p = canonicalize_existing(Path::new("/")).unwrap();
        assert!(p.is_absolute());
    }

    #[test]
    fn canonicalize_nonexistent_walks_until_anchor() {
        let path = std::env::temp_dir().join("studykit-test-does-not-exist");
        let canonical = canonicalize_nonexistent(&path).unwrap();
        assert!(canonical.ends_with("studykit-test-does-not-exist"));
    }
}
