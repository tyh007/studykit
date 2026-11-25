# StudyKit v0.3 产品规范

> 版本：0.3.0 (draft)
> 作者：Yh T
> 日期：2026-07-19
> 前置版本：v0.2.0 (Stage One 文档)
> 适用场景：替代 v0.2 PRD 的"产品定位"章节；与 `studykit_v0.3_system_design_cn.md` 配套
> 文档目的：在 v0.2 已实现能力的基础上，引入"画布优先（Canvas-first）"交互范式，纠正当前实现与原始愿景的偏离，给后续 LLM coding agent 提供清晰边界

---

## 0. 摘要：v0.2 出了什么问题，v0.3 要改什么

### v0.2 的问题（基于现有代码与 git log 的诊断）

1. **三 mode 并列违背"lecture-first"**。`App.tsx` 把 Modules（lecture 笔记）、Literature、Canvas 做成顶层三选一 (`sidebarMode`)。结果是研究工具被升格为"主入口之一"，新用户登录后不知道该去哪。
2. **画布能力被锁在 Lit Hub 里**。`LiteratureCanvas` 已经是一个完整的 ReactFlow 自由画布（paper / note / question / group / shape / text 节点 + 关系 + 场景 + AI 助手），但只能服务于 literature project。这套交互模式天然适合 module / lecture / revision，**没有被复用**。
3. **Lecture 主路径没有被认真打磨**。最近 30 个 commit 几乎全是 `literature/canvas` 的 fix/polish。`NoteEditor` 1310 行单文件、`PDFViewer` 146 行、`AnnotationLayer` 355 行——这些 lecture 核心体验几乎没动。
4. **架构层面欠债**。`App.tsx` 600+ 行单文件，`useStore` 350 行管 30+ 字段，`SidebarContent` 695 行，**没有 router**。`fix(ux): decouple Modules and Library views` 这个 commit 的存在本身，说明状态机已经混乱到需要靠 patch 修补。
5. **Cornell 标签被改名为 "Annotation"**。PRD Stage One 明确说 Cornell-style cue notes 是核心体验，UI 改名 "Annotation" 是典型的"做着做着忘了为什么做"。

### v0.3 的方向（一句话）

> **画布优先（Canvas-first）**：StudyKit 的统一交互范式是"画布上的空间化学习"——module、lecture、literature、revision 都跑在同一套画布交互上。Lit Hub 不再是顶层 mode，而是这套画布范式在文献场景下的一个应用。

### v0.3 不做的事（边界）

- 不废弃 v0.2 已经实现的 lecture 工作流。Slides、Notes、Cornell cue、PDF 批注、导出、Zotero connector、Lit 关系图——全部保留并升级。
- 不引入新数据库。沿用现有 PostgreSQL schema（Dexie 本地 + Postgres 云端）。
- 不引入大改的成本。"画布优先"是**抽象层的提升**，不是底层重写。Lecture 视图仍然可以默认呈现"PDF 左、Notes 右"——只是把这种布局从"硬编码 UI"升格为"画布上的一种 layout preset"。
- **不删除画布工具节点**。v0.2 的 Shape / Text / Group 等不是砍掉的对象，而是"被组织得更清晰的工具"——v0.3 按"内容/组织/表达"等用途重新分类，工具栏从平铺改为 tab 分组。
- **不支持跨 lecture 共享同一个 PDF**。1 lecture → N PDF 是允许的（v0.2 schema 已经支持），但 1 PDF → N lecture 不做（避免同步和权限复杂性）。N lecture → 1 共享 PDF 留到 v0.4。
- 不做实时协作、公开分享、marketplace（仍是 Stage Six 范围）。

---

## 1. 愿景与定位

### 一句话定位

**StudyKit 是一款画布优先的学习工作台，让大学生在同一个空间里组织 lecture、literature、note、citation 和复习材料——通过空间布局和节点关系构建自己的知识网络。**

### 核心转向：从"工具集合"到"空间"

v0.2 把 StudyKit 定位成"lecture-first academic workspace"，隐含假设是"不同工具有不同模式（笔记工具、文献工具、画图工具）"。

v0.3 把它升格为"**空间化学习**"——你的整个学习过程发生在**一张统一的画布**上。画布上的每一个 node 都是一个学习对象（lecture slide、paper、note、cue、equation、citation、flashcard），节点之间的关系是你的理解（"这篇文章 cites 上一篇"、"这张 slide 触发了这个问题"、"这个 equation 解释了这个 finding"）。

