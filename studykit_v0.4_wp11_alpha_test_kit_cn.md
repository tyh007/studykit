# StudyKit v0.4 — WP-11 封闭 Alpha 测试包

> 版本：Alpha-1  
> 日期：2026-07-31  
> 适用构建：Desktop 本地版；**不要把 Web 旧登录页发给参与者**  
> 目的：验证真实用户是否能理解并完成学习、研究和本地数据任务，而不是收集功能愿望清单。

## 1. Go / No-go 决策

本轮只回答五个问题：

1. 用户能否不被“老师式流程”管束，自由开始并找到下一步？
2. Study 是否真正形成 `source → attempt → feedback → review`，而非 AI 代写？
3. Research 是否形成 `paper → Evidence → Claim → Output → citation`，并可回到原文？
4. 用户是否理解文件在哪里、AI 看了什么、Draft 与正式内容有什么区别？
5. 断网、重启、备份和恢复是否不丢内容？

公开 Beta 最低门：

| Gate | 通过线 |
|---|---:|
| Study 主任务无需帮助完成 | ≥80% |
| 保存带完整 locator 的 Evidence | ≥80% |
| 用至少 3 篇论文形成 Claim + support + limitation | ≥70% |
| 恢复演练成功 | 100% |
| “意外发送给 AI”报告 | 0 |
| 可复现数据丢失 | 0 |
| 未关闭 P0 | 0 |
| 数据、隐私、引用正确性 P1 | 0 |

## 2. 样本与招募

目标 12–16 人：

- 4 名 Lecture-heavy 本科生；
- 3–4 名考试密集型 STEM/医学学生；
- 3–4 名正在做 dissertation/文献综述的高年级本科或硕士；
- 2–4 名管理 30+ papers 的 PhD/early researcher。

至少覆盖 macOS Apple Silicon、macOS Intel、Windows 11；中文/空格路径、OneDrive/iCloud 路径各至少 2 次。AI 使用习惯覆盖高频、谨慎和完全不用三类。不要只招募 Notion/Obsidian 高级用户。

### 招募筛选题

1. 过去 7 天是否用 PDF/slides 学习或阅读论文？
2. 最近一次从资料到笔记、复习或写作的真实任务是什么？
3. 当前是否管理 10/30/100+ 篇论文？
4. 是否使用 AI；通常在哪一步用，哪一步拒绝用？
5. 设备、操作系统和同步盘；能否安装测试应用？
6. 是否愿意使用公开或脱敏材料完成任务？

## 3. Consent 与数据边界

主持人在开始前逐条说明并获得口头或书面确认：

- 这是产品研究，不是考试；测试产品，不测试参与者。
- 使用公开或脱敏资料，不收集成绩、患者、未发表研究或其他敏感正文。
- 屏幕/音频录制单独选择；拒绝录制仍可参加。
- 研究记录不包含文件正文、Prompt、文件名或账号凭据。
- 产品 telemetry consent 与本次定性研究 consent 分开；默认不要求开启 telemetry。
- 参与者可随时停止，并要求删除其 session 记录。
- 远程 AI 任务前由参与者自己读 scope/provider；主持人不替其同意发送。

记录 consent：`research=yes/no`、`screen_recording=yes/no`、`audio=yes/no`、`anonymous_quote=yes/no`。任何一项未同意都不得推定同意。

## 4. 主持原则

- 先给目标，不教按钮位置；保持产品的 agency-first 定位。
- 参与者沉默时先等 10 秒，再问“你现在在找什么？”；不说“点左边那个”。
- 第一次中性提示后记为 `assisted`；直接告诉操作步骤记为 `failed`。
- 不让用户评价想象中的功能，追问最近一次真实事件和当前 workaround。
- 每个任务后问一次信任/理解问题，不在任务中暗示正确答案。

## 5. Session 结构（75–90 分钟）

### A. 现状与 Artifact Walkthrough（10–15 分钟）

请参与者展示或口述最近一次真实流程：资料从哪里来、在哪里记、何时用 AI、怎样回到来源、怎样备份。记录工具切换数、重复复制、找不到和不信任事件。

### B. Desktop / Local Trust（10 分钟）

给参与者测试安装包，不给 Web URL。

1. 安装并创建名为 `Alpha 学习与研究` 的 Workspace。
2. 说出文件实际保存在哪里。
3. 在不登录的情况下进入 Study Mode。
4. 找到 AI 当前 provider 和 scope，并解释它会看到什么。
5. 关闭网络，重启应用，确认 Workspace 可重新打开。

理解探针：

- “如果现在卸载 StudyKit，你认为资料在哪里？”
- “刚才 AI 能看到整个 Workspace、当前页面，还是你选中的内容？”
- “AI 的建议什么时候才会成为正式内容？”

### C. Study 主任务（20 分钟）

任务卡（中文）：

> 用提供的课程 slides 学习一个你不熟悉的概念。记下一条自己的笔记，标出一个疑问；先用自己的话作答，再决定是否让 AI 检查。保留、修改或拒绝建议由你决定。最后把问题加入 Review，离开再回来完成一次 Recall。

Task card (English):

> Use the provided slides to learn one unfamiliar concept. Write one note and capture one question. Answer it in your own words before deciding whether to ask AI to check it. Keep, edit, or reject the suggestion as you choose. Add the question to Review, leave, return, and complete one recall.

记录：首笔输入延迟、是否先独立作答、是否理解 Draft、AI-off 是否继续、Review 是否能找回来源、是否出现强迫流程感。

### D. Research 主任务（25–30 分钟）

