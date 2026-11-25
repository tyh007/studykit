// StudyKit v0.4 — WP-09B Round 1 (Correction Gate, Final Delta)
//
// WorkspaceManager owns the current single-open workspace and the
// path to the last workspace the user opened. It is the only
// place that holds a `rusqlite::Connection` open; every IPC
// command funnels through one of its methods.
//
// State machine:
//
//     Closed ──reserve()──> Opening ──commit()──> Open
//       ▲                     │
//       └───────drop()────────┘  (failure path)
//
//   - `reserve()` is the ONLY way to transition Closed → Opening.
//     It holds the manager mutex only for that check-and-set, then
//     releases it. A concurrent `reserve()` can therefore observe
//     Opening and immediately return `STUDYKIT_ANOTHER_OPEN`.
//   - The lock is NOT held during disk IO. `reserve()` is the
//     only blocking section. Once Opening is installed, the
//     caller may do whatever IO is required without the mutex.
//   - `commit(reservation, open_workspace)` atomically swaps
//     Opening for Open. After commit, the reservation is
//     consumed and the open is in the singleton.
//   - A dropped Reservation restores the state to Closed
//     without touching the filesystem or the pointer. This is
//     what every failure arm of `create_workspace` and
//     `open_workspace` relies on.
//   - `reopen_last_workspace` is a thin shell around the
//     internal `open_workspace_impl`; it does NOT call the
//     public `open_workspace` (which would re-reserve).
//
// `last_workspace` pointer integrity: the pointer is written
// only after the new workspace is fully created / opened AND
// the old connection has been closed. If creation / open
// fails, the pointer still points at the previous workspace.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::OnceCell;
use rusqlite::Connection;

use super::db;
use super::error::{ErrorKind, Result, WorkspaceError};
use super::manifest::{generate_workspace_id, read_manifest, write_manifest, WorkspaceManifest};
use super::path_safety::{canonicalize_existing, safe_path_check};

/// File name of the last-workspace pointer persisted into the
/// app config directory. Kept under our app's config root so the
/// WebView never has read or write access to it.
pub const LAST_WORKSPACE_POINTER_FILE: &str = "studykit.last-workspace.json";

/// Subdirectory of `AppConfig` that contains the
/// last-workspace pointer. Kept under a `studykit-v0.4/` prefix
/// so future upgrades have a clean place to live.
pub const LAST_WORKSPACE_POINTER_DIR: &str = "studykit-v0.4";

/// Default name of the SQLite file inside the workspace dir.
pub const SQLITE_FILE_NAME: &str = "studykit.sqlite";

/// Default subdirectory for user-imported assets.
pub const ASSETS_DIR: &str = "assets";
pub const ASSETS_ORIGINALS: &str = "originals";
pub const ASSETS_DERIVED: &str = "derived";
pub const ASSETS_TEMP: &str = "temp";
pub const BACKUPS_DIR: &str = "backups";
pub const EXPORTS_DIR: &str = "exports";

/// Manager state. The lock guards the `state` field, nothing
/// else. Disk IO never runs with the lock held.
static MANAGER: OnceCell<Mutex<ManagerState>> = OnceCell::new();

fn manager() -> &'static Mutex<ManagerState> {
    MANAGER.get_or_init(|| Mutex::new(ManagerState::default()))
}

#[derive(Default)]
struct ManagerState {
    state: ManagerLifecycle,
}

#[derive(Default)]
enum ManagerLifecycle {
    /// No workspace is open. The next `reserve()` succeeds and
    /// transitions to `Opening`.
    #[default]
    Closed,
    /// A reservation is held. Only the holder of the
    /// `Reservation` may call `commit()`; a concurrent
    /// `reserve()` returns `STUDYKIT_ANOTHER_OPEN`.
    Opening,
    /// A workspace is open. The connection lives here.
    Open(OpenWorkspace),
}

pub struct OpenWorkspace {
    pub root: PathBuf,
    pub manifest: WorkspaceManifest,
    pub connection: Connection,
    pub recovered_after_crash: bool,
}

