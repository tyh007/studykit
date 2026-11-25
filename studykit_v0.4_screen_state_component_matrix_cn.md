# StudyKit v0.4 屏幕、状态与组件矩阵

> 版本：0.4.0-draft  
> 日期：2026-07-20  
> 状态：P0 实现输入  
> 配套文档：PRD、交互流程规范、视觉方向与双主题规范、系统设计

---

## 0. 使用方法

本文把产品流程转换为工程可以逐屏实现的 contract。每个屏幕都必须明确：

- 用户此刻想完成什么；
- 主动作是什么；
- 哪些组件复用、适配或新建；
- Empty / Loading / Normal / Draft / Offline / Error / Permission 状态；
- Light / Dark 表现；
- 数据来源与验收信号。

P0 不追求一次实现所有页面，而是确保五条纵向路径可以端到端走通。

## 1. 全局 Shell

| ID | 屏幕/表面 | 用户目标 | 主动作 | 状态 | 组件 |
|---|---|---|---|---|---|
| G-01 | Workspace Entry | 无账号开始或进入同步 workspace | Open local / Sign in to sync | first-run, local, sync, error | `WorkspaceEntry` 新建；复用 Logo/Input/Button |
| G-02 | App Shell | 在 Workspace、Mode、Container 间定位 | Resume current context | loading, ready, offline | `AppShell`, `ModeSwitch`, `ContainerNav` 新建；复用 sidebar/header 基础 |
| G-03 | Home / Continue | 恢复最近工作或快速捕捉 | Resume | empty, recent, offline | `ContinueHome` 新建 |
| G-04 | Global Intent Capsule | Search / Ask / Act | Run intent | idle, scoped, running, result, error | `IntentCapsule`, `ContextChip`, `ActionPreview` 新建 |
| G-05 | Global Search Results | 找到跨 Mode 对象 | Open / Pin / Add to view | empty, results, stale index | `SearchResults` 新建；复用 list primitives |
| G-06 | Inbox | 整理 Quick Capture | Move/Link/Keep free | empty, items, duplicate | `CaptureInbox` 新建 |
| G-07 | Run Center | 观察后台任务 | Pause/Cancel/Review | running, partial, failed, completed | `RunCenter`, `RunItem` 新建 |
| G-08 | Settings | 主题、AI、数据、同步 | Save setting | local, provider unavailable | `SettingsShell` 新建；复用现有 AI settings 内容 |

### G-02 App Shell contract

- Header：Logo、Mode switch、当前 Container、`⌘K`、sync/offline、settings；
- Sidebar：Container 内导航，可收起和调宽；
- Main：route surface；
- Overlay root：Intent Capsule、dialogs、toasts；
- 无账号时不渲染强制 Auth gate；
- Sync workspace 才显示 account actions；
- 每个 Container 保存 last route、scroll/zoom 和 sidebar width。

## 2. Study Mode

| ID | Route/Surface | 核心目标 | 主动作 | 关键组件 | 数据 |
|---|---|---|---|---|---|
| S-01 | `/study` | 选择 Course 或快速开始 | Resume lecture / New capture | `StudyHome` 新建 | courses, recent sources, questions |
| S-02 | `/study/c/:courseId` | 恢复课程状态 | Resume lecture | `CourseHome`, `UnresolvedQuestions` 新建 | course, lectures, notes, review items |
| S-03 | Lecture Focus | 边看 slides 边记录 | Capture note | 适配 `PDFViewer`, `NoteEditor`, `AnnotationLayer` | lecture, source pages, note blocks |
| S-04 | Shared Reader | 深度阅读并回到来源 | Capture/Explain | 适配 Reader + `SelectionActions` | source, locator, annotations |
| S-05 | Study Canvas | 自由捕捉与连接 | Capture / Connect | 适配 Literature Canvas 为 shared Canvas | objects, relations, placements |
| S-06 | Review | 自主复习 | Recall / Reveal | `ReviewWorkspace` 新建 | questions, attempts, sources |

