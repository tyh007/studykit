# StudyKit v0.4 实现就绪与 Minimax Code 施工包

> 总体施工顺序、WP-09～WP-12、公测 Gate 和最新低 Token 执行协议见
> [Master Implementation Plan](./studykit_v0.4_master_implementation_plan_cn.md)。本文件保留 WP-00～WP-08 的详细边界；发生执行顺序冲突时，以 Master Plan 为准。

> 版本：0.4.0-draft  
> 日期：2026-07-20  
> 当前状态：准备就绪；尚未授权开始修改产品代码  
> 目标：让 Minimax Code 以小步、可验证、可回滚的方式实施 v0.4，而不是进行一次大爆炸重写。

---

## 0. 开工结论

产品方向、交互流程、双主题视觉基线、系统边界、屏幕状态矩阵、P0 切片和验收标准已经足以启动工程。

开工不依赖昨日未生成成功的概念图，因为：

- 现有代码与设计 tokens 是明确视觉目标；
- Light/Dark 规范已经冻结；
- 屏幕构图和状态 contract 已明确；
- 每个实现包要求输出真实 light/dark 截图，再进行视觉收敛；
- P0 采用现有组件适配，不凭空重建品牌。

但 Minimax Code 不能一次实现完整 v0.4。必须按本文 Work Packet 顺序执行，每次只完成一个可测试目标。

## 1. Source of Truth

发生冲突时按顺序读取：

1. `studykit_v0.4_decision_log_cn.md`
2. `studykit_v0.4_product_spec_cn.md`
3. `studykit_v0.4_research_mode_ai_native_spec_cn.md`
4. `studykit_v0.4_interaction_flows_cn.md`
5. `studykit_v0.4_screen_state_component_matrix_cn.md`
6. `studykit_v0.4_visual_direction_and_theme_spec_cn.md`
7. `studykit_v0.4_ai_native_and_cognitive_canvas_spec_cn.md`
8. `studykit_v0.4_system_design_cn.md`
9. `studykit_v0.4_roadmap_metrics_and_research_cn.md`

v0.2 / v0.3 是历史依据，不得覆盖 v0.4 已确认边界。

## 2. 工程现状摘要

### 2.1 可复用技术

- React 19 + TypeScript + Vite；
- Zustand；
- Dexie / IndexedDB；
- Tiptap；
- React Flow；
- PDF.js；
- Vitest + Testing Library；
- Node/Express/Postgres backend；
- 现有 AI provider、Ollama、Zotero、citation 与 literature API 基础。

### 2.2 当前结构风险

- `App.tsx` 同时承担 auth、Mode、导航、数据加载与页面分支；
- 没有独立 route layer；
- `sidebarMode: modules | literature | canvas` 混合领域和界面状态；
- 未登录时强制 Auth，与本地优先冲突；
- UI 组件直接调用 Dexie/API，尚未形成 Repository boundary；
- `AIChatPanel` 与 `CanvasAIAssistant` 是页面级交互；
- Light/Dark 主要依赖 `prefers-color-scheme`，缺少完整手动主题 runtime；
- 存在较多 inline style 与 legacy `--color-*` aliases；
- literature/domain 数据还没有 canonical Work / Evidence / Claim 统一模型。

### 2.3 当前工作区保护

开工前必须再次读取 `git status --short`。当前已知存在用户未提交变更：

```text
frontend/src/components/literature/canvas/CanvasToolbar.tsx
frontend/src/components/literature/canvas/literature-canvas.css
frontend/src/components/literature/canvas/useHorizontalScroller.ts
frontend/src/components/literature/canvas/useHorizontalScroller.test.tsx
frontend/tsconfig.app.tsbuildinfo
v0.3 / v0.4 文档文件
```

这些变更属于用户。Minimax Code 不得 reset、checkout、删除、覆盖或顺手格式化。若任务必须修改同一 Canvas 文件，先说明重叠范围并以最小 patch 合并。

## 3. 不可违反的实施边界

1. 不做一次性重写；
2. 不把 Canvas engine 换掉；
3. 不删除现有功能来让新架构“更干净”；
4. 不让本地使用依赖登录、云端或 AI；
5. 不把 AI 变成永久 chat sidebar；
6. 不让 AI 直接写 canonical content；
7. 不在组件中硬编码 Light/Dark 分支颜色；
8. 不把所有领域数据塞进 CRDT；
9. 不生成不可核验 citation；
10. 不未经确认扩大 remote AI scope；
11. 不破坏用户未提交修改；
12. 不在一个 Work Packet 中进行无关重构。

