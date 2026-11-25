# StudyKit v0.4 — WP-11R2A Native Source Asset Bridge 实施报告

日期：2026-08-08  
状态：**ENGINEERING GATE PASS**

## 1. 结果

WP-11R2 的最后一个原生闭环缺口已关闭。已安装桌面版现在可在 Study 与 Research 中使用系统文件选择器导入 PDF，原文件统一进入用户 Workspace 的 `assets/originals`，Study 的 `SourceDocument/SourcePage` 与 Research 的 canonical `Work/WorkAsset` 分别写入既有 SQLite domain records。应用重启后，两种模式都能恢复并继续阅读；原生备份会包含这些 PDF。

未新增第二套资产数据库、repository、router、store 或广泛文件系统权限。WebView 不接收也不提交任意本机路径。

## 2. 架构与安全边界

- ADR：`frontend/docs/adr/ADR-002-native-source-asset-bridge.md`。
- Rust IPC：`choose_and_import_pdf_asset_v1`、`read_workspace_asset_v1`、`discard_workspace_asset_v1`。
- 文件约束：仅普通 `.pdf`，校验 `%PDF-` 文件头，最大 50 MiB；Rust 生成 UUID 资产 ID，并在流式复制时计算 SHA-256。
- 写入方式：`assets/temp/<id>.part` → flush/sync → 原子 rename 到 `assets/originals/<id>.pdf`。
- 读取/删除：只接受生成格式的 asset ID；重新校验 canonical workspace/asset directory、regular file 与 symlink 边界。
- 一致性：先原子复制资产，再提交 canonical metadata；metadata 失败时精确 discard。崩溃最多留下安全 orphan，不会留下指向半文件的 canonical record。
- Tauri capability 与 CSP 未放宽；folder/file picker 仍由 Rust 调用。

## 3. 产品接入

### Study Mode

Course Home 在 Native Workspace 中直接显示 `Import PDF`。成功后一次操作完成：选择文件、创建 Lecture、检测 PDF 页数/尺寸、原子写入 `SourceDocument + SourcePage[]`、设置 `active_source_document_id` 并进入 Lecture。任一步失败都会删除元数据、临时 Lecture 与刚复制的资产。

Legacy Lecture leaf 通过本地 asset bytes 交给 PDF.js，不再尝试 `/uploads/...` 网络路径。

### Research Mode

Library 与 Reader 的 `Import PDF` 使用同一 native bridge。导入后的 asset ID 直接成为 canonical `WorkAsset.id/ref`；失败时 discard。Reader 通过原始 bytes/Blob 加载 PDF，Web 模式继续使用既有 IndexedDB path，未改变 sync 行为。

### 真实缺陷与修正

第一次安装验收发现 Tauri WebView 对 `blob:tauri://localhost/...` 返回 `Unexpected server response (0)`。根因不是资产缺失，而是 PDF.js URL fetch 路径与 WebView 协议组合不可靠。最终修正为原生 bridge 返回 bytes，Reader 使用 `{ data: Uint8Array }` 加载；重新构建、覆盖安装后 Study 与 Research 均成功渲染同一 PDF。

## 4. 验证证据

- TypeScript：0 errors。
- Vitest：98 files passed / 2 skipped；1210 passed / 2 skipped。
- Rust：79 passed；`cargo fmt --check` 通过。
- Web production build：通过；仅保留既有 chunk-size warning。
- Desktop unsigned build：通过。
- macOS `.app` bundle：通过；已覆盖安装 `/Applications/StudyKit.app`，安装二进制 SHA-256 与新 bundle 完全一致。
- `git diff --check`：通过。

真实安装版 Gate 使用 `/Users/hengx/Library/Caches/studykit-wp09b-final`：

1. Study 创建课程并经原生 picker 导入 PDF；Lecture 显示 `1 / 1`，页面渲染成功。
2. Research 创建项目，在 Sources 导入同一 PDF；canonical Work 出现在 Library，Reader 显示 `1 / 1` 并渲染成功。
3. 退出并重启应用后，Study 的 `Open most recent lecture` 与 Research 的 `Continue reading` 均保留。
4. Dark、Light/System 两种主题下 Reader 布局与 PDF 可读。
5. 点击 Backup 生成 `snapshot-20260808-080211-092`；两个原生 PDF 均进入 snapshot 的 `assets/originals`，与源文件 SHA-256 完全一致。

## 5. 范围与后续

WP-11R2A 仅关闭原生 PDF 资产与备份闭环。未加入 PPT/图片/音频、云同步二进制、orphan GC、流式自定义 protocol、签名/notarisation 或 Alpha 用户研究结果。大文件 streaming 与 orphan maintenance 可在后续 hardening packet 单独处理，不需要改变当前 canonical asset ID。

据此，WP-11R2 的原生 source 阻塞项已解除，Engineering Gate 可由 HOLD 更新为 PASS。下一阶段回到 External Alpha：以已安装 Desktop build 执行 12–16 人任务测试，并依据 P0/P1 停测规则决定 Beta Gate。
