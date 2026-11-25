# StudyKit v0.4 文档索引

> 版本：0.4.0-draft  
> 日期：2026-07-31  
> 状态：产品方向重构稿，等待逐项决策  
> 上一版本：`studykit_v0.3_product_spec_cn.md` / `studykit_v0.3_system_design_cn.md`

## 1. 为什么升级为 v0.4

v0.3 正确识别了 StudyKit 的几个问题：Lecture 主路径被忽视、Literature Canvas 与其他学习场景割裂、顶层 mode 状态混乱、AI 与来源之间的关系不够统一。

但 v0.3 把“统一对象和工作流”过早等同成“所有任务统一到画布”。这会把工具切换成本转化为画布维护成本，也没有充分回答：

- 学生怎样在上课时快速记录而不被界面打断；
- AI 怎样促使用户思考，而不是替用户生成笔记；
- 研究项目怎样从论文管理走向问题、证据、论点和输出管理；
- 产品怎样成为无需登录、可离线使用的本地应用。

因此 v0.4 是一次方向重构，不是 v0.3 的功能追加。

## 2. v0.4 核心结论

1. 产品顶层分为 **Study Mode** 与 **Research Mode**。
2. 两个 Mode 共用一套知识对象、来源、关系、搜索、AI 和本地存储，不做两套割裂产品。
3. StudyKit 从 Canvas-first 改为 **Learning-loop-first / Evidence-first**。
4. 画布是可切换的认知与综合视图，不是所有任务的默认界面。
5. AI Assistant 是贯穿整个产品与桌面系统的交互层：在选区、对象、画布、Reader、搜索和项目管理中就地出现，也可通过全局快捷键随时召唤；Chat 只是一种备用界面。
6. 本地版是一等公民：无需账号、离线可用、资料默认留在设备上；云同步和远程 AI 都是可选增强。
7. 产品采用 **Agency-first / Schema-on-demand**：用户可以自由开始，结构、方法模板与 AI 指导只在需要时出现，StudyKit 不扮演老师或流程审批者。
8. Research Collaboration 是核心能力：单人本地工作不受影响，共享项目按需启用成员权限、评论、任务、决策记录及实时共创。

## 3. 文档集

| 文档 | 作用 | 主要读者 |
|---|---|---|
| [Master Implementation Plan](./studykit_v0.4_master_implementation_plan_cn.md) | 总体实施顺序、Work Packets、依赖、MiniMax 执行协议、质量 Gate 与公测计划 | 产品、技术负责人、Minimax Code、测试 |
| [产品需求文档](./studykit_v0.4_product_spec_cn.md) | 产品定位、双模式信息架构、用户场景、功能范围、验收标准 | 产品、设计、开发 |
| [Research Mode AI-native 规范](./studykit_v0.4_research_mode_ai_native_spec_cn.md) | 文献发现、筛选、Evidence、研究设计、项目管理、输出与 citations 的调研和实现方案 | 产品、UX、Research AI 工程 |
| [AI-native 与认知画布规范](./studykit_v0.4_ai_native_and_cognitive_canvas_spec_cn.md) | AI-native 交互、认知画布、学习保护机制、来源追踪 | 产品、UX、AI 工程 |
| [交互流程规范](./studykit_v0.4_interaction_flows_cn.md) | 系统级 AI Assistant、Study、Research、协作与 Desktop Quick Capture 的端到端交互流程 | 产品、UX、前后端、测试 |
| [视觉方向与双主题规范](./studykit_v0.4_visual_direction_and_theme_spec_cn.md) | Warm Cognitive Glass 方向、Light/Dark tokens、表面层级、关键页面构图与视觉 QA | 产品、UX、前端、测试 |
| [屏幕、状态与组件矩阵](./studykit_v0.4_screen_state_component_matrix_cn.md) | P0 页面、状态、现有组件复用、新组件与五条纵向切片 | 产品、UX、前端、测试 |
| [实现就绪与 Minimax Code 施工包](./studykit_v0.4_implementation_readiness_and_minimax_handoff_cn.md) | Definition of Ready/Done、Work Packets、保护边界和逐步施工指令 | 产品、技术负责人、Minimax Code |
| [WP-08 Round 3 生产协作收口报告](./studykit_v0.4_wp08_round3_report_cn.md) | 生产协作 API、权限、原子 Outbox、Shared Task 与 A/B/C 浏览器验收证据 | 产品、技术负责人、测试 |
| [WP-09A Desktop Foundation 报告](./studykit_v0.4_wp09a_desktop_foundation_report_cn.md) | Tauri 2 desktop shell、Runtime contract、最小 capability、macOS `.app` 与真实冷启动恢复；Gate PASS | 产品、技术负责人、桌面端、测试 |
| [WP-09B Round 1 Correction Gate 报告](./studykit_v0.4_wp09b_round1_correction_gate_report_cn.md) | native workspace、SQLite v1、严格验证、原子状态机、单一类型化 IPC 与 Repository 生命周期；Codex Gate PASS | 产品、技术负责人、桌面端、测试 |
| [WP-09B Round 2A Desktop Composition 报告](./studykit_v0.4_wp09b_round2a_desktop_composition_report_cn.md) | 原生 Workspace chooser、重启恢复、Desktop composition root、切换工作区、能力翻转与 Web 隔离 | 产品、技术负责人、桌面端、测试 |
| [WP-09B Round 2B1 Native Domain Repositories 报告](./studykit_v0.4_wp09b_round2b1_native_domain_repositories_report_cn.md) | SQLite schema v2、Study/Research/Canvas 原生 Repository、单事务 IPC、Web/Desktop composition 隔离 | 产品、技术负责人、桌面端、测试 |
| [系统设计](./studykit_v0.4_system_design_cn.md) | 本地优先架构、桌面版、数据层、同步、AI provider、迁移路径 | 前后端、桌面端、LLM coding agent |
| [路线图、指标与用户研究计划](./studykit_v0.4_roadmap_metrics_and_research_cn.md) | 路线图、用户研究计划、指标、实验和 release gate | 产品、项目管理 |
| [决策日志](./studykit_v0.4_decision_log_cn.md) | 已确认、默认决策、开放问题与变更记录 | 全团队 |