切换不同"空间"（module / literature / revision）只是切换画布的"范围"和"模板"，**交互范式完全一致**：拖、连、标、写、调、复习。

### 长期愿景（与 v0.2 一致的部分）

- 成为大学生的 academic learning operating system。
- 从"被动保存资料"到"主动构建知识"。
- 从"碎片化工具切换"到"结构化学习工作流"。
- 让 AI 围绕**用户选定的 source**生成 draft，不替学生学习。

### 与 v0.2 的兼容性

v0.3 **不否定** v0.2 愿景。原始愿景的 6 个用户场景（上课做笔记、课后整理、读 paper、生成复习、统计编程、协作）全部保留，**只是把它们从"列表式 UI"统一到"画布式 UI"**。

---

## 2. 目标用户

v0.2 的 6 类用户全部保留，但角色与场景描述更新以反映画布优先：

### 主用户（80% 场景）

#### U1. Lecture 主导型本科生
- **每天的核心动作**：上课时一边看 slides 一边写 notes。
- **在画布上的体现**：Lecture 空间里左边是 PDF node（slides），右边是 note node 网格，note 通过 "anchors to" 关系链接到具体的 slide 节点。
- **关键体验**：note ↔ slide 的双向跳转、批注延迟、Cornell cue 提示。

#### U2. 复习主导型本科生
- **核心动作**：考前几天从已有 notes / slides / papers 里生成复习材料。
- **在画布上的体现**：复习空间里有 AI 助手，能根据选中的 nodes（note / cue / paper）生成 study guide / flashcard / mind map draft。
- **关键体验**：AI source-grounded、provenance 可见、draft 可编辑可拒绝。

#### U3. 读 paper 主导型研究型学生
- **核心动作**：读大量 papers，理清它们之间的关系（cites / extends / contradicts / same method）。
- **在画布上的体现**：Literature 空间是 paper 节点的网状图，关系用 edge 表达。
- **关键体验**：Zotero 导入、citation 自动绑定、关系图导航、跨 space 引用。

### 次用户（20% 场景）

#### U4. 统计/编程课程学生
- 画布上需要 code node，能运行 R / Python snippet，能 attach dataset。
- v0.2 Stage Five 范围，v0.3 不主动投入。

#### U5. 平板手写型学生
- 画布的 pen support、handwriting node、ink annotation。
- v0.2 Stage One 已实现大部分，v0.3 保证画布上也能用。

#### U6. 高级用户（Obsidian / Notion / Anki 重度用户）
- 导出 contract 必须保留：PDF / Markdown / Obsidian vault / Anki deck。
- v0.3 不做新格式，**确保现有导出不被破坏**。

---

## 3. 核心问题（v0.2 的 5 个问题 + 1 个新增）

v0.2 提了 5 个核心问题。v0.3 全部继承，**新增第 6 个**：

### P1-P5: 继承 v0.2
1. 大学生学习资料天然是多格式。
2. Lecture slides 和个人 notes 经常分离。
3. 传统笔记软件不适合复杂 academic workflow。
4. AI 复习工具如果没有来源会不可信。
5. 导出和打印仍然非常重要。

### P6. **学习活动被工具切换打碎（v0.3 新增）**

> 学生的同一个认知活动（例如"理清 paper A 和 paper B 的关系"）在 Notion 写文字、在 Zotero 看引用、在 Miro 画图、在 ChatGPT 问问题。**工具切换本身就是学习效率的杀手**。

StudyKit v0.3 的解法是：把"写、看、画、问"统一到**同一张画布**。你看 paper、看 slides、写 note、画关系、问 AI——全在一张画布上完成，没有 mode 切换。

---

## 4. 画布优先交互范式（核心新增）

### 4.1 CanvasSpace 抽象

`CanvasSpace`（画布空间）是 StudyKit v0.3 的**第一类核心对象**，对应"用户当前在哪个空间工作"。

每种空间都有自己的：
- **模板**（初始 node 布局）
- **可用节点类型**（部分通用，部分专用）
- **可用关系类型**
- **导航/场景**（scenes）
- **AI scope**（哪些 source 可被 AI 引用）

#### 空间类型与对应 v0.2 实体