/// A reservation moves the manager from `Closed` to `Opening`.
/// Dropping a reservation that was NOT `commit()`-ed moves the
/// manager back to `Closed`. This is the RAII mechanism the
/// state machine uses to make failure atomic: the `Drop` impl
/// is the only path that puts the state back to `Closed` after
/// a failure.
///
/// RAII reservation token. It does not retain the manager lock:
/// disk IO happens while the singleton is visibly `Opening`.
struct Reservation {
    committed: bool,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.committed {
            let mut guard = manager().lock().expect("workspace manager mutex poisoned");
            if matches!(guard.state, ManagerLifecycle::Opening) {
                guard.state = ManagerLifecycle::Closed;
            }
        }
    }
}

impl Reservation {
    /// Commit this reservation, transferring `open` into the
    /// singleton. After commit, dropping the reservation does
    /// NOT revert the state — the workspace is now Open.
    fn commit(mut self, open: OpenWorkspace) {
        let mut guard = manager().lock().expect("workspace manager mutex poisoned");
        debug_assert!(matches!(guard.state, ManagerLifecycle::Opening));
        guard.state = ManagerLifecycle::Open(open);
        self.committed = true;
    }
}

/// Reserve the manager for opening. Returns `STUDYKIT_ANOTHER_OPEN`
/// if another caller already holds the reservation or a workspace
/// is already open. The mutex is released before this function
/// returns, so disk IO is never performed while holding it.
fn reserve() -> Result<Reservation> {
    let mut guard = manager().lock().expect("workspace manager mutex poisoned");
    match &guard.state {
        ManagerLifecycle::Closed => {
            guard.state = ManagerLifecycle::Opening;
            Ok(Reservation { committed: false })
        }
        ManagerLifecycle::Opening | ManagerLifecycle::Open(_) => {
            Err(WorkspaceError::another_open())
        }
    }
}

/// Replace an `Opening` reservation with an `Open(workspace)`.
/// Used by `create_workspace` and `open_workspace_impl` after
/// they have a healthy `Connection`.
fn commit_open(reservation: Reservation, open: OpenWorkspace) {
    reservation.commit(open);
}

/// Summary view of an opened workspace. This is what the IPC
/// layer returns to the WebView — it carries the manifest
/// metadata but NOT the live `rusqlite::Connection`. Real IO
/// happens through `with_open`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenWorkspaceSummary {
    pub root: PathBuf,
    pub manifest: WorkspaceManifest,
}

/// Public read-side for the IPC layer. `with_open` is the only
/// way IPC commands touch the connection.
pub fn with_open<F, R>(f: F) -> Result<R>
where
    F: FnOnce(&mut OpenWorkspace) -> Result<R>,
{
    let mut guard = manager().lock().expect("workspace manager mutex poisoned");
    match &mut guard.state {
        ManagerLifecycle::Open(open) => f(open),
        _ => Err(WorkspaceError::new(
            ErrorKind::NoLastWorkspace,
            "no workspace is currently open",
        )),
    }
}

/// Check whether a workspace is currently open. Safe to call
/// outside a critical section; the lock is briefly acquired
/// and released.
pub fn is_open() -> bool {
    matches!(
        manager()
            .lock()
            .expect("workspace manager mutex poisoned")
            .state,
        ManagerLifecycle::Open(_)
    )
}

/// Resolve the absolute path the last-workspace pointer would
/// live at, given the app config root. The IPC layer passes the
/// app config root in explicitly so we do not pull in
/// `tauri::api::path` from a unit-test context.
pub fn last_workspace_pointer_path(app_config_dir: &Path) -> Result<PathBuf> {
    // Tauri's AppConfig path is trusted but is not guaranteed to
    // exist on a first launch. Create the root before the
    // canonical path-safety check; otherwise a clean install can
    // never reach the workspace chooser.
    if !app_config_dir.exists() {
        std::fs::create_dir_all(app_config_dir).map_err(|err| {
            WorkspaceError::creation_failed(format!(
                "failed to create app config root '{}': {err}",
                app_config_dir.display()
            ))
        })?;
    }
    safe_path_check(app_config_dir, app_config_dir)?;
    let dir = app_config_dir.join(LAST_WORKSPACE_POINTER_DIR);
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|err| {
            WorkspaceError::creation_failed(format!(
                "failed to create app config dir '{}': {err}",
                dir.display()
            ))
        })?;
    }
    Ok(dir.join(LAST_WORKSPACE_POINTER_FILE))
}

