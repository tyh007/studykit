# WP-11R2 Claude Code + MiniMax 一次性执行 Prompt

将下面整段发送给 Claude Code，并选择 MiniMax 模型执行。不要拆成多个对话；执行者完成后只返回最终报告，Codex 再做二次验收。

```text
你是 StudyKit v0.4 的主实施工程师。执行 WP-11R2 Interaction Logic Reconstruction，目标是一次性完成可验收实现；不要扩大功能面，不要边做边向用户汇报，不要宣布最终 Gate PASS。

先严格读取：
1. studykit_v0.4_wp11r2_interaction_reconstruction_spec_cn.md
2. frontend/docs/wp11r2-interaction-logic-audit/audit.md
3. studykit_v0.4_interaction_flows_cn.md 中第 1–5 节
4. studykit_v0.4_visual_direction_and_theme_spec_cn.md
5. 直接相关代码与 tests；先运行 git status --short，保护所有现有修改。

只实施以下目标：
A. 统一可见的 Add / Capture / Ask 操作语言；Header Ask 在所有 v0.4 surface 复用现有 IntentCapsule/openCapsule/session，携带当前 AppLocation context，不建新聊天系统。
B. WorkspaceSidebar 只保留上下文导航：Study 为 Home/Course/按条件 Review；Research 为 Home/Project/Sources/Canvas/按条件 Output。Discover/Evidence/Design 不再永久显示，但旧 AppLocation/hash deep link 必须继续工作。New course 不在 sidebar 展开表单。
C. Study Home 先 Resume 后 Create；Course Home 空状态直接提供 New lecture / Import slides or PDF / Start blank notes。全部复用 getDataApi().lectures 和现有 Lecture Focus/import path；创建后进入真实 Lecture，返回后可见并可恢复。Review 没有内容时不占主要导航。
D. Research Home 先 Resume existing project；Project Home 首屏只保留 Focus、Continue、统一 Add、一个 Next item、Recent。现有 Questions/Hypotheses/Risks/Milestones/Tasks/Lineage/Outputs/Collaboration 功能不得删除，移到按需展开 Project details，空集合不渲染空面板。
E. 将用户可见 Discover + Library 收敛成 Sources surface/state：Add Sources 面板统一 Search literature / Import PDF / Zotero / URL or DOI，复用原 Discovery、Library、SearchRun、Work、Reader contracts，不复制数据和 use cases。
F. Evidence 空状态不显示不可执行 Claim/AI Claim 完整表单；给出 Add/Open source、Reader capture 或 Canvas 的最短动作。Design/Task/Output 由 Develop into… 进入，保留原 surface/deep link/canonical use cases。
G. Canvas 空状态暴露既有 addFreeNode：Add idea、背景双击、纯文本粘贴均可开始且每次只创建一个 canonical node；第一节点直接编辑。无 selection 时隐藏无效 Connector，不新建 Canvas/store/repository。
H. 保持 Warm Cognitive Glass、现有 tokens、Light/Dark/System、960×640、键盘、焦点、aria-live、离线/AI-off/Local Workspace 与 route chunk budget。

强制工程边界：
- 增量重构；先复用后新增；一个概念一个状态真相。
- 不新增数据库表、migration、Rust IPC、router library、重量依赖、feature flag、全局 store、repository 或 AI provider 直连。
- 页面不得直连 Dexie/SQLite/IPC/AI provider。
- 不修改 canonical domain contract，除非发现当前 contract 无法完成已存在的能力；若确需修改，停止并报告，不自行扩张。
- 不 reset/checkout/clean/stash/stage/commit/push，不删除或覆盖无关未提交文件，不全仓格式化。
- 不用 mock、静默 catch、disabled 假按钮或 TODO 冒充完成；错误必须可恢复。
- 不重复实现已有 addFreeNode、IntentCapsule、SearchRun、Work、Evidence、Output、Draft/Accept/Reject。

执行顺序：
1. 用不超过 15 行输出现状映射：每个目标复用的现有组件/use case、会修改的高冲突文件、无 schema/IPC 变化结论；随后立即实施，不等待回复。
2. 先写/改生产组合测试锁定 Course 死胡同、Project Home 降噪、Sources、Evidence 空态、Canvas 三种开始方式、全局 Ask 与 deep-link 兼容。
3. 按 Slice A Shared entry → B Study → C Research → D Canvas → E hardening 实施；完成一个 slice 立即运行定向测试，修正后再进入下一个。
4. 删除被新组合取代的重复 UI 分支和死代码，但不删除 canonical use case/domain/repository；保持组件小而聚焦。
5. 最后一次性运行 Gate，避免重复全量构建：
   - npx tsc -b --noEmit
   - npx vitest run（先定向、最终一次全量）
   - npm run build 或项目现有 quality build
   - cargo fmt --check
   - cargo test --lib -- --test-threads=1
   - npm run build:desktop:unsigned（使用本机已有 Rust PATH）
   - git diff --check
   - git status --short
6. 若环境允许，启动新构建的真实 StudyKit.app，完成规范中的 Study/Research/Canvas、Light/Dark、960×640、重启恢复任务并保存截图；无法人工驱动的项目明确写未执行，禁止虚报。

必须新增或更新的测试断言：
- Course 空状态三个开始动作存在；blank Lecture 创建后 route 与持久化正确；
- Project Home 首屏不出现空数据库 sections，Project details 仍能访问非空对象；
- Sources 统一入口覆盖 Search/PDF/Zotero/URL-DOI，保存后仍是同一 Work；
- Evidence 零数据时没有禁用 Claim form；
- Canvas Add idea、double-click、paste 各只写入一次 addFreeNode；
- Header Ask 在 Study/Research/Reader/Canvas/Output 使用同一 capsule；
- offline/AI-off 不禁用本地 Add/Capture/Notes/Canvas；
- 旧 discovery/library/evidence/design/output hash 可解析；
- Light/Dark 与键盘状态不依赖主题硬编码。

完成后更新：
- studykit_v0.4_master_implementation_plan_cn.md（仅追加 WP-11R2 实际结果）
- studykit_v0.4_document_index_cn.md（追加报告链接）
- 新建 studykit_v0.4_wp11r2_interaction_reconstruction_report_cn.md

最终报告不超过 45 行，只包含：
1. READY FOR CODEX REVIEW（不要宣布 Gate PASS）
2. 用户可见改变
3. 复用与删除内容
4. 核心修改文件
5. 测试/构建/真实桌面验证的精确结果
6. 未执行项、风险、数据/schema/IPC/依赖变化
7. git status 摘要

遇到停止条件或真实基线失败时，不要建立替代系统；保留证据并报告 BLOCKED。
```