### S-03 Lecture Focus states

| 状态 | 主区 | Notes | AI | 恢复 |
|---|---|---|---|---|
| No source | 导入 slides / PDF | Quick note 可用 | 不读取文件 | 导入后保留笔记 |
| Processing | 页缩略图逐步出现 | 可继续输入 | 后台 OCR 状态 | partial pages 可用 |
| Ready | 当前页 + navigation | 自动关联页码 | selection actions | 恢复页码/光标 |
| AI Draft | 原文不变 | Draft 可预览 | scope/locator 可见 | Accept/Reject |
| Offline | 已缓存资料 | 完整本地编辑 | local AI 或关闭 | sync later |
| Failed | 失败文件可重试 | 笔记不丢 | Continue without AI | replace/retry |

## 3. Research Mode

| ID | Route/Surface | 核心目标 | 主动作 | 关键组件 | 数据 |
|---|---|---|---|---|---|
| R-01 | `/research` | 选择/创建项目 | Resume / New project | `ResearchHome` 新建；适配 `ProjectSidebar` | projects, recent activity |
| R-02 | Project Home | 恢复共同研究状态 | Resume last view | `ProjectHome`, `LivingBrief`, `LineageStrip` 新建 | RQ, claims, decisions, tasks, activity |
| R-03 | Discovery | 构造并执行可复现搜索 | Run search | `QueryBuilder`, `SearchRunResults` 新建 | QuerySpec, providers, results |
| R-04 | Library | 管理论文与阅读状态 | Open reader | 适配 `SummaryTable`, reading lists, Zotero | works, sources, assets |
| R-05 | Research Reader | 从 passage 创建 Evidence | Create Evidence | 适配 `LiteraturePDFViewer`, annotations | source, passage, locator |
| R-06 | Evidence & Claims | 比较证据、形成论点 | Open in Canvas / Create Claim | `EvidenceTable`, `ClaimInspector` 新建 | evidence, claims, support links |
| R-07 | Research Canvas | 综合、反例、头脑风暴 | Connect / Ask AI | 适配现有 Canvas components | objects, relations, placements |
| R-08 | Design Workspace | 记录研究设计与理由 | Record decision | `DesignWorkspace` 新建 | design spec, alternatives, evidence |
| R-09 | Project Plan | 管理研究依赖 | Create/complete task | `ResearchPlan`, `DependencyList` 新建 | tasks, decisions, outputs |
| R-10 | Output Editor | 证据驱动写作 | Draft section | 适配 `NoteEditor` / Tiptap | outputs, claims, citations |
| R-11 | Citation Audit | 验证引用身份与支持性 | Resolve issue | 适配 `CitationPicker`, Citation views | canonical works, locators, audit results |

### R-02 Project Home composition

| 区域 | 必须内容 | 空时行为 |
|---|---|---|
| Header | 项目名、Private/Shared、members | 单人本地显示 `Private local project` |
| Living Brief | Research Question / working goal | 可直接自由输入，不强制模板 |
| Resume | 上次 route + 时间/状态 | 新项目显示 `Start anywhere` |
| Lineage | 最近 Evidence → Claim → Decision → Output | 只显示已有对象，不画空流程 |
| Next decision | 一个主要决策/阻塞项 | 没有时隐藏，不显示 0 |
| Collaboration | mentions、reviews、presence | 单人项目不占空间 |
| Secondary nav | Library、Canvas、Design、Plan、Output | 作为导航，不做 feature cards |

### R-03 Discovery states

- Empty：从自由问题、seed paper 或粘贴 query 开始；
- Query draft：自然语言与结构化 QuerySpec 双向编辑；
- Provider unavailable：保存 QuerySpec，允许换 provider；
- Running：结果增量出现，可暂停；
- Results：显示 relevance reason、source、save/maybe/exclude；
- Re-run：保留原 Run，创建新版本；
- Offline：可编辑 QuerySpec，不伪装能完成远程 search。

