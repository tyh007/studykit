# StudyKit v0.4 — WP-09B Round 1 (Correction Gate) 报告

- **Packet**：WP-09B Round 1（Native Workspace + SQLite Foundation）
- **状态**：CODEX FINAL REVIEW PASS（仅 WP-09B Round 1；不代表整个 WP-09B 完成）
- **最终复核日期**：2026-07-30

## A. 真实 Tauri IPC bridge

- `frontend/package.json` 添加 `@tauri-apps/api: ^2.11.1`（与 `@tauri-apps/api/core` 顶层 import 一致；`npm install` 已生成新的 lockfile）。
- `frontend/src/platforms/desktop/workspaceClient.ts` 删除 `require('@tauri-apps/api/core')`，改为顶层 `import { invoke as tauriInvoke } from '@tauri-apps/api/core'`，供 `createTauriWorkspaceClient` 使用。
- 浏览器/Vitest 检测 `globalThis.__TAURI_INTERNALS__` 失败时不再静默回退，命令路径直接抛 `STUDYKIT_NO_LAST_WORKSPACE`。
- 测试 seam：`createWorkspaceClient(invoke)` 通过类型化 `TauriInvoke` 注入；`workspaceClient.test.ts` 验证不存在 `globalThis.__desktopRepoBridge__` 也不需要它。

## B. 单一类型化 WorkspaceClient

- 新增方法：`readObject`、`readAllObjects`、`transact`；保留 `chooseAndCreate/chooseAndOpen/reopenLast/close/getWorkspaceHealth`。
- 删除 `sqliteStudyKitRepository` 中的 `__desktopRepoBridge__` / `defaultBridgeInvoke` / `read_all_objects_v1 → getWorkspaceHealth` 映射。
- `sqliteStudyKitRepository` 现在只接受一个 `WorkspaceClient` 依赖；`transact` 走同一 `client.transact` 调用，Rust 端一笔 BEGIN/COMMIT。
- `sqliteStudyKitRepository.test.ts` 通过注入 `createWorkspaceClient(stub.build())` 验证：(a) 无 `__desktopRepoBridge__` 引用；(b) 一次 `transact(fn)` ⇒ 一次 `transact_v1` IPC；(c) Rust 错误信封被 `WorkspaceIpcError` 包装并按 `STUDYKIT_VALIDATION_FAILED` 透传。

## C. 收紧 capability

- `frontend/src-tauri/capabilities/default.json` 现在只包含 `core:app:default`；`dialog:default` 已删除。
- `tauri-plugin-dialog` 仍在 `lib.rs` 注册，由 Rust `choose_and_create_workspace` / `choose_and_open_workspace` 在 `ipc.rs` 内部调用，不向 WebView 暴露。
- `frontend/src-tauri/README.md` 重写：明确说明 dialog plugin 走 Rust 而非 WebView；CSP 限制未放宽；未引入 `fs:*`、`shell:*`、`clipboard`、`global-shortcut`、`updater` 或 HTTP 权限。
- `frontend/src/platforms/desktop/runtime.desktop.ts` 移除 `workspaceReady` 钩子（Round 1 不暴露 OS-bridge 能力）；`runtimeCapabilitiesWp09b.test.ts` 已删除。

## D. Workspace manager 原子性

- Manager 使用 `Closed → Opening → Open` 状态机。`reserve()` 在短临界区内完成 `Closed → Opening` 后立即释放锁；磁盘 IO 不持锁。并发调用可直接观察 `Opening` 并返回 `STUDYKIT_ANOTHER_OPEN`，不会触碰目录或 pointer。
- `Reservation` 是不持有 `MutexGuard` 的 RAII token：成功时提交为 `Open`，任意失败时自动恢复 `Closed`。`reopen_last_workspace` 复用内部 open 流程，不会重复申请 reservation。
- 删除原 `app-config` 旁路白名单：空目录判断只接受真正空的目录（`legalRow` 之类的助手函数被废弃）。
- 失败原子性：`cleanup_after_failure` 在任意 IO 失败时先关闭连接，再删除 `workspace.json`、SQLite、WAL/SHM、所有叶目录及隐式创建的 `assets/` 根目录。
- 指针完整性：仅在 SQLite 全部 IO 完成后才写 `last_workspace`；任何后续失败不会覆盖既有 pointer。
- 关键回归测试包括：
  1. `a_open_create_b_does_not_touch_b_or_pointer` — A 已开时 create B，pointer 不变、B 无产物。
  2. `a_open_open_b_pointer_unchanged` — A 已开时 open B，pointer 不变。
  3. `concurrent_create_calls_only_one_wins` — 两个线程同步竞争，仅一个成功，失败目标保持为空。
  4. `failure_after_layout_restores_empty_target_directory` — layout 后确定性 failpoint，目标恢复为空。
  5. `failure_after_sqlite_restores_empty_target_directory` — SQLite 打开后 failpoint，数据库、sidecar、manifest 和目录全部清理。
  6. `app_config_inside_workspace_root_is_rejected` — 目标目录内放 `app-config/`，非空检查拒绝。
- 所有 `manager_tests` 把 `app_config_dir` 放在 workspace 根目录之外（`app_config_outside`）。
- Workspace ID 改用标准 `uuid::Uuid::new_v4()`，消除快速连续创建时基于系统时钟的碰撞。

## E. 严格验证边界

