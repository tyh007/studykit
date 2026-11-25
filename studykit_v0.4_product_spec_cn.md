# StudyKit v0.4 产品需求文档（PRD）

> 版本：0.4.0-draft  
> 日期：2026-07-20  
> 文档状态：方向重构稿  
> 产品主题：Two Modes, One Knowledge System  
> 配套文档：AI 与认知画布规范、系统设计、路线图与研究计划、决策日志

---

## 0. Executive Summary

StudyKit v0.4 将产品重构为两个顶层工作上下文：

- **Study Mode**：围绕课程、lecture、理解、练习和复习形成学习闭环；
- **Research Mode**：围绕研究问题、论文、证据、论点、任务和输出形成研究闭环。

两个 Mode 共用本地知识库、来源追踪、搜索、AI、画布和导出能力。它们不是两个独立产品，也不以不同数据库隔离。

v0.4 不再要求所有活动发生在画布上。画布是用于综合、连接、头脑风暴和结构化推理的认知视图；上课记录、PDF 阅读、证据表、复习队列和长文写作分别使用更低摩擦的专用视图。

产品默认本地优先：下载安装后无需账号即可建立 workspace，核心资料和 AI 索引可以完全留在设备上。用户可以选择云同步、远程 AI 或团队能力。

---

## 1. 产品愿景

### 1.1 一句话定位

**StudyKit 是一个本地优先、证据驱动的 AI 学习与研究工作台，让学生在 Study Mode 中真正理解和复习课程，在 Research Mode 中建立问题、证据与论点；AI 通过追问、查证和反馈参与思考，而不是替学生完成思考。**

### 1.2 长期愿景

- 成为学生从课程输入到研究输出的 personal academic operating system；
- 让学习材料、用户理解、疑问、证据和产出保持可追踪的连接；
- 把 AI 从独立聊天工具转化为嵌入工作流的认知协作者；
- 同时尊重本地所有权、离线可靠性和开放导出；
- 帮助学生形成更强的理解、检索、论证和元认知能力。

### 1.3 产品承诺

1. **Your work stays yours**：本地使用不要求登录，用户能完整导出和备份。
2. **Every answer has context**：AI 结果显示来源范围和证据位置。
3. **Agency before automation**：AI 提供解释、提示、生成和检查，但不强制用户遵循某一种学习法或研究流程。
4. **One object, many views**：内容不会因为切换表格、阅读器、画布或复习视图而复制。
5. **Fast enough for class**：记录、翻页、书写和保存必须适合实时课堂。

### 1.4 产品姿态：自由，但不失去支撑

- StudyKit 是认知工作台，不是老师、督导或流程审批者；
- 用户可以从空白画布、快速笔记、PDF、搜索或项目首页任意开始；
- 类型、关系、模板和推荐都是可选支架，可以晚一点添加，也可以完全忽略；
- 同一对象可在 Canvas、Document、Table、Timeline、Review 等视图间自然切换；
- AI 根据当前选择和意图出现，不要求用户学习 prompt engineering；
- “简约”指减少必须理解的概念和操作，不是删掉深度能力；高级能力通过渐进披露出现；
- 系统可以提醒风险和来源缺口，但不得用阻断、评分或道德化语言管理用户。

---

## 2. 目标用户与优先级

### 2.1 Primary Persona A：课程学习型本科生

- 同时处理 slides、课堂讲解、个人笔记、作业和考试；
- 需要在课堂中快速记录，课后补足理解，考前主动回忆；
- 不愿维护复杂知识管理系统；
- 价值时刻：从一页 slide 形成自己的解释，并在之后正确回忆。

### 2.2 Primary Persona B：研究型学生与早期研究者

- 需要阅读多篇论文、比较方法和结论、发展论点并管理研究进度；
- 当前常在 Zotero、PDF reader、笔记软件、表格、ChatGPT 和写作工具之间切换；
- 需要从任何 claim 回到证据原文；
- 价值时刻：从多篇来源形成一个经过证据支持和反例检查的论点。

