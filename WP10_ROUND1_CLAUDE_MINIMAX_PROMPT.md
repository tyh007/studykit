# WP-10 Round 1 — Claude Code + MiniMax 一次性施工 Prompt

你是 StudyKit v0.4 的执行工程师。使用 Claude Code 作为编排器、MiniMax 模型作为主要编码模型，完成：

**WP-10 Round 1 — Evidence-backed Output**

执行工程师只提交真实实施报告，不自行宣布 Gate PASS；Codex 负责二次验收。

## 0. 工作原则

1. 先搜索、后阅读、再修改。使用 `rg` 定位符号，只读完成本包所需的最小范围。
2. 所有 shell 命令使用 `rtk` 前缀；Rust 工具链使用：
   `PATH=/Users/hengx/.cargo/bin:$PATH`。
3. 当前工作区包含用户和 WP-00～09 的未提交变更。不得执行：
   `commit / push / stage / stash / reset / checkout / clean`。
4. 不覆盖或格式化无关文件；保持最小 diff。不复制已有 Repository、Provider、Router 或 UI 基础设施。
5. 以当前已通过 Gate 的 WP-09 为基线：
   - Vitest：1053 passed / 2 skipped；
   - Rust：70 passed；
   - TypeScript、Web build、macOS `.app` 均通过。
6. 一次完成根因级实现。先列出不超过 12 项的文件级实施清单，然后连续施工；不要每完成一个文件就停下来等待。
7. 如果发现真实架构冲突，先沿既有 contract 修正，不新建平行系统。只有会导致数据损坏或必须改变产品范围时才停止。

## 1. 本轮目标

交付最小但完整的纵向闭环：

```text
Research Project
→ Create Output
→ Add/reorder Sections
→ Add Statements
→ Link Statement to accepted Claim and/or verified Evidence
→ Instantly audit supported / unsupported / conflicted
→ Jump Statement → Evidence → Work locator / Reader
→ Optional AI draft from explicitly selected supporting objects
→ User Accept turns draft into canonical Statement
→ Reload / desktop restart still present
```

本轮不是文字处理器，也不是 citation formatting 工程。重点是让研究输出具有真实 lineage。

## 2. 严格范围

### 必须完成

- 纯领域模型、guards 和 invariants；
- Research Repository contract 扩展；
- Dexie v10 增量 schema + Web adapter；
- Desktop SQLite `domain_records` adapter + Rust allowlist；
- Output use cases；
- v0.4 Research composition 和 Output Workspace；
- Evidence-backed audit；
- 明确选择上下文后的 AI draft/Accept/Reject；
- Web/Desktop persistence；
- 单元、Repository、UI 和真实纵向生产测试；
- WP-10 Round 1 实施报告与总计划/索引追加。

### 明确不做

- CitationItem、CSL、Crossref、Retraction Watch；
- APA/MLA/Chicago 渲染；
- BibTeX、RIS、CSL-JSON、DOCX、PDF、LaTeX export；
- Study↔Research cross-mode；
- 多人实时共同编辑 Output；
- Word/Google Docs 插件；
- 新 backend endpoint；
- 新 router library；
- 新通用富文本编辑器；
- 自动生成 reference、伪 DOI 或模型记忆中的文献。

这些属于 WP-10 Round 2/3。不得提前搭空壳或 placeholder。

## 3. 领域模型

新增 `frontend/src/domain/output.ts`。坚持纯类型、guard、构造验证和少量纯 helper，不导入 React、Dexie、Tauri 或 API。

### OutputDocument

- `id`
- `projectId`
- `title`
- `status: 'outline' | 'draft' | 'final'`
- `authorType: 'user' | 'ai' | 'imported'`
- `createdAt`
- `updatedAt`

约束：id/projectId/title 非空；时间为有效 ISO/RFC3339；AI 不得直接创建 `final`。

### OutputSection

- `id`
- `projectId`
- `outputId`
- `title`
- `order: number`
- `createdAt`
- `updatedAt`

约束：order 为有限非负数；同一 Output 的最终排序必须稳定，以 `order → createdAt → id` 排序。

### OutputStatement

- `id`
- `projectId`
- `outputId`
- `sectionId`
- `body`
- `order`
- `authorType`
- `status: 'draft' | 'accepted'`
- `createdAt`
- `updatedAt`

约束：canonical Repository 中不保存空 body；AI 生成内容在用户 Accept 前留在既有 Draft Layer，不可偷偷写入 OutputStatement。

### StatementSupport

- `id`
- `projectId`
- `outputId`
- `statementId`
- `ref`：
  - `{ kind: 'claim'; id: string }`
  - `{ kind: 'evidence'; id: string }`
- `relation: 'supports' | 'contradicts' | 'qualifies'`
- `authorType`
- `createdAt`
- `updatedAt`