| Space Kind | 含义 | 对应 v0.2 实体 | 模板名 |
|---|---|---|---|
| `module` | 一门课的画布 | Module | Lecture Network |
| `lecture` | 一节 lecture 的画布 | Lecture | Slide-Notes Network |
| `literature` | 一个文献项目 | LiteratureProject | Paper Relation Network |
| `revision` | 一次复习会话 | 新增 | Revision Network |

#### 一个关键设计：Lecture Space 嵌入 Module Space

> Module 空间是一张大画布。Lecture 是这张画布上的一个**子画布区域**（用 group node 或 frame 表达），点进去就 zoom in 进入 lecture 空间。
>
> 这避免"module 列表 / lecture 列表"的双层树，**所有东西都是画布上的节点**。

### 4.2 节点类型系统（NodeType）

v0.2 的画布工具栏把所有 node 类型平铺成一排按钮（Paper / PDF / Note / Question / Text / Shape / Group...），学生一眼看不出"我应该用哪个"，这是用户痛点："画布上的元素有点乱"。

v0.3 的解法是**按"工具"分类**——每个 node 类型归到一个工具组，工具栏从平铺改为 tab 切换。节点本身保持稳定，只是它们被组织得更清晰。

#### 工具组与节点映射

| 工具组（Toolbar Tab） | 节点类型 | 用途 |
|---|---|---|
| **📄 文档** | `pdf`, `paper`, `citation`, `file` | 学习材料：PDF slides、paper、citation 引用、文件附件 |
| **✏️ 笔记** | `note`, `cue`, `question` | 主动构建知识：富文本笔记、Cornell 提示、active recall 问题 |
| **🧮 内容块** | `equation`, `code`, `image` | 结构化内容：公式、代码、图片 |
| **📦 组织** | `group`, `frame` | 容器：把节点折叠/命名（group），画大画布分栏（frame，如 lecture 边界） |
| **🎨 表达** | `text`, `callout`, `shape`, `divider`, `arrow` | 视觉表达：独立文本块、callout 提示框、几何形状、分隔线、装饰箭头 |

> 关键设计：**前 4 个工具组（文档/笔记/内容块/组织）是"内容型节点"，承载真正的学习信息。** 最后一个工具组（表达）是"工具型节点"，用于视觉组织和表达，本身不承载知识。
>
> 在画布设置里，学生可以选择**隐藏"表达"工具组**，让画布保持"纯内容"。这是 v0.3 给学术向用户的"清净模式"。

#### 各 space 默认可见的工具组

| Space | 默认显示 | 默认隐藏 |
|---|---|---|
| `lecture` | 文档 / 笔记 / 内容块 / 组织 | 表达（学生可手动打开） |
| `module` | 文档 / 笔记 / 内容块 / 组织 | 表达 |
| `literature` | 文档 / 笔记 / 组织 | 内容块 / 表达 |
| `revision` | 笔记 / 内容块（仅 flashcard） | 文档 / 表达 |

> 这样新用户进 lecture 看到的是"PDF + Note + Equation"这一套学术工具，不会被 Shape/Arrow/Callout 这些"画图元素"干扰。

#### 完整节点清单（11 内容型 + 5 表达型 = 16 种）

**内容型节点**

| Node | 标识 | 工具组 | 用途 | 数据后端 |
|---|---|---|---|---|
| **PDF node** | `pdf` | 📄 文档 | 渲染 PDF 文档，可批注，可分页 | source_documents + source_pages |
| **Paper node** | `paper` | 📄 文档 | 一篇 paper（摘要、cite、extracted data） | literature_papers |
| **Citation node** | `citation` | 📄 文档 | 一个引用条目（独立于 paper） | citation_items |
| **File node** | `file` | 📄 文档 | 文件附件 | attachments |
| **Note node** | `note` | ✏️ 笔记 | 富文本笔记（含 block 列表） | note_blocks |
| **Cue node** | `cue` | ✏️ 笔记 | Cornell-style 提示（短、问题式） | note_blocks (block_type=cue) |
| **Question node** | `question` | ✏️ 笔记 | 待解答的问题（active recall） | note_blocks (block_type=question) |
| **Equation node** | `equation` | 🧮 内容块 | LaTeX 公式 | note_blocks (block_type=equation) |
| **Code node** | `code` | 🧮 内容块 | 代码块 | note_blocks (block_type=code) |
| **Image node** | `image` | 🧮 内容块 | 图片、截图、figure | attachments |
| **Group node** | `group` | 📦 组织 | 把多个 node 折叠/命名 | canvas_groups |
| **Frame node** | `frame` | 📦 组织 | 大画布上的区域/分栏 | canvas_groups (kind=frame) |