### 2.3 Secondary Persona

- 平板手写型 STEM 学生；
- 医学、法律等高强度记忆与文献专业学生；
- Obsidian、Notion、Anki、Zotero 高级用户；
- 需要本地隐私或网络不稳定环境的用户。

### 2.4 暂不优先

- 只需要通用待办或团队项目管理的用户；
- 只需要通用白板绘图的用户；
- 希望 AI 自动代写整篇作业的用户；
- 需要成熟实验计算环境替代 Jupyter/RStudio 的用户。

---

## 3. 用户问题

### P1：课程输入与个人理解分离

Slides、教材、录音、课堂解释和个人笔记分散，学生很难知道自己的某条笔记来自哪里，也难在复习时回到上下文。

### P2：研究资料被困在单篇文献中

Highlight 和 annotation 容易停留在单篇 PDF 内，不能自然转化为跨论文 claim、evidence、counter-evidence 和研究输出。

### P3：现有工具优化“保存”，没有优化“学会”

大量产品帮助生成摘要和卡片，但没有系统推动用户先解释、尝试检索、暴露错误、获得反馈并再次练习。

### P4：AI 与真实任务脱节

Chat 窗口要求用户自己重新描述上下文。AI 不理解当前选区、学习目标、研究问题、历史判断和未解决疑问，生成结果又容易脱离来源。

### P5：工具复杂度本身成为认知负担

自由画布、插件、格式和多层导航如果没有渐进披露，会迫使用户维护系统，而不是学习或研究。

### P6：云端依赖削弱可靠性与所有权

课堂网络、敏感论文、API 成本和长期数据可迁移性要求 StudyKit 在没有账号、网络和远程模型时仍然可用。

---

## 4. 产品模型：Two Modes, One Knowledge System

### 4.1 顶层信息架构

```text
StudyKit
├── Home
│   ├── Continue
│   ├── Inbox
│   ├── Recent sources
│   └── Today: review / research tasks
├── Study Mode
│   ├── Courses
│   ├── Lectures
│   ├── Study canvases
│   └── Review
├── Research Mode
│   ├── Projects
│   ├── Library
│   ├── Evidence & claims
│   ├── Research canvases
│   └── Outputs
└── Shared
    ├── Global search
    ├── AI intent bar
    ├── Local files & sync
    ├── Export / backup
    └── Settings
```

### 4.2 Mode 切换原则

- 顶层只显示 Study / Research，不再显示独立 Canvas mode；
- 系统记住每个 Mode 上次的位置；
- 切换 Mode 不清空选择、不销毁编辑状态；
- 跨 Mode 引用通过对象链接完成，不通过复制文件完成；
- 用户可将一篇 paper 用作 Study source，也可把一条 lecture insight 发送到 Research project；
- 全局搜索同时搜索两个 Mode，并清楚标识对象归属和引用位置。

### 4.3 共享核心对象

| 对象 | 含义 | Study Mode | Research Mode |
|---|---|---|---|
| Source | PDF、slide、网页、图片、音频、引用条目 | 课程材料 | 论文与研究资料 |
| Note | 用户自己的记录与解释 | Lecture note | Literature / project note |
| Concept | 可复用概念 | 课程知识点 | 理论或术语 |
| Question | 未解决或用于回忆的问题 | Cue / practice | Research question |
| Claim | 可被支持或反驳的陈述 | 学习解释 | 研究论点 |
| Evidence | 带来源位置的证据 | 例子、定义、推导 | 数据、引用、发现 |
| Task | 可执行下一步 | 作业、复习 | 阅读、分析、写作 |
| Output | 面向提交或分享的产出 | Study guide、答案 | Outline、report、paper draft |
| Relation | 对象之间的语义关系 | explains、example-of | supports、contradicts、extends |

对象是数据层实体；卡片、列表行、画布节点、复习卡和文档段落只是它们的不同呈现。

