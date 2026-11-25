# ADR-002 — Native Source Asset Bridge

Date: 2026-08-08  
Status: Accepted for WP-11R2A

## Context

Desktop domain metadata already lives in the user-selected Workspace SQLite database, and backups already copy `assets/originals`. PDF bytes do not yet reach that directory: Study rejects local source uploads, while Research stores them in WebView IndexedDB. That split breaks the local-first backup and restore promise.

## Decision

Add one narrow Rust-owned asset bridge for PDF originals:

1. `choose_and_import_pdf_asset_v1` opens the native PDF picker and copies the selected regular file to `assets/originals/<asset-id>.pdf` using a temporary file and atomic rename.
2. `read_workspace_asset_v1` accepts only a generated asset id and returns raw bytes. The WebView never supplies or receives an arbitrary filesystem path.
3. `discard_workspace_asset_v1` removes exactly one generated asset after a failed canonical metadata transaction.
4. Study source-document metadata remains in the existing `legacy` domain-record namespace; Research continues to use canonical `Work` and `WorkAsset` rows. No asset metadata table or repository is added.
5. Existing backup code remains the single snapshot implementation because it already copies `assets/originals` and rejects symlinks.

The imported file is limited to 50 MiB, must have a `.pdf` extension and `%PDF-` header, and is hashed with SHA-256 while it is copied. Asset ids are Rust-generated UUID-based identifiers. All reads and deletes re-validate the id, resolved directory and regular-file boundary.

## Consistency model

Filesystem and SQLite cannot share one transaction. The bridge therefore uses a safe order:

`copy original atomically → write canonical metadata → discard original if metadata fails`

A process crash between the first two steps may leave an unreferenced original, but never a canonical record pointing at a partial file. Orphans are safe, included in backups, and can be garbage-collected by a later maintenance packet. The UI never exposes an asset until canonical metadata commits.

## Alternatives rejected

- WebView filesystem plugin permissions: too broad; would expose user-selected paths to JavaScript.
- Base64/JSON IPC: excessive memory and serialization overhead.
- IndexedDB in Desktop: not part of the Workspace and not covered by native backup/restore.
- A second asset database or repository: duplicates canonical Study/Research metadata.
- Arbitrary file-path URLs: path traversal and scope-expansion risk.

## Consequences

- Raw IPC returns an `ArrayBuffer`, matching Tauri's own filesystem plugin transport; the current 50 MiB product cap bounds memory use.
- Native PDF readers consume the returned bytes as `Blob`/`Uint8Array` data, avoiding Tauri WebView `blob:` URL fetch failures. The bridge retains a revocable object-URL helper for non-PDF consumers, but it is not the canonical reader path.
- Sync Workspace upload behavior remains unchanged.
- A future large-file/streaming packet may replace raw IPC with a scoped custom protocol without changing canonical asset ids or domain metadata.
