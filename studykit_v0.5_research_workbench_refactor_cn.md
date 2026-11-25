# StudyKit v0.5 — Research Workbench 重构方案

日期：2026-11-25
状态：**产品决策已确认（见第 8 节）；P0 ADR 已起草：`frontend/docs/adr/ADR-003-research-workbench.md`；阶段顺序已按 `studykit_v0.5_product_strategy_cn.md` 修订**

## 1. 问题

Research Mode 现在是“一页一个页面”的结构，像网站而不是工作台：

| 现状 | 后果 |
|---|---|
| 单一路由，一次只渲染一个页面（`researchRouter.tsx` 按 `location.surface` 9 个分支切换整页） | 读论文时看不到证据，写 Output 时看不到原文；每次切换都丢失上下文 |
| 项目对象分散在 Project Home、Sources、Evidence、Design、Output、Canvas 各页 | 没有一个地方能一眼看到“这个项目里有什么” |
| AI 是全局模态弹窗 Intent Capsule（`aria-modal`），会话不按项目区分、不持久化；`features/ai/README.md` 明确写着 “Nothing here is a chat sidebar” | AI 无法成为持续参与项目的协作者；关掉就没了，换项目也不知道上下文 |
| AI 入口分散：Intent Capsule、Evidence AI Suggest、Output AI Draft、Canvas AI 动作，外加旧版 `AIChatPanel`、`CanvasAIAssistant` | 同一个项目有 5–6 套 AI 交互，各自为政 |
| 旧版文献中心（`components/literature/`，约 9,600 行：PDF 批注、AI 对话、Freeform 画布、摘要表、阅读列表、Zotero）在 v0.4 界面中**完全不可达**，v0.4 又重写了一部分 | 两套研究系统并存，功能和维护成本都重复 |

## 2. 目标形态：面向研究者的 VS Code

以项目为单位的工作台。打开一个 Research Project，就像在 VS Code 里打开一个文件夹。

```
┌────┬──────────────┬──────────────────────────────────┬──────────────────┐
│活动│  资源管理器   │  编辑区（标签页，可左右分屏）       │  项目 AI 工作区   │
│栏  │  （项目树）   │  [paper.pdf] [Claim 3] [Draft §2] │  （项目共享）     │
│    │              │                                  │                  │
│ 📁 │ ▸ 简报       │                                  │  对话线程         │
│ 🔍 │ ▾ 文献 (24)  │   当前打开的对象                   │  上下文：当前标签  │
│ ✓  │   · 阅读中   │   （论文 / 笔记 / 证据矩阵 /        │  + 选区 + 已钉住  │
│ 👥 │   · 已提取   │     画布 / 草稿 …）                │                  │
│ ⚙  │ ▸ 证据与观点 │                                  │  AI 产出 = 草稿   │
│    │ ▸ 笔记       │                                  │  [应用到编辑区]   │
│    │ ▸ 画布       │                                  │                  │
│    │ ▸ 写作       │                                  │                  │
│    │ ▸ 研究设计   │                                  │                  │
├────┴──────────────┴──────────────────────────────────┴──────────────────┤
│ 底部面板（可收起）：证据缺口 · 引用问题 · 任务 · 动态                       │
├────────────────────────────────────────────────────────────────────────┤
│ 状态栏：本地/同步 · 已保存 · AI 模型 · 引用核查状态                         │
└────────────────────────────────────────────────────────────────────────┘
```

| 区域 | 对应 VS Code | 内容 |
|---|---|---|
| 活动栏 | Activity Bar | 资源管理器、文献检索、证据与观点、任务、协作、设置 |
| 侧栏 | Explorer | 项目对象树：简报、文献（按阅读状态/标签分组）、证据与观点、笔记、画布、写作、研究设计 |
| 编辑区 | Editor Groups + Tabs | 任意对象以标签页打开，可分屏对照（左论文、右写作） |
| 右侧 AI | Secondary Side Bar（如 Copilot Chat） | 项目级、可持久化、可共享的 AI 工作区 |
| 底部面板 | Panel（Problems / Terminal） | 证据缺口、引用核查问题、任务、项目动态 |
| 状态栏 | Status Bar | 工作区类型、保存状态、AI 提供方与模型、引用核查 |
| 命令面板 / 快速打开 | ⌘⇧P / ⌘P | 所有 ActionRegistry 动作；按名称打开任意论文、证据、草稿 |

### 2.1 默认状态：借 VS Code 的结构，不借它的复杂度

按 `studykit_v0.5_product_strategy_cn.md` 第 4 节“零门槛”原则，上面是工作台**长成之后**的样子，不是第一次打开的样子：

