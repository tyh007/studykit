# StudyKit v0.4 Master Implementation Plan

> 版本：0.4.0-plan-1  
> 日期：2026-07-20  
> 状态：实施总控文档  
> 目标：以 MiniMax Code 为主实施者，在保证产品质量、数据安全和代码可维护性的前提下，于 10–12 周内完成公开 Beta

## 0. 作用与权威性

本文件把 PRD、Research Mode、AI-native、认知画布、交互、视觉、系统设计、用户研究和既有施工包收束为一条可执行路径，负责确定施工顺序、依赖、交付物、质量门槛、公测 Gate 和 MiniMax Code 的协作方式。

冲突按以下顺序处理：Decision Log 已确认决策 → PRD → 专项规范 → 本计划的实施安排 → 详细施工包 → 路线图。产品原则不因排期而弱化。

## 1. 公开 Beta 产品边界

### 1.1 必须具备

**全局与本地优先**

- Study Mode / Research Mode 同级可达；
- 无账号可使用本地 Workspace，离线完成核心任务；
- Light / Dark / System 运行时切换；
- 可下载桌面版，具备安装、升级、备份、恢复和崩溃恢复路径；
- 云同步、远程 AI 与协作均为用户主动启用的增强能力。

**AI-native**

- AI 可由全局快捷键、选区、对象和局部动作自然召唤；
- 自动理解当前位置和选区，但 scope 对用户可见、可编辑；
- 页面不形成孤立 AI 系统，全部经过统一 AI Interaction Kernel；
- 所有生成或修改先进入 Draft/Preview，可编辑、接受、拒绝和撤销；
- Research 结果保留 locator、source scope 和 provenance；
- AI 关闭、模型不可用或无网络时，本地核心任务仍可用。

**Study Mode**

- Course Home、Lecture Focus、Understand、Review 最小闭环；
- 课堂记录允许自由捕捉，不强迫先结构化；
- 用户先形成自己的解释或回答，再按需获得 AI 反馈；
- Source、Question、Attempt、Feedback、Review 可追踪；
- Study Canvas 支持自由思考，结构按需出现。

**Research Mode**

- Project Home、Discovery、Library、Reader、Evidence/Claim、Canvas、Output；
- 文献搜索、本地 PDF 和 Zotero 导入进入统一 Work identity；
- 选区可保存为带页码/位置的 Evidence；
- Evidence 可支持、限制或反驳 Claim；
- 研究设计决策、Evidence gap、下一步行动和项目状态互相连接；
- 输出引用可回到 Evidence 和原文，并提供 citation audit。

**Research Collaboration**

- 个人本地空间不要求账号或协作；
- 共享项目具备成员、角色、评论、提及、共享任务和活动记录；
- Private Scratch 与 Shared Layer 边界清晰；
- 首轮公开 Beta 承诺可靠异步协作；presence 和实时 Canvas 可标记 Beta；
- 完整离线 CRDT 冲突合并不阻塞首轮公开 Beta。

### 1.2 首轮公开 Beta 不做

- 完整移动端、自动剪贴板监听、捆绑大型本地模型；
- 完整 systematic review protocol 和全部文献数据库覆盖；
- 复杂组织/审批/企业权限和完整多人富文本；
- 未经用户确认的自主研究 Agent；
- 为未来可能性预建的插件平台。

## 2. 实施与代码策略

### 2.1 增量替换，不重写

v0.4 使用受控替换：新能力从明确边界进入，旧功能先通过 adapter 继续可用；纵向闭环验证后，再逐步替换旧内部实现。

1. 不创建第二套长期并存的主题、导航、AI、Canvas 或领域模型；
2. 不一次迁移全部历史数据；migration 必须 additive、可重复、有 fixture 和恢复路径；
3. feature flag 默认关闭，直到对应切片通过 Gate；
4. 一个 Packet 只改变一个可说明、可测试、可回滚的边界；
5. 用户未提交修改不得被覆盖、重置或顺手格式化。

### 2.2 纵向闭环优先

施工单位不是页面数量，而是：

```text
真实输入 → 用户操作 → AI/系统辅助 → 用户判断 → 可保存结果 → 下一步行动
```

不能服务当前闭环、也不是已确认共享边界的能力，不提前建设。

### 2.3 共享内核，Mode 只表达差异

Study 与 Research 共用 Workspace、Source、Locator、Search、Reader、Canvas、Output 基础、AI Context/Action/Draft/Provenance、Repository、主题与基础组件。

Mode 只保留业务差异：

- Study：Course、Lecture、Question、Attempt、Feedback、Review；
- Research：Project、Work、Evidence、Claim、ResearchDecision、Task、Citation。

### 2.4 “最优、最简”的工程标准

“最简”指最低必要复杂度，不是代码行数最少。

- 先复用可靠实现，再扩展，再新增；
- 相同概念只有一个 canonical type 和一个状态真相；
- feature 不直连 Dexie、SQLite、fetch 或 AI provider；
- 页面不能直接调用模型；
- 抽象需要至少两个真实用例证明，单一用例优先局部实现；
- 新依赖必须说明体积、维护成本和退出方案；
- 临时 adapter 必须写明删除条件；
- 不以过早优化换取难读代码，但必须守住交互性能预算。

## 3. 目标架构

```text
App / Feature Flags / Routes
            ↓
Study Features   Research Features   Shared Canvas Views
            ↓             ↓                  ↓
Application Use Cases + AI Interaction Kernel
            ↓
Repository Contracts + Provider Contracts
            ↓
Web: Dexie / IndexedDB       Desktop: Tauri / SQLite + Files
            ↓
Optional Sync / Collaboration Gateway / Cloud AI
```