---

## 5. Study Mode

### 5.1 用户目标

帮助学生完成：**接触材料 → 形成自己的理解 → 发现缺口 → 主动回忆 → 获得反馈 → 巩固**。

### 5.2 核心页面

#### Course Home

- 继续上次 lecture；
- 本周 lectures、资料和任务；
- 待复习问题与薄弱概念；
- 最近新增但尚未整理的 inbox 内容；
- 不以整门课自由画布作为默认首页。

#### Lecture Focus

- 默认 PDF/slide 左、快速笔记右；
- Note 自动链接当前页和时间点；
- 支持多 PDF，但同时只突出一个 active source；
- 课堂模式隐藏非必要工具，保存和翻页优先；
- 支持键盘、触控和 Pencil；
- 一键将笔记转为 Question、Claim、Concept 或 Evidence。

#### Understand

- 对选中内容执行 Explain、Compare、Example、Derive、Challenge；
- 用户可以先写自己的解释，再让 AI 评估；
- 系统显示“我理解了 / 仍不确定 / 稍后复习”；
- 未解决问题自动进入 Review inbox。

#### Study Canvas

- 用于课后综合、概念关系、问题求解和头脑风暴；
- 可从 Lecture Focus 选中对象创建 canvas view；
- 画布不复制内容，只保存对象位置、折叠和视图设置；
- 支持隐藏答案、按概念聚焦、演示和自我讲解。

#### Review

- Question 和 Cue 进入主动回忆队列；
- 先显示问题，用户回答后再显示来源和反馈；
- AI 可判断答案覆盖度并指出缺失，但不替用户默认为正确；
- v0.4 首发采用简单复习状态，完整 spaced repetition 在数据验证后迭代。

### 5.3 Study Mode 核心场景

#### S-STUDY-01：课堂快速记录

1. 打开 Course，进入今天的 Lecture；
2. 导入或打开 slide；
3. 在当前页旁输入笔记；
4. 系统自动保存并建立 source link；
5. 用户按快捷键将一句话标记为 Question；
6. 下课后问题出现在 Review inbox。

目标：开始记录不超过 30 秒；连续输入、翻页和保存不被 AI 或画布打断。

#### S-STUDY-02：形成理解而非复制摘要

1. 用户框选一段 slide 或 note；
2. 选择“Explain in my own words”；
3. 用户先输入自己的解释；
4. AI 对照来源指出正确部分、缺失步骤和潜在误解；
5. 用户修订并保存为 Concept / Claim；
6. 系统生成一个未来的 retrieval question 草稿，用户确认后加入 Review。

#### S-STUDY-03：考前复习

1. 用户选择课程和考试日期；
2. 系统聚合 Questions、Cues、低置信度 Concepts 和错题；
3. 用户逐题回忆；
4. AI 只在提交后给反馈和来源跳转；
5. 错误概念回到 Study Canvas 或原始 lecture 上下文。

---

## 6. Research Mode

### 6.1 用户目标

帮助研究者完成：**定义问题 → 收集来源 → 阅读提取 → 建立证据 → 比较与质疑 → 发展论点 → 管理下一步 → 形成输出**。

### 6.2 核心页面

#### Research Project Home

- Research question / objective；
- 当前阶段、milestones 和 next actions；
- 未阅读、阅读中、已提取、已使用的 sources；
- 未解决冲突、证据缺口和最近 decisions；
- 当前 output / outline 进度；
- Collaborators、mentions、待 review 内容和最近团队活动；
- 个人 scratch 与共享项目内容明确分层。

#### Library & Reader

- Zotero 导入和本地 PDF 导入；
- 状态、标签、作者、年份、自定义字段；
- PDF highlight / annotation 与项目 note 同屏；
- 任何摘录都保留 page、bounding box、document checksum；
- 支持全项目 annotation 搜索。

#### Evidence & Claims

