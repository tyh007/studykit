# StudyKit v0.4 — WP-09B Round 1 实施报告

- **Packet**: WP-09B Round 1（Native Workspace + SQLite Foundation）
- **状态**: READY FOR CODEX REVIEW（执行工程师不宣布整个 WP-09B PASS）

## 架构选择及原因

- **SQL 接入：不用 `tauri-plugin-sql`，使用 `rusqlite` 直接接入**。
  原因：官方 Tauri SQL 插件把 SQLite 路径锁定在 `BaseDirectory::AppConfig` 下，无法承载用户自选的任意绝对路径 Workspace。WP-09B 要求 SQLite 文件落在用户选择的工作区目录。窄 `rusqlite` adapter 让我们能：(a) 在指定路径打开；(b) 在 IO 前做 manifest + formatVersion 校验；(c) 一次 BEGIN/COMMIT 应用 migration；(d) 拒绝路径穿越 / 符号链接越界 / 外部目录；(e) 所有文件 IO 在自有 Rust 命令里完成，WebView 不接触 `rusqlite` 或 `dialog`。
- **对话框：仅 `tauri-plugin-dialog`**（folder picker）。`dialog:default` 是本包唯一新增 capability；不开放 `fs:*`、`shell:*`、`clipboard`、`global-shortcut`、`updater`、`http`。

## Workspace 格式

```
My StudyKit Workspace/
├── workspace.json
├── studykit.sqlite   (+ -shm/-wal)
├── assets/{originals,derived,temp}/
├── backups/
└── exports/
```

`workspace.json` schema v1：

```json
{
  "schema": "studykit.workspace/1",
  "id": "<uuid-v4>",
  "formatVersion": 1,
  "displayName": "<string>",
  "createdAt": "<iso8601>",
  "updatedAt": "<iso8601>"
}
```

## SQLite schema v1 / migration

`schema_migrations(version INTEGER PK, applied_at TEXT)`，`workspace_meta(key, value)`，`knowledge_objects(id PK, kind, body, state, author_type, container_workspace_id, container_mode, container_kind, container_id, created_at, updated_at)` + 3 索引（kind/state、container_id、updated_at）。Migration 通过 SAVEPOINT 应用，幂等，schema 版本高于 `SUPPORTED_SCHEMA_VERSION` 拒绝打开；每次 open 后 `PRAGMA integrity_check`。

## IPC 与权限清单

- Rust 命令：`choose_and_create_workspace`、`choose_and_open_workspace`、`reopen_last_workspace`、`close_workspace`、`get_workspace_health`、`read_object_v1`、`read_all_objects_v1`、`transact_v1`（一个 JS `transact` ⇒ 一次 IPC ⇒ 一个 SQLite transaction）。
- 错误信封：`{ kind: "STUDYKIT_*", message }`，WebView 用 `WorkspaceIpcError` 包装。
- Capability：`core:app:default`、`dialog:default`。CSP 未放宽。

## Runtime capability 结果

- Web：`supportsNativeFileSystem` 始终 `false`（构造器硬编码）。
- Desktop：默认 `false`；仅当 `createDesktopRuntimeCapabilities({ workspaceReady: true })` 时翻为 `true`。本轮内 IPC 路径不调用此构造器，所以生产 UI 暂时没有 OS-bridge 入口，**这是预期**——composition root 接入由 Round 2 / 09C 完成。
- 其余三个能力：`supportsGlobalShortcut`、`supportsAutoUpdate`、`supportsLocalAiDiscovery` 继续 `false`。

## 修改文件

Rust 新增：`src-tauri/Cargo.toml`（+`rusqlite 0.32`、`tauri-plugin-dialog 2.2`、`once_cell`、`thiserror`、`tempfile` dev）、`src-tauri/src/workspace/{mod,error,manifest,path_safety,db,knowledge,manager,manager_tests}.rs`、`src-tauri/src/ipc.rs`、`src-tauri/src/lib.rs`、`src-tauri/examples/host_verify.rs`。修改：`src-tauri/capabilities/default.json`（加 `dialog:default`）。

Frontend 新增：`src/application/runtime/{runtimeCapabilities,index,ts,test}.ts`、`src/platforms/desktop/{workspaceClient,sqliteStudyKitRepository}.ts`、`src/platforms/desktop/{workspaceClient,sqliteStudyKitRepository,runtimeCapabilitiesWp09b}.test.ts`、`src/platforms/desktop/runtime.desktop.ts`（+`workspaceReady`）、`src/platforms/web/runtime.web.ts` 与 `index.ts`、`src/platforms/runtime.ts`、`src/platforms/index.ts`、`frontend/src-tauri/icons/icon.png`（最小占位）。

