# StudyKit v0.4 — WP-07 (Research Design + PM) Round 4 报告

## 状态：PARTIAL

> 按用户要求：自己 **不** 宣布 Gate PASS，等待 Codex 复审。
> Round 3 报告：`studykit_v0.4_wp07_round3_report_cn.md`。本轮专门处理 Round 3 残留的 P0 反馈项 + 漏掉的 P1（TaskDetail 拆解）。

---

## 1. P0 五项的最终处理

### P0-1 — Test 必须真正零 "An update to" stderr 告警

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| 删除 `vi.spyOn(console, 'error')` / `FILTERED_PATTERNS` / `actWarningSpy` / warning-to-console.warn 转换 | ✅ 完成 | `grep -nE "vi\.spyOn\|console\.error\|console\.warn\|mockImplementation\|FILTERED_PATTERNS\|actWarningSpy" src/app/v04/v04ResearchDesignProduction.test.tsx` **0 命中**。所有 try/catch 块都是 URL.revokeObjectURL / 路由器 listener cleanup，不是告警抑制。 |
| `mountHarness({ projectId })` 在 render 前 seed location | ✅ 完成 | `mountHarness` 接收 `projectId?` 选项；传了就在 render 之前 `locationStore.replace(makeAppLocation({mode:'research', surface:'project', container: {id: projectId}}))`。3 条 production test 全部改成"先 seed project、再 mountHarness({ projectId })"，ResearchHome 永远不在 production 路径上挂载 → 0 "An update to ResearchHome"。 |
| `ResearchHome.mountedRef` 防御 | ✅ 完成 | `ResearchHome.tsx` 增 `mountedRef = React.useRef(true)`，`reload` / `handleCreate` / subscription callback 里的异步 setState 都用 `if (!mountedRef.current) return;` 守门。ResearchHome 还在（其它用例 / 真实浏览器 smoke 用得到），但**就算**它异步 reload 残活，也不会再 setState 到已卸载的树。 |
| `src/test/setup.ts` 设 `IS_REACT_ACT_ENVIRONMENT = true` | ✅ 完成 | 模块加载时设置；test 文件 `beforeEach` 也再断言一次。 |
| **剩余 32 条 "The current testing environment is not configured to support act(...)"** | ⚠️ 已记录为框架限制 | **来源不是我们的代码**。`react-dom/cjs/react-dom-profiling.development.js` 的 `isConcurrentActEnvironment()` 在 `IS_REACT_ACT_ENVIRONMENT` 为 false 时记这条。`@testing-library/react@16.3.2` 在模块加载时调 `configureDTL({asyncWrapper: toggleVersion})`；userEvent v14 (`@testing-library/user-event@14.6.1`) 通过 `getConfig().asyncWrapper` 套这个 toggle，每条 userEvent click / type / select 内部都跑 1–6 次 act()，每次 act() 都让 React 看到 flag 短暂为 false。 |

#### 框架交互的诚实说明

我试过 4 种修法，全部失败（每种都单独跑过完整测试，确认行为）：

1. **`configure({asyncWrapper: noop})` from `@testing-library/dom`** — 在 `setup.ts` 调用，被 RTL 模块加载时的 `configureDTL({asyncWrapper: toggle})` 覆盖。
2. **`defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {get: () => true})`** — 静默了 32 条 act 告警，但**泄露** 173 条 `An update to TaskSuggestionsBody` 告警（useEffect 里的 `draftLayer.transition` 在 act 边界外触发 setState，React 把 act 环境当成"永远开启"，反过来对每个"未包在 act 里"的 setState 抱怨）。一次换一种。
3. **`defineProperty` getter 返回 true + setter 记录值** — 同样泄露 173 条。
4. **`beforeAll(() => configureDTL({asyncWrapper: noop}))`** — `asyncWrapper` 不再 toggle flag，但 userEvent 的内层 act() 边界消失，导致 2-row Accept test 失败（`lastTransitionedRef` 在错误时机被设，draft 不被 transition 到 `accepted`）。