- 新增 `frontend/src-tauri/src/workspace/validation.rs`：单一 Rust 验证模块，覆盖 `kind` / `state` / `author_type` / 容器字段一致性 / `(mode, kind)` 仅允许 `study|course` 与 `research|project` / `id` 非空且无 NUL。
- 时间戳使用 `chrono::DateTime::parse_from_rfc3339`，接受 JavaScript `Date.toISOString()` 的 `.000Z`、无小数秒格式和合法时区偏移，同时拒绝不存在日期、非法月份与非法时间。
- `transact_v1` 在打开 SQLite 事务前先调用 `validate_ops(&args.operations)`；任一 op 非法立即 `STUDYKIT_VALIDATION_FAILED` 并整体回滚。
- 新增 `ErrorKind::ValidationFailed` 与 `WorkspaceError::validation_failed` 工厂函数。
- 前端 `rowToObject` 与 `objectToRow` 严格双向校验：未知 `author_type`、未知 `mode/kind`、部分缺失的容器、孤儿 `container_workspace_id`、非法 `(mode, kind)` 配对全部抛 `WorkspaceIpcError(STUDYKIT_VALIDATION_FAILED)`；不再默认把未知 `container_kind` 补成 `project`。
- 测试 `first_invalid_op_aborts_whole_batch` 证明前序合法 op 不会因为后续非法 op 部分落盘。
- 前端测试 `rowToObject rejects unknown author_type` / `rejects partial container fields` / `rejects invalid mode/kind pairs` / `rejects orphan container_workspace_id` 验证边界。

## F. Repository 生命周期最终修复

- `initialSummary` 存在时 Repository 视为已绑定，不调用 `reopen_last_workspace`。
- 无 `initialSummary` 时，首次操作最多 reopen 一次；并发首次读取共享同一个 binding Promise。
- `getObject` 在首次使用时先绑定，再调用 `read_object_v1`。
- `transact_v1` 成功后仅重新读取对象缓存，不会再次 reopen 已打开的 Workspace。
- 定向测试覆盖 initialSummary、首次 get、并发首次读、transact 后刷新与单次 reopen 上限。

## 修改文件

新增：`frontend/src-tauri/src/workspace/validation.rs`、`frontend/src-tauri/src/workspace/ipc_types.rs`、`frontend/src-tauri/src/workspace/manager_tests.rs`（重写）。
修改：`frontend/package.json`（+`@tauri-apps/api`）、`frontend/package-lock.json`、`frontend/src/platforms/desktop/workspaceClient.ts`、`frontend/src/platforms/desktop/sqliteStudyKitRepository.ts` 及其测试、`frontend/src/platforms/desktop/runtime.desktop.ts`、`frontend/src-tauri/Cargo.toml`（+`chrono`、直接声明已有 `uuid`）、`Cargo.lock`、`src/lib.rs`、`src/ipc.rs`、`src/workspace/{manager,manager_tests,manifest,error,mod}.rs`、capability 与 README。
删除：`frontend/src/platforms/runtimeCapabilitiesWp09b.test.ts`（依赖 `workspaceReady`）。

## 真实命令结果

- `rtk npx tsc -b --noEmit` → TypeScript: No errors found。
- WP-09B 前端定向测试 → **27 passed**。
- `rtk npx vitest run` → Test Files 83 passed / 2 skipped (85)；Tests **1037 passed / 2 skipped (1039)**。无回归。
- `rtk npm run build` → ✓ built in 2.28s；production bundle 不包含 `require('@tauri-apps')` / `__desktopRepoBridge__`。
- `rtk cargo fmt --check` → 干净。
- `rtk cargo test --lib -- --test-threads=1` → **59 passed**。
- `PATH=/Users/hengx/.cargo/bin:$PATH rtk npm run build:desktop:unsigned` → 成功；Built at `frontend/src-tauri/target/release/studykit-desktop`。
- `rtk git diff --check` → 通过。

## 验证分类

- **自动测试**：Rust 59/59 全部通过；Vitest 1037/1037 全部通过；`tsc` + `cargo fmt --check` 干净；Web production build 与 unsigned desktop build 成功。
- **真实二进制构建**：上述 unsigned build 已成功生成可执行文件；未在真实 Tauri 窗口中驱动 folder picker（生产路径 UI 接入属于 Round 2 范围）。
- **人工 GUI 验证**：本轮范围不接入业务 UI（per brief 范围限制）；host_verify 端到端流程已 Round 1 内验证，Round 1 的数据目录与 app-config 仍保留在 `/Users/hengx/Library/Caches/studykit-wp09b-final*` 供后续参考。

## 未执行的验证

- 真实 Tauri 窗口中由 GUI 驱动 folder picker + create workspace：未执行。Round 1 已通过 Rust `host_verify` example 覆盖同一 manager 的端到端流程；生产 UI 接入属于 Round 2 范围。
- macOS 签名 / notarisation：未执行（按 brief 排除）。
- Dexie 数据迁移到 SQLite：未执行（brief 明确排除，留 Round 2/3）。
- 真实 `cargo tauri icon` 生成 icon 资源：未执行（按 brief 排除；占位 `icons/icon.png` 仍为 104 B 最小 PNG）。
- `frontend/src-tauri/.gitignore`：未新建（由 Codex 决策）。

## git status --short

```
 M backend/index.js
 M backend/init-db.js
 M backend/schema.sql
 M frontend/index.html
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/src/App.tsx
 ... (其余既有未提交修改，未触碰)
?? frontend/src-tauri/src/workspace/validation.rs
?? frontend/src-tauri/src/workspace/ipc_types.rs
```

未执行 `commit` / `push` / `stage` / `stash` / `reset` / `checkout`。
