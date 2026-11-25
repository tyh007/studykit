# StudyKit v0.4 — WP-09 最终实施与验收报告

日期：2026-07-30  
结论：**WP-09 Engineering Gate PASS；Public Release Gate 仍受外部签名、跨平台设备与 DMG 发布机约束。**

## 1. 已完成的用户闭环

- Tauri 2 桌面壳、Web/Desktop runtime contract、原生工作区选择与 SQLite v3。
- Study、Research、Canvas 及旧版 Module/Lecture/Literature 数据均由选中的本地工作区承载。
- Dexie → SQLite 迁移先生成 SHA-256 校验的 JSON 快照，再在单一事务中导入；重复执行幂等、碰撞拒绝覆盖、未修改的导入记录可完整回滚。
- 在线 SQLite Backup API 生成可直接用“Open existing”打开的完整工作区快照；包含 manifest、数据库和 originals/derived assets，保留最近 5 份。
- Quick Capture 可从主界面或 `CmdOrCtrl+Shift+Space` 唤起，内容默认 `private + inbox`，不自动读取剪贴板。
- Ollama 仅通过 Rust 固定访问 `127.0.0.1:11434`，自动发现已安装模型并接入 Study/Research 共用 AI Provider Router；不下载模型、不暴露任意 HTTP bridge。
- 首次启动自动建立 AppConfig 根目录；工作区 session dirty marker、WAL 与 integrity check 共同识别非正常退出并安全恢复。
- 正式应用图标、最小 CSP、最小 WebView capability、macOS `.app` 和 release 二进制均已生成。

## 2. 数据安全约束

- 数据迁移不会删除 Dexie 原数据。
- 迁移中任一记录失败，SQLite 导入事务整体回滚。
- 回滚前逐条核对 payload hash；用户已编辑或缺失的记录不会被错误删除。
- 备份拒绝 workspace assets 内的符号链接，避免路径逃逸。
- Local AI、folder picker、SQLite、backup 均由 Rust 侧执行；WebView 未获得 filesystem、dialog、global-shortcut、HTTP 或 shell 权限，仅开放 `core:app` 与接收 Quick Capture 事件所需的 `core:event`。
- 自动更新保持关闭。没有签名密钥和 HTTPS release endpoint 时不植入占位 updater。

## 3. 自动验证

- TypeScript：`tsc -b --noEmit` 通过。
- Vitest：86 files passed / 2 skipped；1053 tests passed / 2 skipped。
- Rust：70 tests passed；覆盖 schema/migration、原子创建、并发状态机、路径安全、backup、Quick Capture、可回滚迁移和首次启动。
- `cargo fmt --check`、`git diff --check` 通过。
- Web production build 通过；既有 bundle-size/dynamic-import 警告未恶化。
- release binary 与 `StudyKit.app` 成功构建。

## 4. 真实 macOS Host Gate

真实 release `.app` 已完成：

1. 全新 AppConfig 首次启动进入 workspace chooser，无错误。
2. 原生 folder picker 打开已有 workspace。
3. SQLite health/integrity 正常，Study 主界面进入成功。
4. 发现 1 条旧 Dexie 记录；迁移完成，迁移前 JSON backup 存在。
5. Quick Capture 保存 1 条 private inbox 记录。
6. 手动 workspace backup 生成可直接打开的 snapshot，snapshot SQLite `integrity_check=ok`。
7. Study ↔ Research Mode 切换和主题切换通过。

测试工作区位于 `/private/tmp/studykit-wp09-gui.yk2cVF`，属于可丢弃的临时验证数据。

## 5. 外部发布 Gate

以下不是代码缺陷，也不应通过假配置绕过：

- macOS Developer ID / notarisation、Windows code-signing、Linux 发布渠道签名。
- Tauri updater 私钥、公钥与 HTTPS release endpoint；官方 updater 要求更新签名，当前 `supportsAutoUpdate=false`。
- Windows、Linux 与干净 macOS 设备上的安装 → 升级 → backup restore 设备矩阵。
- 当前机器的 DMG Finder/hdiutil 美化脚本失败；`.app` 正常。日常 `npm run desktop:bundle` 因此只构建 `.app`，`npm run desktop:dmg` 留给签名发布机。

发布凭据与最终设备矩阵补齐后，才能宣布 Public Release Gate PASS。