## 4. 文档优先级

发生冲突时按以下顺序处理：

1. `studykit_v0.4_decision_log_cn.md` 中的“已确认决策”；
2. `studykit_v0.4_product_spec_cn.md`；
3. Research Mode AI-native 规范；
4. 交互流程规范；
5. 屏幕、状态与组件矩阵；
6. 视觉方向与双主题规范；
7. AI 与认知画布规范；
8. 系统设计；
9. Master Implementation Plan；
10. 实现就绪与 Minimax Code 施工包；
11. 路线图和历史文档。

v0.2、v0.3 文档保留为历史依据，但不再作为新功能的最终实施规范。

## 5. 一句话产品定义

> StudyKit 是一个本地优先、证据驱动、尊重用户自主性的 AI 学习与研究工作台：学生和研究人员可以自由捕捉、连接与发展想法，在需要时获得结构、AI 与团队协作，而不被迫遵循固定流程。
# WP-09 最终报告

- `studykit_v0.4_wp09_final_report_cn.md` — 桌面本地优先闭环、真实 Host Gate、数据安全约束与外部发布 Gate。

# WP-10 Round 1 实施与 Codex 二次验收报告（Engineering Gate PASS）

- `studykit_v0.4_wp10_round1_evidence_backed_output_report_cn.md` — Evidence-backed Output 纵向闭环（Project → Output → Section → Statement → support → audit → AI context selection → editable Draft → Accept/Reject → reload persistence）；Codex 二次验收与修正见第 11 节，Engineering Gate PASS；Round 2/3 的 Citation/CSL/export 等明确不做。

# WP-10 Round 2 Citation Foundation 报告（Engineering Gate PASS）

- `studykit_v0.4_wp10_round2_citation_foundation_report_cn.md` — Statement → canonical Work 引用、Identity/Metadata/Integrity/Entailment 四层审计、Dexie v11 / Desktop SQLite parity、stable citekey、Markdown/CSL-JSON export 与完整 Gate 证据。

# WP-10 Round 3 Citation Verification & Formatting 报告（Engineering Gate PASS）

- `studykit_v0.4_wp10_round3_verification_formatting_report_cn.md` — Crossref/OpenAlex 主动核验、差异预览与用户逐字段确认、retraction/correction mapping、APA/MLA/Chicago CSL、BibTeX/RIS、动态加载与 Web/Desktop Gate 证据。

# WP-11 Round 1 Alpha Hardening 报告（Engineering Gate PASS）

- `studykit_v0.4_wp11_round1_hardening_report_cn.md` — route-level code split、bundle hard budget、10k Native Workspace benchmark、数据位置/AI scope onboarding、Study/Research/Canvas 真实浏览器 Gate，以及仍待真实用户完成的 External Alpha Gate。
- `studykit_v0.4_wp11_alpha_test_kit_cn.md` — 12–16 人封闭 Alpha 的招募、consent、Study/Research/Desktop 任务、记录模板、P0/P1 停止条件、设备/PDF/人工可访问性矩阵与 Go/No-go Scorecard。

# WP-11R1 Product Shell Convergence 报告（Engineering Gate PASS）

- `studykit_v0.4_wp11r1_product_convergence_report_cn.md` — 双应用/双侧栏根因修复、单一 AppLocation 导航、Study/Research 模式隔离、Lecture 窄兼容桥、真实安装及 Light/Dark 桌面验收证据。

# WP-11R2 Interaction Logic Reconstruction（READY FOR IMPLEMENTATION）

- `frontend/docs/wp11r2-interaction-logic-audit/audit.md` — 已安装桌面版 10 步真实操作审计与结构性根因。
- `studykit_v0.4_wp11r2_interaction_reconstruction_spec_cn.md` — Add/Capture/Connect/Develop/Share 操作模型、Study/Research/Sources/Canvas/AI 重构范围、工程边界与 Gate。
- `WP11R2_CLAUDE_MINIMAX_EXECUTION_PROMPT.md` — 给 Claude Code + MiniMax 的一次性施工指令，限定复用、测试、真实桌面验证和停止条件。

# WP-11R2 交互逻辑重构实施报告（AUTOMATED PASS / ENGINEERING HOLD）

- `studykit_v0.4_wp11r2_interaction_reconstruction_report_cn.md` — Add/Capture/Connect/Develop/Share 交互收敛、Study/Research/Sources/Canvas/AI 实施结果、1205 条前端测试与 73 条 Rust 测试、macOS 安装包证据，以及锁屏 UI Gate 与 Native Study/Research source asset bridge 的明确边界。

# WP-11R2A Native Source Asset Bridge（Engineering Gate PASS）

- `frontend/docs/adr/ADR-002-native-source-asset-bridge.md` — Rust-owned PDF 资产边界、原子复制、路径安全、一致性与替代方案。
- `studykit_v0.4_wp11r2a_native_source_asset_bridge_report_cn.md` — Study/Research 原生 PDF 导入、SQLite metadata、失败回滚、备份、安装版重启及双主题真实 Gate 证据。
