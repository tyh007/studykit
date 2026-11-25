# StudyKit v0.4 路线图、指标与用户研究计划

> 版本：0.4.0-draft  
> 日期：2026-07-19  
> 目的：把产品重构从功能清单转成可验证的学习/研究结果，并明确哪些结论来自案头研究、哪些仍需真实用户验证。

---

## 1. 当前证据判断

### 1.1 已有信号

结合当前产品结构、既有产品文档和公开研究，v0.4 可以较有信心采用以下方向：

- 学生需要在低摩擦记录与深度整理之间切换，不能把课堂记录强迫进复杂画布；
- active recall 比重复阅读或只做概念图更能促进长期保持，因此 Study Mode 必须包含“先回忆、后反馈”的闭环；
- 无护栏的生成式 AI 可以提升当下表现，却可能削弱后续独立学习；带有教学护栏的 AI 更符合产品目标；
- 研究工作流横跨信息发现、管理、知识综合和写作，资料管理工具很难单独解决“从读过到能论证”的断层；
- 本地可靠性、可回溯来源和开放导出是学术资料的基础信任条件，而不是高级功能。

公开证据包括：

- Karpicke 与 Blunt 的实验比较了 retrieval practice 与 elaborative concept mapping，支持把主动检索作为 Study 核心，而不是只优化整理体验。[PNAS: Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping](https://doi.org/10.1073/pnas.1010186108)
- 一项学校场景 RCT 发现，普通 GPT 辅助可能提升练习表现却伤害撤掉 AI 后的表现，而带教学护栏的 tutor 缓解了这一问题。这支持提供 Hint、Check 与 Review 等认知支架，但不意味着产品应强制所有用户遵循同一学习步骤。[PNAS: Generative AI without guardrails can harm learning](https://doi.org/10.1073/pnas.2422633122)
- 关于学生、研究者与教职员工 reference management practice 的质性研究指出，工具使用嵌在高度个性化的更大研究工作流中；这支持 StudyKit 连接来源、笔记、证据与输出，而不是只重做一个 reference manager。[The Journal of Academic Librarianship: Reference management practices](https://www.sciencedirect.com/science/article/pii/S0099133324000405)
- 社会科学研究者工作流研究将活动归纳为 information literacy、information management、knowledge management 和 scholarly communication；Research Mode 应覆盖它们之间的交接，而不只是 PDF 收藏。[A qualitative study of social sciences faculty research workflows](https://www.sciencedirect.com/org/science/article/pii/S0022041821000047)

### 1.2 证据边界

以上是案头研究，不是 StudyKit 自己的用户证据。当前仍不能声称：

- 两个 Mode 的命名对目标用户天然清楚；
- 用户会接受 Draft Layer、可选 Guidance 和自由工作流之间的具体权衡；
- Tauri + SQLite 对真实设备已经足够稳定；
- 目标用户愿意把本地 workspace 作为主要资料库；
- 认知画布比其现有纸笔、Obsidian 或表格方案更好；
- Study Mode 一定应先于 Research Mode 开发。

因此路线图把“访谈 + 任务测试 + 行为基线”放在功能扩张之前。

## 2. 需要验证的核心假设

| ID | 假设 | 失败意味着什么 | 验证方式 |
|---|---|---|---|
| H1 | Study / Research 是用户能理解且有价值的顶层分区 | 需要按目标或 workspace 分区 | tree test + prototype task |
| H2 | 用户希望内容跨 Mode 复用，而非复制 | 共享对象模型价值下降 | card sort + cross-mode task |
| H3 | Lecture Focus 比 Canvas-first 更适合课堂 | 需要重新定义 Study 主视图 | 课堂模拟与完成时长 |
| H4 | 研究者最大断点在 reading → evidence → claim → output | Research Mode 价值主张错误 | workflow interview + artifact walkthrough |
| H5 | 用户自主选择 Explain/Hint/Check/Generate 能兼顾自由度与学习价值 | 需调整 AI 入口与默认主动程度 | 对照任务 + retention probe |
| H6 | 来源范围与 Draft Layer 提升信任 | 可能过度增加界面负担 | trust/error detection test |
| H7 | 画布在综合阶段有价值，在 capture 阶段不是默认 | Canvas 入口和定位需调整 | diary + stage-specific task |
| H8 | 本地无需账号是重要激活因素 | 桌面版优先级可能降低 | concept test + download intent |
| H9 | macOS + Windows 同期覆盖首批用户 | 需调整发布平台 | recruitment screener |

## 3. 用户研究样本

第一轮建议 12–16 人，不追求总体统计推断，目的是发现工作流模式与阻断点。

| Segment | 人数 | 条件 |
|---|---:|---|
| Lecture-heavy 本科生 | 4 | 每周使用 slides/PDF，上课实时记录 |
| Exam-heavy / STEM / 医学学生 | 3–4 | 有主动回忆、题目练习或手写需求 |
| Research-heavy 高年级本科/硕士 | 3–4 | 正在做 dissertation、文献综述或研究项目 |
| PhD / early researcher | 2–4 | 管理 30+ papers，并有真实写作输出 |

设备至少覆盖：Mac、Windows、iPad/Pencil 或 Surface；AI 使用至少覆盖高频用户、谨慎用户和不使用者。

不要只招募 Notion/Obsidian 高级用户，否则会高估用户维护复杂系统的意愿。

## 4. 第一轮研究流程

### Session A：现状访谈与 Artifact Walkthrough（45–60 min）

要求参与者屏幕分享一门正在学的课程或一个真实研究项目，并展示：

1. 最近一次从资料到笔记的过程；
2. 最近一次复习或回答题目的过程；
3. 最近一次从论文阅读到写作引用的过程；
4. AI 在哪里进入、哪里复制粘贴、哪里不信任；
5. 丢失、找不到、重复整理和切换工具的具体事件；
6. 当前文件、命名、备份与同步方式。

访谈避免问“你想不想要 AI 画布”，改问“上一次你需要比较 5 篇论文时具体怎么做”。

### Session B：低保真任务测试（45 min）

任务使用参与者熟悉的公开材料：

- Study：导入 slides → 课堂记一条 note → 标记疑问 → 自己解释 → AI 检查 → 加入 Review → 一天后再答；
- Research：导入 3 篇 paper → 保存 evidence → 对比方法 → 建 claim → 查反例 → 形成 outline；
- Cross-mode：把课程概念连接到研究项目，不复制正文；
- Local trust：创建本地 workspace → 选择 AI provider → 查看发送范围 → 导出与恢复。

### Session C：5–7 天 Diary Pilot

选 4–6 人使用纵向 prototype 或早期 build，记录：

- 每次任务的触发、目标和使用设备；
- 在 StudyKit 前后切换了哪些工具；
- AI 建议何时有帮助、何时打扰；
- 哪个对象/来源后来找不到；
- 是否回到 Review 或继续 Research next step；
- 任何卡顿、等待、数据不信任事件。

## 5. 研究记录框架

每个 observation 不按“用户想要的 feature”归档，而按下列结构：

```text
Context → Trigger → Intended progress → Current workaround
→ Friction / risk → Evidence artifact → Desired outcome
→ Frequency → Severity → Existing alternative
```

需求优先级使用：

```text
Opportunity score = frequency × severity × strategic fit × evidence confidence
```

任何只有一次口头偏好、没有真实事件或 artifact 的需求，先标记为 weak signal。

## 6. Jobs to Be Done

### Study Mode

1. 当我在课堂上处理 slides 和讲解时，我想快速把自己的理解连到具体页面，以便之后能恢复老师当时的语境。
2. 当我觉得“好像懂了”时，我想在看答案前尝试解释或回答，以便发现真正的知识缺口。
3. 当考试临近时，我想从自己的资料和错误中得到可追踪的练习队列，以便把时间用在薄弱点上。
4. 当多个概念容易混淆时，我想看到它们的关系、例子与边界，以便建立可迁移的理解。

### Research Mode

1. 当我阅读论文时，我想把有价值的发现保存为带定位的 evidence，以便写作时能回到原文。
2. 当论文越来越多时，我想按研究问题比较方法、结论和限制，以便看见共识、冲突与 gap。
3. 当我形成一个论点时，我想检查支持、反证和缺失证据，以便避免只收集支持自己的材料。
4. 当项目停滞时，我想从当前 question / claim / gap 得到一个明确 next action，以便继续推进研究。

### Local / AI

1. 当网络不可用或资料敏感时，我想继续完整工作，以便不受账号、服务器和 provider 限制。
2. 当 AI 使用我的资料时，我想知道它具体看了什么、发送到哪里、改了什么，以便决定是否信任和接受。

## 7. 产品指标

### 7.1 North-star：Verified Thought Loops / WAU

一次 Verified Thought Loop 需要在 7 天内满足：

1. 用户处理一个可追踪 Source / Question；
2. 用户产生自己的 Attempt / Explanation / Claim / Decision；
3. 用户或系统完成 Feedback / Evidence check / Counterexample check；
4. 用户完成一次 revision、retrieval 或 next action。

这个指标比“AI 生成次数”“画布停留时长”更接近产品愿景。

### 7.2 Study 指标

- Lecture 建立到第一条 source-linked note 的时间；
- 课堂 session 中输入被中断的次数；
- Question 中有 user attempt 的比例；
- Review 1 天 / 7 天回访率；
- 首次错误后完成修订或再次检索的比例；
- 用户能否从 Note 在 10 秒内回到 source locator。

### 7.3 Research 指标

- 导入 paper 到第一条 confirmed Evidence 的时间；
- Evidence 有有效 locator 的比例；
- Claim 同时有 support 和 counter/qualification 的比例；
- 从 selected sources 到 comparison draft 的完成率；
- Project 每周完成的 evidence-backed decision / next action；
- Output 段落能回溯到 supporting objects 的比例。

### 7.4 AI 质量与护栏

- 结果 source citation 可打开且支持陈述的比例；
- 无足够来源时正确表达不确定的比例；
- AI draft 被审阅后修改的比例；
- 未审阅批量接受率（guardrail）；
- AI 建议被标记为打扰的比例；
- 独立完成/延迟测试相较无护栏 AI 的差异；
- 远程 scope 引发“意外发送”报告数，目标为 0。

### 7.5 本地可靠性与性能

- crash-free sessions；
- autosave durability failure；
- workspace restore 成功率；
- 离线核心任务完成率；
- warm start、route open、search、PDF first page 和 Canvas FPS；
- 因卡顿放弃的 task 比例。

## 8. 事件设计原则

- 不上传用户正文、选区、文件名或 AI prompt 到通用 analytics；
- 事件只记录 object kind、动作、时长、结果和匿名性能桶；
- 把“用户写了 attempt”与 attempt 内容分开；
- local-only workspace 可完全关闭 telemetry；
- 定性研究 consent 与产品 telemetry consent 分开；
- 每个指标先写 decision it changes，不能影响决策的指标不埋点。

## 9. v0.4 路线图

每个阶段是学习/产品 Gate，不是按组件堆功能。

### Phase 0：方向与基线（2 周）

- 12–16 人 recruitment 与 6–8 次 artifact walkthrough；
- 记录当前版本关键任务完成时长、错误、卡顿和工具切换；
- 对 Study / Research IA 做 tree test；
- 评审 v0.4 decision log；
- 建立性能与数据安全基线。

**Gate**：H1–H4 至少获得中等证据；确认第一个纵向路径。

### Phase 1：架构边界 + Desktop Spike（2–3 周）

- repository contract 与 Dexie adapter；
- Tauri + SQLite workspace spike；
- PDF import、page-linked note、重启恢复、export snapshot；
- Mode shell 与 legacy route adapter；
- 性能预算自动测量。

**Gate**：本地技术 Gate 全部通过，旧数据无破坏。

### Phase 2：Study Mode 纵向切片（4 周）

- Course Home、Lecture Focus、Understand、Review；
- source locator、Question 与 review event；
- Selection action + user-led AI intents + Draft Layer；
- 离线、键盘与基础 Pencil 路径；
- 5–7 天 diary pilot。

**Gate**：目标用户无需指导完成一次 Verified Thought Loop；体验不慢于现有工具组合的关键动作。

### Phase 3：Research Mode 纵向切片（4–5 周）

- Project Home、Library & Reader、Evidence / Claim table、Output outline；
- Zotero/local PDF import；
- Evidence locator、comparison、counterevidence；
- Research AI actions 与项目 next action；
- 研究用户任务测试。

**Gate**：用户能从 3 篇论文建立有来源的 claim 并形成 outline，不依赖复制粘贴到外部 Chat。

### Phase 4：共享认知画布与 Research Collaboration（4–5 周）

- shared object placements；
- Study / Research templates；
- semantic relations、Focus、Outline alternative；
- AI cluster/layout preview；
- Research project roles、comments、mentions、shared tasks、activity log；
- Private Scratch → Shared Layer publish；
- Canvas presence、实时协作与离线重连 spike；
- touch / keyboard / accessibility QA。

**Gate**：Canvas 在综合任务上优于表格/线性基线且不拖慢 capture；两人离线/重连后不丢内容，权限与 private/shared 边界无误解。

### Phase 5：Desktop Beta Hardening（3 周）

- 签名、安装、更新、备份、migration 与 crash recovery；
- Ollama provider 与云 provider permission UX；
- large workspace benchmarks；
- onboarding、下载页和数据位置说明；
- beta cohort 与 rollback rehearsal。

**Gate**：数据安全、性能、隐私和恢复 checklist 全部通过；否则延后公开下载。

### Phase 6：可选同步与扩展

- 跨设备完整 sync、assets sync、conflict UI；
- mobile companion 只读/捕捉/Review；
- systematic review、复杂组织协作或 plugin 能力依据研究再排期。

## 10. PR 拆分原则

- 一个 PR 只解决一个可回滚的边界；
- data migration 与 visual redesign 不放在同一 PR；
- 新 route 先接 legacy feature，再替换内部实现；
- repository contract tests 先于第二个 adapter；
- AI action 必须同时包含 scope、draft、provenance、cancel 与 failure state；
- 每个纵向切片从 import/capture 到 output/review 可走通后才扩展节点类型；
- 性能回归和 migration fixture 是 merge gate。

建议顺序：

1. PR-01 Baseline telemetry & performance harness；
2. PR-02 Domain object types & repository contract；
3. PR-03 Dexie adapter around existing data；
4. PR-04 Study / Research route shell；
5. PR-05 Tauri shell + SQLite contract spike；
6. PR-06 Source locator vertical primitive；
7. PR-07 AI Context Packet + Draft Layer primitive；
8. PR-08 Study Mode first thought loop；
9. PR-09 Research Mode first evidence loop；
10. PR-10 Shared Canvas view model。

## 11. Go / No-go Dashboard

### Study Alpha

- ≥ 80% 目标用户无需帮助完成 source → attempt → feedback → review；
- 课堂记录任务相较现版本无新增阻断；
- 0 个可复现数据丢失；
- AI 来源定位准确率达到预设测试集门槛；
- 用户能解释 AI 与自己内容的区别。

### Research Alpha

- ≥ 80% 用户能把选区保存为带 locator 的 Evidence；
- ≥ 70% 用户能从多篇论文形成 Claim + support + limitation；
- 用户能从 Output 返回原文；
- AI 不把无 locator 摘要伪装成 Evidence。

### Desktop Beta

- 安装、升级、恢复在目标 OS matrix 全部通过；
- crash-free session 与性能达到预算；
- 无账号/断网任务完成率与联网状态一致；
- 云 AI scope 与本地模式在测试中无误解；
- export snapshot 可在干净设备恢复。

这些数字是首轮产品 Gate，不是长期目标；Phase 0 后应根据基线校准。

## 12. 明确停止条件

出现以下情况时停止扩大功能，回到问题定义：

- 用户仍把 StudyKit 理解为“另一个复杂笔记软件”；
- Study / Research 分区增加找东西的成本；
- 用户为了喂 AI 需要重新整理或复制上下文；
- Canvas 只带来更好看的图，没有改善解释、比较或论证；
- AI 提升即时完成率，却降低延迟回忆或独立判断；
- 桌面版无法证明数据恢复与迁移可靠；
- 团队用功能数量替代 Verified Thought Loop。

## 13. 本轮需要共同拍板的五个问题

1. 是否正式接受“Canvas 是综合视图，不是产品操作系统”；
2. 第一条纵向路径是否采用 Study：slide → note → own explanation → AI feedback → Review；
3. 本地 workspace 是否采用 SQLite + assets，Markdown 作为开放导出；
4. Desktop 是否 macOS + Windows 同期，Linux 延后；
5. AI 默认是否采用 Quiet，以及 Explain / Hint / Check / Generate 并列的 user-led 模型。