- 新项目打开时只有两件事：拖入 PDF，或写下“我想弄清楚什么”。
- 初始布局只有“资料 + 写作”两栏；活动栏、底部面板、研究设计、任务、协作在用到时才出现；资源管理器的分组有内容才显示。
- AI 面板默认收起成一个“问问”按钮，第一次使用后才展开为常驻面板。
- 界面文案说人话：摘录、我的观点、还缺什么、有人反对；不出现 Claim / Evidence / Provenance 等术语。
- 每个状态只突出一个建议的下一步。

核心编辑器按策略文档调整为：**资料与摘录**（阅读 + 自然核实）、**论证编辑器**（由现有 Output 升级而来，先搭结构，最后成文）、**画布**（头脑风暴），加上右侧作为思考伙伴的 AI 面板。

## 3. 右侧：项目共享的 AI 工作区

这是这次重构的核心变化，从“临时弹窗”变成“常驻协作者”。

- **按项目持久化的对话线程**：每个项目有自己的线程列表，重启后还在；切换项目时自动切换。
- **自动上下文**：默认带上当前标签页对象 + 选区，并以可编辑的 Context Chip 显示（沿用 `ContextResolver` 的 “selection > current view > container” 规则和 v0.4 的 “Every answer has context” 原则）。用户可以钉住多篇论文或证据做对比。
- **工具按钮**：Ask、Summarize、Extract evidence、Compare papers、Find gaps、Draft section、Search literature —— 全部来自现有 `ActionRegistry`，不另起一套。
- **AI 产出仍然是草稿**：回复里的可执行结果（候选证据、Claim 关系、段落草稿）以草稿卡片出现，点“应用”才写入编辑区，沿用 `DraftLayer` 的 accept/reject 生命周期。保留 v0.4 “AI 不静默修改正式内容”的承诺。
- **项目共享（已决策：默认共享）**：新线程默认对项目所有成员可见（复用 WP-08 的 membership、activity 和 outbox），用户可以把单个线程改为私人。线程里会带上论文原文片段和用户输入，所以创建共享线程时要在面板上清楚显示“项目成员可见”。
- **Intent Capsule 降级为快速入口**：⌘K 在编辑区就地提问，结果写入右侧当前线程，不再是独立弹窗。

## 4. 技术架构

### 4.1 新增

| 模块 | 职责 |
|---|---|
| `WorkbenchState` | `{ projectId, editorGroups: [{ tabs: EditorInput[], active }], sidebarView, panelOpen, sizes }`，按项目持久化到本地仓储；URL 只编码当前激活的编辑器，用于深链和重启恢复 |
| `EditorInput` | `{ kind: 'work' \| 'note' \| 'claim' \| 'evidence-matrix' \| 'canvas' \| 'output' \| 'search' \| 'overview' \| 'design' \| 'task', id }` |
| `EditorRegistry` | `kind → { lazy 组件, 标题/图标解析 }`，保持现有按需加载拆包 |
| `ExplorerTree` | 基于现有 research repository 查询生成项目树 |
| `AiThreadStore` | 取代全局单会话 `sessionStore`：按项目保存线程与消息。新增 SQLite 实体（`ai-thread`、`ai-message`，走既有 domain repository namespace）与 Web/Dexie 对应实现 |
| `WorkbenchLayout` | 可拖拽、可折叠的分栏；最小窗口 960×640 时自动收起侧栏和 AI 面板 |

### 4.2 复用（不重写）

- **页面变编辑器**：`ResearchReader`、`EvidenceWorkspace`、`OutputWorkspace`、`DesignWorkspace`、`TaskDetail`、`CognitiveCanvasView`、`Discovery` 已经是靠参数驱动的组件（`projectId`、`workId` + 回调）。去掉各自的页头和“返回”按钮，`onOpenX` 回调改成“打开标签页”即可。
- **AI 内核**：`ContextResolver`、`ActionRegistry`、`PermissionGate`、`ProviderRouter`、`DraftLayer` 全部保留；只把 `sessionStore` 换成 `AiThreadStore`，把 `IntentCapsule` UI 换成面板 UI。
- **数据层**：canonical use case、repository、SQLite schema 和备份不变（AI 线程是唯一新增实体）。
- **协作**：membership、activity、outbox 用于共享线程。

### 4.3 移除 / 合并

