# StudyKit v0.4 WP-11R2 交互逻辑重构报告

日期：2026-08-05  
状态：**自动化与构建 Gate PASS；真实桌面 Gate HOLD（macOS 当前锁屏）**

## 1. 交付结论

本轮已把 StudyKit 从“按内部实体逐页跳转”收敛为连续的学习与研究工作台。没有新增 schema、IPC、router、全局 store、repository、Canvas 或 AI session；所有写入继续经过既有 canonical use case 与 repository。

稳定操作语言现在是 `Add → Capture → Connect → Develop → Share`。Header 统一为 `Add / Capture / Ask`，Sidebar 只保留当前位置与少量工作视图，创建动作进入上下文菜单或页面内动作。

## 2. 已完成的产品改动

### Shared shell

- 新增上下文感知的 Header Add：Study Home 打开 New course；Course 提供 Lecture/material/blank notes 与共享 Canvas；Research Home 打开 New project；Project 提供 Sources、Evidence、details 与 Canvas。
- Capture 只在原生 Workspace 就绪时出现；Ask 在 Study、Research、Reader、Canvas、Output 全局可达，并复用同一个 Intent Capsule session。
- Sidebar 不再永久展示 Discover、Evidence、Design 等内部实体；旧 deep link 仍可解析。
- Add 菜单支持 Escape、点击外部关闭与触发按钮焦点返回。

### Study Mode

- Study Home 改为 Resume 优先，New course 默认收起；Header Add 可直接打开真实创建表单。
- Course Home 提供 `New lecture`、`Import slides or PDF`、`Start blank notes` 三个开始动作。
- New lecture 与 blank notes 都写入真实 Lecture 并进入 Lecture Focus；已有 Lecture 时仍保留 Add，不形成第二次创建死胡同。
- 首个 Lecture 标记为 Resume；Review 只在存在可复习问题时进入主要导航。
- Study Canvas 复用现有 Cognitive Canvas、CanvasUseCasesProvider 与 `addFreeNode`，未复制画布实现。

### Research Mode

- Research Home 改为 Resume 优先，New project 默认收起；Header Add 可直接打开创建表单。
- Project Home 首屏只保留 Focus、Continue、Add、Next 与最近对象；Questions、Hypotheses、Risks、Milestones、Tasks、Outputs、Collaboration 收入 `Project details`。
- Add 面板提供 Sources、Search、Evidence、Canvas、Design、Output；创建 Output 使用既有 canonical use case 后直接打开。
- Discover + Library 组合为 Sources；同一 surface 内可在 Library/Search/Add Sources 间切换。
- Add Sources 的 PDF、Zotero、URL/DOI 都是真实入口；URL/DOI 会创建 canonical Work 与 URL WorkAsset，并立即刷新同一 Library。
- Evidence 无内容时不显示禁用的 Claim/AI Claim 表单，只给出 Add sources / Open source / Capture evidence 的最短动作。

### Canvas

- 空画布直接显示 Add idea、双击与粘贴提示。
- 按钮、背景双击、纯文本粘贴均调用既有 `addFreeNode`，写入同一个 canonical Canvas。
- 无 selection 时隐藏无效 Connector；首个节点创建后空状态消失并进入编辑。

## 3. 主要复用与边界

复用：`AppLocation/locationStore`、`getDataApi()`、Study/Research repositories、canonical use cases、`CanvasUseCasesProvider/addFreeNode`、`IntentCapsuleProvider/openCapsule`、shared UI primitives 与主题 tokens。

未新增数据库表、IPC 命令、依赖、feature flag 或平行数据系统；未触碰用户已有未提交修改，未执行 commit、push、stage、stash、reset、checkout 或 clean。

## 4. 自动化与构建证据

| 验证 | 结果 |
|---|---|
| TypeScript | 0 errors |
| WP-11R2 定向组合测试 | 28/28 passed |
| 完整 Vitest | 400/400 suites；1205 passed / 2 skipped / 0 failed |
| Rust lib tests | 73/73 passed |
| `cargo fmt --check` | 通过 |
| Web production + bundle budget | 通过；入口 176.0 KiB gzip |
| Desktop unsigned build | 通过 |
| macOS `.app` bundle | 通过 |
| 已安装 app ad-hoc 签名校验 | `valid on disk`；满足 Designated Requirement |
| `git diff --check` | 通过 |

构建产物：

- `frontend/src-tauri/target/release/studykit-desktop`
- `frontend/src-tauri/target/release/bundle/macos/StudyKit.app`
- 已覆盖安装 `/Applications/StudyKit.app`

最终安装包标识为 `com.studykit.desktop`、版本 `0.4.0`。覆盖安装曾保留上一包的 `_CodeSignature`；验收发现后已重新执行本机 ad-hoc 签名并通过 `codesign --verify --deep --strict`，未把失效签名留给用户。

Vite 仍报告既有的单 chunk 大于 500 kB 提示，但自动性能 Gate 通过；最大按需编辑器 chunk 不进入首屏预算。

## 5. 未虚报的两项边界

### 5.1 真实桌面 UI Gate

最新安装包已生成并覆盖安装，但本轮最后一次 Computer Use 启动时 macOS 处于锁屏状态，系统明确拒绝读取窗口。因此 Light/Dark、960×640、键盘与真实安装版端到端任务不能在本次会话中声明 PASS。自动组合测试和构建不能代替该项人工证据，Engineering Gate 保持 HOLD。

### 5.2 本地 Source Asset Bridge

Sync Workspace 的 Study PDF 导入复用现有 `sourceDocuments.upload`，可完成 Lecture 创建、上传与打开。Native Workspace 当前 deliberately 不支持该 capability；现有原生层没有 Study source-document/asset 的文件选择、复制与读取 contract。按本包停止条件，不能用 Dexie 临时副本或新增未评审 IPC 绕过。

Research PDF 的既有 `importLocalPdf` 也仍把二进制写入 Web `pdfAssetStore`（IndexedDB）：Work/WorkAsset metadata 可以进入 Desktop SQLite，但 PDF bytes 尚未进入用户 Workspace 的 `assets/originals`，因此不能把它声明为完整的原生备份/恢复闭环。

要使“本地可下载版本”完整满足 Study/Research PDF 导入，下一包应先定义窄的 Native Source Asset ADR，再补原生 file picker、`assets/originals` 原子写入、Study source-document 与 Research WorkAsset metadata、Reader 路径、备份/恢复与迁移测试。其余 blank notes、Lecture、Canvas、Research URL/DOI 与原生 Workspace 路径不依赖该能力。

## 6. Gate 决策与下一动作

- **自动化/构建 Gate：PASS。**
- **WP-11R2 Engineering Gate：HOLD。** 原因仅为锁屏导致真实 UI Gate 无法执行，以及 Native Study/Research PDF asset 需要一个独立、先 ADR 后施工的底层包。
- 下一动作：解锁后对当前已安装 app 完成规范第 8 节真实桌面任务；随后实施 `WP-11R2A Native Source Asset Bridge`，再做一次安装版回归即可关闭 WP-11R2。
