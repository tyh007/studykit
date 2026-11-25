# StudyKit v0.4 — WP-09A Desktop Foundation 实施报告

> 包：WP-09A（Desktop Foundation，本地优先基座）
> 日期：2026-07-28
> 角色：执行工程师（MiniMax Code）+ Codex 二次验收
> 状态：Gate PASS（Codex 二次验收 + macOS 真实 Host Gate，2026-07-28）
> 范围严格限定：本报告覆盖 WP-09A；不包含 SQLite 迁移、Quick Capture、自动更新、附件目录、备份恢复、签名 notarisation 等 WP-09B / 09C 能力。

## 1. 实际完成内容

| 项目 | 实现 |
|---|---|
| Runtime 契约 | `frontend/src/application/runtime/runtimeCapabilities.ts` —— 纯类型合同，描述 `runtime` / `platform` / `hostVersion` 与四个 OS-bridge 能力（`supportsNativeFileSystem`、`supportsGlobalShortcut`、`supportsAutoUpdate`、`supportsLocalAiDiscovery`），全部 `false`。 |
| Web 适配器 | `frontend/src/platforms/web/runtime.web.ts` —— UA / `navigator.platform` 解析，输出 `runtime: 'web'` 快照；OS-bridge 能力全部 `false`。 |
| Desktop 适配器 | `frontend/src/platforms/desktop/runtime.desktop.ts` —— 仅把 `window.__TAURI_INTERNALS__` 当作 Tauri 主机存在标记，不读取私有字段、不依赖 `@tauri-apps/api`；平台诊断使用公开 `navigator` 信息，`hostVersion` 暂为空；无 Tauri 注入时安全回退。 |
| 统一选择点 | `frontend/src/platforms/runtime.ts` —— 缓存的单例 `getActiveRuntimeCapabilities()`、`isDesktopRuntime()`，以及测试用 `__setActiveRuntimeCapabilitiesForTests`。 |
| 应用层 barrel | `frontend/src/application/runtime/index.ts` —— 重导出 contract；`application/` / `features/` / `shared/` 只从此处 import，不直接读 `window.__TAURI_INTERNALS__`。 |
| 平台 barrel | `frontend/src/platforms/index.ts` 与 `platforms/desktop/index.ts` —— composition root（`app/`）从这里 import；`platforms/web/index.ts` 已加入 web runtime 重导出。 |
| Tauri shell | `frontend/src-tauri/` —— Tauri 2 配置：最小 Cargo 依赖、正确从父目录运行 Vite hooks、窗口/CSP、无自定义 IPC、`capabilities/default.json` 仅授权 `core:app:default`。缺失 icon 不再写入配置。 |
| Desktop Alpha 入口 | `frontend/src/main.tsx` 在 Tauri composition root 为已过 Gate 的 `v04Shell` / Assistant / Study / Research / Canvas 提供 runtime defaults；Web 编译默认值仍关闭，Collaboration/Gateway 仍按需启用。 |
| 重启恢复 | Workspace flavour 改为仅在 v0.4 shell 启用时从 `localStorage` rehydrate；Local Workspace 选择、Dark 主题与 Dexie Research Project 均已在 `.app` 完全退出/重启后恢复。 |
| 桌面 composition 测试 | `frontend/src/platforms/desktopComposition.test.ts` —— 6 个测试覆盖：Tauri 主机识别、desktop 快照、Web 回退、Local Workspace 无账号进入、WebView 内 shell remount，以及 Research Project 经生产 Dexie repository 写入并在 runtime/repository 重建后恢复。 |
| Runtime 单元测试 | `frontend/src/platforms/runtimeCapabilities.test.ts`（9 个）+ `frontend/src/application/runtime/runtimeCapabilities.test.ts`（2 个）= 共 11 个；UA / Tauri 平台解析、capability 形状、singleton 解析、test injection。 |
| 文档 | `frontend/src-tauri/README.md`（运行手册、外部依赖、命令清单）；`frontend/src-tauri/icons/README.md`（图标缺口与生成方法）；本报告。 |

## 2. 文件清单

新增文件：

- `frontend/src/application/runtime/runtimeCapabilities.ts`
- `frontend/src/application/runtime/runtimeCapabilities.test.ts`
- `frontend/src/application/runtime/index.ts`
- `frontend/src/platforms/runtime.ts`
- `frontend/src/platforms/runtimeCapabilities.test.ts`
- `frontend/src/platforms/desktopComposition.test.ts`
- `frontend/src/platforms/desktop/runtime.desktop.ts`
- `frontend/src/platforms/desktop/index.ts`
- `frontend/src/platforms/web/runtime.web.ts`
- `frontend/src/platforms/index.ts`
- `frontend/src-tauri/Cargo.toml`
- `frontend/src-tauri/Cargo.lock`
- `frontend/src-tauri/tauri.conf.json`
- `frontend/src-tauri/build.rs`
- `frontend/src-tauri/package.json`
- `frontend/src-tauri/package-lock.json`
- `frontend/src-tauri/.gitignore`
- `frontend/src-tauri/README.md`
- `frontend/src-tauri/src/main.rs`
- `frontend/src-tauri/src/lib.rs`
- `frontend/src-tauri/capabilities/default.json`
- `frontend/src-tauri/icons/README.md`
- `frontend/src-tauri/icons/icon.png`（仅满足 Tauri build context 的开发占位图，不是发行图标）