- 单页路由 `researchRouter.tsx` → 由 `WorkbenchState` + `EditorRegistry` 取代；旧深链映射为“打开对应标签页”。
- Project Home 页 → 变成“项目概览”标签页（打开项目时的默认标签，类似 VS Code 的 Welcome 页）。
- Sources 页 → 拆到活动栏“文献检索”视图和资源管理器的“文献”分组。
- 旧版文献中心 → 把 PDF 批注能力并入 Reader 编辑器，把 `AIChatPanel` 的有用能力并入 AI 面板，达到功能对等后删除约 9,600 行旧代码。

## 5. 分阶段实施

每个阶段都在 feature flag `v05Workbench` 后面开发，完成后通过各自的验收门槛（Gate）才进入下一阶段；旧界面在 flag 关闭时保持不变。

阶段顺序已按产品策略修订（2026-11-25）：先把“核实”和“论证结构”这两个护城河做出来，AI 对话面板放在其后。**每个阶段的验收都包含零门槛检查**：新用户无指导完成该阶段的核心任务。

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0 方案与 ADR** ✅ | 产品策略、重构方案、ADR-003 | 产品决策确认 |
| **P1 极简工作台** | 工作台骨架（默认“资料 + 写作”两栏，其余区域渐进出现）、EditorRegistry、现有页面包装成编辑器、单组标签页、深链与重启恢复、文案改为人话 | 所有现有 Research 功能可从工作台到达；新用户 2 分钟内导入 PDF 并打开阅读；双主题；960×640 可用 |
| **P2 自然核实与账本** | PDF 高亮即生成带页码的摘录；一步关联到“我的观点”；账本视图（每个观点的核实状态、反证、缺口），放在底部“还缺什么”面板 | 从高亮到关联观点不超过 2 次操作；80% 新用户无指导完成“导入 → 摘录 → 形成观点” |
| **P3 论证编辑器** | Output 升级为论证骨架：每个观点下有证据 / 理由 / 反驳 / 局限位，空位即缺口，只能引用账本内已核实证据；论证完整后才可一键生成成文；资料与写作分屏并排 | 缺口一目了然；成文中的每条引用都能回到原文定位 |
| **P4 AI 思考伙伴** | 按项目持久化、默认共享的 AI 线程（ADR-003 数据模型与同步）；小步回复与草稿卡片；“先想再看”；“挑刺”角色；⌘K 快速提问并入线程 | 重启后线程还在；AI 写入必须经过草稿；scope 可见可改；离线优雅降级；共享权限矩阵全部通过 |
| **P5 画布头脑风暴与协作** | 一卡一想法的头脑风暴模式、聚类成提纲；团队先各自写再揭晓（brainwriting）、分歧对象、AI 主持人、组会议程 | 画布聚类可一步转为论证骨架；分歧可挂证据并留档 |
| **P6 过程证明与开放接口** | 逐句来源视图、AI 使用声明与证据覆盖报告导出；MCP 接口（外部 agent 受同样的草稿 / 核实 / 来源规则约束） | 报告可被导师独立核对；外部 agent 不能绕过核实写入正式内容 |
| **P7 合并旧文献中心** | 另写 ADR 定义旧数据映射；Reader 补齐 PDF 批注，画布统一；对等后删除旧代码 | 映射测试通过后才删除；可在 P2 之后与其他阶段并行 |

快速打开（⌘P）、命令面板（⌘⇧P）等效率功能随所在阶段需要加入，不单列阶段，也不在默认界面暴露。

## 6. 风险

- **测试耦合**：现有 Research 生产测试大量依赖页面级 `data-testid` 和路由；P1 需要同步改写为“打开标签页”的断言。
- **拆包预算**：工作台骨架会进入首屏，需要守住现有 bundle budget（`check-performance-budget.mjs`）。
- **AI 线程是新的持久化数据**：需要纳入备份、迁移和隐私说明（线程里可能含论文原文片段）。
- **范围控制**：先做 Research；Study Mode 是否也迁移到工作台另行决定。

## 7. 不做

- 不做插件系统、不做多窗口。
- 不做实时多人同时编辑同一文档（沿用 WP-08 的异步协作）。
- 不改变 canonical 数据模型（AI 线程除外）。

## 8. 产品决策（2026-11-25 已确认）

1. **AI 面板交互模型**：对话式线程，回复中嵌入可应用的草稿卡片；写入编辑区仍需用户点“应用”。
2. **共享默认值**：AI 线程默认对项目成员共享，可单独改为私人。
3. **Study Mode**：工作台骨架做成通用的（不绑定 Research），先只用于 Research；Study 待 Research 稳定后再迁移（课程 = 项目）。
4. **旧文献中心**：其中有用的能力（PDF 批注、AI 对话等）并入新工作台，功能对等后删除旧代码。
