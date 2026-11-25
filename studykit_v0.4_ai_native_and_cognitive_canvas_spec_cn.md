# StudyKit v0.4 AI-native 与认知画布规范

> 版本：0.4.0-draft  
> 日期：2026-07-19  
> 适用范围：Study Mode、Research Mode、共享 Reader、Canvas、Review 与 Output  
> 核心原则：AI 在工作流里出现，但不越过用户的思考、判断和来源核验

---

## 1. 设计目标

StudyKit 的 AI-native 不是“每个页面放一个聊天框”，而是让系统理解用户正在处理的对象、当前目标和即时意图，在最合适的动作位置提供可撤销、可核验的帮助。AI 可以直接解释或生成，也可以提示、追问或检查；选择哪种帮助由用户决定。

AI Assistant 应像产品的交互底层一样随时存在，而不是用户需要先进入的目的地。它在界面内贴近当前焦点出现，在桌面版中还能通过 global hotkey、Quick Capture、剪贴板与文件入口被召唤；无论从哪里进入，都回到同一套对象、权限、来源和 Draft Layer。

认知画布也不是通用白板。它是一种把来源、概念、问题、证据、关系和未解决冲突放到同一思考空间的视图。它服务于综合与推理，不承担所有记录、阅读和写作任务。

### 1.1 成功状态

- 用户不需要复制内容到独立 Chat 才能获得有上下文的帮助；
- AI 输出能回到具体 source、page、selection 或 object；
- AI 不会静默改变正式知识、画布结构或用户表达；
- 用户无需遵循产品预设的学习法、研究步骤或对象分类；
- 画布帮助用户看见连接、冲突和空白，而不只是增加节点数量；
- 无 AI、离线和本地模型状态仍能完成核心任务。

## 2. AI-native 交互原则

### 2.1 Context-aware

AI 默认理解当前 Mode、项目、资料、选区、对象关系和用户目标。用户不必重复描述“我正在看第 12 页”。

### 2.2 Intent before prompt

入口首先呈现用户意图：解释、比较、质疑、提取、检查、练习、规划。自然语言 prompt 是补充，不是使用产品的前置技能。

### 2.3 Agency-first and adaptive

系统可以把“提示”“检查我的理解”作为轻量建议，但不得要求用户先作答、先阅读或完成固定步骤。用户可以直接选择 Explain、Generate、Hint、Challenge 或 Do nothing，系统记住个人偏好并根据场景调整，而不是把所有人置于同一种教学流程。

### 2.4 Source-grounded

只要任务涉及事实、课程材料或研究结论，AI 就必须显示 source scope。没有足够来源时应明确标记“基于通用知识”或“无法从所选来源确认”。

### 2.5 Draft-first and reversible

AI 只能创建 suggestion 或 draft。接受、编辑、拒绝、撤销和查看差异必须是一等操作。

### 2.6 Mixed initiative, low interruption

系统可以主动发现重复内容、证据冲突和复习缺口，但默认只在任务转折点给出轻提示。不得在课堂连续输入、Pencil 书写或用户专注阅读时弹出阻断层。

### 2.7 Visible boundary

“AI 做的”“用户写的”“来源原文”三者在视觉和数据层都必须可区分。无感接入指减少操作摩擦，不是隐藏 AI 的参与。

### 2.8 Local by default

索引、embedding 和生成 provider 分开配置。选择云同步不等于授权云 AI；选择云 AI也不等于上传整个 workspace。

## 3. AI 的六种产品表面

| 表面 | 触发方式 | 最适合的任务 | 不能做什么 |
|---|---|---|---|
| Selection actions | 框选文字、区域、节点或关系 | 解释、提取证据、创建问题、比较 | 处理未选中的整个库 |
| Object actions | 对 Source、Claim、Question 等对象操作 | 检查、转换、建立候选关系 | 静默改变对象类型 |
| Intent bar | `⌘K / Ctrl+K` 或自然语言 | 跨多个对象执行明确意图 | 作为长期聊天记录中心 |
| Transition suggestion | 完成阅读、作答或整理后轻提示 | 建议下一步、发现缺口 | 在输入中断用户 |
| AI workspace | 用户显式打开的临时工作面板 | 连续对话、研究计划、复杂比较与生成 | 自动把对话写进正式内容 |
| Desktop quick access | global hotkey、Quick Capture、剪贴板、文件或系统分享入口 | 离开主窗口时捕捉想法、资料与临时问题 | 未经授权读取其他应用或把内容上传云端 |

后台能力包括索引、OCR、引用解析、重复检测和关系候选。后台任务必须显示状态、范围、失败和取消入口。

