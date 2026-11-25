# StudyKit v0.4 WP-11R2 交互逻辑重构施工规范

> 日期：2026-08-01  
> 状态：READY FOR IMPLEMENTATION  
> 依据：已安装桌面版 10 步真实流程审计，而非功能清单推演  
> 目标：把当前“按实体跳页面”的产品，收敛为连续、自由、AI-native 的学习与研究工作台

## 1. 本轮结论

WP-11R2 不重写领域层，也不继续增加功能。现有 Course、Lecture、Work、Evidence、Claim、Design、Task、Output、Canvas 和 AI Draft 能力继续作为 canonical model；本轮只重构用户如何进入、继续、添加、连接和发展这些内容。

用户面对的稳定操作语言统一为：

`Add → Capture → Connect → Develop → Share`

它们是随时可用的动作，不是老师式流程。用户可以从材料、问题、空白笔记或画布任意开始，并随时回退或跳过。

## 2. 成功标准

真实用户无需理解内部实体名称，即可完成：

1. Study：进入课程后 10 秒内新建 Lecture、导入材料或开始空白笔记；
2. Research：进入项目后优先恢复最近工作，也可通过一个 `Add` 添加搜索、PDF、Zotero 或想法；
3. Canvas：空画布进入后无需阅读帮助即可双击、点击按钮、粘贴或拖入开始；
4. AI：任一 surface 一次操作内可召唤，并自动带入当前 Mode、Container、View 和明确 Selection；
5. 页面不再用大量禁用表单表达前置条件，而是给出最短可执行动作；
6. Light/Dark、键盘、离线、无 AI、本地 Workspace 均保持可用；
7. 不新增数据库表、IPC、router library、平行 repository、平行 Canvas 或平行 AI session。

## 3. 冻结的信息架构

### 3.1 四层界面

| 层 | 始终回答的问题 | 内容 |
|---|---|---|
| Global | 我在哪个工作语境？ | Study/Research、全局搜索、Capture、Ask AI、Workspace 状态 |
| Context | 我正在处理什么？ | 当前 Course/Project、Home、最近内容、切换上下文 |
| Work | 我现在具体做什么？ | Reader、Notes、Sources、Canvas、Review、Output 等工作视图 |
| Inspector | 当前选择能做什么？ | 属性、来源、关系、历史、上下文 AI；按需出现 |

### 3.2 Sidebar 决策

- Sidebar 只负责 Home、当前上下文和少量工作视图，不罗列内部数据库类型。
- Study 容器内：`Course`、`Lectures`（已有时）、`Canvas`、`Review`（有可复习内容时）；创建动作不塞进侧栏表单。
- Research 容器内：`Project`、`Sources`、`Canvas`、`Output`（已有时）；Evidence、Claim、Design、Task 仍可深链访问，但不永久占据主导航。
- `Discover + Library` 在用户语言中合并为 `Sources`；底层 SearchRun、Work 和 Reader contract 不变。

### 3.3 页面内统一动作

- `Add`：打开同一套上下文菜单，内容随 Mode/Container 变化；不直接建立另一个 store。
- `Capture`：把选区或输入保存为 Note、Question、Evidence 或 Inbox item。
- `Connect`：把现有对象送入同一个 canonical Canvas，或建立显式 relation。
- `Develop into…`：从当前对象创建/关联 Claim、Design、Task、Output；先显示最小选择，不展示整页空表单。
- `Share`：协作、引用、导出入口；单人本地项目不占首屏。

## 4. 目标流程

### 4.1 Study

`Study Home → Resume/Open Course → Course start actions → Lecture Focus → optional Capture/Ask/Canvas/Review`

Course 空状态必须同时提供：

- `New lecture`：最小标题输入，创建后直接进入 Lecture；
- `Import slides or PDF`：复用现有 Lecture/source 导入路径；若导入只能在 Lecture 内完成，则先建立带默认可编辑标题的 Lecture，再打开文件选择；
- `Start blank notes`：创建空白 Lecture 并直接聚焦笔记，不要求 source。

有 Lecture 时首屏优先 `Resume` 最近 Lecture，其余 Lecture 次之；只有存在 unresolved/reviewable question 时才显示 Review 主入口。