- Claim 列表或 matrix；
- 每个 Claim 展示 supporting、contradicting 和 missing evidence；
- Evidence 必须能跳回原文；
- AI 可以建议候选关系，但用户确认后才进入正式模型；
- 支持按 method、population、result 等研究维度比较。

#### Research Canvas

- 用于文献综合、argument mapping、假设发展和研究计划；
- 默认提供 Literature Synthesis、Argument Map、Research Plan 模板；
- 自动布局是可预览操作；
- 画布连接语义直接写回 Relation，不只是装饰线。

#### Outputs

- 从已确认的 Claims、Evidence 和 Notes 组装 outline；
- 每一段都能显示引用覆盖和来源；
- AI 可以建议结构、反例和缺失证据；
- 导出 Markdown、PDF、DOCX-compatible Markdown、BibTeX/CSL JSON；
- v0.4 不在产品内完成复杂排版和最终投稿。

#### Collaboration

- Research Project 支持 Owner、Editor、Commenter、Viewer；
- Canvas、Outline/Document 和 Research Notes 支持实时协作、presence、选择范围和光标；
- Evidence、Claim、Design Decision 和 Citation 采用对象级评论、mention、review 与 resolution；
- Task、Milestone、Meeting Note 与 Decision Log 支持异步协作；
- 每个用户拥有默认私有的 Scratch Layer，可选择发布到共享空间；
- AI draft 默认属于发起者，发布到项目后才进入团队共同上下文；
- 所有 AI 操作记录发起人、provider、scope 和接受者，不能把 AI 改动冒充团队成员改动；
- 本地单人 workspace 无需登录；只有创建或加入共享项目时才需要账号与项目同步。

Research Mode 的文献发现、筛选、Evidence、研究设计、项目管理与 citation audit 采用独立的端到端规范，见 [Research Mode AI-native 规范](./studykit_v0.4_research_mode_ai_native_spec_cn.md)。其产品原则是统一 research lineage，而不是把搜索、PDF、白板、任务和写作简单堆在同一屏幕。

### 6.3 Research Mode 核心场景

#### S-RESEARCH-01：从阅读到证据

1. 用户创建 Project 并写下 Research Question；
2. 从 Zotero 或本地导入论文；
3. 阅读时将一段内容标记为 Evidence；
4. 系统要求选择或新建 Claim；
5. Evidence 与 Claim 建立 supports / contradicts 关系；
6. 回到 Project Home 后能看到证据覆盖和缺口。

#### S-RESEARCH-02：跨论文比较

1. 用户选中若干 papers 或 Evidence；
2. 选择 Compare；
3. AI 根据研究问题建议比较维度；
4. 用户确认维度后生成 comparison draft；
5. 每个单元格保留来源；
6. 用户将发现保存为 Claim 或 Question。

#### S-RESEARCH-03：从综合到输出

1. 用户打开 Argument Map；
2. 检查主要 Claim、反例和证据缺口；
3. 选中已确认 Claims 创建 outline；
4. AI 只提供结构草稿和缺口提醒；
5. 用户编辑后导出到写作工具。

---

## 7. 跨 Mode 工作流

### 7.1 Study → Research

- 将 lecture 中的 Concept、Question、Claim 或 Source 引用到 Research Project；
- 原对象保持在 Study Mode，Research Mode 创建 reference，不复制正文；
- Research 中的修改不覆盖原课堂笔记，但可以添加新的 Relation 和 project-specific note。

### 7.2 Research → Study

- 将 paper、Evidence 或 Claim 加入 Course / Lecture 的 supplementary source；
- 从研究材料生成的复习问题必须标记来源与项目；
- 用户可选择只在 Study Mode 展示简化内容。

### 7.3 冲突处理

- 对象正文只有一个 canonical version；
- Mode-specific metadata 独立，例如 reading status 与 mastery status；
- 删除一个引用不会删除 canonical source；
- 删除 canonical source 时必须显示所有被影响的引用位置。

---

## 8. AI-native 产品要求