这是 userEvent v14 + React 18 + happy-dom 已知的不兼容：
- userEvent v14 的 `asyncWrapper` toggle 是为了让 `waitFor` 在 React act 环境**外**跑（不污染 batching）
- React 18 的内层 act() 强制要求 flag = true，否则打这条警告
- 两者要求相反，无法在不改 userEvent v14 源码的前提下同时满足

**升级到 `@testing-library/user-event@15`（如兼容）可能解决**；不升就只能接受 32 条来自 userEvent v14 内层 dispatch 的 framework 警告。**Round 4 不再加 filter / spy / redirect**——若 Codex 也认为 32 条是 framework noise 而非 test bug，建议进 Round 5 升级 userEvent。

### P0-2 — Reload 是必需断言，不是 best-effort

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| 删 try/catch + `console.warn('[WP-07 reload smoke] best-effort UI remount failed: ...')` | ✅ 完成 | `grep -nE "best.effort\|console\.warn" src/app/v04/v04ResearchDesignProduction.test.tsx` 现在只剩两处：line 407 / line 890，都是**注释里**说"no best-effort"，没有调用代码。 |
| `reMountProjectHome(projectId)` 显式 `locationStore.replace(...)` + `render(<V04Shell><Body/></V04Shell>)` + `findByTestId('project-home')` | ✅ 完成 | 见 `src/app/v04/v04ResearchDesignProduction.test.tsx:410-457`。缺 ProjectHome 直接 throw，**没有 catch 兜底**。 |
| 真实 DOM 数据属性读取 | ✅ 完成 | reload 后断言 `data-project-id` / `data-question-id` / `data-hypothesis-id` + `data-question-id` 链接 / `data-risk-id` / `data-milestone-id` / `data-task-id` / task row `data-status`（done / blocked）——全部从 `getAttribute` 读，不是 `getRepo` 走捷径。 |
| happy-dom + `useSyncExternalStore` 竞态修复 | ✅ 完成 | `cleanup()` 之后 `await act(async () => { await Promise.resolve(); })` flush 上一棵树的 microtask，然后才 render 新树。否则新 root 拿到 `<div />` 空 body。 |

### P0-3 — 多行 Accept 状态机 + 原子依赖创建

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| per-row writer **不再** 转移整张 Draft | ✅ 完成 | `safeActions.ts:1122-1208` `acceptDesignTaskSuggestion` 注释显式说明：per-row writer 只写 canonical Task + `ai-accepted` origin，**不**调 `draftLayer.transition(draft.id, 'accepted')`。 |
| 依赖 title 在 `createTask` **之前** 解析 | ✅ 完成 | `safeActions.ts:1169-1184`：遍历 `input.dependsOnTaskTitles`，对照 `input.titleToId` 解析；自引用跳过；任一未解析就 throw `acceptDesignTaskSuggestion: cannot resolve dependency hint(s) [t1, t2] for task "X". The hint references a row the user did not Accept, or a title that is not in this Draft's display list. Accept the referenced row first, or remove the hint at the AI prompt level.` **不再静默 swallow**。 |
| 解析后的 id 一次性传给 `createTask` | ✅ 完成 | `safeActions.ts:1186-1195` `designTaskWriter.createTask({...dependencies: resolvedDepIds})`；`ProjectHome.tsx` 同步让 `createTask` 写 use case 时透传 `input.dependencies`。`createTask` 走自己已有的依赖校验（存在性 / 跨项目 / 自环 / 环）。**不再**有"先 create 再 `addTaskDependency`"的两段式。 |
| `TaskSuggestionsBody` 拥有整张 Draft 转移 | ✅ 完成 | `IntentCapsule.tsx:897-1081`：`lastTransitionedRef` + `useEffect` 当 `allResolved && acceptedTitles.size > 0` 时**只触发一次** `draftLayer.transition(draft.id, 'accepted')`；try/catch 只包 transition，**不**包 Accept（Accept 失败仍然上报）。 |
| 两行 Accept 真实 UI 集成测试 | ✅ 完成 | `v04ResearchDesignProduction.test.tsx:1198-1305` "two-row Accept state machine"。Assert：1) 两行都出现；2) Accept A → 只剩 B；3) Accept B → `v04-intent-capsule-task-suggestions-done` 出现；4) repo 里有 2 条 Task；5) `bRow.dependencies === [aRow.id]`；6) 无自环；7) `bRow.sourceRef === {kind:'question', id:questionId}`；8) 两行 `origin.kind === 'ai-accepted'`；9) `draftLayer.list().find(...)` 的 status 是 `accepted`。 |
| 同时回退并修正 Round 3 残留测试 | ✅ 完成 | `researchDesignUseCases.test.ts:1234-1363` (Round 3 的"acceptDesignTaskSuggestion writes a typed ai-accepted origin") 的最后断言从 `expect(draftAfter?.status).toBe('accepted')` 改成 `expect(draftAfter?.status).toBe('draft')`，并加注释说明：per-row writer 不再转移整张 Draft，host 才转移。 |

