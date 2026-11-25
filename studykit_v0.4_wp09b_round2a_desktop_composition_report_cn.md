# StudyKit v0.4 — WP-09B Round 2A Desktop Composition 报告

- **Packet**：WP-09B Round 2A（Desktop Workspace Composition）
- **状态**：CODEX AUTOMATED GATE PASS
- **复核日期**：2026-07-30

## 1. 本轮完成

- 新增统一的 `DesktopWorkspaceProvider` 与显式状态机：Web、恢复中、待选择、选择中、就绪和错误。
- Desktop 冷启动只调用一次 `reopen_last_workspace`；成功后读取健康状态、绑定同一个 `WorkspaceClient` 与 SQLite Repository，再进入 v0.4 Shell。
- 无最近 Workspace 时展示简洁的原生入口，可创建命名 Workspace 或打开现有目录；用户取消选择保持中性状态，不显示伪错误。
- Create/Open/Retry/Close/Switch 均有并发保护。关闭失败时保留当前可用 Workspace，不错误清空 UI 状态。
- Header 显示当前 Workspace 名称与 Native 标识，并提供切换入口。
- Desktop runtime 的 `supportsNativeFileSystem` 为 `true`；Web 始终为 `false`，其余 OS bridge 能力仍为 `false`。
- Web 端既有登录、Local Workspace 和主题路径不受 Desktop composition 影响。

## 2. 核心实现边界

- Composition root 位于 `frontend/src/app/v04/desktopWorkspaceContext.tsx`，原生调用仍全部收敛在 `frontend/src/platforms/desktop/`。
- 生产路径只创建一个类型化 Tauri client；测试通过显式依赖注入，不使用全局 bridge 或静默回退。
- Desktop 启动不再从浏览器 localStorage 恢复旧的 workspace flavour，避免原生 Workspace 与旧 Web 状态竞争。
- 本轮只完成 Workspace 生命周期和 Repository 绑定。现有 Study、Research 与 Canvas 业务数据仍留在原有本地应用存储；正式切换和 Dexie 数据迁移属于 Round 2B，界面已明确标注 Alpha 状态。

## 3. 主要文件

- 新增：`frontend/src/app/v04/desktopWorkspaceContext.tsx`
- 新增：`frontend/src/app/v04/desktopWorkspaceContext.test.tsx`
- 修改：`frontend/src/main.tsx`
- 修改：`frontend/src/App.tsx`
- 修改：`frontend/src/app/v04/V04Shell.tsx`
- 修改：`frontend/src/app/v04/v04.css`
- 修改：`frontend/src/app/v04/index.ts`
- 修改：`frontend/src/platforms/desktop/index.ts`
- 修改：`frontend/src/platforms/desktop/runtime.desktop.ts`
- 修改：runtime 与 desktop composition capability 测试

## 4. 验证结果

- Desktop composition 定向测试：**41 passed**。
- TypeScript typecheck：通过。
- Vitest 全量：Test Files **84 passed / 2 skipped**；Tests **1047 passed / 2 skipped**。
- Production build：通过（898 modules）。
- Rust library：**59 passed**；`cargo fmt --check` 通过。
- Unsigned desktop build：通过；二进制生成于 `frontend/src-tauri/target/release/studykit-desktop`。
- `git diff --check` 与禁止模式静态搜索：通过。

现有 Vite 大 chunk 与 dynamic/static import 提示仍存在，属于此前已记录的性能债务，本轮没有新增构建失败。

## 5. Gate 结论与下一步

WP-09B Round 2A 的实现和自动化验收通过。下一包应为 **Round 2B：业务 Repository 接线与可回滚迁移**，先定义旧 Dexie 数据的盘点、备份、迁移 journal、校验与回滚，再逐域切换 Study/Research/Canvas；不得通过双写或隐式迁移制造两个事实来源。

本轮未执行 commit、push、stage、stash、reset 或 checkout，也未触碰无关业务改动。