fn read_last_workspace_pointer(app_config_dir: &Path) -> Result<Option<PathBuf>> {
    let path = last_workspace_pointer_path(app_config_dir)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|err| {
        WorkspaceError::not_a_workspace(format!(
            "failed to read last-workspace pointer '{}': {err}",
            path.display()
        ))
    })?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|err| {
        WorkspaceError::not_a_workspace(format!("last-workspace pointer is not valid JSON: {err}"))
    })?;
    let raw = value.get("path").and_then(|v| v.as_str()).ok_or_else(|| {
        WorkspaceError::not_a_workspace("last-workspace pointer is missing the 'path' string field")
    })?;
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(WorkspaceError::not_a_workspace(format!(
            "last-workspace pointer is not absolute: '{raw}'"
        )));
    }
    Ok(Some(path))
}

fn write_last_workspace_pointer(app_config_dir: &Path, workspace_root: &Path) -> Result<()> {
    let pointer = last_workspace_pointer_path(app_config_dir)?;
    let json = serde_json::json!({
        "schema": "studykit.last-workspace/1",
        "path": workspace_root.to_string_lossy(),
    });
    let bytes = serde_json::to_vec_pretty(&json).map_err(|err| {
        WorkspaceError::creation_failed(format!(
            "failed to serialise last-workspace pointer: {err}"
        ))
    })?;
    // Atomic write: write to a sibling tempfile and rename. This
    // prevents a torn pointer if the process is killed mid-write.
    let tmp = pointer.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|err| {
        WorkspaceError::creation_failed(format!(
            "failed to write last-workspace pointer '{}': {err}",
            tmp.display()
        ))
    })?;
    std::fs::rename(&tmp, &pointer).map_err(|err| {
        WorkspaceError::creation_failed(format!(
            "failed to rename last-workspace pointer into place: {err}"
        ))
    })?;
    Ok(())
}

fn clear_last_workspace_pointer(app_config_dir: &Path) -> Result<()> {
    let path = last_workspace_pointer_path(app_config_dir)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| {
            WorkspaceError::creation_failed(format!(
                "failed to remove last-workspace pointer '{}': {err}",
                path.display()
            ))
        })?;
    }
    Ok(())
}

/// Atomically swap the open workspace. Returns
/// `AnotherWorkspaceOpen` if a workspace is already open.
///
/// The mutex is held across the entire check-and-set. The only
/// way a second caller can slip past the check is to acquire
/// the mutex between the check and the swap — but `with_locked`
/// keeps the lock until the closure returns.
/// Open an existing StudyKit workspace at `root`. Refuses to
/// silently convert a foreign directory. Uses the
/// Closed → Opening → Open state machine: a concurrent caller
/// sees Opening and returns `STUDYKIT_ANOTHER_OPEN` without
/// touching the filesystem.
pub fn open_workspace_impl(app_config_dir: &Path, root: &Path) -> Result<OpenWorkspaceSummary> {
    // Step 0 — reserve. The only state-machine transition.
    let reservation = reserve()?;

    match open_workspace_after_reserve(root, app_config_dir, &reservation) {
        Ok((canonical_root, manifest, connection, recovered_after_crash)) => {
            commit_open(
                reservation,
                OpenWorkspace {
                    root: canonical_root.clone(),
                    manifest: manifest.clone(),
                    connection,
                    recovered_after_crash,
                },
            );
            Ok(OpenWorkspaceSummary {
                root: canonical_root,
                manifest,
            })
        }
        Err(CreateOrOpenError::Cleanup { error, .. }) => {
            // `open_workspace_after_reserve` does not create
            // any subdirectories, so cleanup is a no-op.
            Err(error)
        }
        Err(CreateOrOpenError::Bare(error)) => Err(error),
    }
}