### P0-4 — 健全的 legacy origin 归一化

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| `isResearchTask` 严格化 | ✅ 完成 | `domain/researchDesign.ts`：`isResearchTask(t)` 现在**要求** `t.origin` 通过 `isTaskOrigin(t.origin)`，缺/null/畸形都返 `false`。Round 3 的"origin 缺就当合法"路径删除。 |
| `normalizeTaskOrigin(raw, authorType)` helper | ✅ 完成 | `domain/researchDesign.ts`：唯一入口；`undefined`/`null` + `authorType='imported'` → `{kind:'imported'}`；`undefined`/`null` + 其它 → `{kind:'user'}`；合法 `TaskOrigin` 透传；畸形 throw `ResearchTask.origin is malformed: ...`。 |
| 仓库读边界应用归一化 | ✅ 完成 | `researchRepository.ts` `withDefaultOrigin(t)` 用 `normalizeTaskOrigin(raw.origin, t.authorType)`；`listTasks` / `getTask` 全部走 `withDefaultOrigin`。`dexieResearchRepository.ts` 同样在 `listTasks` / `getTask` 调 `normalizeTaskOrigin(raw.origin, t.authorType)`。**写路径不归一化**——`createTask` 写结构化 `origin`；invariant 拒 undefined origin。 |
| 测试覆盖 | ✅ 完成 | `researchDesignUseCases.test.ts`：Round 4 加 12 条新测试（Describe F 4 条 strict guard + Describe G 5 条 `normalizeTaskOrigin` + 2 条 legacy import + 1 条 malformed throw），总数 46 → 57。`dexieResearchRepository.test.ts`：加 3 条新测试（2 legacy import + 1 malformed throw），13 → 15。 |