`git status --short`：除既有未跟踪 `frontend/src-tauri/` 与 `studykit_v0.4_wp09a_*` 报告外，本包未触碰任何业务文件。

## Rust tests

`cargo fmt --check` 干净；`cargo test --lib --test-threads=1`：**40 passed**（含 create/reopen、Chinese + space、corrupt manifest、future formatVersion、non-StudyKit dir、migration 首次 + 重复、transaction rollback（SAVEPOINT）、integrity_check、path traversal、symlink escape、creation-failure 不覆盖、UUID 唯一、manifest round-trip、null bytes、empty path 拒绝、ISO 8601 含 2026-07-28 日历验证等）。

## TypeScript / 全量测试 / build

- `tsc -b --noEmit`：TypeScript: No errors found。
- `vitest run`：**Test Files 84 passed / 2 skipped (86)；Tests 1031 passed / 2 skipped (1033)**。WP-09B 新增 18 用例（runtime capability 边界 5、workspaceClient 6、sqliteStudyKitRepository 7）。
- `npm run build`：✓ built in 2.11s；既有 dynamic-import 与 chunk-size 警告（pdfjs / literature canvas）为 WP-02 / WP-08 历史遗留，未触。
- `npm run build:desktop:unsigned`：Built application at `frontend/src-tauri/target/release/studykit-desktop`（14,308,272 字节）；4 cargo warnings（测试模块 `reset` 与 `app_config` 未在 example 中使用），不影响产品代码。
- `git diff --check`：通过。

## 真实 Host 验证

构建 `examples/host_verify` binary（cargo build --example host_verify），用专用临时目录跑完整 5 步流程，**不**触碰用户真实 Documents / Desktop / OneDrive：

```text
== step 1: create_workspace   → root, manifest.id, formatVersion=1, displayName OK
== step 2: integrity_check    → schema_version=1, integrity=ok, has_knowledge_objects=false
== step 3: insert row         → has_knowledge_objects=true
== step 4: close + reopen_last → 通过 last-workspace pointer 找回，数据仍在
== step 5: explicit open      → 同一路径重新打开，健康
```

测试 Workspace 路径（**未删除，等用户决定**）：`/Users/hengx/Library/Caches/studykit-wp09b-final`（manifest + SQLite + `host-verify-1` note 仍存在）；app-config：`/Users/hengx/Library/Caches/studykit-wp09b-final-app-config`。真实 `studykit-desktop` 二进制冷启动后渲染 v04 "Choose a workspace" 卡片（dark theme），无控制台 error、无额外权限弹窗。

## 未完成项和风险

1. **真实 GUI folder picker 未手动驱动**：Host 验证走 `examples/host_verify` binary 调用同一 Rust manager；用户人工点选仍需在 Round 2 把 `workspaceFlavour.openLocal()` 与 `choose_and_create_workspace` 串起来。`platforms/runtime.desktop` 已暴露 `workspaceReady` 给 composition root。
2. **现有 Dexie 数据未迁移**：完全按 brief 留给后续；桌面 SQLite 与 Web Dexie 各走各的 contract。
3. **`reopen_last_workspace` 跨进程 pointer 是单条绝对路径**：占位符原子写入（写 tmp + rename）；未实现多 profile / 切换 UI。Round 2 / 09C。
4. **桌面 `StudyKitRepository` 当前只在测试中通过 IPC stub 跑通**：真实 `transact_v1` IPC 路径已写、未在 Round 1 内用真实桌面交互过；Round 2 由 composition root 接入后正式走端到端。
5. **icon.png 是 104-byte 占位**：`tauri::generate_context!()` 需要存在；正式图标生成留给 Round 2。打包产物不带 bundling，bundle target 仍指向 macOS dev certificate（无签名）。
6. **.gitignore**:未新建 `frontend/src-tauri/.gitignore`（保留 `target/`、`gen/`、`node_modules/`），由 Codex 决策。

## 测试 Workspace 路径（请决定是否删除）

- 数据：`/Users/hengx/Library/Caches/studykit-wp09b-final/`（manifest `id=558bc974-71c0-4186-bc21-010000000000`、`studykit.sqlite` 含 1 条 `host-verify-1` note）。
- AppConfig：`/Users/hengx/Library/Caches/studykit-wp09b-final-app-config/studykit-v0.4/studykit.last-workspace.json` 指向上面。

不执行 `commit` / `push` / `stage` / `stash` / `reset` / `checkout`。等待 Codex 二次验收。