- `domain/`：纯领域类型和规则；
- `repositories/`：存储 contract；
- `application/`：无 UI 用例；
- `platforms/`：Web、Desktop、AI、Sync adapters；
- `shared/`：无业务知识的 primitives；
- `features/`：Study、Research、Canvas、Assistant 纵向切片；
- `app/`：组合根、路由、feature flags 和 provider wiring。

所有 AI 行为统一经过：

```text
Invocation → ContextResolver → ActionRegistry → PermissionGate
→ ProviderRouter → DraftResult/BackgroundRun → Accept/Edit/Reject/Undo
```

Web 继续使用 Dexie/IndexedDB，通过 Repository 包装；Desktop 使用同一 contract 接入 SQLite/file store。server 只承载用户主动启用的同步、协作和远程能力。不把所有数据塞进 CRDT，只对真正需要实时合并的共享对象使用协作数据结构。

## 4. 时间线

按 AI 主实施、单一产品决策人快速验收估算：

| 周期 | 阶段 | 结果 |
|---|---|---|
| Week 1 | Foundation Gate + Theme | WP-00 通过；主题 runtime/primitives 可用 |
| Week 2 | Local-first Shell | 无账号 Workspace；Study/Research 双入口 |
| Week 3 | AI-native Kernel | Intent Capsule 贯通至少两个表面 |
| Week 4–5 | Study Slice | Study Verified Thought Loop 可完成 |
| Week 5–7 | Research Slice | Discovery/Import → Evidence → Claim 可完成 |
| Week 7–8 | Canvas + Research PM | 自由思考、证据综合、研究设计和行动 |
| Week 8–9 | Collaboration + Desktop | 异步协作；可安装桌面候选版 |
| Week 9–10 | Output/Citation + Cross-mode | 来源可追踪输出与跨 Mode 引用 |
| Week 10–11 | Alpha Hardening | 数据、性能、可访问性、迁移、恢复收敛 |
| Week 12 | Public Beta Gate | 下载、反馈、监测和回滚准备完成 |

目标节点：Week 4 内部可用；Week 6–7 封闭 Alpha；Week 10–11 Release Candidate；Week 12 公开 Beta。若数据恢复或引用正确性 Gate 未过，自动顺延，不以隐藏风险换日期。

## 5. Work Packets

每个 Packet 单独授权、单独实现、单独验收，不得自动进入下一 Packet。

### WP-00：Baseline Guard + Contracts

**当前状态：Gate PASS（2026-07-20）。** 131 项测试通过、2 项既有测试跳过；typecheck、production build 与 `git diff --check` 通过。构建仍存在既有 chunk 过大警告，记录到 WP-02/WP-11 性能工作，不在 WP-00 越界处理。

交付：v0.4 目录边界；Workspace/Mode/Location/Status/Draft contracts；Repository contract/fixtures；三个 feature flags；Architecture 约定。

Gate：新 contract tests、完整 tests、typecheck、build 通过；旧 UI 不变；flags 默认关闭；用户 Canvas 修改未被覆盖。

### WP-01：Theme Runtime + Shared Primitives

依赖 WP-00。交付 ThemeProvider、首屏 bootstrap、持久化/system change；Button、Input、Surface、Pill、IconButton、StatusLabel、VisuallyHidden；语义 tokens；最小设置入口；登录页和一个主表面双主题迁移。

**当前状态：Gate PASS（2026-07-20）。** Light/Dark/System runtime、首屏 bootstrap、共享 primitives、语义状态 tokens、sandbox-safe adapters 与完整 shared import boundary 已实现；182 项测试通过、2 项既有测试跳过，typecheck/build/`git diff --check` 通过。既有首包约 641KB gzip 的警告进入 WP-02/WP-11。

Gate：无刷新切换、无 flash/Canvas 重排；focus/contrast 可用；状态与可访问性测试通过；不机械迁移全部旧组件。

### WP-02：Local-first App Shell

依赖 WP-01。交付 WorkspaceEntry、AppShell、ModeSwitch、ContainerNav；local 无账号进入；Study/Research 同级入口；legacy adapters；位置恢复、offline/sync 状态；WebRepository 对现有 Dexie 的最小包装。

**当前状态：Gate PASS（2026-07-21）。** Local-first App Shell 已形成真实本地闭环：无账号进入本地工作区、Module 通过真实 UI 创建并在重载后保留、local/sync 数据边界和浏览器历史导航已验证；AI、引用、论文批注、Zotero、上传、导出、同步及文献写入等 sync-only 能力均在 UI 操作前自然降级，并由 data gateway 提供第二道零请求保护。231 项测试通过、2 项既有测试跳过，测试无 React warning/AggregateError/ECONNREFUSED；typecheck、production build 与 `git diff --check` 通过。浏览器抽查确认默认入口加载正常、无错误覆盖层或控制台错误，Light/Dark 主题可切换。既有首包过大警告继续进入后续性能工作。

Gate：无账号、断网可进入并恢复；旧页面全部可达；Mode 切换不泄漏 selection；theme、keyboard、reload smoke tests 通过。

### WP-03：AI Interaction Kernel + Intent Capsule

依赖 WP-00/WP-02。交付 ContextResolver、ActionRegistry、PermissionGate、ProviderRouter、AssistantSessionStore；IntentCapsule、ContextChip、ScopeEditor、ActionPreview、DraftResult；全局/选区 invocation；安全本地动作；现有 AI 面板 adapter；完整失败/取消状态。