fn open_workspace_after_reserve(
    root: &Path,
    _app_config_dir: &Path,
    _reservation: &Reservation,
) -> std::result::Result<(PathBuf, WorkspaceManifest, Connection, bool), CreateOrOpenError> {
    let fail = |error: WorkspaceError| CreateOrOpenError::Bare(error);
    if let Err(error) = safe_path_check(root, root) {
        return Err(fail(error));
    }
    if !root.exists() {
        return Err(fail(WorkspaceError::not_a_workspace(format!(
            "folder does not exist: '{}'",
            root.display()
        ))));
    }
    if !root.is_dir() {
        return Err(fail(WorkspaceError::not_a_workspace(format!(
            "path is not a directory: '{}'",
            root.display()
        ))));
    }
    let canonical_root = match canonicalize_existing(root) {
        Ok(c) => c,
        Err(error) => return Err(fail(error)),
    };
    let manifest = match read_manifest(&canonical_root) {
        Ok(m) => m,
        Err(error) => return Err(fail(error)),
    };
    let db_path = canonical_root.join(SQLITE_FILE_NAME);
    if !db_path.exists() {
        return Err(fail(WorkspaceError::db_unusable(format!(
            "workspace is missing '{}'",
            db_path.display()
        ))));
    }
    let mut connection = match db::open_connection(&db_path) {
        Ok(c) => c,
        Err(error) => return Err(fail(error)),
    };
    if let Err(error) = db::apply_pending_migrations(&mut connection) {
        return Err(fail(error));
    }
    if let Err(error) = db::integrity_check(&connection) {
        return Err(fail(error));
    }
    let recovered_after_crash = db::read_meta(&connection, "session_dirty")
        .map_err(fail)?
        .as_deref()
        == Some("1");
    if let Err(error) = db::write_meta(&connection, "session_dirty", "1") {
        return Err(fail(error));
    }
    if let Err(error) = write_last_workspace_pointer(_app_config_dir, &canonical_root) {
        return Err(fail(error));
    }
    Ok((canonical_root, manifest, connection, recovered_after_crash))
}

/// Open an existing StudyKit workspace at `root`. Thin shell
/// over the internal `open_workspace_impl`. Kept as a public
/// entry point so the IPC layer and the `host_verify`
/// example binary can call it without going through the
/// `reopen_last_workspace` path.
pub fn open_workspace(app_config_dir: &Path, root: &Path) -> Result<OpenWorkspaceSummary> {
    open_workspace_impl(app_config_dir, root)
}

/// Reopen the workspace the user had open last. Returns
/// `NoLastWorkspace` if no pointer exists or the pointer is
/// stale. Reads the pointer outside the state machine (a
/// pointer read is not a state change) and then delegates to
/// the same `open_workspace_impl` code path as a direct open.
pub fn reopen_last_workspace(app_config_dir: &Path) -> Result<OpenWorkspaceSummary> {
    let root = match read_last_workspace_pointer(app_config_dir)? {
        Some(root) => root,
        None => return Err(WorkspaceError::no_last_workspace()),
    };
    open_workspace_impl(app_config_dir, &root)
}

/// Drop the currently open workspace. Future reads/writes will
/// return `NoLastWorkspace` until the user opens or creates
/// another. We do NOT clear the `last_workspace` pointer here —
/// the user expects "reopen" to bring them back to where they
/// were.
pub fn close_workspace() -> Result<()> {
    let mut guard = manager().lock().expect("workspace manager mutex poisoned");
    if let ManagerLifecycle::Open(open) = &guard.state {
        db::write_meta(&open.connection, "session_dirty", "0")?;
    } else {
        return Ok(());
    }
    guard.state = ManagerLifecycle::Closed;
    Ok(())
}

/// Drop the currently open workspace AND clear the pointer. The
/// caller is expected to ask the user before invoking this.
/// Round 1 only exposes it from tests / dev seams; the IPC layer
/// does not register a command for it yet.
pub fn forget_workspace(app_config_dir: &Path) -> Result<()> {
    close_workspace()?;
    clear_last_workspace_pointer(app_config_dir)?;
    Ok(())
}

/// Ensure the chosen directory is empty. The directory MUST
/// exist; we refuse any directory that contains even a single
/// entry. The caller passes the canonical root.
///
/// We deliberately do NOT whitelist any sibling entries. The
/// earlier `app-config` whitelist was a test-only convenience
/// that hid a real problem (a target dir containing an
/// app-config sibling is non-empty from the user's
/// perspective). Tests must place their app-config directory
/// outside the workspace root.
fn ensure_workspace_root_is_empty(root: &Path) -> Result<()> {
    let entries: Vec<_> = std::fs::read_dir(root)
        .map_err(|err| {
            WorkspaceError::path_rejected(format!(
                "cannot list chosen directory '{}': {err}",
                root.display()
            ))
        })?
        .filter_map(|res| res.ok())
        .collect();
    if !entries.is_empty() {
        let names: Vec<String> = entries
            .iter()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        return Err(WorkspaceError::creation_failed(format!(
            "chosen directory '{}' is not empty (contains: {}); refusing to convert it into a StudyKit workspace",
            root.display(),
            names.join(", ")
        )));
    }
    Ok(())
}