详细规则见 `studykit_v0.4_ai_native_and_cognitive_canvas_spec_cn.md`。

### 8.1 系统级 AI Assistant

AI Assistant 不是 Research 或 Study 中的独立功能，而是贯穿所有表面的共享交互层：

- **就地可用**：选中文字、PDF 区域、节点、关系、表格单元格、任务或引用时，Assistant 在焦点附近提供与对象匹配的动作；
- **随时召唤**：在应用内使用统一快捷键打开 transient Intent Capsule；桌面版支持 global hotkey，即使主窗口不在前台也能 Quick Capture、询问或把剪贴板内容送入指定 workspace；
- **连续上下文**：在 Reader、Canvas、Project Home 与 Output 间移动时保留当前目标、已固定资料和最近决策，但不自动扩大到整个 workspace；
- **可执行**：Assistant 可以搜索、创建草稿、转换对象、建立关系、安排任务、生成 QuerySpec 或准备 citation，不只是回答问题；
- **可见可控**：Capsule 始终显示当前 scope、目标对象、provider、Private/Shared 状态，并提供 Pin context、Preview、Undo 与 History；
- **安静存在**：未召唤时只保留轻量状态和必要提醒，不用常驻面板压缩思考空间。

桌面系统接入按风险渐进：首发 global hotkey + Quick Capture + clipboard；随后加入文件拖放、系统分享入口和菜单栏；任何跨应用读取、文件上传或共享发布都需要明确授权。

### 8.2 主要入口

1. **Selection actions**：选中 source / note / claim 后出现 Explain、Question、Compare、Link、Challenge；
2. **Intent bar**：`⌘K / Ctrl+K` 用自然语言执行“把这些证据按方法比较”；
3. **Transition suggestions**：阅读结束、保存解释、发现冲突等节点出现低打扰建议；
4. **AI workspace**：用户需要连续对话、生成或比较时才打开临时工作面板；
5. **Background services**：OCR、索引、引用解析和来源检查在后台进行。

### 8.3 不可违反的规则

- 不静默修改正式内容；
- 不隐藏 source scope；
- 不把 AI 生成内容冒充用户内容；
- 不在未授权情况下把本地文件发送给远程 provider；
- 不强制用户完成“先尝试”“先阅读”或固定整理步骤；AI 可以建议，但用户可直接解释、生成、跳过或关闭；
- 不把“接受 AI 内容”作为学习成功指标。
- 不把“无感”误解为隐藏上下文或权限；系统级 Assistant 的每次执行都必须可追溯、可取消、可撤销。

---

## 9. 本地版产品要求

### 9.1 Onboarding

首次启动提供两个清晰选项：

- **Local workspace**：无需账号，资料只保存在设备上；
- **Sync workspace**：登录并跨设备同步，可随时退出同步而保留本地副本。

AI 单独选择：

- No AI；
- Local AI（检测 Ollama）；
- Cloud AI（选择 provider，并说明数据发送范围）。

存储与 AI 选择不得捆绑。

### 9.2 本地核心能力

- 创建、移动、备份和恢复 workspace；
- PDF、笔记、annotation、canvas、review 和 search 离线可用；
- 本地全文索引；
- 本地 AI 可选；
- 无网时所有操作进入本地 operation log；
- 本地 workspace 可导出为单个 backup package；
- 提供 macOS `.dmg` 和 Windows installer，Linux 后续加入。

### 9.3 信任与隐私

- Workspace 设置显示数据位置、备份时间、同步状态和 AI provider；
- 每次远程 AI 请求可查看将发送的对象范围；
- API key 存储在系统凭据库，不进入普通配置文件；
- 删除 workspace 前显示备份建议；
- 遥测默认最小化且不收集文档正文。

---

## 10. 信息架构与路由建议

端到端状态、返回规则、AI Assistant、Desktop Quick Capture、Study / Research 与 Collaboration 的详细行为，以 [v0.4 交互流程规范](./studykit_v0.4_interaction_flows_cn.md) 为准。