## 4. Definition of Ready

| 项目 | 状态 | 依据 |
|---|---|---|
| 产品目标和双 Mode | Ready | PRD / Decision Log |
| 用户自主性和 AI 姿态 | Ready | PRD / AI spec |
| 系统级 AI Assistant | Ready | Interaction Flow / System Design |
| Study/Research 核心流程 | Ready | Interaction Flow |
| Research Collaboration | Ready for foundation | Research spec / Interaction Flow |
| Local-first / Desktop 方向 | Ready for spike | System Design |
| Light/Dark 视觉系统 | Ready | Visual Theme spec + current tokens |
| P0 screens/states | Ready | Screen Matrix |
| 数据迁移最终 schema | Not frozen | 先用 additive domain contracts + fixtures |
| CRDT 选型 | Not frozen | 只能 spike，不得全面采用 |
| 像素级页面图 | Not required for Packet 00–02 | 以现有系统+规范+真实截图 QA 收敛 |

允许开工的前提：一次只授权一个 Work Packet。

## 5. 分支与提交建议

- Branch：`codex/v04-foundation` 或用户指定的 Minimax branch；
- 一个 Work Packet 对应一个 reviewable commit 或小型 PR；
- 每个 commit 只包含相关代码、测试和必要文档；
- 不自动 stage 用户原有脏文件；
- 不提交 `tsbuildinfo` 等生成物，除非仓库当前明确跟踪并需要；
- 在每个 Packet 开始和结束记录 `git status --short`；
- 任何 migration 必须 additive、可重复运行并有 fixture test。

## 6. Work Packet 顺序

### WP-00：Baseline Guard + Contracts

目标：建立 v0.4 新代码可以安全进入的边界，不改变主要用户界面。

范围：

- 新建 `domain/`, `application/`, `repositories/`, `platforms/`, `features/`, `shared/` 边界；
- 定义最小 `Workspace`, `Mode`, `ContainerRef`, `AppLocation`, `SurfaceStatus`；
- 定义 Repository interfaces，不迁移全部旧数据；
- 建立 fixtures 与 contract tests；
- 添加 feature flags：`v04Shell`, `v04Assistant`, `v04Research`；
- 建立 architecture import rules 的轻量约定或 tests；
- 不改 CanvasToolbar 和现有 Canvas CSS。

完成标准：

- 现有 UI 行为不变；
- frontend test/typecheck/build 通过；
- 新 contracts 有测试；
- 新 feature 默认关闭；
- 无用户文件被覆盖。

### WP-01：Theme Runtime + Shared Primitives

目标：把现有 Light/Dark tokens 变成可切换、可测试的正式设计系统。

范围：

- `ThemeProvider` 支持 system/light/dark；
- 首次绘制前应用 preference；
- 将 current `@media` tokens 拆成可显式选择 contract，同时保留 system fallback；
- 建立 Button、Input、Surface、Pill、IconButton、StatusLabel、VisuallyHidden 等最小 primitives；
- 只迁移新 v0.4 组件，不机械重写全部旧组件；
- 添加主题设置入口的最小 UI；
- 测试 runtime 切换、持久化和 system change。

完成标准：

- Light/Dark/System 可运行时切换，无 reload；
- 两主题无 flash、布局跳动和 Canvas 重排；
- 登录页和一个现有主表面有双主题截图；
- contrast/focus 关键问题记录并修复。

### WP-02：Local-first App Shell

目标：建立 Workspace → Mode → Container 的新 Shell，并移除“必须登录才能使用本地产品”的阻断。

范围：

- `WorkspaceEntry`, `AppShell`, `ModeSwitch`, `ContainerNav`, `RouteResumeBoundary`；
- local workspace 无账号进入；
- sync workspace 保留现有 auth；
- Study / Research 入口同级可见；
- 先使用轻量 route adapter；是否引入 router 需在 Packet 开始说明；
- 旧 modules/literature/canvas 页面通过 legacy adapters 挂到新 Shell；
- 保留当前数据和 sidebar width；
- 添加 offline/sync 状态。

完成标准：

- 无账号可打开 local workspace；
- 旧 Study/Literature/Canvas 都可达；
- Mode 切换不泄漏 stale selection；
- back/forward 和 reload 后位置可恢复；
- Light/Dark、keyboard、offline smoke test 通过。