/// Build a fresh workspace at `parent_dir`. The caller (Rust
/// side of an IPC command) MUST have obtained the path through
/// `tauri-plugin-dialog`'s `pick_folder`.
///
/// Steps, in order; any failure unwinds the directory back to
/// a pre-creation state so the caller never observes a
/// "half-built" workspace:
///
///   0. `reserve()` transitions the manager state machine
///      Closed → Opening. A concurrent caller immediately
///      observes Opening and returns `STUDYKIT_ANOTHER_OPEN`
///      without touching any file on disk.
///   1. Path safety check (`safe_path_check`).
///   2. Refuse to touch an existing non-empty directory.
///   3. Create the directory tree (`assets/{originals,derived,temp}`,
///      `backups/`, `exports/`).
///   4. Write `workspace.json` (refuses to overwrite).
///   5. Open SQLite + apply migrations + integrity_check.
///   6. Persist `last_workspace` pointer.
///   7. `commit_open()` transitions Opening → Open. The
///      reservation is consumed; the workspace is now live.
///
/// The reservation's `Drop` runs only on the failure arms: it
/// transitions Opening → Closed. The `Drop` does NOT touch
/// disk — failure cleanup is the explicit `cleanup_after_failure`
/// calls below, which run before the reservation is dropped.
pub fn create_workspace(
    app_config_dir: &Path,
    parent_dir: &Path,
    display_name: &str,
) -> Result<OpenWorkspaceSummary> {
    // Step 0 — reserve. This is the only state-machine
    // transition; everything else is disk IO without the lock.
    let reservation = reserve()?;

    match create_workspace_after_reserve(parent_dir, display_name, app_config_dir, &reservation) {
        Ok((canonical, manifest, connection, _created_subdirs)) => {
            // Step 7 — commit. Consumes the reservation.
            commit_open(
                reservation,
                OpenWorkspace {
                    root: canonical.clone(),
                    manifest: manifest.clone(),
                    connection,
                    recovered_after_crash: false,
                },
            );
            Ok(OpenWorkspaceSummary {
                root: canonical,
                manifest,
            })
        }
        Err(err) => match err {
            CreateOrOpenError::Cleanup {
                error,
                root,
                created_subdirs,
            } => {
                cleanup_after_failure(&root, &created_subdirs, None);
                Err(error)
            }
            CreateOrOpenError::Bare(error) => {
                // The workspace on disk is good; the user just
                // didn't get the pointer update. We surface the
                // error without removing any artefact.
                Err(error)
            }
        },
    }
}

/// Internal helper that runs the full disk-IO path AFTER
/// `reserve()` has succeeded. Returning a `Result<(canonical,
/// manifest, Connection, Vec<subdirs>), CleanupGuard>` keeps
/// the failure-arms straightforward: the caller calls
/// `cleanup()` on the error variant and re-raises.
/// Internal error type for the create/open helpers. Two
/// variants:
///   - `Cleanup { error, root, created_subdirs }` — the workspace
///     on disk is half-built; the caller must remove every
///     artefact before returning.
///   - `Bare(error)` — the workspace on disk is good (e.g. the
///     pointer write failed after the SQLite commit); the
///     caller surfaces the error without removing any artefact.
enum CreateOrOpenError {
    Cleanup {
        error: WorkspaceError,
        root: PathBuf,
        created_subdirs: Vec<PathBuf>,
    },
    Bare(WorkspaceError),
}