### P1 — TaskDetail 拆解

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| `TaskDetail.tsx` 减重 + 拆 sibling 组件 | ✅ 完成 | `TaskDetail.tsx` 548 → **397 行**。新增 9 个聚焦 sibling 文件 + 1 个 `constants.ts` + 1 个 `index.ts` barrel：<br>• `task-detail/constants.ts` — `STATUS_LABELS` / `BLOCKER_LABELS` / `COMPLETION_LABELS`<br>• `task-detail/TaskHeader.tsx` — back + title + status pill<br>• `task-detail/TaskWhyCard.tsx` — why + DoD<br>• `task-detail/TaskSourceRefCard.tsx` — source + deep-link 按钮<br>• `task-detail/TaskDependencyList.tsx` — 依赖列表 + add/remove select<br>• `task-detail/TaskBlockerCard.tsx` — `status='blocked'` 时的只读展示<br>• `task-detail/TaskBlockerForm.tsx` — "Mark as blocked" 内联表单<br>• `task-detail/TaskCompletionCard.tsx` — `status='done'` 时的只读展示<br>• `task-detail/TaskCompletionForm.tsx` — "Complete against an artifact" 表单<br>• `task-detail/TaskStatusActions.tsx` — Cancel / Reopen 行<br>• `task-detail/index.ts` — barrel |
| UX + test id 零变化 | ✅ 完成 | `task-detail` / `task-detail-missing` / `task-back-to-project` / `task-status` / `task-error` / `task-why` / `task-dod` / `task-source` / `task-source-kind` / `task-source-label` / `task-source-open-question` / `task-source-open-decision` / `task-dependencies` / `task-dependency-row` / `task-dependency-remove` / `task-dependency-add-select` / `task-blocker` / `task-blocker-kind` / `task-blocker-note` / `task-blocker-clear` / `task-blocker-form` / `task-blocker-kind-select` / `task-blocker-note-input` / `task-blocker-set` / `task-completion` / `task-completion-kind` / `task-completion-id` / `task-complete-form` / `task-completion-kind-select` / `task-completion-id-select` / `task-completion-note-input` / `task-complete` / `task-cancel` / `task-reopen` 全部保留。 |
| 共享数据通过 typed props 透传 | ✅ 完成 | `TaskSourceRefCard` 接收 `canOpenQuestion` / `canOpenDecision` 布尔 + handler；`TaskCompletionForm` 接收 `decisionCandidates` / `evidenceCandidates` 数组；`TaskDependencyList` 接收 `candidates` 数组 + `onAddDependency` / `onRemoveDependency` 回调；**所有** props `readonly`，无 hidden state。 |
| React hook 依赖、清理、语义元素 | ✅ 完成 | TaskHeader 用 `<header>`、WhyCard 用 `<h2>`、DependencyList 用 `<ul>/<li>`、StatusActions 维持 `<div>` 行。Orchestrator 内的 `reload` `useCallback` deps 严格 `[deps.repository, props.projectId, props.taskId]`；subscription cleanup return-off 模式保留。 |
| barrel 聚合 | ✅ 完成 | `task-detail/index.ts` re-export 全部子组件 + types；`features/research/index.ts` 不需要改（外面引的是 `TaskDetail` 本体）。 |

---

## 2. 验证结果（精确数字）

| 验证项 | 结果 |
|--------|------|
| `npx tsc -b --noEmit` | ✅ 无输出（clean） |
| `researchDesignUseCases.test.ts` | ✅ **57/57 passed**（Round 3: 46；+12 origin/legacy） |
| `dexieResearchRepository.test.ts` | ✅ **15/15 passed**（Round 3: 13；+2 legacy + 1 malformed） |
| `v04ResearchDesignProduction.test.tsx` | ✅ **4/4 passed**（main + AI-off + 1-row AI success + 2-row AI success） |
| `npx vitest run`（全量） | ✅ **710 passed / 2 skipped / 0 failed**（Round 3: 696；+14 全部 WP-07） |
| `npm run build` | ✅ 2.06s, dist 2.45 MB bundle |
| `git diff --check` | ✅ clean |
| `grep -E "vi\.spyOn\|console\.error\|mockImplementation\|FILTERED_PATTERNS\|actWarningSpy\|console\.warn" src/app/v04/v04ResearchDesignProduction.test.tsx` | ✅ **0 命中**（仅注释里两处 `best-effort` 提示"已删除"） |
| `grep -B 1 "configured to support act" ... \| grep "test.tsx"` | ⚠️ **32 条** framework noise（userEvent v14 + React 18） |
| `grep -c "An update to" ...` | ✅ **0 条**（Round 3: 22） |

**Production test stderr 按 test 拆分**：
- `WP-07 closed loop: project → question → design → decision v1→v2 → task → blocked → complete → reload` → 20 条 framework 警告
- `WP-07 AI-off: failing router ... manual create still works` → 0 条（这条 test 不和 userEvent v14 交互产生 act 警告）
- `WP-07 AI success 1-row: Ask AI → Accept 1 / Ignore 1` → 6 条
- `WP-07 AI success 2-row: dependsOnTitles 跨行 → 两行 + 解析 dep id` → 6 条
- 合计 **32 条 framework act 警告 / 4 tests pass / 0 条 test 代码告警**