修改文件：

- `frontend/src/platforms/web/index.ts` —— 增加 `createWebRuntimeCapabilities` 与 `detectWebPlatform` 重导出。
- `frontend/src/main.tsx`、`frontend/src/app/feature-flags.ts` 与测试 —— 增加桌面 Alpha runtime defaults，不改变 Web compile defaults。
- `frontend/src/application/workspaceFlavour.ts` 与相关测试 —— Local Workspace 选择从 tab-session persistence 提升为应用冷启动 persistence。

## 3. Runtime / 平台边界

```text
frontend/src/application/runtime/runtimeCapabilities.ts   ←  contract（runtime/platform/capabilities）
                     ▲
                     │ re-export only
frontend/src/application/runtime/index.ts                ←  application barrel
                     ▲
                     │ re-export only
frontend/src/platforms/index.ts                          ←  composition-root barrel
                     │
       ┌─────────────┼─────────────┐
       ▼                           ▼
frontend/src/platforms/web/runtime.web.ts       frontend/src/platforms/desktop/runtime.desktop.ts
       │                           │
       └─────────────┬─────────────┘
                     ▼
frontend/src/platforms/runtime.ts               ←  getActiveRuntimeCapabilities()
```

关键约束：

1. `application/`、`features/`、`shared/` 都 **不** import `platforms/*`；它们通过 `application/runtime` 拿 contract 类型与测试注入工具。
2. `main.tsx` 作为 composition root 读取 `isDesktopRuntime()`；Tauri Alpha 启用已经通过各自 Gate 的核心 v0.4 slices，Web rollout 默认值保持不变。
3. `__TAURI_INTERNALS__` 只用于区分 Tauri host；不依赖其未公开的内部结构。普通 Web 环境没有该标记时回退 web 快照；测试已覆盖。
4. Tauri API（`@tauri-apps/api`）**未** 进入依赖；后续插件加入时仅在 `frontend/src-tauri/Cargo.toml` 与 Rust 侧做扩展，不影响 React 业务代码。

## 4. 权限与隐私

Tauri capabilities 最小权限（`capabilities/default.json`）：

```text
core:app:default
```

未启用：

- `tauri-plugin-clipboard-manager`（剪贴板）—— 本包不申请。
- `tauri-plugin-fs`（filesystem 任意路径）—— 本包不申请。
- `tauri-plugin-global-shortcut`（global hotkey）—— 本包不申请。
- `tauri-plugin-shell`（执行系统命令）—— 本包不申请。
- `tauri-plugin-os`（OS 信息探测）—— 本包不申请。
- `tauri-plugin-updater`（自更新）—— 本包不申请。
- Ollama / 本地 AI HTTP 探测 —— 本包不实现。

CSP（`tauri.conf.json`）允许 `connect-src` 包含 `http://ipc.localhost`（Tauri IPC）、`http://localhost:5173`（Vite dev）、`http://localhost:3001`（本地 backend，仅 dev）、`http://localhost:11434`（Ollama 默认端口，留作未来可选 AI），生产 CSP 已收紧到不再含 dev 端口。其余指令保持 `default-src 'self'`、`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`。

CSP / capabilities 调整将随 WP-09B / 09C 插件扩展独立提交，每加一个能力都对应一行 capability 与一段最小 CSP 允许列表。

## 5. 验证命令和真实结果

| 命令 | 真实结果 |
|---|---|
| `rtk npx tsc -b --noEmit` | TypeScript: No errors found |
| `rtk npx vitest run src/platforms/runtimeCapabilities.test.ts src/platforms/desktopComposition.test.ts src/application/runtime/runtimeCapabilities.test.ts` | 17 passed (17) |
| `rtk npx vitest run`（全量） | Test Files 81 passed / 2 skipped (83)；Tests 1010 passed / 2 skipped (1012)；存在既有 React `act()` / SVG NaN 警告，本包未新增相关 canvas 代码。 |
| `rtk npm run build` | ✓ built in 2.20s；`dist/index.html` + assets 正常；既有动态/静态 chunk 与首包约 2.5 MB / 739 kB gzip 警告仍在。 |
| `rtk git diff --check` | 无输出（通过） |
| `cargo check` | PASS；Rust/Cargo 1.97.1，dev profile 无 error/warning。 |
| `npm run build:desktop:unsigned` | PASS；生成 `frontend/src-tauri/target/release/studykit-desktop`。 |
| `tauri build --bundles app` | PASS；生成本地未签名 `target/release/bundle/macos/StudyKit.app`。 |
| 真实桌面窗口 | PASS；1280×820、最小 960×640；默认显示 v0.4 入口，无账号进入 Local Workspace，Study/Research 切换与 System/Light/Dark 切换通过。 |
| 真实冷启动恢复 | PASS；完全退出 `.app` 后重开，直接恢复 Local Workspace、Dark 主题，并显示此前创建的 `WP-09A Host Gate` Research Project。 |