**表达型节点（v0.2 已有的 shape/text 不删，归到"表达"组）**

| Node | 标识 | 工具组 | 用途 | 状态 |
|---|---|---|---|---|
| **Text node** | `text` | 🎨 表达 | 自由文本块（独立于 note 树） | v0.2 已有，重分类 |
| **Callout node** | `callout` | 🎨 表达 | 提示/警示/quote 框 | v0.2 部分功能，v0.3 提升为独立 node |
| **Shape node** | `shape` | 🎨 表达 | 矩形/椭圆/三角形等几何形状 | v0.2 已有，重分类 |
| **Divider node** | `divider` | 🎨 表达 | 分隔线 | v0.3 新增 |
| **Arrow node** | `arrow` | 🎨 表达 | 装饰箭头（非数据关系） | v0.3 新增 |

#### 复习专用节点（revision space 专用，v0.3.0 一起出）

| Node | 标识 | 工具组 | 用途 |
|---|---|---|---|
| **Flashcard node** | `flashcard` | ✏️ 笔记 | 一张复习卡（前后两面） |
| **AI draft node** | `ai_draft` | 🧮 内容块 | AI 生成的 draft（study guide / mind map） |

> 用户的反馈是"Revision space 直接出 v0.3.2 内容"，所以 flashcard / ai_draft node 在 v0.3.0 一起出，而不是分两批。

#### v0.3 明确不做的节点

- ❌ **AI Chat node**（v0.2 有 `CanvasAIAssistant`）—— AI 是工具不是节点，统一放到画布右下角的浮层助手（v0.3.2 实装）。v0.3.0 AI 仅通过 ⌘K 唤起。
- ❌ **Sticky note** 之类"装饰贴纸"——属于"表达"工具组的衍生，不单独建类型。

### 4.3 关系类型系统（RelationType）

| Relation | 含义 | 适用 node | UI 表现 |
|---|---|---|---|
| `anchors-to` | 笔记/批注锚定到 PDF 某一页 | note / cue / annotation → pdf | 实线箭头 |
| `cites` | 引用 | paper / note → paper / citation | 蓝色实线 |
| `extends` | 扩展/继承 | paper / note → paper / note | 虚线 |
| `contradicts` | 矛盾/反例 | paper / note → paper / note | 红色虚线 |
| `defines` | 定义/解释 | note → equation / term | 紫色细线 |
| `related` | 通用关联 | any → any | 灰色细线 |
| `groups` | 包含关系 | group → node | 容器边框 |

#### 关系编辑器（v0.2 已有，需升级）

v0.2 的 `RelationTypeMenu.tsx`（472 行）已经实现了一组关系预设，v0.3 收口到上面 7 种，去掉 v0.2 里过细的细分。

### 4.4 场景（Scenes）与导航

v0.2 的 `CanvasSceneNavigator` 已实现"画布上保存多个 viewport / scene"。v0.3 给每个 CanvasSpace 预置几个 scene：

#### Lecture Space 默认 scene
- "Slides Overview"：zoom out，看所有 PDF 缩略
- "Current Page Focus"：zoom in 到当前 slide
- "Cue Review"：只看 cue nodes（用 canvas search 过滤）
- "Export View"：导出预览布局

#### Literature Space 默认 scene
- "All Papers"：所有 paper 节点
- "Cited-by Tree"：以某篇 paper 为根的引用树
- "Method Cluster"：按 method 自定义字段聚类
- "Recent Reads"：按 reading_status 过滤

#### Revision Space 默认 scene
- "Active Recall"：只显示 question / flashcard 节点
- "Provenance Trail"：按 AI draft 跳回 source node
- "Weak Spots"：按 confidence / 错题率排序（v0.3 仅 UI 预留，数据 v0.4 接 spaced repetition）

### 4.5 画布上的"软模式"（Soft Modes）

v0.2 的硬 mode 切换（modules / literature / canvas）消失。取而代之的是**画布上的软模式**——