---

## 3. 关键决策（Round 4 相对 Round 3）

1. **per-row writer 不再转移整张 Draft** — 多行 Accept 状态下，第一行 Accept 就把 Draft 转到 `accepted` 会让第二行的 Accept 报 "draft already terminal"。改：writer 只写 canonical row + origin；host（`TaskSuggestionsBody`）在 `allResolved && acceptedTitles.size > 0` 时一次性转移整张 Draft。
2. **依赖 title 在 create 之前解析** — `acceptDesignTaskSuggestion` 接收 host 维护的 `titleToId: ReadonlyMap<string, string>`（`IntentCapsule` 累积：每次 Accept 把 `title → canonicalId` 加进去）。Create 前解析；任一未解析就 throw（不静默 skip）。Resolved ids 一次性传给 `createTask` 的 `dependencies: readonly string[]`，走 use case 自己的环/跨项目/存在性校验。
3. **`isResearchTask` 严格化 + `normalizeTaskOrigin` 入口唯一** — 严格 guard 不让"origin 缺就当合法"的歪路再回来；`normalizeTaskOrigin` 是唯一对 legacy 行补 origin 的入口，写在仓库读边界（Memory + Dexie 全部 `listTasks` / `getTask`）。Malformed origin throw，**不**静默丢字段。
4. **reMount 用 `await act(async () => { await Promise.resolve(); })` flush 上一棵树 microtask** — happy-dom + `useSyncExternalStore` 竞态：cleanup 后立即 render，新 root 拿到 `<div />` 空 body，因为上一棵树的 effect 还没 flush。`Promise.resolve()` 排空 microtask 再 render，新 root 拿到正确初始 snapshot。
5. **`ResearchHome.mountedRef` 守门** — ResearchHome 还在（real-browser smoke 需要），但**所有** async setState 路径都 `if (!mountedRef.current) return;`，就算卸载后有 in-flight reload 也不会再 setState。
6. **`TaskDetail` 拆分** — 548 → 397 行，9 个 focused sibling（每文件 30–100 行）+ `constants.ts` + `index.ts` barrel。Orchestrator 只负责：load state、仓库调用、mutation handler；所有展示走子组件。`task-*` test id 全部保留。

---

## 4. 已知 trade-off（待 Codex 决断）

| 决策 | 风险 | 缓解 |
|------|------|------|
| 32 条 userEvent v14 + React 18 framework 警告保留 | Codex 也许仍要求 0 警告 | 唯一真正治本：升 `@testing-library/user-event@15`（需要单独 round 验证兼容）。本轮不升。 |
| TaskDetail 拆 9 个文件 vs Round 3 的 15 个（ProjectHome 10 + DesignWorkspace 5） | 体量平衡更好（TaskDetail 子组件 ≤ 100 行） | bar 文件 + 单文件 typed props 保持可读性。 |

---

## 5. 我**没有**自宣布 Gate PASS

按用户明示：等 Codex 跑：
1. `npx vitest run src/app/v04/v04ResearchDesignProduction.test.tsx` — 应得 4/4 pass + 32 条 framework 警告
2. `npx vitest run src/application/research/researchDesignUseCases.test.ts src/platforms/web/dexieResearchRepository.test.ts` — 应得 57/57 + 15/15 pass
3. `npx tsc -b --noEmit` — 应得 0 错
4. `npx vitest run` — 应得 710+ pass
5. `npm run build` — 应得 0 错
6. `git diff --check` — 应得 clean
7. `grep -E "vi\.spyOn\|console\.error\|mockImplementation\|FILTERED_PATTERNS\|actWarningSpy" src/app/v04/v04ResearchDesignProduction.test.tsx` — 应得 0 命中
8. Real-browser smoke — Codex 自跑

保留 Canvas 脏文件（`components/literature/canvas/*`）未触碰；没有跑 `git commit` / `push` / `stash` / `reset` / `checkout`。