**当前状态：Gate PASS（2026-07-21）。** AI Interaction Kernel 与 mount-once Universal Intent Capsule 已落地；Lecture、Reader/Canvas 共用同一会话与入口，scope 显示和执行一致，导航、本地搜索及课程笔记均走真实 application/data gateway，AI/写入失败保留 prompt、selection、scope、focus 与 Draft 并支持重试。`v04Assistant` 默认关闭，生产 wiring 仅在 flag 开启时注册并在关闭或卸载时清理；页面无新增 provider 直连。346 项测试通过、2 项既有测试跳过，测试 stderr 为 0；typecheck、production build 与 `git diff --check` 通过。既有动态/静态分块及首包过大警告继续进入 WP-11 性能收敛。

Gate：至少两个表面共用 Capsule；scope 可见可编辑；写入先 Draft；失败不丢 prompt/selection/focus；页面无新增 provider 直连。

### WP-04：Study Vertical Slice

依赖 WP-02/WP-03。打通 `Lecture → 自己解释/作答 → AI Feedback → Review`。交付 Study/Course Home 最小状态、Lecture capture、source locator、Understand、Question/Attempt/Feedback、Review，以及完整异常恢复。

**当前状态：Gate PASS（2026-07-21）。** Study Vertical Slice 已通过真实生产组合接入现有 Lecture/NoteEditor：用户可从 Capture/Understand 自主创建 Question 与 Attempt，可选择请求 AI Feedback Draft、拒绝后继续修改/重试，或在 AI 不可用及离线状态下直接继续，并在 Review 中使用 Recall/Reveal 与自主状态标记。Question、Attempt、Feedback、Recovery 与 SourceLocator 通过 local-first Repository 和 additive Dexie v4 schema 持久化；`v04Study` 默认关闭，关闭时旧界面保持原行为。修订后已修复 Provider/Router 生产挂载、Lecture 入口缺失及 Understand 状态机问题；真实用户事件测试和浏览器 smoke 覆盖 Light/Dark、键盘、AI-off、持久化与恢复。473 项测试通过、2 项既有测试跳过；测试 stderr、typecheck、production build 与 `git diff --check` 通过。既有动态/静态分块和首包过大警告继续进入 WP-11 性能收敛。

Gate：用户无需指导完成 Verified Thought Loop；课堂记录无新增阻断；AI/用户内容边界可解释；最近确认输入可恢复。不做完整 spaced repetition、游戏化或强制计划。

### WP-05：Research Evidence Slice

依赖 WP-02/WP-03。打通 `Project → Discovery/Import → Library → Reader → Evidence → Claim`。交付 Living Brief、QuerySpec、首个 search provider、本地 PDF/Zotero、canonical Work、去重、locator、Evidence/Claim 与多文献比较。

**当前状态：Gate PASS（2026-07-22）。** Research Evidence Slice 已形成真实本地优先闭环：用户可创建研究项目，经 OpenAlex Discovery 或本地 PDF/Zotero 导入形成 canonical Work，在 Reader 中从三篇不同论文保存并验证带完整 locator 的 Evidence，再建立含 `supports / contradicts / qualifies` 关系的 Claim；Claim、Evidence 与原文可双向回链，重载后状态和关系保持。AI Suggest 经统一 ProviderRouter 生成 Draft，并展示真实 provider/model provenance；AI 不可用、离线和 provider timeout 均自然降级且保留选择与上下文。最终修订删除了测试 warning filter、临时全局 seam 和冗余 Reader 状态，修复原生 selection 事件绕过 Testing Library act 及无效 `waitFor`。583 项测试通过、2 项既有测试跳过，测试 stderr 为 0；typecheck、production build 与 `git diff --check` 通过；真实浏览器 smoke 12/12 通过且无 console/page error。既有动态/静态分块和首包过大提示继续进入 WP-11 性能收敛。

Gate：从三篇论文建立带 locator 的 Claim/synthesis；可回到 Evidence/原文；无 locator AI 内容不能成为 confirmed Evidence；失败和去重不丢选择。不做 provider 全覆盖或自动整篇 extraction。

### WP-06：Cognitive Canvas Adapter

依赖 WP-03/04/05。交付 object placement adapter、free node 渐进升级、认知角色/语义关系、AI cluster/layout preview、Diverge/Converge、Focus 与 list/outline alternative，并最小适配现有 Canvas engine。

**当前状态：Gate PASS（2026-07-23）。** 实修后 Outline UI round-trip 真实通过，**109.46 fps**（Round 9 浏览器烟雾 50 节点）。643 项测试通过、2 项既有测试跳过，typecheck、production build 与 `git diff --check` 通过；真实浏览器烟雾覆盖 Light/Dark/重载/Outline 键盘与 tree round-trip/无 console error。AI 走统一 Action Registry 与 Draft Layer，三类 canvas AI 动作在 AI-off 状态下保留 selection + 手工操作、不写 canonical。Dexie v6 表为可加迁移。

Gate：Canvas 不成为数据真相或强制入口；AI 不静默移动 canonical state；50 visible nodes 达性能预算；outline 支持键盘/屏幕阅读器；安全合并用户现有 Canvas 修改。

### WP-07：Research Design + Project Management

依赖 WP-05。交付 ResearchQuestion、Hypothesis、MethodDecision、Risk、Milestone、Task；版本化设计决策；Task 关联 Claim/Evidence gap/Output/Decision；Project Home 显示阻塞、下一步和近期决策；AI 只建议、不管理。