### WP-03：AI Interaction Kernel + Intent Capsule

目标：让 AI 成为系统级动作层，不再依赖页面 chat。

范围：

- `ContextResolver`, `ActionRegistry`, `PermissionGate`, `AssistantSessionStore` interfaces；
- `IntentCapsule`, `ContextChip`, `ScopeEditor`, `ActionPreview`, `DraftResult`；
- 先注册安全动作：navigate、search local、create free note draft、explain selected text；
- 复用现有 provider adapters；
- `AIChatPanel` / `CanvasAIAssistant` 通过 adapter 接入，不立即删除；
- `⌘K/Ctrl+K` 打开 Capsule；
- AI off/local unavailable/cloud error 完整状态；
- 每个生成结果带 provenance 与 Accept/Reject。

完成标准：

- Lecture、Reader、Canvas 至少两个表面可打开同一个 Capsule；
- Context scope 可见且可编辑；
- 无 AI 时 local search/navigation/create note 仍可用；
- AI 失败不丢 prompt 和 selection；
- 关闭后回到原 focus。

### WP-04：Study Vertical Slice

目标：打通 `Lecture → Explain → Question Draft → Review`。

范围：Study Home、Course Home 最小状态、Lecture adapter、selection actions、Review Workspace。

不做：完整 spaced repetition 算法、gamification、复杂课程计划。

### WP-05：Research Evidence Slice

目标：打通 `Project Home → Query Draft → Library → Reader → Evidence → Claim`。

范围：Project Home Living Brief、QuerySpec draft、mock/provider search adapter、canonical Work mapping、Evidence Draft、Claim relationship。

不做：全 provider 覆盖、systematic review 完整协议、自动整篇 extraction。

### WP-06：Cognitive Canvas Adapter

目标：自由节点、渐进结构、候选关系和 Intent Capsule 共存。

范围：统一 Object adapter、free node upgrade、Draft relation、Preview/Undo、Outline fallback。

注意：必须与当前用户的 CanvasToolbar/useHorizontalScroller 变更协调。

### WP-07：Collaboration Foundation

目标：先形成权限、私有/共享和异步协作 contract。

范围：memberships、roles、comments、mentions、activity、Publish Preview；Canvas presence 只做 spike。

不做：复杂组织层级、完整多人富文本、审批流。

### WP-08：Desktop Quick Capture Spike

目标：验证 Tauri、本地 SQLite/file store、global hotkey 与 Quick Capture。

范围：macOS/Windows spike、text/explicit clipboard/file drop、本地 Inbox、workspace chooser、theme、offline。

不做：系统 share extension、自动剪贴板监听、捆绑本地模型。

## 7. 每个 Packet 的固定执行循环

```text
Read scope → Inspect exact files → State assumptions → Implement minimal slice
→ Unit/contract tests → Typecheck/build → Run app
→ Verify primary flow → Capture Light/Dark → Review diff/status
→ Report gaps → Stop
```

Minimax Code 不得在最后一步自动开始下一个 Packet。

## 8. 测试与验证命令

Frontend：

```text
cd frontend
npm test
npm run typecheck
npm run build
```

Backend：

```text
cd backend
npm test
```

每个 Packet 只运行相关快速测试后再运行完整 frontend suite；涉及 backend 时补 backend tests。视觉页面必须在真实浏览器验证 Light/Dark，不用 DOM snapshot 代替视觉检查。

## 9. Definition of Done

每个 Packet 必须同时满足：

- scope 内的主流程完成；
- scope 外功能未被破坏；
- 新行为有测试；
- typecheck/build 通过；
- Loading/Empty/Offline/Error 不丢内容；
- Light/Dark 均验证；
- keyboard focus 和 accessible names 完整；
- AI off 时核心路径可用；
- local-only 时不要求登录；
- 不隐藏 source scope、Draft、Private/Shared；
- `git diff --check` 通过；
- `git status` 中用户既有变更保持原样；
- 最终报告列出 changed files、tests、screenshots、remaining gaps；
- 未擅自开始下一个 Packet。

## 10. Stop Conditions

Minimax Code 遇到以下情况必须停止并报告，不得猜测：