### 4.2 Research

`Research Home → Resume/Open Project → Focus + Continue + Add → Sources/Reader/Canvas → Develop into…`

Project Home 首屏只保留：

- 可直接编辑的 Focus / Living Brief；
- 最近工作位置和一个 `Continue`；
- 一个统一 `Add`；
- 用户明确设置或由已有对象推导出的一个 Next item；
- 最近 3–5 个研究对象或活动。

Questions、Hypotheses、Risks、Milestones、Tasks、Lineage、Outputs 和 Collaboration 不删除数据与能力，但移动到按需展开的 `Project details`，空集合不渲染占位卡。

`Sources` 首屏包含同一 Add Sources 面板：`Search literature`、`Import PDF`、`Import from Zotero`、`Add URL/DOI`。已有来源时默认显示 Library 列表；Search 作为同一 surface 的可切换工作状态，而非侧栏中的另一个目的地。

Evidence 从 Reader selection、Source card 或 Canvas selection 就地捕捉。没有 Evidence 时不渲染 Claim 与 AI Claim 完整表单；显示 `Add sources`、`Open a source` 或 `Capture evidence` 的最短路径。

Design、Task、Output 使用 `Develop into…` 进入，保持原 surface 和 canonical use case，以深链/返回位置维持连续性。

### 4.3 Canvas

Canvas 不新增实现，优先暴露已经存在的 `addFreeNode` 和 Surface double-click contract：

- 空状态中央显示 `Double-click anywhere or add your first idea`；
- 主动作：`Add idea`；次动作：`Add sources`、`Paste`；
- 背景双击在点击位置创建可编辑自由节点；
- 粘贴纯文本创建自由节点，粘贴 URL/对象引用沿用既有解析能力；
- 无 selection 时隐藏 Connector 等无效控件，不以 disabled 按钮占据主要注意力；
- 首个节点创建后空状态立即消失，焦点进入编辑；Escape 可退出且不丢内容。

### 4.4 AI Assistant

复用现有 `IntentCapsuleProvider`、`openCapsule`、session store、ProviderRouter 和 Draft/Accept/Reject，不创建新聊天面板。

- Shell Header 始终显示 `Ask`，并提供现有应用内快捷键；
- 点击时传入当前 AppLocation 形成 context chips：Mode、Course/Project、surface；
- selection action 仍由 Reader/Canvas/Output 等局部 surface 提供；
- 无 selection 时允许问答、搜索、导航、创建 Draft，不默认读取整个 Workspace；
- AI unavailable 时入口仍可打开并明确显示 Local/Cloud/Off 状态及设置路径；核心本地操作不禁用；
- AI 结果只能作为可编辑 Draft，用户 Accept 后才进入 canonical 内容。

## 5. 页面删改矩阵

| 当前 surface | 决策 | 本轮改变 |
|---|---|---|
| Study Home | 保留 | Resume 优先；New course 使用对话/弹层，不改变侧栏结构 |
| Course Home | 重构 | 增加三种开始动作，修复 Lecture 死胡同，Review 条件展示 |
| Research Home | 重构 | Existing/Resume 优先，New project 收起为动作 |
| Project Home | 重构 | Focus/Continue/Add/Next/Recent 为首屏；其余按需展开 |
| Discovery | 合并展示 | 作为 Sources 内 Search 状态；保留原 SearchRun contract |
| Library | 更名/组合 | 用户可见名称 Sources；统一添加来源 |
| Evidence | 降级为工作视图 | 空状态不给禁用 Claim 表单；提供 Reader/Canvas 就地路径 |
| Design | 保留深链 | 由 Develop into… 进入，不作为永久一级导航 |
| Task detail | 保留深链 | 从对象/Project details 进入并返回原上下文 |
| Output | 保留深链 | 有 Output 才在导航出现；从 Develop into… 创建 |
| Canvas | 重构开始体验 | 暴露 addFreeNode、双击、粘贴和 Add Sources |

## 6. 工程边界与复用点

优先修改：