**当前状态：Gate PASS（2026-07-24）。** 真实生产组合下，ResearchQuestion、Hypothesis、Risk、Milestone、Task 全部可建、可修订、可完成；MethodDecision 走 chainId+supersedes 链式模型；版本化决策可重开/追源；Task 必填 `why` + `definitionOfDone`，完成需 `completionRef`，依赖有循环检查；Project Home 渲染阻塞、下一步、近期决策、Design Decision chip 与回跳。AI 仅通过 Draft Layer 建议任务，suggest 需用户在 IntentCapsule 中显式 Accept。`v04Research` 默认关闭，旧界面在 flag 关闭时行为不变。Round 5 删除手写 `await act()` 包装、清理 silent try/catch、测试 stderr 为 0 字节；专项测试 4/4、Research/Dexie 72/72、全量 710 passed / 2 skipped；typecheck、production build、`git diff --check` 通过；真实浏览器烟雾覆盖 Light/Dark/Research Design 主路径/重载持久化/无 console warning 与 error。Canvas 脏文件未触碰；没跑 `git commit` / `push` / `stash` / `reset` / `checkout`。

Gate：用户能解释任务为什么存在和依赖什么；建议可忽略/关闭，不表现为老师式计划；历史与离线状态可靠。

### WP-08：Collaboration Foundation

依赖 WP-02/05/07。交付 memberships/roles、comments、mentions、shared tasks、activity、Private Scratch 发布预览、共享 scope、presence/realtime spike 和冲突提示。

**当前状态：Gate PASS（2026-07-28）。** Round 3 已接入 JWT 保护的生产协作 API 与 Postgres schema；项目创建和唯一 Owner membership 原子提交，邀请/改角色/移除均由服务端复查 Owner 权限，非成员全部 403。Research Home 可从服务端发现受邀项目；Shared Task 的 Activity 与 Outbox 同事务持久化，受派人必须是成员；canonical Activity 禁止 AI 冒充。严格 A/B/C 浏览器验收通过：A/B 发现同一项目、UI 精确两名成员且角色正确、C 被隔离、跨用户 Activity/Push/Pull 可见、Light/Dark 可达、0 console/page error。前端 992 passed / 2 skipped，后端 31/31，typecheck、production build、`git diff --check` 通过。详见 `studykit_v0.4_wp08_round3_report_cn.md`。

Gate：角色权限完整；Private 不因邀请自动共享；重连后异步内容不丢失；实时失败时异步协作仍可用。

### WP-09：Desktop Runtime + Quick Capture

技术 spike 依赖 WP-00/02，产品化依赖 WP-04/05。交付 Tauri shell、共享 Repository contract、本地 store、workspace chooser、global hotkey、Quick Capture Inbox、Ollama detection、安装/签名/更新/备份/恢复/migration/crash recovery。

Gate：无账号/断网完成两条核心任务；Web/Desktop contract fixtures 一致；干净设备可恢复 snapshot；不自动读剪贴板、不捆绑模型；目标 OS 安装升级恢复通过。

### WP-09A：Desktop Foundation（基座，本轮）

依赖 WP-00/02。交付 Tauri 2 桌面 shell 加载现有 Vite 构建、`RuntimeCapabilities` contract、Web/Desktop adapter 统一选择点、最小 capability allowlist 与本地工作区重启持久化在 desktop runtime 下的 composition 测试。**不**实现 SQLite 迁移、Quick Capture、global hotkey、Ollama 探测、自动更新、签名 / notarisation；这些留作 WP-09B / 09C。

**当前状态：Gate PASS（2026-07-28）**。Runtime contract、Web/Desktop adapter、最小 Tauri shell 与桌面 Alpha v0.4 composition 已落地；`cargo check`、unsigned binary、未签名 macOS `.app`、typecheck、production build、全量 1010 passed / 2 skipped 均通过。真实 `StudyKit.app` 已验证无账号 Local Workspace、Study/Research 切换、System/Light/Dark 切换，以及完全退出/重启后 Local Workspace、主题和 Research Project 同时恢复。正式图标、签名/notarisation、SQLite/native fs、Quick Capture 与本地 AI 留给 WP-09B/09C。详见 `studykit_v0.4_wp09a_desktop_foundation_report_cn.md`。

### WP-09B Round 1：Native Workspace + SQLite Foundation

依赖 WP-00/02/09A。交付 native workspace 格式、`workspace.json` schema v1、SQLite v1 schema + 幂等 migration、`PRAGMA integrity_check`、窄 IPC 命令集（folder picker + workspace open/close/health + knowledge object CRUD）、`StudyKitRepository` contract 的桌面 SQLite adapter、最小 WebView capability allowlist（仅 `core:app:default`）。**不**实现 Dexie 数据迁移、CRDT 同步、Quick Capture、global shortcut、Ollama 探测、自动更新、签名/notarisation；这些留作 WP-09B Round 2 / 09C。SQL 接入选择：`rusqlite` 直接在自有 Rust 命令里管理 SQLite 文件；原生 folder picker 由 Rust 内部调用 `tauri-plugin-dialog`，不向 WebView 暴露 dialog 权限。