### R-05 Research Reader → Evidence contract

1. selection 必须带 source ID 与 locator；
2. Evidence Draft 预填 excerpt，不自动写 interpretation；
3. AI candidate fields 与用户字段视觉区分；
4. verified 前必须确认 locator；
5. 保存后同一 Evidence 出现在 Table/Canvas/Output；
6. 无 locator 只能保存 Note / Draft Evidence。

## 4. Collaboration 表面

| ID | Surface | 核心目标 | 主动作 | 状态 | 组件 |
|---|---|---|---|---|---|
| C-01 | Members | 邀请和理解权限 | Invite | pending, active, revoked | `MemberManager`, `RoleExplainer` 新建 |
| C-02 | Presence | 看见当前共创者 | Follow/Inspect | online, idle, disconnected | `PresenceCluster`, `RemoteSelection` 新建 |
| C-03 | Comments | 锚定对象讨论 | Comment/Resolve | open, resolved | `CommentAnchor`, `CommentThread` 新建 |
| C-04 | Review Request | 异步审阅 | Request review | pending, changes requested, complete | `ReviewRequestPanel` 新建 |
| C-05 | Private/Shared Publish | 选择性共享个人思考 | Copy to shared | preview, publishing, conflict | `PublishPreview`, `VisibilityToggle` 新建 |
| C-06 | Conflict Review | 恢复离线/权限冲突 | Keep local/shared/combined | conflict, resolved | `ConflictReview` 新建 |

P0 collaboration 不要求完整富文本多人编辑；先实现 ownership、visibility、roles、comments、mentions、activity 和 Canvas presence contract。

## 5. Desktop 表面

| ID | Surface | 目标 | P0 |
|---|---|---|---|
| D-01 | Quick Capture | 离开主窗口捕捉 text/clipboard/file | 必须 |
| D-02 | Workspace chooser | 选择 Inbox/Course/Project | 必须 |
| D-03 | Local/Shared preview | 防止误共享 | 必须 |
| D-04 | Menu bar/tray | 打开、capture、sync status | Should |
| D-05 | File/share target | 从系统送入资料 | 后续 |
| D-06 | Update flow | 安全更新与回滚提示 | Desktop Beta |

## 6. 共享组件矩阵

### 6.1 现有可直接复用

| 能力 | 当前文件 | 处理 |
|---|---|---|
| Logo | `components/ui/Logo.tsx` | 直接复用，验证双主题 |
| Icons | `components/ui/Icons.tsx` | 继续扩展同一线性语言 |
| PDF/Slides | `PDFViewer.tsx`, `LiteraturePDFViewer.tsx` | 通过 Shared Reader adapter 统一 |
| Notes editor | `NoteEditor.tsx` | 作为 Study/Output 编辑基础 |
| Annotation | `AnnotationLayer.tsx`, `PaperAnnotationLayer.tsx` | 对齐统一 SourceLocator |
| Literature table | `SummaryTable.tsx` | 迁移为 Library view adapter |
| Citation picker | `CitationPicker.tsx` | 接 canonical Work contract |
| Canvas engine | `LiteratureCanvas.tsx`, `useLiteratureCanvas.ts` | 保留，逐步接统一 Object/View |
| Canvas nodes/edges | `canvas/*Node.tsx`, `RelationEdge.tsx` | 复用渲染，替换领域绑定 |
| Canvas controls | toolbar/search/minimap/scenes/zoom | 合并层级，不重写算法 |
| AI provider config | `lib/literature/*ai*` | 下沉到 provider adapter |

### 6.2 需要适配，不应继续复制