| 软模式 | 触发 | 表现 |
|---|---|---|
| **Select** | 默认 / Esc | 选择/拖动 |
| **Connect** | 按住 C / 从节点 port 拖出 | 画关系 |
| **Annotate** | 双击 PDF node | PDF 批注工具栏（沿用 v0.2 AnnotationLayer） |
| **Cornell** | ⌘⇧C 切换 | 临时把 note node 切换到 Cornell cue 模式（只显示 cue 列） |
| **AI Ask** | ⌘K 唤起 AI | 浮层 AI 助手，作用于当前选区（v0.3.2 实装） |
| **Present** | ⌘⇧P | 隐藏 UI chrome，进入 presentation mode（用于课堂展示或自我复习） |

#### 多 PDF 支持（1 lecture → N PDF）

v0.2 的 lecture 在 UI 上只显示一个 PDF（`active_source_document_id`），但 schema 上 `source_documents.lecture_id` 是 FK 关系，**一个 lecture 可以挂多个 source_document**。

v0.3 暴露这个能力：

- Lecture space 画布上，**每个 PDF 一个 node**。例如 lecture 上传了 3 个 PDF 文档（slides / worksheet / reading），画布上就有 3 个 PDF node。
- 学生可以拖动每个 PDF node 自由摆放。
- note 通过 `anchors-to` 关系指向**具体 PDF 的具体 page**，而不是"指向 lecture"。
- `lectures.active_source_document_id` 字段保留，作为"打开 lecture 时默认 focus 的 PDF"。

> **不支持**：1 PDF 跨多个 lecture 共享。v0.3 维持 v0.2 的 1:1 边界，避免同步和权限复杂性。学生如果需要"这个 PDF 在两个 lecture 都用"，目前只能上传两次（v0.3 接受这个 trade-off）。

---

## 5. 典型用户场景（重写以反映画布优先）

### S1. 上课时做 lecture notes（最核心）

1. 学生登录 → 默认进入**上次打开的 lecture space**（首次登录有 onboarding）。
2. 画布上左边是 PDF node（slide deck），右边是 note node 网格。
3. 老师讲到第 5 页时，学生点 PDF node 的 "Open" → 进入 PDF 批注视图（v0.2 已实现 AnnotationLayer）。
4. 在右侧 note 节点上写新 note → 自动 `anchors-to` 关系建立到当前 page。
5. 按 `C` 切到 Cornell cue 模式 → 写几个 active recall question。
6. ⌘S → 自动保存（v0.2 已实现）+ 上传 operation log 到云端。

**画布相对 v0.2 的优势**：PDF node 可以被**多个 note 节点同时引用**（不同 student 角色、不同主题），不需要切换 layout。布局自由。

### S2. 课后整理：缺失内容检测

1. 学生在 lecture space 画布上点 "Cue Review" scene。
2. 画布只显示 cue 节点，按 page 排序。
3. 学生发现 page 7-9 没有 note → 在画布上拖一个 "Create Note" 到 PDF node 的 page 7 区域。
4. 继续写 note，自动锚定到 page 7。

**画布相对 v0.2 的优势**：可视化"哪些 slide 还没被 note 覆盖"，比 v0.2 的列表式 missing-content detection 更直观。

### S3. 读 paper 并连接课堂内容

1. 学生从 Zotero 导入 12 篇 paper → 自动在 **literature space** 画布上铺成 paper 节点。
2. AI 助手（⌘K）问："这些 paper 中哪些方法相同？" → AI 扫 paper 节点的 extracted data → 返回"3 篇用了 fMRI, 2 篇用了 EEG" → 学生在画布上把这些 paper 用 `related(method=fMRI)` 关系连起来。
3. 学生切到 module space，把其中 2 篇 paper 节点**拖入** lecture space（用 `cites` 关系连到对应 note node）。
4. 导出时，paper 的引用信息自动进入笔记导出。

**画布相对 v0.2 的优势**：跨 space 拖拽 = 显式的关系建立，比 v0.2 的"在 lecture note 里插入 citation"更符合学生的认知模型。

### S4. 生成复习材料