**当前状态：Codex Gate PASS（2026-07-30）**。最终修正覆盖真实 Tauri IPC、单一类型化 `WorkspaceClient`、严格 RFC 3339/对象验证、`Closed → Opening → Open` RAII 状态机、创建失败完全回滚和 Repository 单次绑定生命周期。Rust 59 passed；前端全量 1037 passed / 2 skipped；typecheck、production build、unsigned desktop build、格式和 diff 检查均通过。Round 1 只提供可靠的 native storage 基础，不在未打开 Workspace 时宣称能力。详见 `studykit_v0.4_wp09b_round1_correction_gate_report_cn.md`。

### WP-09B Round 2A：Desktop Workspace Composition

依赖 WP-09B Round 1。把原生 Workspace 接入 v0.4 composition root：桌面冷启动恢复最近 Workspace；无记录时显示 Create/Open chooser；创建、打开、取消、损坏、切换和关闭失败均有明确状态；进入成功后绑定单一 SQLite Repository，并仅在 Desktop runtime 宣告 native file-system 能力。Web 登录与 Local Workspace 流程保持不变。

**当前状态：Codex 自动化 Gate PASS（2026-07-30）**。Desktop Workspace controller、原生 chooser、恢复/切换流程、Header 状态和能力边界已接入。定向 41 passed；全量 1047 passed / 2 skipped；Rust 59 passed；typecheck、production build、unsigned desktop build 与 diff 检查均通过。为避免隐式迁移和数据风险，现有 Study/Research/Canvas 业务库仍保留在本地应用存储；把业务 Repository 切换到 SQLite 与 Dexie 迁移明确留给 Round 2B。详见 `studykit_v0.4_wp09b_round2a_desktop_composition_report_cn.md`。

### WP-09B Round 2B1：Native Domain Repositories

依赖 WP-09B Round 2A。增加 SQLite schema v2 `domain_records`，用 `(namespace, entity_type, id)` 复合主键无损保存强类型领域对象；新增窄 IPC 读与事务接口；实现 Desktop Study、Research、Canvas Repository，并由 v0.4 composition root 在 Desktop runtime 自动选择，Web runtime 继续使用 Dexie。一次前端 `transact` 对应一次 IPC 和一次 SQLite transaction；失败时内存视图与磁盘同时保持未提交状态。

**当前状态：Codex Gate PASS（2026-07-30）**。SQLite v1→v2 增量升级保留既有 `knowledge_objects`；Rust 对 namespace/entity type、ID、JSON object、payload ID、RFC 3339 和大小做边界校验。前端全量 1053 passed / 2 skipped；Rust 62 passed；typecheck、production build、unsigned desktop build、Rust format 与 diff 检查通过。旧 Dexie 数据未自动迁移或删除；带 snapshot、hash、journal、校验和回滚的显式迁移属于 Round 2B2。详见 `studykit_v0.4_wp09b_round2b1_native_domain_repositories_report_cn.md`。

### WP-10：Output, Citation Audit + Cross-mode

依赖 WP-04/05/07。交付 evidence-backed outline、citation insertion/style/export、sentence/claim → Evidence → Work locator chain、证据缺失/冲突 audit、Study↔Research 跨 Mode 引用和 export snapshot。

Gate：citation 与 evidence support 明确区分；Output 可回到原文；至少一条内容跨 Mode 引用而非复制；不可核验时失败，不生成伪造 citation。

### WP-11：Quality, Migration + Alpha Hardening

依赖公测范围全部 Packet。交付旧数据 migration/只读导入、large workspace benchmark、性能/可访问性/i18n、consent、onboarding、数据位置和 AI scope 说明、rollback rehearsal。

Gate：0 个可复现数据丢失；主要性能预算达标；P0 flows 在双主题、在线/离线、AI on/off 下通过；Alpha 任务测试过线；P0/P1 风险关闭或有明确接受记录。

### WP-12：Public Beta Release

依赖 WP-11。交付下载页、签名安装包/checksum、版本/隐私/数据说明、in-app feedback/诊断、known issues、支持/事故流程、回滚 flags 和下一阶段研究 backlog。

## 6. 依赖与并行

```text
WP-00 → WP-01 → WP-02 → WP-03
                    ├→ WP-04 Study ────────────────┐
                    └→ WP-05 Research → WP-07 ─────┤
                              └→ WP-06 Canvas       ├→ WP-10
                                   └→ WP-08 Collab  │
WP-02 ─────────────────────────────→ WP-09 Desktop ─┤
                                                    ↓
                                                WP-11 → WP-12
```

WP-04 与 WP-05 在共享 contracts 冻结后可并行；WP-09 spike 可在 WP-03～05 期间进行；用户研究和视觉 QA 贯穿实施。

以下高冲突区域同一时间只允许一个 Packet 修改：`App.tsx`/全局 store/routes、Dexie migration、AI provider routing、Canvas state/CSS、canonical Work/Evidence/Claim types、theme root tokens。

## 7. MiniMax Code 执行协议

### 7.1 分工与低 Token 方式

MiniMax 负责实现、测试、构建、局部重构和短报告；产品/架构 Gate 负责范围、决策、关键 UX、架构和发布判断。

每个 Packet 默认只有两次主要交互：派发与验收，不持续读取 MiniMax 的思考过程。MiniMax 每次只读：本计划当前 Packet、Decision Log 相关决策、任务指定的 1–3 份专项规范，以及直接影响的代码/tests/tokens，不重复读取全部 v0.4 文档。

### 7.2 固定开工指令