- 需要覆盖用户现有未提交 Canvas 改动；
- 需要 destructive migration；
- 需要上传本地资料或使用真实 API key；
- 需要选择 router、CRDT、database truth source 且选择会改变多个 Packet；
- 现有测试失败且原因不在当前 scope；
- Light/Dark token 对比度无法同时满足；
- local workspace 与现有 auth 无法安全共存；
- 用户数据迁移无法提供回滚或 fixture；
- 实现要求超出当前 Packet。

## 11. Minimax Code 总指令

以下内容作为每次 Minimax Code 会话的固定开头。为减少重复上下文，不再要求每次读取所有 v0.4 文档：

```text
你正在实施 StudyKit v0.4。只执行当前授权的 Work Packet。先阅读 Master Implementation
Plan 中当前 Packet、decision log 中相关决策，以及任务指定的 1–3 份专项规范。不要重复
读取所有 v0.4 文档。

这是现有项目中的增量重构，不是重写。必须保留现有功能和用户未提交改动。
开始前运行 git status --short，明确列出与当前任务重叠的文件；不得 reset、checkout、
删除、覆盖或格式化无关文件。不要自动 stage、commit 或 push。

只执行本次指定 Work Packet，不进入下一个 Packet。先检查相似组件、tokens、tests 和
现有数据边界，用不超过 12 行说明范围、复用点和验证项后直接实施。使用现有 Warm Cognitive Glass 设计系统，Light、
Dark、System 都是一等主题。AI 是系统级 Intent Capsule/Action Layer，不是永久聊天栏。
本地无账号和无 AI 时核心路径必须可用。所有 AI 修改进入 Draft/Preview，可撤销并保留
source scope/provenance。Private 内容不得自动共享。

实现完成后运行相关 tests、完整 frontend test、typecheck、build；涉及 backend 时运行
backend test。检查 light/dark、keyboard、offline/error 状态。最后用不超过 30 行报告
changed files、验证结果、未解决问题和 git status，然后停止。
```

## 12. 第一次施工指令：WP-00

在用户明确说“开始 WP-00”后，把以下内容发送给 Minimax Code：

```text
执行 StudyKit v0.4 Work Packet WP-00：Baseline Guard + Contracts。

目标：在不改变现有主要 UI 和行为的前提下，为 v0.4 建立可增量进入的代码边界。

必须完成：
1. 检查 git status，保护所有用户未提交改动，尤其是 CanvasToolbar、
   literature-canvas.css、useHorizontalScroller 及其测试。
2. 在 frontend/src 下建立最小 app/domain/application/repositories/platforms/features/shared
   目录边界；只添加当前 packet 需要的文件。
3. 定义并测试 WorkspaceMode、ContainerRef、AppLocation、SurfaceStatus、DraftStatus、
   Repository 基础 contract。
4. 建立 feature flag contract：v04Shell、v04Assistant、v04Research，默认关闭；不得把
   flag 散落成组件内 magic booleans。
5. 为 domain contracts 添加 fixtures/round-trip tests；不要迁移当前 Dexie schema。
6. 写一份简短 frontend/src/ARCHITECTURE.md，说明依赖方向和 legacy adapter 策略。

禁止：
- 修改用户当前 Canvas 文件；
- 改变 Auth/App UI；
- 引入 router、Tauri、CRDT 或新数据库；
- 迁移现有数据；
- 删除/重命名现有组件；
- 开始 WP-01。

验收：现有 UI 不变；相关 tests、完整 npm test、npm run typecheck、npm run build 通过；
git diff --check 通过；最终报告新文件、测试结果、既有失败和 git status，然后停止。
```

## 13. 后续 Minimax 管理方式

- 每次只发一个 Packet；
- Minimax 先回计划和重叠文件，再允许它修改；
- 完成后由本代理复核 diff、tests、双主题截图和 scope；
- 复核通过才发送下一 Packet；
- 若 Minimax 自行扩大范围，回退其未授权部分但保留用户原始变更；
- 产品决策变化先更新 Decision Log，再更新代码任务；
- 视觉问题先对照 Visual Theme spec 修正，不临时发明第三套样式。

## 14. 当前可以开始什么

WP-00 与 WP-01 已于 2026-07-20 通过正式 Gate。WP-01 验收为 182 项测试通过、2 项既有测试保持 skipped，typecheck/build、`git diff --check`、完整 shared import boundary 和语义 token contract 通过。构建的既有 chunk 过大警告留到 WP-02/WP-11 处理。当前可授权 **WP-02**，但仍不得自动进入 WP-03。