约束：

- 一个 support 只能引用一个 canonical object；
- `(statementId, ref.kind, ref.id, relation)` 不得重复；
- Claim 必须属于相同 project 且为 accepted；
- Evidence 必须属于相同 project 且为 verified；
- 不复制 Claim/Evidence 正文，不保存失真的 snapshot；
- 删除 Claim/Evidence 不自动级联删除 support，保留 broken lineage 让 audit 显示。

### Audit（派生，不持久化）

定义：

- `supported`：至少一个有效 supports/qualifies 链，且没有有效 contradicts；
- `conflicted`：同时存在有效正向支持和有效 contradicts；
- `unsupported`：无有效正向支持；
- `broken`：至少一个引用对象缺失、跨 project、Claim 非 accepted 或 Evidence 非 verified。

Audit 必须返回原因列表和可跳转的 ref；不得用单个 boolean 隐藏差异。

## 4. Repository 与持久化

沿现有 `ResearchRepository` 扩展，禁止另建 OutputRepository 平行真相。

新增事务操作和查询：

- OutputDocument CRUD / `listOutputs({ projectId })`
- OutputSection CRUD / `listOutputSections(outputId)`
- OutputStatement CRUD / `listOutputStatements(outputId | sectionId)`
- StatementSupport CRUD / `listStatementSupports(statementId | outputId)`

要求：

- 一次 use-case 写入对应一次 Repository transaction；
- 失败不产生部分提交；
- subscribe 一次 transaction 只通知一次；
- 内存、Dexie、SQLite adapter 行为一致；
- delete Output 时在同一事务删除其 sections/statements/supports；
- delete Section 时不得误删其他 section；
- Desktop adapter 必须延续单次读快照/单次 IPC transaction 的既有模式。

### Dexie

- 增加 v10 additive schema；
- 表名建议：
  `researchOutputs`、`researchOutputSections`、
  `researchOutputStatements`、`researchStatementSupports`；
- 不修改 v1～v9；
- 不迁移或删除旧数据。

### Desktop SQLite

沿 `domain_records(namespace='research')` 存储，新增 entity types：

- `output`
- `output_section`
- `output_statement`
- `statement_support`

同步更新：

- Rust `validate_domain_pair` allowlist；
- Desktop Research adapter；
- Dexie → SQLite migration table map；
- 相关严格 payload/id/timestamp 校验。

不得为四个对象新增另一套 SQLite 表，除非能证明 `domain_records` 无法满足现有 contract；本包默认不允许这种架构扩张。

## 5. Application use cases

新增 `frontend/src/application/output/outputUseCases.ts` 与测试，或在同目录采用与 Study/Research 现有组织一致的最小结构。

至少实现：

- `createOutput`
- `renameOutput`
- `addSection`
- `reorderSections`
- `addStatement`
- `updateStatement`
- `reorderStatements`
- `attachSupport`
- `removeSupport`
- `auditStatement`
- `auditOutput`
- `deleteOutput`

每个 use case：

- 验证 project/output/section/statement 归属；
- 使用 domain guard；
- 不从 UI 接受伪造的完整对象；
- 时钟/id generator 通过 deps 注入，测试可确定；
- 返回 typed result/error；
- 不直接访问 Dexie、SQLite、HTTP 或组件状态。

如果接通 `ResearchTask.completionRef.kind='output'`：

- 只有真实存在、相同 project、状态为 `final` 的 Output 才能完成任务；
- 必须移除当前“phantom output”临时拒绝逻辑；
- 增加成功和伪造 id/跨 project/非 final 的测试。

## 6. AI draft

沿用现有 Provider Router、Draft Layer 和 provenance；不得直接调用 `literatureAiApi`，不得新建聊天面板。

入口：Output Workspace 中的 `Draft from selected evidence`。

要求：

1. 用户显式勾选 accepted Claims / verified Evidence；
2. prompt 只包含所选对象及必要 locator，不读取整个 workspace/PDF；
3. 没有选择、存在 invalid ref、AI unavailable 时 fail closed；
4. provider 返回内容进入 Draft Layer；
5. UI 展示 provider、model、selected object ids 和 `Accept / Reject`；
6. Accept 后才创建一个或多个 canonical Statement + StatementSupport；
7. Reject 不写 Repository；
8. 本地 Ollama 与 sync/cloud 使用同一 Provider Router contract；
9. AI 文本不能自己引入新的 citation/reference；
10. 如输出超出证据，应保留但 audit 为 unsupported，不替用户伪造 support。

## 7. UI / 交互

新增 `OutputWorkspace`，沿用 v0.4 视觉 token、primitives 和 `ResearchWiring`。不要复制 legacy NoteEditor。

路由使用已经存在的：

`/research/p/:projectId/output/:outputId`

必要入口：

