# WP-10 Round 3 — Citation Verification & Formatting 报告

> 日期：2026-07-31  
> 状态：**ENGINEERING GATE PASS**  
> 范围：Crossref/OpenAlex 主动核验、差异确认、CSL 样式、BibTeX/RIS

## 1. 交付结果

本轮完成了“真实 registry 核验 → 差异预览 → 用户选择 → canonical Work 更新 → CSL 渲染/交换格式导出”的闭环。网络与格式化均不是 AI 行为；AI 不能创建或修改 canonical citation。

## 2. Metadata / integrity verification

- `CrossrefOpenAlexCitationVerifier` 是 composition root 注入的可选依赖，UI 不直接调用 `fetch`。
- 仅用户点击 Citation 的 `Verify` 后请求；不后台扫描、不阻塞离线编辑。
- DOI 与 OpenAlex id 同时存在时并行请求；单一 provider 失败时保留另一方结果并明确显示 partial error。
- Crossref DOI 与 OpenAlex id 必须严格匹配 canonical Work，响应不匹配直接拒绝。
- 核验只产生 preview，不写数据。title/authors/year/venue/doi 逐字段默认不勾选；integrity 也需用户单独确认。
- Apply 前再次比较 `Work.updatedAt`；预览后发生并发修改时拒绝覆盖，要求重新核验。
- 接受字段后写入 field-level `metadataProvenance`；Crossref `update-to/updated-by` 映射为 ok/corrected/concern/retracted。
- 继续复用现有 `Work` 与 `ResearchRepository`，无新表、无新 IPC、无平行 registry store。

依据：[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)、[Retraction Watch in Crossref](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/)。

## 3. CSL formatting 与 export

- 使用 Citation.js 0.7.18 + citeproc-js 链路，不让 LLM 模仿引用格式。
- 内置离线样式：APA 7、MLA 9、Chicago author-date。
- MLA/Chicago 使用按样式拆分的 CSL packages；UI 显示 CSL Project attribution。
- Citation processor 与样式仅在用户点击 Preview/BibTeX/RIS 时动态加载，不进入首屏执行路径。
- 同一 CSL-JSON 可生成 bibliography、in-text citation、BibTeX 与 RIS。
- BibTeX entry key 显式替换回 StudyKit stable citekey，避免 processor 重新生成不稳定 label。
- 既有 Markdown、CSL-JSON 导出继续保留。

依据：[CSL Primer](https://docs.citationstyles.org/en/master/primer.html)、[Citation.js](https://citation.js.org/)、[CSL official styles](https://github.com/citation-style-language/styles)。

## 4. 关键文件

- `frontend/src/application/output/citationVerification.ts`
- `frontend/src/application/output/citationVerification.test.ts`
- `frontend/src/application/output/citationFormatting.ts`
- `frontend/src/application/output/citationFormatting.test.ts`
- `frontend/src/types/citation-js.d.ts`
- `frontend/src/features/research/OutputWorkspace.tsx`
- `frontend/src/features/research/researchContext.tsx`
- `frontend/src/app/v04/researchWiring.tsx`
- `frontend/src/app/v04/v04ResearchOutputProduction.test.tsx`
- `frontend/package.json` / `frontend/package-lock.json`

## 5. 验收结果

| Gate | 真实结果 |
|---|---|
| TypeScript | 0 errors |
| Round 3 定向测试 | 33 passed |
| Vitest 全量 | 93 files passed / 2 skipped；1184 passed / 2 skipped |
| Rust library | 73 passed |
| cargo fmt | clean |
| Web build | success；1039 modules transformed |
| Desktop unsigned build | success；`src-tauri/target/release/studykit-desktop` |
| npm production audit | 3 处既有链路告警（Tiptap link / linkify-it / markdown-it）；Citation.js 链路未出现在报告中 |
| diff whitespace | clean |

生产构建首次暴露 Citation.js 0.8.2 的 Node-only `node-fetch` 入口；未添加浏览器 polyfill，而是锁定浏览器兼容的 0.7.18。最终 build 与 desktop build 均通过。

包体结果：Citation processor/styles 被拆为按需 chunk（最大约 539 KB / gzip 120 KB）；主应用 chunk 约 2651 KB / gzip 769 KB。历史主包超预算仍属于 WP-11 hardening，Round 3 没有把 citeproc 并入首屏 chunk。

## 6. 测试覆盖

- Crossref DOI match、metadata parse、correction/retraction mapping。
- Crossref + OpenAlex 并行、partial failure、无核验写入。
- 逐字段 apply、provenance、integrity opt-in、stale preview 拒绝。
- APA/MLA/Chicago deterministic formatting。
- BibTeX/RIS 结构与 stable citekey。
- 真实 Output UI：MLA preview；registry diff 勾选单字段后仅更新该字段，不隐式更新 year/integrity。

## 7. 已知边界

- 自动测试使用确定性 registry fixtures；没有在 Gate 中对真实上游写入或依赖实时网络成功。
- Crossref/Retraction Watch coverage 不是“绝对未撤稿”证明；UI 显示的是最近一次 registry 检查结果。
- 当前 integrity 仍沿用 `Work.integrity + integrityCheckedAt`，尚未保存多来源历史；需要历史审计时应新增明确 ADR，而不是塞入 metadata 字符串。
- DOCX/LaTeX/Quarto 与 Word/Google Docs live fields 未进入本轮。
- Citation.js 按需 chunk 仍较大；WP-11 可评估 worker/desktop-side formatting，但不能以手写格式替代 CSL 正确性。

## 8. Gate 决策

WP-10 Round 3 **Engineering Gate PASS**。WP-10 的 Output + Citation 主闭环已完成。下一实施位置建议进入 WP-11 Hardening：真实任务 E2E、bundle/cold-start、备份恢复、跨平台安装与公测 Gate；不要继续扩张 citation 功能面。