### 3.1 Universal Intent Capsule

所有入口打开同一个轻量 Intent Capsule，而不是不同页面各自复制聊天功能。Capsule 根据焦点自动组合以下区域：

1. **Context chips**：当前选区、对象、项目、固定资料和 Private/Shared 状态；
2. **Intent field**：用户可以直接输入自然语言，也可以选择 Explain、Find、Connect、Transform、Create、Check、Plan；
3. **Action preview**：说明将读取什么、创建或修改什么、使用哪个 provider；
4. **Result surface**：短结果就地展开，复杂结果进入临时 workspace，结构化结果进入 Draft Layer；
5. **Continuation**：结果可以继续变成 Note、Question、Evidence、Claim、Task、QuerySpec 或 Citation，而不是停留为聊天文本。

Capsule 的位置跟随用户焦点：文本选区旁、Canvas 节点旁、表格行内、Project Home 顶部或系统级浮层。用户切换视图时，显式 Pin 的上下文保留，普通选区自动释放，避免错误地把旧材料带入新任务。

### 3.2 AI-native 的闭环标准

一次交互只有同时满足以下条件才算 AI-native：

```text
感知当前上下文 → 理解用户意图 → 调用真实产品动作 → 预览/执行 → 生成可继续操作的对象 → 保留来源与撤销
```

如果 AI 只能输出文字、要求用户手动复制到另一个模块，或无法说明修改对象，就仍然只是嵌入式聊天。

## 4. Context Packet

每次 AI 请求都由产品构造显式 Context Packet，用户可在发送前或结果中查看范围。

```ts
type AIContextPacket = {
  activeMode: 'study' | 'research';
  workspaceId: string;
  containerId: string; // courseId or projectId
  route: string;
  activeSource?: { sourceId: string; locator?: SourceLocator };
  selectedObjectIds: string[];
  selectedText?: string;
  currentGoal?: string;
  userAttempt?: string;
  relatedObjectIds: string[];
  scopePolicy: 'selection' | 'current-view' | 'container' | 'explicit-set';
  provider: 'none' | 'ollama' | 'cloud';
  permissionReceiptId?: string;
  invocationSurface: 'selection' | 'object' | 'intent-capsule' | 'transition' | 'workspace' | 'desktop-quick-access';
  visibility: 'private' | 'project';
  pinnedContextIds: string[];
};
```

### 4.1 Scope 规则

- 默认最小范围：selection 优先于 current view，current view 优先于 container；
- 跨 Course 或跨 Project 检索必须由用户显式扩大范围；
- 云端请求发送前显示“将发送：3 个节点、论文第 4–7 页、你的回答”；
- 完整 PDF 不因用户只选中一个段落而默认上传；
- 结果中保留 context snapshot，后续来源变化不会伪装成当时模型已经看过。

## 5. Draft Layer 与 Provenance

### 5.1 生命周期

```text
suggested → generating → draft → reviewed → accepted
                              ├───────→ rejected
                              └───────→ superseded
```

### 5.2 最小数据

```ts
type AIDraft = {
  id: string;
  action: string;
  content: unknown;
  targetObjectId?: string;
  sourceObjectIds: string[];
  sourceLocators: SourceLocator[];
  contextSnapshotHash: string;
  provider: string;
  model: string;
  createdAt: string;
  status: 'draft' | 'accepted' | 'rejected' | 'superseded';
  userEdits?: unknown;
};
```

### 5.3 接受规则

- “Accept” 必须说明将创建或修改什么；
- 修改现有正文时显示 diff，不只显示最终结果；
- 批量接受需要逐项审阅或明确的全选确认；
- 拒绝不删除审计记录，但可按隐私设置清除生成内容；
- 正式对象保留 `derivedFromDraftId`，但导出时用户可选择隐藏 AI 元数据。

## 6. Study Mode 的 AI 行为

### 6.1 推荐动作

| 用户状态 | 默认 AI 动作 | 结果形式 |
|---|---|---|
| 第一次遇到概念 | Ask me first / Give a hint / Explain | 提示或解释草稿 |
| 写完自己的解释 | Check my understanding | 正确、缺失、误解、来源 |
| 做完一道题 | Diagnose my approach | 步骤反馈，不只给答案 |
| 复习前 | Generate cues from my notes | Question drafts |
| 回答后 | Compare with sources | 覆盖度、错误、下一次练习 |
| 概念混淆 | Contrast A and B | 对比表草稿 + 来源 |
| 不知道如何继续 | Give one next step | 单步提示 |

### 6.2 学习自由与保护机制