| 当前能力 | 问题 | 目标 |
|---|---|---|
| `App.tsx` 单体分支 | Mode、route、auth、数据加载耦合 | `AppShell` + routes + feature boundaries |
| `sidebarMode` | modules/literature/canvas 混合导航与领域 | `mode + container + route` |
| 强制 `AuthPage` | 与本地优先冲突 | Local entry 一等；sync 才登录 |
| `AIChatPanel` / `CanvasAIAssistant` | 页面级 chat 与重复状态 | 统一 `IntentCapsule` + AI Interaction Kernel |
| `ProjectSidebar` | literature project 仅 name/description | Research Project navigation adapter |
| inline colors/styles | 双主题和一致性风险 | semantic tokens + shared primitives |
| Dexie concrete calls in UI | 页面和数据层耦合 | Repository/use-case boundary |

### 6.3 P0 新组件

```text
app/
├── AppShell
├── WorkspaceEntry
├── ModeSwitch
├── ContainerNav
├── RouteResumeBoundary
└── ThemeProvider

features/ai/
├── IntentCapsule
├── ContextChip
├── ScopeEditor
├── ActionPreview
├── DraftResult
└── RunCenter

features/study/
├── StudyHome
├── CourseHome
├── LectureFocusAdapter
└── ReviewWorkspace

features/research/
├── ResearchHome
├── ProjectHome
├── LivingBrief
├── QueryBuilder
├── EvidenceTable
└── ClaimInspector

features/collaboration/
├── VisibilityToggle
├── PresenceCluster
├── CommentThread
└── PublishPreview
```

## 7. 组件状态 contract

所有异步主组件必须支持：

```ts
type SurfaceStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'partial'
  | 'error'
  | 'forbidden';
```

AI 结果必须支持：

```ts
type DraftStatus =
  | 'suggested'
  | 'generating'
  | 'draft'
  | 'accepted'
  | 'rejected'
  | 'superseded';
```

组件不能把 `loading` 当作清空旧内容；刷新时保留 stale content 并显示状态。

## 8. P0 五条纵向切片

### Slice 1：Study

`Workspace Entry → Study Home → Lecture Focus → selection Explain → Question Draft → Review`

必须组件：G-01、G-02、S-01、S-03、G-04、S-06。

### Slice 2：Research Evidence

`Research Home → Project Home → Query Draft/Mock Run → Library → Reader → Evidence Draft → Claim`

必须组件：R-01 至 R-06 的最小状态。

### Slice 3：Canvas

`Blank Canvas → Free node → Connect → Intent Capsule → Candidate relation → Accept/Undo`

必须组件：R-07、G-04，复用当前 Canvas engine。

### Slice 4：Collaboration

`Private Scratch → Publish Preview → Copy to shared → Comment/Mention → Record decision`

必须组件：C-03、C-05；presence 可以先用双窗口本地模拟验证 contract。

### Slice 5：Desktop AI

`Global hotkey → Quick Capture → Workspace chooser → Save locally / Ask AI → Open exact object`

必须组件：D-01 至 D-03；先用 Tauri spike，不绑定云同步。

## 9. 状态测试矩阵

每个 P0 route 至少验证：

| 维度 | 取值 |
|---|---|
| Theme | light / dark / system |
| Network | online / offline / reconnecting |
| AI | off / local unavailable / cloud / generating / failed |
| Data | empty / normal / large / stale / error |
| Visibility | private / shared |
| Role | owner / editor / commenter / viewer |
| Input | mouse / keyboard / touch or pen where relevant |
| Motion | normal / reduced |

不是所有组合都做 E2E；domain/state tests 覆盖组合，关键路径在 light/dark + online/offline 做浏览器验证。

## 10. 屏幕完成定义

一个屏幕只有同时满足以下条件才算完成：

- 主要任务可端到端完成；
- Empty、Loading、Normal、Offline/Error 不丢用户内容；
- Light/Dark 均通过视觉检查；
- keyboard focus 与 accessible names 完整；
- AI 关闭时主路径仍可用；
- Draft、source scope、Private/Shared 状态可见；
- 返回后恢复 route、scroll/zoom 和 selection；
- 新组件有针对行为的测试；
- 不绕过 Repository/Service boundary 直接新增页面级数据访问。

