# StudyKit v0.4 决策日志

> 版本：0.4.0-draft  
> 日期：2026-07-20  
> 目的：将用户已明确的方向、当前默认决策和仍需共同判断的问题分开，避免文档把假设写成结论。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| 已确认 | 用户已明确提出或接受，可直接作为 PRD 边界 |
| 默认采用 | 本轮基于产品、UX 和技术权衡作出的推荐，后续可推翻 |
| 待验证 | 必须经过目标用户测试或技术 spike 才能确定 |
| 延后 | 方向可能成立，但不进入 v0.4 首发 |

## 2. 已确认决策

### D-001：产品分为 Study Mode 与 Research Mode

- 状态：已确认
- 决策：Study Mode 服务课程学习、lecture、理解、练习和复习；Research Mode 服务论文阅读、证据综合、论点发展与研究项目管理。
- 约束：Mode 是工作上下文，不是数据孤岛。任何来源、笔记、问题和引用都可以跨 Mode 被引用。

### D-002：AI 接入必须自然、低打扰

- 状态：已确认
- 决策：不以固定 Chat 窗口作为主要入口。AI 优先通过选区操作、对象动作、意图栏、过渡节点建议和后台索引参与工作。
- 约束：用户必须始终知道 AI 使用了什么范围、做了什么修改、结果来自哪里。

### D-003：画布应符合真实思考和学习过程

- 状态：已确认
- 决策：画布围绕“捕捉—分块—连接—质疑—回忆—反思”设计，不围绕 Shape、Arrow 等绘图工具设计。
- 约束：系统不得为了自动整理破坏用户已经形成的空间记忆；AI 重排必须先预览。

### D-004：提供可下载的本地版本

- 状态：已确认
- 决策：本地版无需注册即可使用，离线时核心学习、阅读、笔记、画布、搜索和导出可用。
- 约束：云同步与远程模型是可选增强；单人本地使用不依赖团队协作或账号。创建或加入共享 Research Project 时才启用项目级同步，本地文件不得未经明确授权上传。

## 3. 本轮默认采用的产品决策

### D-005：放弃 Canvas-first，采用 Learning-loop-first / Evidence-first

- 状态：默认采用
- 原因：上课记录、长文阅读、复习队列、研究表格和写作分别需要不同的最佳界面。
- 决策：同一对象可在 Focus、Table/List、Canvas、Review、Output 等视图之间切换。

### D-006：统一的是对象和操作，不是屏幕布局

- 状态：默认采用
- 决策：Study 与 Research 共用 Source、Note、Question、Claim、Evidence、Concept、Task、Output 等核心对象。
- 决策：每种视图都通过相同的对象 ID、source links、relations 和 activity history 工作。

### D-007：AI 提供认知支架，但不强制学习脚本

- 状态：默认采用
- 决策：Explain、Hint、Check、Generate 是并列意图；系统可以建议“先尝试”，但用户不需要先作答、先阅读或完成固定步骤。
- 约束：任何 Guidance 都可跳过、关闭或改为直接生成；StudyKit 不对用户选择作道德化评价。

### D-008：AI 只能写入 Draft Layer

- 状态：默认采用
- 决策：AI 生成内容先成为 suggestion / draft，用户接受或编辑后才能进入正式笔记、论点、卡片或输出。
- 决策：每项 AI 内容保留 source scope、模型、时间、生成动作和用户修改记录。

### D-009：桌面版采用 Tauri v2 + SQLite + 本地文件库