```text
你是 StudyKit v0.4 的主实施工程师。只执行当前授权的 Work Packet。

先读 Master Implementation Plan 当前 Packet、Decision Log 相关决策、任务指定的专项规范，
再检查直接相关的现有代码、tests 和 tokens。开始前运行 git status --short，保护全部用户
未提交修改；不得 reset、checkout、删除、覆盖、格式化无关文件，也不得 stage/commit/push。

增量重构，不重写；先复用后新增；一个概念一个状态真相；不建立第二套系统；不为未来
可能性提前抽象；页面不直连 AI provider；AI 写入必须经过 Draft/Preview；无账号、无网络、
无 AI 时核心路径仍可用；Light/Dark/System 都是一等主题。

先用不超过 12 行说明范围、重叠文件、复用点、最小方案和验证项，然后直接实施。
完成后运行相关 tests、完整 frontend tests、typecheck/build；涉及 backend 时运行 backend tests；
检查 git diff --check 和 git status。只输出不超过 30 行的完成报告，然后停止。
```

报告格式：Packet、PASS/PARTIAL/BLOCKED、完成内容、复用/删除内容、修改文件、数据/migration、测试、主题/键盘/离线、性能影响、遗留问题、最终 git status。

### 7.3 Stop Conditions

- 需要覆盖用户未提交修改或 destructive migration；
- 需要真实 API key、上传资料或扩大远程 AI scope；
- 需要新增 router、CRDT、数据库或重量级依赖且无 ADR；
- 基线测试失败且无法证明与当前 Packet 无关；
- 需要修改 Packet 外的 canonical model；
- 无法满足 provenance、数据安全或 Private/Shared 边界；
- 为赶时间只能复制现有系统形成第二套实现。

## 8. Go / No-go Dashboard

**Study Alpha**：≥80% 用户无需帮助完成 source → attempt → feedback → review；课堂记录无新增阻断；0 数据丢失；用户能解释 AI 与自己内容区别。

**Research Alpha**：≥80% 保存带 locator Evidence；≥70% 从多篇论文形成 Claim + support + limitation；可回到原文；无 locator 摘要不能伪装 Evidence。

**Collaboration Beta**：Private/Shared 无误解；异步协作可靠；断网重连不丢失；AI 不读取未授权 private scope；实时失败不损坏 canonical content。

**Desktop Beta**：目标 OS 安装、升级、备份、恢复、rollback 通过；无账号/断网任务完成率与联网一致；snapshot 可在干净设备恢复；用户理解文件位置和 AI scope。

公开 Beta 只有在 Study、Research、Desktop Gate 全部通过，Collaboration 基础通过，P0=0，引用/隐私/数据无 P1，旧数据有迁移/只读路径，并完成真实用户任务测试后才发布。

## 9. 每个 Packet 的统一质量 Gate

**体验**：主路径真实可操作；loading/empty/offline/error/permission/recovery 完整；自由可跳过；AI 不静默决定；scope/Draft/provenance/Private-Shared 可见；刷新重启能恢复。

**代码**：无重复组件/store/type；无新增页面直连数据库/API/AI provider；无 magic boolean/theme branch/硬编码业务状态；无无使用者通用框架；无无解释 `any` 或静默 catch；public contract 有 tests；临时 adapter 有删除条件；`git diff --check` 通过。

**验证**：相关 tests → 完整 frontend tests → typecheck/build；涉及 backend、migration、AI、协作分别补齐对应验证；有 UI 必须检查真实 Light/Dark、keyboard；存储必须检查重启/断网/恢复。

**性能预算**：Desktop cold start ≤2.5s；Lecture Focus P75 ≤1.2s；第一笔输入 P95 ≤50ms；Canvas 50 visible nodes ≥55fps；autosave 不阻塞；Web 必要 JS gzip 目标 <300KB（不含按需 PDF worker）。

## 10. 用户研究同步

- Alpha 前：6–8 次 artifact walkthrough、IA tree test、当前工具组合任务基线；
- Study 后：5–7 天 diary pilot，观察 capture、独立作答、AI feedback、Review；
- Research 后：用三篇真实论文测试 Discovery、Evidence、Claim、citation trace；
- Beta 前：12–20 名学生/早期研究者完成真实安装、导入、断网、恢复和多日任务；协作用两人项目测试；
- 指标只服务 Go/No-go 决策，不采集无决策用途的 telemetry。

## 11. 当前状态与立即动作

截至 2026-07-24：产品与专项规范 Ready；WP-00～WP-07 Gate 全部通过但仍是未提交工作区变更；用户 CanvasToolbar、canvas CSS 和 horizontal scroller 修改必须继续保护；下一实施位置为 WP-08 Collaboration Foundation。

立即顺序：

1. 已通过 Gate 的 WP-00～WP-07 作为独立可审查变更保存；
2. WP-08 Collaboration Foundation 范围严格限定在 membership/role、comments/mentions/shared tasks/activity、private scratch publish preview、shared scope、presence/realtime spike + 异步回退、冲突检测非破坏性提示、AI 上下文读取 + 用户确认门槛、Research Project Home 自然融入；不进入 WP-09 Desktop、WP-10 Output/Citation、WP-11 Hardening；
3. 每周只根据 Gate 调整顺序，不在施工中扩张 Beta 范围。

本计划已经开始执行；当前实施位置为 WP-00 PASS → WP-01 PASS → WP-02 PASS → WP-03 PASS → WP-04 PASS → WP-05 PASS → WP-06 PASS → WP-07 PASS。下一实施位置为 WP-08 Collaboration Foundation。
# WP-09 最终收口（2026-07-30）

WP-09 Engineering Gate 已 PASS：原生 workspace + SQLite、Dexie 可回滚迁移、完整 snapshot backup/restore、Quick Capture/global shortcut、固定 loopback Ollama discovery、崩溃恢复、正式图标与 macOS `.app` 已接入并通过自动测试及真实 Host Gate。