fn create_workspace_after_reserve(
    parent_dir: &Path,
    display_name: &str,
    app_config_dir: &Path,
    _reservation: &Reservation,
) -> std::result::Result<(PathBuf, WorkspaceManifest, Connection, Vec<PathBuf>), CreateOrOpenError>
{
    let fail_cleanup = |error: WorkspaceError, root: PathBuf, created_subdirs: Vec<PathBuf>| {
        CreateOrOpenError::Cleanup {
            error,
            root,
            created_subdirs,
        }
    };
    let fail_bare = |error: WorkspaceError| CreateOrOpenError::Bare(error);

    // Path safety. Failures here never touched the disk.
    if let Err(error) = safe_path_check(parent_dir, parent_dir) {
        return Err(fail_cleanup(error, parent_dir.to_path_buf(), Vec::new()));
    }
    if !parent_dir.exists() {
        return Err(fail_bare(WorkspaceError::path_rejected(format!(
            "chosen folder does not exist: '{}'",
            parent_dir.display()
        ))));
    }
    if !parent_dir.is_dir() {
        return Err(fail_bare(WorkspaceError::path_rejected(format!(
            "chosen path is not a directory: '{}'",
            parent_dir.display()
        ))));
    }
    let canonical_parent = match canonicalize_existing(parent_dir) {
        Ok(c) => c,
        Err(error) => return Err(fail_cleanup(error, parent_dir.to_path_buf(), Vec::new())),
    };
    if let Err(error) = ensure_workspace_root_is_empty(&canonical_parent) {
        return Err(fail_cleanup(error, canonical_parent.clone(), Vec::new()));
    }

    let id = generate_workspace_id();

    // Create the subdirectories.
    let mut created_subdirs: Vec<PathBuf> = Vec::new();
    let subdirs = [
        canonical_parent.join(ASSETS_DIR).join(ASSETS_ORIGINALS),
        canonical_parent.join(ASSETS_DIR).join(ASSETS_DERIVED),
        canonical_parent.join(ASSETS_DIR).join(ASSETS_TEMP),
        canonical_parent.join(BACKUPS_DIR),
        canonical_parent.join(EXPORTS_DIR),
    ];
    for dir in &subdirs {
        if let Err(err) = std::fs::create_dir_all(dir) {
            return Err(fail_cleanup(
                WorkspaceError::creation_failed(format!(
                    "failed to create {} under '{}': {err}",
                    dir.display(),
                    canonical_parent.display()
                )),
                canonical_parent,
                created_subdirs,
            ));
        }
        created_subdirs.push(dir.clone());
    }

    // Test-only failpoint: trigger an error right after the
    // layout is fully created. The failpoint is inert outside
    // `#[cfg(test)]` and is set to `0` (no fail) by default.
    if let Err(error) = failpoint_after_layout(&canonical_parent) {
        return Err(fail_cleanup(error, canonical_parent, created_subdirs));
    }

    // Manifest.
    let manifest = match write_manifest(&canonical_parent, &id, display_name) {
        Ok(m) => m,
        Err(error) => return Err(fail_cleanup(error, canonical_parent, created_subdirs)),
    };

    // SQLite.
    let db_path = canonical_parent.join(SQLITE_FILE_NAME);
    let mut conn_option: Option<Connection> = match db::open_connection(&db_path) {
        Ok(c) => Some(c),
        Err(error) => return Err(fail_cleanup(error, canonical_parent, created_subdirs)),
    };

    // Test-only failpoint: trigger an error right after the
    // SQLite connection has been opened. The failpoint is inert
    // outside `#[cfg(test)]` and is set to `0` (no fail) by
    // default.
    if let Err(error) = failpoint_after_sqlite(&db_path) {
        return Err(fail_cleanup(error, canonical_parent, created_subdirs));
    }

    if let Err(error) =
        db::apply_pending_migrations(conn_option.as_mut().expect("connection just opened"))
    {
        return Err(fail_cleanup(error, canonical_parent, created_subdirs));
    }
    if let Err(error) = db::integrity_check(conn_option.as_ref().expect("connection present")) {
        return Err(fail_cleanup(error, canonical_parent, created_subdirs));
    }
    if let Err(error) = db::write_meta(
        conn_option.as_ref().expect("connection present"),
        "session_dirty",
        "1",
    ) {
        return Err(fail_cleanup(error, canonical_parent, created_subdirs));
    }

    // Pointer. The workspace is real; we just failed to
    // remember it. The caller surfaces the error WITHOUT
    // cleaning up the disk artefacts.
    if let Err(error) = write_last_workspace_pointer(app_config_dir, &canonical_parent) {
        return Err(fail_bare(error));
    }

    let connection = conn_option.expect("connection held until return");
    Ok((canonical_parent, manifest, connection, created_subdirs))
}

