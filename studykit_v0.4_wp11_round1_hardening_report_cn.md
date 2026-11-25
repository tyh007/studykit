# StudyKit v0.4 — WP-11 Round 1 Hardening 报告

> 日期：2026-07-31  
> 状态：**Engineering Gate PASS；External Alpha Gate 待真实用户研究**

## 1. 本轮结论

本轮完成可在当前工程内闭环的 WP-11 项目：首屏与跨 Mode 分包、可执行 bundle budget、10k 原生 Workspace 基准、入口数据位置/AI scope/Draft 控制说明、迁移与恢复回归、真实浏览器 Study/Research/Canvas Gate、Web 与 Desktop 构建。没有增加新业务系统、数据库表、IPC 或 feature flag。

WP-11 不能整体宣布 Public Beta PASS：12–20 名真实学生/研究人员的安装、导入、断网、恢复和多日任务测试，以及 100/500 MB PDF 设备矩阵仍需外部样本和测试资料。

## 2. 性能与加载架构

- `App.tsx` 中 PDF、TipTap Note Editor、文献库、Canvas、Export 全部改为 surface 激活后动态加载。
- Study 的 3 个 surface 与 Research 的 10 个 surface 直接按 route chunk 加载，不再经 feature barrel；Study/Research 不互相拖载重型编辑器。
- 删除 `V04Shell → App` 的无用循环依赖；composition root 改为直接 import。
- 新增 `npm run quality:bundle` / `npm run build:quality`：入口和任一按需 JS chunk 的 gzip 上限均为 300 KiB，超限直接失败。
- 实测入口 **174.4 KiB gzip**；最重按需 NoteEditor **249.1 KiB gzip**；PDF runtime **104.9 KiB gzip**；均通过预算。
- Vite 仍报告两个 raw-minified chunk 超过 500 kB（NoteEditor 834 kB、入口 627 kB）；它们 gzip 达标且 NoteEditor 不在首屏，但 raw parse cost 继续作为 P2 优化项，不通过调高 warning 阈值掩盖。

## 3. 10k 原生 Workspace 基准

`frontend/src-tauri/examples/wp11_large_workspace.rs` 在隔离临时目录创建中文路径 Workspace，写入 10,000 个对象并执行完整 SQLite integrity check。当前机器结果：

| 指标 | 结果 | 预算 |
|---|---:|---:|
| 10k 单事务批量写入 | 48 ms | 记录基线 |
| indexed local query | <1 ms | <300 ms |
| 单对象 durable save | <1 ms | <100 ms |
| warm close + reopen | 19 ms | <2 s |

临时目录由 `tempfile` 自动回收，不触碰用户 Workspace。

## 4. Onboarding、数据位置与 AI 边界

Workspace Entry 在用户进入前明确展示：数据存放位置、本地/Sync 可选关系、AI scope/provider 可见、AI 建议保持 Draft 直到用户接受。Desktop Shell 的 Workspace pill 通过 title 暴露实际 root path。Light/Dark 继续复用语义 tokens，无新增主题分支。

## 5. 真实验证

- TypeScript：0 errors。
- Vitest：**1188 passed / 2 skipped**（新增 4 项）；懒加载相关 Gate test stderr 已消除。
- Rust library：**73 passed**。
- `cargo run --example wp11_large_workspace`：通过上述 10k 性能硬阈值和 integrity check。
- Web `npm run build:quality`：production build + bundle hard gate 通过。
- Desktop unsigned build：成功生成 `frontend/src-tauri/target/release/studykit-desktop`。
- Study browser smoke：Light/Dark、键盘、Review、AI-off Continue without AI、持久化 PASS。
- Research browser smoke：Discovery → 3 Work → Evidence → Claim/relations → AI Draft/provenance → reload、键盘、offline、AI-off PASS；无 console/page error。
- Canvas browser smoke：50 nodes、Light/Dark、keyboard/screen-reader Outline、reload persistence、连续 pan/zoom **110.36 fps**（预算 ≥55）；无 console/page error。
- 修复 smoke harness 两个真实问题：错误使用 `sessionStorage` 保存 local Workspace，以及 server 绑定 `127.0.0.1` 但探测 `localhost/::1`。
- `cargo fmt --check` 与 `git diff --check` 通过。

## 6. 数据安全与迁移结论

WP-09 已实现的 migration preview、备份先行、幂等导入、拒绝回滚用户已编辑记录、snapshot restore、crash recovery 与 SQLite integrity check 保持不变并由 73 项 Rust tests 回归。当前无可复现数据丢失缺陷；本轮没有更改 schema 或 migration。

## 7. 尚未完成的 External Alpha Gate

1. 按计划招募 12–20 名学生/早期研究者，验证 ≥80% Study 主任务与 ≥70% Research 多文献论证任务完成率。
2. 在目标低端设备运行 10/100/500 MB PDF 首屏矩阵；当前只证明 PDF worker 已退出启动包。
3. 在干净 macOS/Windows 设备执行安装、升级、移动 Workspace、权限变化、磁盘满与恢复演练；签名、公证和 updater 属 WP-12。
4. 用 VoiceOver/NVDA 完成正式 screen-reader session；当前已有语义/键盘/Outline 自动与浏览器证据，但不替代人工读屏。
5. 全量 Vitest 仍含既有 Canvas test-environment `act(...)`/无布局几何告警；真实 Canvas smoke 无 console/page error，暂按 test-harness P2 接受，后续单独清理。

## 8. Gate 决策

**WP-11 Engineering Gate：PASS。** 代码、性能、数据安全回归和真实浏览器主路径已满足进入封闭 Alpha 的条件。  
**WP-11 External Alpha / Public Beta Gate：PENDING。** 下一步不是继续扩张功能，而是执行真实用户与设备矩阵，并把结果作为 WP-12 Go/No-go 输入。

未执行 commit / push / stage / stash / reset / checkout / clean。