Public Release Gate 独立保留：平台签名/公证、Tauri updater 密钥与 endpoint、Windows/Linux/干净 macOS 设备矩阵，以及签名发布机上的 DMG。详见 `studykit_v0.4_wp09_final_report_cn.md`。

# WP-10 Round 1 — Evidence-backed Output（2026-07-31，Gate PASS）

WP-10 Round 1 已完成 Codex 二次验收并通过 Engineering Gate。范围严格限定在 Evidence-backed Output 纵向闭环（Project → Output → Section → Statement → 支持 → audit → AI context selection → editable Draft → Accept/Reject → reload persistence）。二次验收修正了 AI context 被误当作 support、Accept 不重新核验、真实 UI 无选择入口、重复 reorder、Dexie 跨 transaction 重复 Support、AI order 占位和 Statement 低透明度问题。无新平行系统、无新 SQLite 表、无新 IPC 命令、无新 feature flag。最终验证：TypeScript 0 错误、Vitest 1162 passed / 2 skipped、Rust 73 passed、vite build / cargo check / desktop unsigned build / `git diff --check` 全部通过。详见 `studykit_v0.4_wp10_round1_evidence_backed_output_report_cn.md` 第 11 节。

明确**不做**：CitationItem / CSL / Crossref / Retraction Watch、APA/MLA/Chicago 渲染、BibTeX/RIS/CSL-JSON/DOCX/PDF/LaTeX export、Study↔Research cross-mode、real-time collab Output 编辑、Word/Google Docs 插件、auto-generated references / fake DOIs / model-hallucinated literature。这些属于 WP-10 Round 2/3。

# WP-10 Round 2 — Citation Foundation（2026-07-31，Gate PASS）

WP-10 Round 2 已完成 canonical Work citation 的本地优先基础：Statement 可插入/移除项目内 Work 引用，citation identity 与 Evidence entailment 分层审计，Web Dexie v11 与 Desktop SQLite `domain_records` 保持 parity，并支持确定性 citekey、Pandoc Markdown 与 CSL-JSON 导出。没有新增平行 CitationRepository、IPC 命令或远程依赖。最终验证：TypeScript 0 错误、定向 53 passed、Vitest 1174 passed / 2 skipped、Rust 73 passed、Web production build、desktop unsigned build 与 `git diff --check` 全部通过。详见 `studykit_v0.4_wp10_round2_citation_foundation_report_cn.md`。

Round 3 仅继续做 metadata/integrity live verification、citeproc styles 和 richer export；Crossref/OpenAlex/Retraction Watch 网络接入必须可关闭且不影响离线主路径，AI 不得直接写 canonical citation。

# WP-10 Round 3 — Verification & Formatting（2026-07-31，Gate PASS）

WP-10 Round 3 已完成用户主动触发的 Crossref/OpenAlex 并行核验、metadata 差异预览与逐字段确认、Crossref update/retraction 状态映射、stale preview 并发保护，以及 APA 7 / MLA 9 / Chicago author-date 的离线 CSL 渲染和 BibTeX/RIS 导出。Citation processor 与样式动态加载；离线 Output/Citation 主路径不依赖网络。无新表、无新 IPC、无后台扫描、无 AI canonical write。最终验证：TypeScript 0 错误、Vitest 1184 passed / 2 skipped、Rust 73 passed、Web production build、desktop unsigned build 与 `git diff --check` 通过。详见 `studykit_v0.4_wp10_round3_verification_formatting_report_cn.md`。

WP-10 至此收口。下一实施位置为 WP-11 Hardening / Beta Gate，不继续扩张 citation 功能面。

# WP-11 Round 1 — Quality, Migration + Alpha Hardening（2026-07-31）

WP-11 Engineering Gate 已 PASS：Study/Research/PDF/Canvas/Output surface 已形成独立动态 chunk，入口 174.4 KiB gzip、最大按需 chunk 249.1 KiB gzip，并新增 300 KiB 自动硬门；原生 10k Workspace 实测 indexed query <1 ms、durable save <1 ms、warm reopen 19 ms；Study、Research、Canvas 真实浏览器在双主题、键盘、离线/AI-off、持久化与 Canvas 110.36 fps 路径通过。TypeScript 0 errors、Vitest 1188 passed / 2 skipped、Rust 73 passed，Web quality build 与 Desktop unsigned build 均通过。入口已明确数据位置、AI scope/provider 和 Draft 控制。

External Alpha Gate 不虚报完成：仍需 12–20 名真实用户任务测试、10/100/500 MB PDF 目标设备矩阵、人工读屏和干净设备安装/升级/恢复演练。下一实施动作是封闭 Alpha 与设备矩阵，不扩张功能面。详见 `studykit_v0.4_wp11_round1_hardening_report_cn.md`。

WP-11 Round 2 已将 External Alpha 转为可执行测试包：冻结 12–16 人样本结构、Study/Research/Desktop/恢复任务卡、独立 consent、无正文记录模板、P0/P1 停测规则、10/100/500 MB PDF 与 VoiceOver/NVDA/设备矩阵。当前 Web 默认仍进入 legacy auth，因此封闭 Alpha 邀请只允许指向 Desktop build，避免把错误入口的结果混入产品判断。详见 `studykit_v0.4_wp11_alpha_test_kit_cn.md` 与 `frontend/docs/wp11-alpha-audit/audit.md`。