- Explain、Hint、Check、Generate 作为并列意图，不把“正确学习方式”藏在默认排序中；
- 用户可以保存 Exam / Learn / Explore / Accessibility 等辅助偏好，也可以不选择任何策略；
- Review 可采用“提交后反馈”，也允许用户随时 Reveal；系统记录选择但不惩罚；
- 不以生成卡片数量作为成功，不默认一次生成几十张卡；
- AI 解释后可以建议复述或迁移问题，但不得阻止用户继续；
- 对数学、统计和代码题，优先检查过程与假设；
- 对高风险学科内容明确“不确定”和来源缺失。

## 7. Research Mode 的 AI 行为

### 7.1 推荐动作

| 工作节点 | AI 可以做 | 用户必须做 |
|---|---|---|
| 导入论文 | 解析 metadata、章节和引用 | 确认论文归属与阅读价值 |
| 阅读选区 | 提取 candidate claim/evidence | 确认含义、类型和 locator |
| 多论文比较 | 建议比较维度、填 comparison draft | 选择维度、纠正解释 |
| 发展论点 | 找支持、反例、冲突和证据空白 | 决定自己的 claim |
| 项目规划 | 从 gap 生成 next-action 草稿 | 确认优先级和截止时间 |
| 输出写作 | 建议结构和证据顺序 | 撰写、判断和承担论证责任 |

### 7.2 研究约束

- AI 不得把 paper summary 当作 paper evidence；
- Evidence 必须有 source locator，无法定位时只能创建 Note；
- Claim 与 Evidence 的关系是用户判断，AI 只能建议；
- 研究事实优先引用原文与 metadata，不引用模型生成文本；
- 对 contradictory evidence 不自动“求平均”，而是显示冲突条件；
- Outline 可由 AI 建议，但每个关键段落应能显示 supporting objects。

## 8. 认知画布模型

### 8.1 思考循环

```text
Capture → Chunk → Connect → Challenge → Retrieve → Reflect
   ↑                                                     ↓
   └────────────────── revise / extend ──────────────────┘
```

- **Capture**：从来源或脑中快速留下对象；
- **Chunk**：把信息转为可理解的概念、问题、Claim 或 Evidence；
- **Connect**：建立具体语义关系；
- **Challenge**：发现反例、缺口、矛盾和假设；
- **Retrieve**：隐藏解释或证据，主动回忆与重建；
- **Reflect**：记录当前理解、信心和下一步。

### 8.2 节点角色，不以视觉形状为中心

| 认知角色 | 用途 | Study | Research |
|---|---|---|---|
| Source | 原始材料入口 | slide / textbook | paper / dataset |
| Concept | 稳定概念 | 定义、公式、机制 | 理论、术语 |
| Question | 未知或检索提示 | practice cue | research question |
| Claim | 可判断陈述 | 自己的解释 | 论点 |
| Evidence | 支持判断的带源材料 | 例子、推导 | 发现、数据、引文 |
| Counterevidence | 反例或限制 | 边界条件 | 反证、矛盾结果 |
| Example | 具体化或迁移 | worked example | case / application |
| Task | 下一步行动 | 作业、复习 | 阅读、分析、写作 |
| Output | 需要形成的结构 | study guide | outline / report |

图片、公式、代码、表格和手写是对象内容格式，不单独成为顶层认知类型。

### 8.3 关系词汇

首发只提供能支持学习与研究判断的关系：

- `explains`、`example-of`、`causes`、`depends-on`；
- `supports`、`contradicts`、`qualifies`、`extends`；
- `compares-with`、`answers`、`raises`；
- `derived-from`、`part-of`、`next-step-for`。

连线可以只是视觉关联；当用户需要检索、论证或协作时再补充关系语义。系统可以建议标签，但不能用未命名关系阻断用户。

## 9. 画布交互规范

### 9.1 Progressive disclosure

- 空白画布可直接点击、粘贴、书写或拖入资料，不先要求选择模板或任务类型；
- Toolbar 第一层只保留 Capture、Connect、Focus、AI；Question、Review 等作为上下文动作出现；
- Shape、颜色和高级排版放在 Properties；
- 单个节点只显示核心内容，hover/focus 后显示来源、状态和动作；
- 复杂关系、AI trace 和 metadata 可按需展开。

### 9.1.1 Schema-on-demand

- 新内容默认可以只是自由文本、手写、图片或未分类想法；
- 用户需要搜索、比较、引用或协作时，再把内容提升为 Question、Claim、Evidence、Task 等对象；
- AI 可以建议类型和关系，但“稍后”“保持自由节点”始终是有效选择；
- 模板是可插入的局部结构，不控制整张画布；
- 画布、文档、表格和时间线是同一对象集合的不同视图，而不是互相导入导出的独立文件。