1. 考试前 3 天，学生在 module space 画布上框选 4 个 lecture 的所有 cue 节点。
2. ⌘K 唤起 AI 助手 → "Generate study guide from selected sources"。
3. AI 弹出 draft 面板（不是覆盖原 note，是**新建** AI draft 节点）。
4. 学生 review draft，看到 provenance 标签（"基于 23 个 note blocks, 8 个 cue blocks, 4 篇 paper"）。
5. 接受 → 节点变成正式 node（带 `ai-provenance` 元数据，可追踪）。
6. ⌘⇧P 切 Present 模式 → 自我讲解。

**画布相对 v0.2 的优势**：AI draft 是画布上的一个 node，可以**继续被关系化**（例如"这段总结 contradicts 那篇 paper 的 finding"），复习过程本身在积累知识。

### S5. 平板手写

1. iPad + Pencil → 画布的 pan/zoom 跟手（ReactFlow 已有，需要 polish 延迟）。
2. 在 PDF node 上 ink annotation（v0.2 已实现）。
3. 手写转文字？v0.3 不做（依赖第三方 API，scope 太大）。

### S6. 协作（v0.3 不做，Stage Six）

仍然 read-only 导出，不做实时多人编辑。

---

## 6. 信息架构

### 6.1 侧栏（Sidebar）

v0.2 的 695 行 SidebarContent 保留，但内容重新组织：

```
┌─ 顶栏（全局）
│  • Logo
│  • Sync Status
│  • ⌘K 搜索
│  • AI 助手按钮
│  • 用户头像
│
├─ 空间导航
│  ▸ Recent (最近 10 个 space)
│  ▸ Modules
│      └─ Module A (展开)
│           └─ Lecture 1 (今天)
│           └─ Lecture 2
│      └─ Module B
│  ▸ Literature
│      └─ Project: fMRI Review
│  ▸ Revision (Stage Three 后)
│  ▸ Trash
│
└─ 工具区
   • New Module
   • New Literature Project
   • Zotero Connect
   • Settings
```

### 6.2 路由结构（首次引入 react-router）

| Path | Component | 说明 |
|---|---|---|
| `/` | Redirect to `/m/recent` | 默认最近 lecture |
| `/m/:moduleId` | `<ModuleCanvas>` | 整门课的画布 |
| `/m/:moduleId/l/:lectureId` | `<LectureCanvas>` | 一节 lecture 的画布 |
| `/lit/:projectId` | `<LiteratureCanvas>` | literature space |
| `/rev/:revisionId` | `<RevisionCanvas>` | 复习 space |
| `/settings` | `<SettingsPage>` | 设置 |
| `/trash` | `<TrashPage>` | 回收站 |
| `/onboarding` | `<OnboardingPage>` | 首次引导 |

### 6.3 主区（Main）

主区是一个 `<CanvasShell>` 容器，根据路由参数选择具体的 `<CanvasSpace>` 组件：
- `<LectureCanvas>`（复用 + 改写 v0.2 LiteratureCanvas）
- `<ModuleCanvas>`（新）
- `<LiteratureCanvas>`（v0.2 改名复用）
- `<RevisionCanvas>`（v0.3 后期）

---

## 7. P0-P3 路线

### P0: 画布优先骨架（v0.3.0）—— 预计 6-8 周

**目标**：把"画布优先"从口号变成可点击的产品。

1. ✅ 引入 `react-router` v6，按 §6.2 配置路由
2. ✅ 拆 `useStore` 为 6 个 slice：`workspaceSlice`, `modulesSlice`, `lecturesSlice`, `noteBlocksSlice`, `litSlice`, `canvasSlice`, `uiSlice`
3. ✅ 撤掉 `sidebarMode` 状态机（由路由参数替代）
4. ✅ 撤掉 `currentLayout`（硬性 slide_left_notes_right / slide_top_notes_below），改为画布上的 PDF node + note node 自由布局
5. ✅ 抽 `<CanvasSpace>` 通用容器，从 LiteratureCanvas 提取 paper / note / question / pdf node 注册
6. ✅ 把 LectureView 重构为 `<LectureCanvas>`：PDF = 画布上的 `pdf` node，notes = 画布上的 `note` node
7. ✅ Module 页改为 `<ModuleCanvas>`：把 lectures 显示为 group / frame 节点
8. ✅ **画布工具重新分类**：v0.2 的 `ShapeNode` / `TextNode` 等"工具型节点"归到 🎨 表达 工具组，工具栏从平铺改为 5 个 tab（📄 文档 / ✏️ 笔记 / 🧮 内容块 / 📦 组织 / 🎨 表达），新用户进 lecture 默认只看到前 4 个
9. ✅ Cornell tab 改回 "Cornell Cues"
10. ✅ 修 App.tsx 单文件 600 行问题（拆 5 个 route 组件文件）
11. ✅ **1 lecture → N PDF 支持**：画布上每个 PDF 一个 node，学生可上传多份 PDF 到同一 lecture
12. ✅ **Revision space v0.3.0 一起出**（用户决策）：flashcard node + revision canvas + ai_draft node 占位