- 状态：默认采用
- 原因：当前前端是 React + Vite，可复用；Tauri 使用系统 WebView，安装包和内存开销通常小于捆绑浏览器内核的方案，并提供 SQL、文件系统、更新器和 sidecar 能力。
- 数据：桌面端以 SQLite 为结构化真相源，PDF、图片和附件存入 workspace assets 目录。
- Web：浏览器版继续使用 Dexie/IndexedDB；二者通过统一 Repository 接口和 schema contract 对齐。
- 参考：[Tauri v2](https://v2.tauri.app/start/)、[Tauri SQL plugin](https://v2.tauri.app/plugin/sql/)

### D-010：本地 AI 采用可选 Ollama 接入，不默认捆绑大模型

- 状态：默认采用
- 决策：StudyKit 自动检测本地 Ollama；用户可选择本地模型或已有远程 provider。
- 原因：不捆绑模型可以控制安装包体积、许可证和硬件兼容风险；Ollama 提供本地 API、embedding 和 OpenAI-compatible 接口。
- 参考：[Ollama API](https://docs.ollama.com/api/introduction)、[Ollama embeddings](https://docs.ollama.com/capabilities/embeddings)

### D-011：Study Mode 是首个激活入口，Research Mode 是第二条完整纵向路径

- 状态：默认采用
- 决策：首次打开默认引导用户建立 Course 或导入一份资料进入 Study Mode；Research Mode 在首页同等可见，但首轮 onboarding 不同时教授两套流程。
- 原因：降低首次学习成本，不代表 Research Mode 优先级较低。

### D-012：Research Mode 以 research lineage 为核心，不以 AI 报告为核心

- 状态：默认采用
- 决策：首条纵向路径为 Research Question → Search Run → Source → Evidence → Claim → Design Decision / Task → Output → Citation。
- 原因：现有工具分别覆盖搜索、文献库、AI 问答、任务和写作，StudyKit 的差异化应是保持这些阶段的来源与决策链，而不是再做一个论文摘要器。

### D-013：AI 不得生成自由文本学术引用

- 状态：默认采用
- 决策：任何可插入 Output 的 citation 必须先解析为 canonical Work，完成 identifier、metadata 与 integrity 检查，再用 CSL 渲染。
- 约束：模型找不到真实匹配记录时只能创建 `citation needed`，不能补写看似合理的作者、标题或 DOI。

### D-014：产品采用 Agency-first 与 Schema-on-demand

- 状态：已确认
- 决策：用户可从空白画布、自由文本、手写、PDF、搜索或项目任务任意开始；模板、对象类型和语义关系均为可选支架。
- 决策：结构在用户需要检索、比较、引用、复习或协作时渐进出现，不把维护系统本身变成工作。
- 约束：同一对象在 Canvas、Document、Table、Timeline 等视图中保持一致，避免传统工具之间的复制和导入导出。

### D-015：Research Collaboration 是核心能力

- 状态：已确认
- 决策：Research Project 支持成员角色、评论、mentions、共享任务、activity/decision history，并逐步支持 Canvas 与文档实时协作。
- 决策：本地单人 workspace 继续无需账号；只有创建或加入共享项目时启用账号、权限和项目同步。
- 约束：个人 Scratch Layer 默认私有；AI draft 默认属于发起者，发布后才进入团队共享上下文。

### D-016：AI Assistant 是系统级交互层，不是一个页面

- 状态：已确认
- 决策：同一个 AI Assistant 贯穿 Study、Research、Reader、Canvas、Review、Output、Search 和 Project Management；用户可以在当前选区或对象旁就地使用，也可以通过全局快捷键随时召唤。
- 决策：桌面版逐步提供 global hotkey、Quick Capture、剪贴板/文件接入和菜单栏入口，使用户离开主窗口时仍能把材料与想法送入明确的 workspace。
- 约束：Assistant 自动继承当前最小上下文，但始终显示 scope、目标对象、provider 与 Private/Shared 状态；跨项目、上传文件、发布共享内容或执行破坏性动作必须显式确认。
- 约束：AI 通过统一 Action Registry 调用真实产品能力，所有修改先预览或进入 Draft Layer，并可撤销；不能只返回一段无法继续操作的聊天文本。

### D-017：视觉方向延续 Warm Cognitive Glass，并平等支持 Light / Dark

- 状态：默认采用
- 决策：v0.4 复用现有奶油、玫瑰灰、腮红、淡紫与酒红品牌，正式方向命名为 `Warm Cognitive Glass / Living Workspace`；不另起蓝紫霓虹 AI 风格。
- 决策：Light 是奶油纸张与日光工作台，Dark 是酒红夜间研究室；两者共享语义、层级和交互，但不是简单反色。
- 决策：主题 runtime 支持 System / Light / Dark，组件只消费 semantic tokens；每个核心页面合并前必须完成双主题截图 QA。
- 约束：Glass 只用于需要层级的浮层、侧栏和工具条，正文、表格和 Canvas 不得变成卡片墙。

### D-018：P0 交互默认值

- 状态：已确认
- 决策：应用内 Search / Ask / Act 共用 `⌘K / Ctrl+K` Capsule；Desktop global hotkey 默认 `⌘⇧Space / Ctrl+Shift+Space`，可修改。
- 决策：Project Home 默认先显示 Living Brief，并提供 `Resume last view`；Private Scratch 默认 `Copy to shared`。
- 决策：AI 短结果不超过视口 40%，复杂任务进入临时 workspace；Quick Capture 首发支持 text、显式 clipboard 和 file drop。

### D-019：v0.4 采用 Work Packet 增量实施

- 状态：默认采用
- 决策：先完成 contracts、theme runtime、local-first shell、AI kernel，再进入 Study、Research、Canvas、Collaboration 与 Desktop slices。
- 约束：一个 Packet 一个可验证目标；不得一次重写 App、Canvas 和数据层，不得自动开始下一 Packet。
- 约束：当前用户未提交 Canvas 与文档变更必须保留；Minimax Code 每次开工和收工都检查 git status，并且不自动 stage/commit/push。

## 4. 待验证决策

### Q-001：本地 workspace 是“数据库库”还是“可见文件夹”

- 推荐：SQLite + assets 为运行时格式，提供 Markdown/JSON/ZIP 一键导出，不采用 Markdown-first 作为内部真相源。
- 待验证：高级用户是否要求直接在 Finder/Explorer 中编辑笔记文件。

### Q-002：桌面首发平台

- 推荐：macOS 与 Windows 同期；Linux 在安装、PDF、输入法和更新链路稳定后加入。
- 待验证：早期测试用户的实际设备分布，以及代码签名成本。

### Q-003：文件导入策略

- 推荐：默认复制到 StudyKit workspace，提供“仅引用原文件”高级选项。
- 待验证：大型论文库用户对磁盘重复和文件移动失效的容忍度。

### Q-004：AI 主动建议强度

- 推荐：默认为 Quiet：只在任务转折点出现一条可忽略提示；用户可切换 Off / Quiet / Assist / Guidance。
- 待验证：不同专业和学习阶段对主动提示的接受程度。

### Q-005：研究项目管理深度

- 推荐：v0.4 只做 question、claim、evidence、reading status、task、milestone、outline，不做通用甘特图和团队资源管理。
- 待验证：硕博用户是否需要 systematic review 的 screening / inclusion / exclusion 专用流程。

### Q-006：Zotero 在 Research Mode 中的真相源角色

- 推荐：StudyKit 维护 canonical Work identity 与研究对象，Zotero 作为可互操作的 reference library；首期 read/import 优先，two-way sync 延后到冲突模型验证后。
- 待验证：Zotero 重度用户是否要求 Zotero 始终是 metadata、PDF 和 annotations 的唯一真相源。

### Q-007：Research Mode 首个方法学 profile

- 推荐：通用 Research core + social/behavioral quantitative reference profile，后续按学科增加模板。
- 待验证：首批真实用户的专业分布，以及他们更需要 Explore、systematic Review、Empirical Study 还是 Thesis workflow。

### Q-008：Research 实时协作技术边界

- 推荐：对象、任务和决策使用 operation log；Canvas 与 collaborative text 采用独立 CRDT 文档，presence 不持久化。
- 待验证：Yjs 在现有 Canvas、未来编辑器、离线恢复和大型项目上的复杂度与性能；通过 spike 后再冻结技术选型。

### Q-009：协作首发深度

- 推荐：先交付角色、邀请、评论、mentions、共享任务、activity log 和 Canvas presence，再扩展复杂文档共同编辑。
- 待验证：研究团队最依赖的是共同阅读、共同画布、共同写作，还是 supervisor review/approval。

## 5. 明确延后

- 大型机构的组织层级、复杂审批和企业资源排期；
- 插件 marketplace；
- 内置 Python/R 执行环境；
- 自动替用户完成整篇论文或作业；
- 将所有 canvas 内容自动公开分享；
- 默认捆绑大语言模型；
- 移动端完整编辑器。移动端首期可只做阅读、快速捕捉和复习。

## 6. 下一轮共同决策顺序

1. 确认 v0.4 的一句话定位和两个 Mode 的边界；
2. 确认本地 workspace 格式与桌面首发平台；
3. 确认 AI 主动程度和自由度原则；
4. 确认第一条实现纵向路径；
5. 确认 Research Collaboration 首发边界；
6. 再进入界面视觉方向和工程 PR 拆分。