- Project Home 增加自然的 `Outputs` 区域；
- 创建 Output；
- 打开 Output；
- 返回 Project；
- Section add/rename/reorder；
- Statement add/edit/reorder；
- 选择 Claim/Evidence 并 attach；
- 每个 Statement 显示 audit badge 和原因；
- 点击 Evidence 打开现有 Reader locator；
- 点击 Claim 打开现有 Evidence/Claim surface；
- AI draft 显示明确 Draft 状态；
- 空状态告诉用户可以自由写，不强迫先建模板或 Research Question。

交互原则：

- 不做强制写作向导；
- 不用红色恐吓用户；unsupported 是信息和检查入口；
- 自动保存，但显示真实 saved/pending/error；
- Light/Dark/System 使用现有 token；
- 键盘可达，reorder 提供非拖拽按钮；
- 不把 Citation 与 Evidence Support 混为一谈，Round 1 UI 明确写
  “Evidence support；citations arrive in the next audited step”。

不要增加 `v04Output` 新 flag；Output 属于已存在的 `v04Research` 纵向闭环，避免 flag 膨胀。

## 8. 测试要求

先 targeted，最后一次全量。不得为了通过而降低已有断言。

### Domain

- guards 拒绝空值、NaN order、错误 status/time；
- stable ordering；
- audit 四种状态；
- broken/cross-project/non-verified/non-accepted；
- duplicate support。

### Use case

- create → section → statement → support → audit；
- attach 的 Claim/Evidence 真实性和 project 校验；
- transaction rollback；
- delete cascade 范围；
- AI Accept/Reject，AI off，本地 Ollama provider provenance；
- task completionRef 若接入则覆盖成功和所有拒绝路径。

### Repository

- memory/Dexie/SQLite contract parity；
- reload persistence；
- transact 单通知；
- v9 → v10 additive migration 不丢数据；
- Desktop entity allowlist 与严格 validation。

### Production UI

至少一条真实 userEvent：

```text
existing Project
→ existing accepted Claim + 3 verified Evidence
→ create Output
→ add Section
→ add Statement
→ attach support
→ audit=supported
→ reload/remount
→ Statement 和 lineage 仍存在
→ click Evidence opens the real locator path
```

另覆盖：

- unsupported；
- conflicted；
- broken；
- AI off；
- Reject 无写入；
- Desktop repository composition；
- v04 flags off 无旧 UI 回归；
- Light/Dark contract。

## 9. 禁止做法

- 不以 `any`、默认空对象或 catch-and-ignore 绕过验证；
- 不把 citation id 当 evidence support；
- 不把 AI 回答直接保存为 final Output；
- 不缓存独立的第二份 Claim/Evidence 正文；
- 不通过 reload 掩盖 Repository lifecycle 问题；
- 不从组件直接访问 `db`、Tauri invoke 或 backend API；
- 不扩大 WebView capability；
- 不引入大型 editor/citation 依赖；
- 不生成模拟 citation；
- 不删除现有用户数据或测试 workspace。

## 10. 验证命令

按以下顺序运行；修复失败根因后再继续，不重复无意义命令：

```sh
cd frontend
rtk npx tsc -b --noEmit
rtk npx vitest run <本包定向测试>
rtk npx vitest run
rtk npm run build

cd ..
PATH=/Users/hengx/.cargo/bin:$PATH rtk cargo fmt --check --manifest-path frontend/src-tauri/Cargo.toml
PATH=/Users/hengx/.cargo/bin:$PATH rtk cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib -- --test-threads=1
PATH=/Users/hengx/.cargo/bin:$PATH rtk cargo check --manifest-path frontend/src-tauri/Cargo.toml
rtk git diff --check
```

如果修改 Desktop adapter，再执行一次：

```sh
cd frontend
PATH=/Users/hengx/.cargo/bin:$PATH rtk npm run desktop:build:unsigned
```

不要重复 DMG 封装；WP-09 已确认 DMG 属于签名发布机 Gate。

## 11. 最终报告

新增：

`studykit_v0.4_wp10_round1_evidence_backed_output_report_cn.md`

并只追加更新：

- `studykit_v0.4_master_implementation_plan_cn.md`
- `studykit_v0.4_document_index_cn.md`

报告必须包含：

1. 完成的真实用户闭环；
2. 架构选择及没有新建平行系统的证据；
3. 核心新增/修改文件；
4. 数据模型和 invariants；
5. Web/Desktop persistence 结果；
6. AI 输入 scope、Draft/Accept/Reject 和 provenance；
7. 全部真实命令结果；
8. 未完成项和风险；
9. git status 摘要；
10. 请求 Codex 二次验收。

最终输出状态只能是：

`READY FOR CODEX REVIEW`

不得写整个 WP-10 PASS，也不得写 Public Beta Ready。