**P0 验收**：
- 打开任意 lecture，**画布上能看到 PDF node（支持多 PDF）和 note node 自由排列**。
- 在 lecture canvas 上可以拖动 PDF node、note node、画 `anchors-to` 关系。
- 切换 module / literature / revision 走路由，没有 sidebarMode 字符串。
- 工具栏 5 tab 切换正常，"表达"组可隐藏，画布进入"清净模式"。
- Revision space 路由可访问，flashcard / ai_draft node 可创建（即使 AI 内容生成是 v0.3.2 完善）。
- 旧的 PDF / Markdown 导出仍然能跑。
- 旧数据 100% 兼容（modules / lectures / note_blocks / annotations / attachments 字段无破坏）。

### P1: 画布体验打磨（v0.3.1）—— 预计 4 周

1. 画布性能：100+ node 时 pan/zoom ≥ 55fps（M1 MacBook 基准）
2. 软模式切换：`C` / `⌘⇧C` / `⌘K` / `⌘⇧P` 全部可用
3. 跨 space 拖拽：paper node 从 literature 拖到 lecture，自动建立 `cites` 关系
4. Scene 默认值：每个 space 类型有 4 个默认 scene
5. Note node 内 NoteEditor 拆模块：当前 1310 行拆成 5 个子组件

**P1 验收**：
- 200 个 node 时画布交互无明显卡顿。
- 软模式快捷键全部可发现（⌘? 弹出快捷键面板）。
- 一个学生从 literature 拖 paper 到 lecture 不到 10 秒完成。

### P2: AI 复习（v0.3.2 = Stage Three 的入口）—— 预计 6 周

1. ⌘K 唤起 AI 助手浮层
2. Source-grounded：AI 只能基于选中的 node 生成
3. AI draft node 落地（不是覆盖原 note）
4. Provenance 元数据：每个 AI 节点记录它来自哪些 source node
5. Revision Canvas：复习专用空间，AI draft 自动生成 flashcard 节点

**P2 验收**：
- AI 输出 100% 有 provenance。
- 任何 AI 生成的内容都可以一键 reject。

### P3: 协作与导出（v0.4）—— 长期

1. 多人实时协作（v0.4 早期）
2. 分享 lecture canvas 的 read-only 链接
3. 导出 Anki deck / R Markdown / Quarto / Jupyter

---

## 8. 与 v0.2 的差异速查表

| 维度 | v0.2 | v0.3 |
|---|---|---|
| 顶层 mode | `modules` / `literature` / `canvas` 三选一 | 路由 + 空间（module / lecture / literature / revision） |
| 笔记布局 | 硬性 slide 左 / notes 右 | 画布自由布局 |
| 节点类型 | block 列表（heading / paragraph / list ...） | 16 种节点（11 内容型 + 5 表达型），按 5 工具组分类 |
| 工具栏 | 平铺所有 node 按钮 | 5 tab 切换（📄 文档 / ✏️ 笔记 / 🧮 内容块 / 📦 组织 / 🎨 表达） |
| 文献画布 | 独立的 LiteratureCanvas | 复用为 LiteratureCanvas space（其他 space 用同一套范式） |
| Cornell 标签 | 叫 "Annotation" | 改回 "Cornell Cues" |
| PDF 支持 | 1 lecture → 1 PDF（UI 限制） | 1 lecture → N PDF（schema 已支持，UI 暴露） |
| 跨 lecture 共享 PDF | 不支持 | 不支持（v0.3 维持） |
| Revision space | 没有 | v0.3.0 一起出 |
| AI 入口 | 散落在 canvas / summary table / citation | ⌘K 全局浮层助手（v0.3.0 占位，v0.3.2 完善） |
| 路由 | 无（靠 sidebarMode 字符串） | react-router v6 |
| Store | 350 行单 store | 6 个 slice |