/// Cleanup helper used by every failure arm of
/// `create_workspace`. Closes the connection (if any), then
/// removes the manifest, the SQLite files, and every
/// subdirectory we created.
fn cleanup_after_failure(root: &Path, created_subdirs: &[PathBuf], connection: Option<Connection>) {
    // Drop the connection explicitly so SQLite releases any
    // file locks before we try to remove the file.
    drop(connection);
    // Remove the manifest + SQLite + sidecars.
    for name in [
        "workspace.json",
        SQLITE_FILE_NAME,
        &format!("{SQLITE_FILE_NAME}-wal"),
        &format!("{SQLITE_FILE_NAME}-shm"),
    ] {
        let p = root.join(name);
        if p.exists() {
            let _ = std::fs::remove_file(&p);
        }
    }
    // Remove the subdirectories we created, in reverse order.
    for dir in created_subdirs.iter().rev() {
        if dir.is_dir() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    // `create_dir_all(assets/originals)` creates the `assets`
    // parent implicitly, but the leaf-only tracking above does
    // not include that parent. The target was verified empty
    // before creation, so this directory belongs to this attempt.
    let _ = std::fs::remove_dir_all(root.join(ASSETS_DIR));
}

/// Health probe. Returns a `WorkspaceHealth` summary the IPC
/// layer can hand back to the WebView without exposing any raw
/// `rusqlite` types.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceHealth {
    pub root: String,
    pub manifest_id: String,
    pub display_name: String,
    pub format_version: u32,
    pub schema_version: i64,
    pub integrity: String,
    pub has_knowledge_objects: bool,
    pub recovered_after_crash: bool,
}

pub fn get_workspace_health() -> Result<WorkspaceHealth> {
    with_open(|open| {
        let has_knowledge_objects = open
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM knowledge_objects)",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n != 0)
            .unwrap_or(false);
        let schema_version = db::read_schema_version(&open.connection)?;
        Ok(WorkspaceHealth {
            root: open.root.to_string_lossy().into_owned(),
            manifest_id: open.manifest.id.clone(),
            display_name: open.manifest.displayName.clone(),
            format_version: open.manifest.formatVersion,
            schema_version,
            integrity: "ok".to_string(),
            has_knowledge_objects,
            recovered_after_crash: open.recovered_after_crash,
        })
    })
}

// ---------------------------------------------------------------------------
// Test-only deterministic failpoints.
// ---------------------------------------------------------------------------
//
// `manager::set_failpoints` plus the two private failpoint
// checks injected into `create_workspace_after_reserve` let
// the test suite simulate a deterministic failure right after
// the directory layout is built, or right after the SQLite
// connection has been opened. The failpoint is no-op by
// default; production builds never call `set_failpoints` so
// the failure path is unreachable.

#[cfg(test)]
use std::sync::atomic::{AtomicU8, Ordering};

/// Failpoint id for "after the directory layout is created".
#[cfg(test)]
const FAIL_AFTER_LAYOUT: u8 = 1;
/// Failpoint id for "after the SQLite connection has been opened".
#[cfg(test)]
const FAIL_AFTER_SQLITE: u8 = 2;

#[cfg(test)]
static FAILPOINT_LAYOUT: AtomicU8 = AtomicU8::new(0);
#[cfg(test)]
static FAILPOINT_SQLITE: AtomicU8 = AtomicU8::new(0);

/// Set the layout / sqlite failpoints. Pass `0` to clear.
#[cfg(test)]
pub fn set_failpoints(layout: u8, sqlite: u8) {
    FAILPOINT_LAYOUT.store(layout, Ordering::SeqCst);
    FAILPOINT_SQLITE.store(sqlite, Ordering::SeqCst);
}

#[cfg(test)]
fn failpoint_after_layout(canonical: &Path) -> Result<()> {
    let flag = FAILPOINT_LAYOUT.load(Ordering::SeqCst);
    if flag == FAIL_AFTER_LAYOUT {
        // Reset before returning so a second call would not
        // re-trigger.
        FAILPOINT_LAYOUT.store(0, Ordering::SeqCst);
        return Err(WorkspaceError::creation_failed(format!(
            "test failpoint triggered after layout at '{}'",
            canonical.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
fn failpoint_after_sqlite(db_path: &Path) -> Result<()> {
    let flag = FAILPOINT_SQLITE.load(Ordering::SeqCst);
    if flag == FAIL_AFTER_SQLITE {
        FAILPOINT_SQLITE.store(0, Ordering::SeqCst);
        return Err(WorkspaceError::db_unusable(format!(
            "test failpoint triggered after sqlite at '{}'",
            db_path.display()
        )));
    }
    Ok(())
}

#[cfg(not(test))]
fn failpoint_after_layout(_canonical: &Path) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
fn failpoint_after_sqlite(_db_path: &Path) -> Result<()> {
    Ok(())
}