# WP-11R1 — Product Shell Convergence（2026-07-31，Gate PASS）

WP-11R0 真实桌面审计发现的双应用组合已修复：生产环境只渲染一个 v0.4 active surface，Study/Research 使用单一 AppLocation 导航事实和各自的 mode-aware sidebar，完整 legacy body 不再常驻；仅 Study Lecture 保留窄兼容叶并在进入前同步选择上下文。URL hash 可完整恢复 surfaceId/params。TypeScript 0 errors、Vitest 1193 passed / 2 skipped、Rust 73 passed、Web build、macOS `.app` bundle、签名校验与 diff 检查通过；新构建已覆盖安装并在真实 Dark/Light 桌面界面完成 Study Home、Research Home、Project 与 Library 验收。下一实施位置为 WP-11R2 Study Mode 收敛。详见 `studykit_v0.4_wp11r1_product_convergence_report_cn.md`。

# WP-11R2 — Interaction Logic Reconstruction（2026-08-01，READY）

真实桌面 10 步审计确认：当前系统虽已收敛为单一 Shell，但仍以 Course/Library/Evidence/Design/Canvas 等内部实体驱动用户跳页，存在 Course 创建 Lecture 死胡同、Project Home 数据库化过载、Sources/Evidence/Canvas 断裂、空画布不可发现和 AI 非全局可达等问题。

本轮不增加功能或 canonical model，改为围绕 `Add → Capture → Connect → Develop → Share` 重组现有能力：修复 Study 开始/恢复路径；将 Research 首屏收敛为 Focus/Continue/Add/Next/Recent；把 Discover + Library 组合为 Sources；Evidence/Design/Task/Output 改为就地 Capture/Develop 入口；让 Canvas 直接暴露已有 addFreeNode；让现有 Intent Capsule 成为所有 surface 的统一 Ask。禁止新增 schema、IPC、router、store、repository、Canvas 或 AI 平行系统。

施工规范见 `studykit_v0.4_wp11r2_interaction_reconstruction_spec_cn.md`；一次性 Claude Code + MiniMax 指令见 `WP11R2_CLAUDE_MINIMAX_EXECUTION_PROMPT.md`。实施完成后由 Codex 做代码、自动测试和真实桌面二次验收，执行工程师不得自行宣布 Gate PASS。

# WP-11R2 实施收口（2026-08-05，AUTOMATED PASS / ENGINEERING HOLD）

交互重构已完成：Header 使用上下文感知的 Add/Capture/Ask；Study Home/Course Home 恢复 Resume 与三种开始路径；Research Home/Project Home 收敛为 Focus/Continue/Add/Next/Recent；Discover + Library 合并为 Sources；URL/DOI 为真实 canonical 写入；Study/Research 共用既有 Cognitive Canvas；Project 的 Questions/Hypotheses/Risks/Milestones/Tasks/Outputs/Collaboration 进入按需展开的 Project details。未新增 schema、IPC、router、store、repository、Canvas 或 AI session。

自动验证：TypeScript 0 errors；Vitest 400/400 suites、1205 passed / 2 skipped；Rust 73/73；Web quality build、176.0 KiB gzip 入口预算、desktop unsigned build、macOS `.app` bundle 与 `git diff --check` 均通过。新构建已覆盖安装 `/Applications/StudyKit.app`，并在替换旧签名后通过本机 ad-hoc `codesign --verify --deep --strict`。

Engineering Gate 暂不宣布 PASS：macOS 锁屏阻止最后的真实 UI 自动走查；Native Workspace 尚无统一 source asset bridge，Study source document 不能导入，Research PDF bytes 仍停留在 Web IndexedDB 而非 Workspace `assets/originals`，不能用临时平行存储伪装成原生闭环。详见 `studykit_v0.4_wp11r2_interaction_reconstruction_report_cn.md`。下一施工包为窄范围 `WP-11R2A Native Source Asset Bridge`，完成 ADR、原生文件/资产 contract、备份恢复与安装版回归后再关闭 WP-11R2。

# WP-11R2A Native Source Asset Bridge（2026-08-08，Engineering Gate PASS）

Rust-owned PDF bridge 已统一 Study/Research 的原生资产路径：系统 picker、50 MiB/PDF header 校验、SHA-256 流式复制、temp→originals 原子 rename、严格 asset ID/path/symlink 边界与 metadata 失败 discard。Study 复用 legacy `SourceDocument/SourcePage` domain records，Research 复用 canonical `Work/WorkAsset`；WebView 不接触任意文件路径，未新增平行 repository/store/schema 或广泛 capability。

TypeScript 0 errors；Vitest 1210 passed / 2 skipped；Rust 79 passed；Web build、desktop unsigned build、macOS `.app` bundle 与 `git diff --check` 通过。新 bundle 已覆盖安装 `/Applications/StudyKit.app`。真实窗口完成 Study 与 Research 原生 PDF 导入/阅读、重启恢复、Dark/Light-System 主题及 Backup SHA-256 一致性验证；验收中发现并修复 Tauri `blob:` URL 读取失败，最终由 PDF.js 直接消费 native bytes。WP-11R2 的 Engineering HOLD 解除并更新为 PASS。详见 `studykit_v0.4_wp11r2a_native_source_asset_bridge_report_cn.md`。

下一阶段：使用已安装 Desktop build 执行 WP-11 External Alpha 12–16 人任务测试；不继续扩展新功能面，先按 P0/P1 规则验证交互理解、Study/Research 完成率、数据信任与恢复能力。