---

## 9. 产品边界（v0.3 不会做的事）

1. **不做白板化**。Shape、Arrow、Divider 等"表达"工具归到 🎨 表达 工具组，默认隐藏，不喧宾夺主。v0.3 不在画布上推动学生画自由图形。
2. **不做跨 lecture 共享 PDF**。1 lecture → N PDF 支持，但 1 PDF → N lecture 不做。v0.4 范围。
3. **不做实时多人协作**。v0.4 范围。
4. **不做 marketplace / 插件商店**。Stage Four 范围，且 v0.3 不做插件 SDK。
5. **不写回 Zotero**。v0.2 Stage Two 默认 read-only，v0.3 维持。
6. **不替代 IDE**。Code node 不内置 R / Python 执行。
7. **不默认公开分享**。所有 canvas 默认私有。
8. **不牺牲导出**。v0.2 PDF / Markdown 导出必须 100% 可用。

---

## 10. 验收标准（v0.3.0 release gate）

### 10.1 数据兼容性

- [ ] 现有 module / lecture / note_block / annotation / attachment 数据全部可读。
- [ ] 现有 PDF / Markdown 导出功能不变。
- [ ] 现有 Zotero 同步功能不变。

### 10.2 体验验收

- [ ] 新用户 60 秒内能打开一个 lecture，导入 PDF，写第一条 note。
- [ ] 旧用户登录后，**第一次就能在 lecture 里看到 PDF 和 note 作为画布上的节点**（默认布局）。
- [ ] 切换 module / literature 不再是 mode 切换，而是路由切换（URL 可分享）。

### 10.3 性能验收

- [ ] Lecture 画布渲染 50 个 node 流畅（≥ 55fps pan/zoom）。
- [ ] 打开 lecture 画布的 TTI ≤ 1.5s（M1 MacBook / 普通宽带）。

### 10.4 代码质量

- [ ] `App.tsx` ≤ 200 行。
- [ ] `SidebarContent` ≤ 400 行。
- [ ] 任何组件文件 ≤ 500 行（超过则强制拆分）。
- [ ] 单元测试覆盖：节点 CRUD、关系编辑、scene 切换、撤销/重做。

---

## 11. 文档与配套

- `studykit_v0.3_system_design_cn.md`：本规范的**系统设计**配套（路由、store 切片、CanvasSpace 实现、迁移策略）。
- `studykit_v0.3_migration_plan_cn.md`：从 v0.2 迁移到 v0.3 的步骤（**待写**）。
- 原 `studykit_full_product_introduction_cn.md` 和 `studykit_post_stage_one_llm_coding_prd_guide.md` 保留作为历史文档，v0.3 不覆盖。

---

## 12. 用户已拍板的关键决策

| 决策点 | 选择 | 影响 |
|---|---|---|
| 画布默认布局 | **PDF 左、note 网格右**（layout-default_opt1） | Lecture 打开即有 v0.2 熟悉度，PDF 节点可拖动 |
| 画布工具分类 | **不删除 Shape/Text，而是按工具重新分类**（5 tab：文档/笔记/内容块/组织/表达） | v0.2 ShapeNode/TextNode 保留，归到 🎨 表达 组，工具栏 tab 化 |
| Revision space 时机 | **v0.3.0 一起出**（revision-space_opt3） | P0 范围扩大，flashcard / ai_draft node 一起实现 |
| PDF 共享 | **1 lecture → N PDF 支持，不支持 1 PDF → N lecture** | UI 暴露 v0.2 schema 已有的能力，跨 lecture 共享留 v0.4 |

---

## 13. 立即可执行的下一步

1. **审阅 v0.3 product_spec + system_design 两份文档**。任何不同意的地方告诉我，我现场改。
2. **审阅 system design 里的开放问题**（`studykit_v0.3_system_design_cn.md` §13）——主要是 store 切片命名、CanvasSpace 的具体 props 接口、PR 拆分粒度。
3. **确认后开工**：从 PR 1（react-router 引入）开始，按 system design §9 的 12 个 PR 顺序推进。
4. **建立 worktree**：PR 1 开始前需要 `git worktree add .worktrees/v0.3-router -b feature/v0.3-router`，所有改动在 worktree 里做。
5. **保留 v0.2 文档**：旧 PRD 仍可作为历史参考，新文档**不覆盖** v0.2。