| Path | 页面 |
|---|---|
| `/` | Home / Continue |
| `/study` | Study Home |
| `/study/c/:courseId` | Course Home |
| `/study/c/:courseId/l/:lectureId` | Lecture Focus |
| `/study/c/:courseId/canvas/:viewId` | Study Canvas |
| `/study/review` | Review |
| `/research` | Research Home |
| `/research/p/:projectId` | Project Home |
| `/research/p/:projectId/library` | Project Library |
| `/research/p/:projectId/evidence` | Evidence & Claims |
| `/research/p/:projectId/canvas/:viewId` | Research Canvas |
| `/research/p/:projectId/output/:outputId` | Output Editor |
| `/source/:sourceId` | Shared Source Reader |
| `/search` | Global Search |
| `/settings` | Local data、AI、sync、export settings |

路由可分享不代表公开访问；本地版深链接必须在桌面应用内正常恢复。

---

## 11. 功能优先级

### Must Have（v0.4 首个可用版本）

- Study / Research 双 Mode shell；
- 本地 workspace，无账号可用；
- Course、Lecture、Research Project；
- PDF 导入、阅读、annotation 和 source-linked note；
- Shared objects 与跨 Mode reference；
- Study Review 基础队列；
- Claim / Evidence 基础工作流；
- Study Canvas 与 Research Canvas，共用认知画布内核；
- Research Project 成员、角色、评论、mentions、共享任务和 activity history；
- Selection actions、Intent bar、Draft Layer、provenance；
- 本地搜索和可选 Ollama；
- PDF / Markdown / structured backup 导出；
- 路由拆分、按需加载和明确的性能预算。

### Should Have

- Zotero connector；
- comparison matrix；
- 可选的 AI Guidance 模式；
- exam date 与简单复习计划；
- research milestones；
- Canvas/Document 实时 presence 与协同编辑；
- DOCX-friendly export；
- optional cloud sync；
- auto update。

### Could Have

- 音频/录音 source；
- OCR 和公式识别增强；
- tablet quick capture；
- 分享只读 snapshot；
- advanced spaced repetition；
- systematic review 模板。

### Won't Have in v0.4

- 面向大型机构的复杂组织架构和企业级资源排期；
- marketplace；
- 通用 whiteboard 竞品级绘图；
- 内置 IDE；
- 自动代写；
- 默认捆绑本地大模型。

---

## 12. 非功能需求

### 12.1 性能

- Desktop cold start：目标 ≤ 2.5s；
- 打开已有 Lecture Focus：P75 ≤ 1.2s；
- 第一笔键盘输入响应：P95 ≤ 50ms；
- Canvas pan/zoom：50 visible nodes 时 ≥ 55fps；
- 200 total nodes 时通过虚拟化/可见渲染保持可操作；
- autosave 不阻塞输入；
- Web 首次必要 JS gzip 目标 < 300KB，不含按需 PDF worker。

### 12.2 离线与可靠性

- 无网时核心 CRUD、阅读、annotation、canvas、review 可用；
- 所有写入先本地提交；
- 崩溃后最近一次已确认输入可恢复；
- sync 冲突不得静默覆盖用户正文；
- workspace backup 可在另一台同平台设备恢复。

### 12.3 Accessibility

- 键盘可完成导入、阅读、笔记、搜索、Review 和主要 AI 动作；
- Canvas 提供 list/outline alternative，不强迫屏幕阅读器用户操作二维空间；
- 所有状态改变通过可见提示和 live region 表达；
- 目标尺寸、对比度、focus ring 和 zoom/reflow 按 WCAG 2.2 AA 设计并单独验证；
- 动画可关闭，自动布局不造成无法追踪的位置跳变。

### 12.4 国际化

- UI 文案进入 locale 文件，不在组件中硬编码；
- v0.4 至少支持简体中文与英文；
- academic terms 可按 locale 保留英文别名。

---

## 13. 成功定义