- `frontend/src/app/v04/WorkspaceSidebar.tsx`
- `frontend/src/app/v04/V04Shell.tsx`
- `frontend/src/app/v04/studyRouter.tsx`
- `frontend/src/app/v04/researchRouter.tsx`
- `frontend/src/features/study/StudyHome.tsx`
- `frontend/src/features/study/CourseHome.tsx`
- `frontend/src/features/research/ResearchHome.tsx`
- `frontend/src/features/research/ProjectHome.tsx` 及 `project-home/*`
- `frontend/src/features/research/Discovery.tsx`
- `frontend/src/features/research/Library.tsx`
- `frontend/src/features/research/EvidenceWorkspace.tsx`
- `frontend/src/features/canvas/CognitiveCanvasAdapter.tsx`
- `frontend/src/features/canvas/CognitiveCanvasView.tsx`
- `frontend/src/app/v04/v04.css`、Study/Research/Canvas 对应现有样式文件

必须复用：`AppLocation/locationStore`、`getDataApi()`、Study/Research repository、所有 canonical use cases、`CanvasUseCasesProvider`、`addFreeNode`、`IntentCapsuleProvider/openCapsule`、现有 shared UI primitives 和主题 tokens。

禁止：新增全局 store、复制现有 repository、页面直连 Dexie/SQLite/IPC/provider、改变 canonical schema、把 Discovery/Library 复制成第三个 Sources 数据系统、用硬编码 mock 掩盖缺失动作、删除用户未提交改动。

## 7. 实施切片

### Slice A — Shared entry language

统一 Header `Add / Capture / Ask`、Sidebar、上下文菜单和键盘入口；保持旧深链可解析。完成后所有 surface 可召唤 AI。

### Slice B — Study recovery

修复 Course Home 死胡同、Study Home Resume/New course 层级和空白 Lecture。必须先完成一条真实 `Course → create blank Lecture → type note → return → resume` 路径。

### Slice C — Research continuity

收敛 Research/Project Home，组合 Sources，修正 Evidence 空状态；保留原数据与 deep-link surface。

### Slice D — Canvas start

让空画布可发现、可点击、可双击、可粘贴开始；不修改 Canvas domain contract。

### Slice E — UX hardening

Light/Dark、960×640 最小窗口、键盘、焦点返回、aria-live、离线/AI-off、刷新/重启恢复和 bundle budget。

## 8. 自动化与真实验收

必须新增生产组合测试，而不是只测孤立组件：

1. Course 空状态三个开始动作可达，创建后打开真实 Lecture；
2. 创建 Lecture 后返回 Course 可见且可 Resume；
3. Research 项目首屏不渲染空 Question/Hypothesis/Risk/Milestone/Task/Output 数据库面板；
4. Sources 能在 Library/Search/Add panel 间切换，保存 Work 后回到同一来源列表；
5. Evidence 空状态没有禁用 Claim 表单，并能导航到 Add/Open source；
6. 空 Canvas 点击和双击均调用同一个 `addFreeNode`，只产生一个 canonical node；
7. Header Ask 在 Study、Research、Reader、Canvas、Output 中打开同一个 capsule session；
8. 无 AI、离线、本地 Workspace 时 Add/Capture/Canvas/Notes 仍可用；
9. Sidebar 不再出现 Discover/Evidence/Design 永久入口，既有 hash deep link 仍能打开对应 surface；
10. Light/Dark 和 960×640 下无裁切、重叠、横向溢出；键盘主路径与焦点返回可见。

真实桌面 Gate 任务：

- Study：新建 Course → 空白 Lecture → 输入笔记 → Ask → 返回 → Resume；
- Research：新建/打开 Project → Add Sources → Search 或 PDF → Reader → Capture Evidence → Canvas → Develop into Claim/Output；
- Canvas：空画布用按钮、双击和粘贴各开始一次；
- 重启应用后恢复上次 Container、surface 和数据；
- 两种主题和最小窗口各完成一次核心路径。

## 9. Gate 与停止条件

Engineering Gate 只有在定向测试、完整 Vitest、TypeScript、Web build、Rust tests、Desktop unsigned build、`git diff --check` 与真实桌面任务全部通过后才可 PASS。

若需要新增 schema/IPC/依赖、覆盖不明用户改动、复制 Canvas/AI/repository、破坏旧 deep link 或无法证明本地数据不丢失，立即停止并报告；不得用临时平行实现绕过。