### 9.2 Spatial memory

- 用户拖动后的节点位置视为重要数据；
- AI layout 必须用 overlay 预览，接受后才写入；
- 重新打开保持 viewport、缩放、折叠和 focus；
- 语义缩放：远景显示簇和关系，中景显示标题，近景显示正文和来源；
- 自动整理只处理用户选区，不默认重排整张画布。

### 9.3 Diverge / Converge 头脑风暴

**Diverge**：快速输入不要求立即分类；Enter 连续创建，支持语音和 Inbox；AI 只提供刺激问题、不同视角和遗漏维度。

**Converge**：用户选择 cluster 标准，AI 预览候选分组、重复项和冲突；合并对象必须保留原内容与撤销链。

### 9.4 Focus 与可访问替代

- Focus mode 只显示一个问题及一跳/两跳相关对象；
- Outline/List 与 Canvas 是同一 view 的二维/线性表达；
- 键盘可以创建、选择、连接、移动到组和打开来源；
- screen reader 使用语义顺序、对象类型、关系和来源描述；
- 触控目标不小于 44×44 CSS px；Pencil 书写不触发 AI 浮层。

## 10. 画布模板

模板只预设角色与问题，不复制一堆空节点。

### Study

- Explain a Concept：定义 → 机制 → 例子 → 反例 → retrieval question；
- Solve a Problem：已知 → 目标 → 方法 → 步骤 → 检查；
- Compare Theories：共同问题 → 假设 → 证据 → 区别 → 使用条件；
- Exam Topic：概念 → 易错点 → 典型题 → 自测。

### Research

- Literature Landscape：研究问题 → 主题/方法簇 → 主要发现 → gaps；
- Claim Map：主张 → supporting evidence → counterevidence → qualification；
- Method Comparison：样本 → 设计 → 测量 → 分析 → 限制；
- Project Decision：选择 → 标准 → 证据 → 风险 → next action。

## 11. AI 主动等级

| 等级 | 行为 |
|---|---|
| Off | 只运行用户显式触发动作；后台仅做非 AI 本地索引 |
| Quiet（默认） | 只在任务转折点显示一条可忽略提示；连续使用后自动降低提示频率 |
| Assist | 根据当前选择提供更多建议、比较和生成入口，不主动接管工作流 |
| Guidance（可选） | 用户主动开启后追踪目标、缺口和节奏，随时可以退出 |

任何等级都不得在用户连续输入期间插入正文或改变画布布局。

## 12. 性能与状态体验

- 选区菜单出现：感知延迟低于 100 ms；
- 本地对象操作：低于 150 ms；
- AI 首个流式反馈：本地/云端分别显示明确状态，不伪造速度；
- 超过 2 秒的任务显示阶段、scope、取消和后台运行；
- 断网时保留请求草稿，由用户决定稍后重试；
- 生成失败不丢用户选区、prompt 或 attempt；
- Canvas 拖拽、缩放和书写不得因 embedding 或生成任务掉帧。

## 13. 验收场景

- [ ] 用户框选 slide 段落并在两步内选择 Explain、Hint、Check 或 Generate；
- [ ] AI 反馈能跳转到具体页和选区；
- [ ] 未经接受，AI 内容不会进入正式 Note、Claim 或 Review；
- [ ] 用户能查看云 AI 将发送的对象范围；
- [ ] 关闭 AI 后 Study / Research 核心路径完整可用；
- [ ] AI layout 有 before/after 预览和撤销；
- [ ] 同一 Claim 在 Table、Canvas 和 Output 中保持同一 ID；
- [ ] Canvas 有等价 Outline/List 操作路径；
- [ ] Review 同时支持“提交后反馈”和用户主动 Reveal，不把先作答设为强制门槛；
- [ ] Evidence 没有 locator 时系统阻止其进入正式 evidence 状态。
- [ ] 用户能在不选择模板、对象类型和 AI 策略的情况下开始并持续使用画布；
- [ ] 自由节点可在不中断位置和内容的情况下升级为结构化对象。

## 14. 明确不做

- 自动替用户生成整门课的“知识图谱”并视为已学会；
- 每个页面常驻大型聊天栏；
- 用拟人动画或频繁气泡增加 AI 存在感；
- 自动修改用户画布位置、关系和正式文本；
- 把 AI 使用时长、生成字数或接受率作为北极星指标；
- 因 AI 不可用而阻止阅读、记录、检索、画布和导出。