### 北极星指标：Verified Thought Loops / WAU

一次有效循环至少包含：

1. 用户处理了一个可追踪来源或问题；
2. 用户产生自己的解释、回答、Claim 或决策；
3. 系统或用户完成证据核验、反馈或反例检查；
4. 结果被修订、用于输出或进入未来 Review。

### Study 指标

- 首次 source-linked note 时间；
- 用户自己作答后查看反馈的比例；
- 7 天后问题回忆成功率；
- 从错误反馈回到来源并修订的比例；
- 课堂记录期间的中断和失败保存率。

### Research 指标

- 可回跳原文的 Evidence 比例；
- 有 supporting / contradicting evidence 的 Claim 比例；
- 从导入 paper 到第一个 confirmed Claim 的时间；
- 输出中引用覆盖率；
- project next action 完成率。

### Guardrail 指标

- 无来源 AI 陈述率；
- AI 草稿未经查看直接接受率；
- 用户报告的错误修改或数据丢失；
- AI 远程发送范围的撤回/惊讶反馈；
- Canvas 布局维护时间占任务时间比例。

---

## 14. v0.4 Release Gate

产品只有在以下条件同时满足时才能称为 v0.4：

- [ ] Study / Research 两个 Mode 都有一条完整纵向任务流，而不是空页面；
- [ ] 本地版无需账号完成两条核心任务流；
- [ ] 一条 Study 内容和一条 Research 内容可以跨 Mode 引用；
- [ ] 所有 AI 写操作进入 Draft Layer；
- [ ] AI 结果能显示具体 source scope 并跳转；
- [ ] Lecture Focus 达到性能预算；
- [ ] Canvas 有 outline/list alternative；
- [ ] 本地 workspace 可备份和恢复；
- [ ] 旧 v0.2 数据有明确迁移或只读导入路径；
- [ ] 完成目标用户任务测试，不以团队自测替代。

---

## 15. 产品风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 两个 Mode 变成两套复杂产品 | 高 | 共用对象、Reader、Canvas、AI、Search；用纵向路径控制范围 |
| AI 太隐形导致用户不信任 | 高 | 明确 provider、scope、draft 和 provenance；后台过程有状态 |
| AI 太主动或像老师一样管理用户 | 高 | 默认为 Quiet；所有指导可跳过、关闭或改为直接生成 |
| Canvas 再次成为功能堆积区 | 高 | 认知角色优先、渐进披露、模板、outline alternative |
| 协作破坏本地优先与个人思考空间 | 高 | 单人本地无需账号；共享项目可选同步；Private Scratch 与 Shared Layer 分开 |
| Desktop 与 Web 数据层分叉 | 高 | Repository contract、schema fixtures、双端一致性测试 |
| 本地模型体验不稳定 | 中 | 不默认捆绑；能力检测、模型 profile、云端 fallback 由用户选择 |
| v0.4 范围过大 | 高 | 以两条纵向任务流为 release unit，不以页面/节点数量衡量完成度 |

---

## 16. 实施前必须完成的决策

1. 确认本 PRD 的一句话定位；
2. 确认 Study Mode 与 Research Mode 的首个完整场景；
3. 确认 Tauri + SQLite 的桌面技术 spike；
4. 确认 AI 默认主动程度与自由度原则；
5. 确认本地文件默认复制还是引用；
6. 完成第一轮用户任务访谈和现状基准测试；
7. 确认 Research Collaboration 的首发边界；
8. 之后再冻结 v0.4.0 scope 并拆工程 PR。

实现输入与施工顺序见：

- [v0.4 屏幕、状态与组件矩阵](./studykit_v0.4_screen_state_component_matrix_cn.md)
- [v0.4 视觉方向与双主题规范](./studykit_v0.4_visual_direction_and_theme_spec_cn.md)
- [v0.4 实现就绪与 Minimax Code 施工包](./studykit_v0.4_implementation_readiness_and_minimax_handoff_cn.md)
