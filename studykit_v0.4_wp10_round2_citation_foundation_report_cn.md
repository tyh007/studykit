# WP-10 Round 2 — Citation Foundation 实施与验收报告

> 日期：2026-07-31  
> 状态：**ENGINEERING GATE PASS**  
> 范围：canonical Work citation、四层审计、CSL-JSON/Markdown、Web/Desktop persistence

## 1. 结果

本轮打通了 Output Statement → canonical Work 的本地优先引用闭环：用户可从项目已有 Work 插入引用、查看 citekey 与审计状态、回到 Reader、移除引用，并导出 Pandoc citekey Markdown 与去重后的 CSL-JSON。引用与 Evidence Support 保持两个独立概念，不因“有引用”而推断“论述已被证据支持”。

## 2. 产品与数据边界

- `StatementCitation` 只保存 Statement 与 canonical Work 的关系，不保存自由文本书目，也不接受 AI 生成的 DOI。
- 插入前要求 Work 属于同一项目、具有外部 identifier、完整 title/authors/year，且不是 retracted。
- 唯一键为 `(statementId, workId)`；Memory、Dexie 与 SQLite adapter 均执行相同约束。
- citekey 由 canonical Work 确定性生成；刷新、Web/Desktop adapter 切换后保持稳定。
- 删除 Statement/Section/Output 会清理引用关系，但不删除 canonical Work。
- Work 后续缺失或元数据退化时，审计/导出显式失败，不伪造补全。

## 3. 四层 Citation Audit

| 层 | 检查 | 结果 |
|---|---|---|
| Identity | Statement、Work、project boundary、identifier | pass / warning / fail |
| Metadata | title、authors、year | pass / fail |
| Integrity | ok / unknown / concern / corrected / retracted | pass / warning / fail |
| Entailment | 同一 Work 的 Evidence 是否支持、限定或反驳 Statement | pass / warning / fail |

聚合状态为 `verified / needs-review / blocked`。Evidence Support 与 citation identity 分开显示和审计；没有 supporting Evidence 的真实引用只会进入 `needs-review`，不会被误标为 verified。

## 4. 实现范围

- Domain：`domain/citation.ts`（类型、guard、stable citekey、audit、CSL-JSON mapping）。
- Use cases：插入、移除、单条/Output 批量审计，以及 Markdown/CSL-JSON 导出。
- Repository：沿现有 `ResearchRepository` 扩展；没有 CitationRepository、第二套 store 或新 IPC 命令。
- Web：Dexie v11 additive migration，新增 `researchStatementCitations`。
- Desktop：继续复用 `domain_records(namespace='research')`，新增 `statement_citation` allowlist entity。
- UI：Output Statement 下就地选择 canonical Work；显示 citekey、Work、audit 状态与四层 tooltip；点击回到 Reader；Header 提供 Markdown/CSL JSON 下载。
- 性能：Output 首次读取改为单个并行批次，未增加串行加载 waterfall。
- React 复核：无页面直连数据库/IPC、无新增 provider 调用、无 inline component、交互控件有 label，错误可见。

## 5. 自动验收证据

| Gate | 真实结果 |
|---|---|
| TypeScript | 0 errors |
| Citation/adapter/UI 定向测试 | 53 passed |
| Vitest 全量 | 91 files passed / 2 skipped；1174 tests passed / 2 skipped |
| Rust library | 73 passed |
| cargo fmt | clean |
| Web production build | success；916 modules transformed |
| Desktop unsigned build | success；`src-tauri/target/release/studykit-desktop` |
| diff whitespace | clean |

全量测试中的既有 React `act(...)` 与 Vite chunk/dynamic-import warnings 仍存在，但无新增失败；本轮没有扩大历史 bundle 问题。

## 6. 新增测试覆盖

- stable citekey、CSL-JSON、domain guard 与四层 audit。
- canonical/incomplete/retracted Work 的接受与 fail-closed 行为。
- citation 与 entailment 独立、重复引用拒绝、移除与级联删除。
- Markdown/CSL-JSON 输出、Work 去重。
- Dexie v11 round-trip 与跨 transaction duplicate。
- SQLite domain record round-trip/reopen 与 Rust allowlist。
- 真实 production composition：从 Output 插入 canonical Work citation，连接 Evidence 后 audit=`verified`，点击进入 Reader。

## 7. 明确延期到 Round 3

- Crossref/OpenAlex 实时 metadata reconciliation 与来源冲突 UI。
- Retraction Watch/外部 integrity 定时刷新；当前只消费 canonical Work 已有 integrity 状态。
- citeproc 驱动的 APA/MLA/Chicago 文内引用与 bibliography rendering。
- BibTeX/RIS/DOCX/PDF/LaTeX export 与 Word/Google Docs 插件。
- AI citation suggestion / citation-needed queue；AI 不得直接写 canonical citation。
- 协作中的 citation conflict resolution。

这些延期不影响 Round 2 的本地、离线、可审计引用基础。

## 8. Gate 决策

WP-10 Round 2 Citation Foundation **Engineering Gate PASS**。下一步进入 WP-10 Round 3：metadata/integrity verification + citeproc styles + richer export；应继续复用本轮 canonical Work 和 StatementCitation，不引入平行 bibliography 数据源。