任务卡（中文）：

> 建立一个研究项目，导入给定的 3 篇论文。每篇保存一条可回到原文的 Evidence，并写下自己的解释。形成一个同时包含支持与限制的 Claim，把它组织进 Output，插入引用并检查引用对应的 Work 和 Evidence。

Task card (English):

> Create a research project and import the three provided papers. Save one Evidence item from each paper with a path back to the source, and add your interpretation. Form a Claim with both support and a limitation, place it in an Output, add citations, and verify the cited Work and Evidence.

记录：locator 完整率、跨论文综合是否自然、Claim/引用是否可追溯、Canvas 是主动选择还是被迫维护、AI 建议是否打扰、项目下一步是否清楚但不带教师口吻。

### E. Backup / Recovery（10 分钟）

1. 创建 backup；记录参与者是否理解备份包含什么。
2. 新增一个带唯一短语的对象并关闭应用。
3. 重新打开并找到该对象。
4. 在专用测试 Workspace 中执行 restore/rollback 演练。
5. 检查导出文件可在 StudyKit 外打开。

任何正文丢失、回滚误删用户编辑或无法说明恢复结果，立即标 P0 并停止扩大样本。

## 6. 任务记录模板

每个任务记录一行：

```text
participant_id:
segment / device / os / path_kind:
task_id:
result: unassisted | assisted | failed | not_run
time_seconds:
first_action:
wrong_turns:
tool_switches:
ai_state: off | local | cloud
network_state: online | offline | reconnect
theme: light | dark
data_persisted_after_restart: yes | no | unknown
source_trace_correct: yes | no | n/a
participant_explanation_of_storage:
participant_explanation_of_ai_scope:
observation: Context → Trigger → Intended progress → Workaround → Friction → Evidence
severity: P0 | P1 | P2 | P3
moderator_note:
```

不记录论文正文、笔记正文、Prompt、真实文件名、API key 或账号凭据。

## 7. Severity 与停止条件

| 等级 | 定义 | 动作 |
|---|---|---|
| P0 | 数据丢失/损坏、隐私越界、错误引用被当真、无法恢复 | 立即停测该路径，保留只读证据，修复后重跑 |
| P1 | 核心任务无法完成、用户被错误 scope 误导、严重可访问性阻断 | 不进入 Public Beta；本轮修复或明确 No-go |
| P2 | 可绕过但明显增加认知/操作成本 | 排序后进入 RC 修复清单 |
| P3 | 文案、微交互或视觉抛光 | 不阻断 Alpha/Beta |

同一阻断在 2 名不同参与者出现即升级一档；任何数据/隐私/引用问题不因低频降级。

## 8. 设备、PDF 与可访问性矩阵

### Desktop 与路径

- macOS 13/14/15：Apple Silicon + Intel；普通目录、中文/空格、iCloud/OneDrive。
- Windows 11 x64：普通目录、中文/空格、OneDrive；休眠/唤醒和文件移动。
- 每台设备：首次启动、warm start、断网、重连、强制退出、backup、restore、升级前备份。

### PDF

| 样本 | 目标 |
|---|---|
| 10 MB text PDF | 首屏 <1 s；搜索/选区/annotation 正常 |
| 100 MB mixed PDF | 首屏 <1 s 目标；不能阻塞笔记输入 |
| 500 MB scan-heavy PDF | 允许降级；必须显示进度/错误且不崩溃、不丢其他内容 |
| 损坏/加密 PDF | 明确错误与恢复路径；不创建伪 Evidence |

记录 first-page、内存峰值、输入延迟、取消是否有效、重启后状态。测试文件必须是公开或合成材料。

### Accessibility（人工）

- 全程只用键盘：安装后入口、Mode switch、Study、Reader、Evidence、Output、Backup/Restore。
- VoiceOver（macOS）和 NVDA（Windows）：标题/landmark、label、错误、保存状态、Draft/provider/scope。
- 200% 与 400% zoom/reflow；Light/Dark/System；reduced motion。
- Canvas 必须能通过 Outline 完成选择和返回，不要求使用空间拖拽。
- 任何焦点丢失、键盘陷阱、无标签关键操作或仅靠颜色表达的 P0 路径状态，至少 P1。

## 9. 每日审查与最终 Scorecard

每天最多完成 3–4 个 session 后暂停，先合并同类问题，避免带着已知 P0/P1继续消耗参与者。

最终报告只包含：

1. 样本构成与缺口；
2. 每个 Gate 的分子/分母，不只写百分比；
3. P0/P1 清单与复现证据；
4. 关键任务中位数/P75 时间和失败点；
5. AI scope、Draft、数据位置三个理解率；
6. 继续 Beta、限制 Beta 或 No-go 的明确决定。

不要用平均满意度覆盖数据安全或任务失败。没有完成真实 session 时，Scorecard 必须写 `PENDING`，不得用自动测试结果代替。

## 10. Alpha 开始前清单

- [ ] 测试安装包与版本号冻结；checksum 记录。
- [ ] 邀请只包含 Desktop 安装包，不包含 Web URL。
- [ ] 公开/合成 slides、3 篇论文和 10/100/500 MB PDF 样本准备完成。
- [ ] Consent、录制选择和删除联系人明确。
- [ ] 每个 session 使用新的测试 Workspace；真实资料不导入。
- [ ] 至少一台 Mac 和一台 Windows 完成主持人 dry run。
- [ ] P0 停测负责人和修复/回归路径明确。
- [ ] 结果文件仅本地保存，正文/Prompt/文件名不进入 analytics。