## 6. 未完成项（明确留给后续 Packet）

1. **正式图标资源**—— 当前 `icons/icon.png` 是 32×32 开发占位图；发行前需由正式品牌源生成 PNG/ICO/ICNS 全套资源。
2. **签名 / notarisation**—— 不在本包范围；进入公开分发 Gate 前完成。
3. **Windows/Linux 主机矩阵**—— 本次真实 Host Gate 为 macOS；其他系统由后续 CI/发行 Gate 验证。
4. **Quick Capture / global shortcut / Ollama 探测**—— 全部留作 WP-09B / 09C。
5. **SQLite / native filesystem adapter**—— 留作 WP-09B；本包继续使用 WebView IndexedDB。

## 7. 阻塞与风险

| 风险 | 严重度 | 说明 |
|---|---|---|
| 正式 Icon 未生成 | 中 | 开发占位图已满足编译；不能作为公开安装包品牌资产。 |
| macOS code signing / notarisation | 中 | 公开发布前必须配置；WP-09B 处理。 |
| Windows code signing | 中 | 同上；不在本包范围。 |

## 8. WP-09B 建议输入

1. 在 `capabilities/desktop.json` 下新增 `tauri-plugin-fs`、`tauri-plugin-dialog`、`tauri-plugin-sql`、`tauri-plugin-os`、`tauri-plugin-global-shortcut` 等插件；每加一个 capability，对应 `frontend/src-tauri/capabilities/<feature>.json` 文件，并按需收紧 CSP。
2. 把 `supportsNativeFileSystem` 切到 `true`，并通过 IPC 暴露 workspace 选择 + SQLite 路径解析；与 `StudyKitRepository` / `StudyRepository` / `ResearchRepository` 协调复用现有 Dexie schema 升级。
3. 引入 `tauri-plugin-global-shortcut` 后，把 `supportsGlobalShortcut` 切到 `true` 并接入 Quick Capture 浮层；保留“不默认读剪贴板、不扫用户目录”的本地优先姿态。
4. 增加 `tauri-plugin-os` + Ollama 探测（`http://localhost:11434/api/tags`），并在探测确认后把 `supportsLocalAiDiscovery` 切到 `true`；UI 入口由 settings 页面单独管理。
5. 配置 macOS Developer ID 与 notarisation 后再跑一次 `tauri build` 与真实窗口视觉检查，落到 WP-09B 报告。

## 9. Codex 二次验收结论

Codex 已完成代码、配置、权限和 Web 回归二次验收，并修复以下问题：

1. `beforeDevCommand` / `beforeBuildCommand` 原先在 `src-tauri` 错误目录执行，现通过 hook `cwd: ".."` 指向现有前端。
2. npm 包名改为合法小写名称；不存在的 icon 路径从 bundle 配置移除。
3. capability 从重复且过宽的 `core:default` 集合收紧为 `core:app:default`。
4. Desktop adapter 不再读取 Tauri 私有内部字段；未实际使用的 IPC 与 `serde` 依赖已删除。
5. “模拟重启持久化”不再用 `sessionStorage` 冒充数据持久化，新增生产 Dexie Research Project round-trip。

Host Gate 首轮报告曾在只显示 legacy AuthPage、未验证 Local Workspace/Mode/Project 冷启动的情况下误报 PASS。Codex 拒绝该结论并完成补修：

6. 为 Tauri Desktop Alpha 配置 v0.4 runtime defaults，避免桌面产品启动到旧登录墙。
7. 将 Local Workspace 选择改为跨应用重启持久化，同时保留 flag-off legacy 隔离。
8. 新增 `.gitignore`，排除 `target/`、`node_modules/`、`gen/`；保留 Cargo/npm locks 和必需占位 icon。
9. 真实构建并用 Computer Use 操作 `StudyKit.app`，完成双模式、三主题、本地入口及 Research Project 冷启动恢复。

**最终 Gate 结论：PASS。** WP-09A Desktop Foundation 已完成；正式品牌图标、签名/notarisation、SQLite/native fs、Quick Capture 和本地 AI 进入后续 Packet。

参考命令集合已记录在 `frontend/src-tauri/README.md`。未执行 commit / push / stash / reset / checkout。
