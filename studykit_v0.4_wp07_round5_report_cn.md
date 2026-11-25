# StudyKit v0.4 — WP-07 (Research Design + PM) Round 5 报告

## 状态：PARTIAL

> 按用户要求：自己 **不** 宣布 Gate PASS，等待 Codex 复审。
> Round 4 报告：`studykit_v0.4_wp07_round4_report_cn.md`。本轮专门处理 Round 4 漏掉的真实根因 —— 测试自己写了 12 个手写 `act()` 包装，userEvent v14 和 RTL 已经有自己的 act 边界，手写包装是 double-wrap。

---

## 1. Codex 反馈的根因诊断（Round 4 我搞错了）

Codex 明确指出：
- **本仓库用 React 19（不是 React 18）**，`node_modules/react/cjs/react.development.js` 的 `version = "19.2.6"`，`@testing-library/react@16.3.2` 也是 React 19 时代。
- **`@testing-library/user-event@14.6.1` 已经是 latest**。npm 没有 v15 可升（之前我误以为升 v15 能解决，是错的）。
- **32 条 "The current testing environment is not configured to support act(...)" 来自测试自身** —— 测试写了 12 个 `await act(async () => { await user.X(...) })` 手写包装，userEvent v14 在自己 `setup()` / `dispatchEvent` 里已经管理 act 边界，手写包装 = 双重 act 边界，React 内层 `act()` 在外层 act 的 `actQueue` 之外跑时记警告。

Round 4 我误诊成"userEvent v14 + React 18 框架互斥"、还写了一大堆 `asyncWrapper` 覆盖、`Object.defineProperty` 陷阱、`__CLIENT_INTERNALS_DO_NOT_USE` 黑魔法，全是错方向。Round 5 全部撤销，回归用户直白的指引：去掉手写 `act()`。

---

## 2. 实际改动（test 边界 / 业务零改动）

### 2.1 测试文件 `src/app/v04/v04ResearchDesignProduction.test.tsx`

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| **去掉 `mountHarness` 里的 `await act(async () => { render(...) })` 包装** | ✅ 完成 | `mountHarness` 现在 `render(...)` 之后直接 `findByTestId` —— RTL `render` 自己有 act 边界；`findByTestId` 是 act-poll 边界。 |
| **去掉 `reMountProjectHome` 里的 `await act(async () => { await Promise.resolve(); })` 包装** | ✅ 完成 | `cleanup()` 之后直接 `await Promise.resolve();`（裸 microtask drain，不套 act）。Reload 仍是硬断言：`findByTestId('project-home')` 缺则 throw，无 try/catch 兜底。 |
| **去掉 6 个 `await act(async () => { await user.click(save) })` 包装**（主测试 question / hypothesis / risk / milestone save + AI 1-row / 2-row test 的 question save） | ✅ 完成 | 全部改成 `await user.click(save)` —— `userEvent.setup()` 已在 dispatch 里建了 act 边界。 |
| **去掉 2 个 `await act(async () => { navigation + findByTestId })` 包装**（design-back-to-project + task-back-to-project 之后等 ProjectHome 重挂） | ✅ 完成 | 改成 `await user.click(back); const ph = await screen.findByTestId('project-home'); await within(ph).findByTestId('project-home-brief-input');` —— `user.click` + `findByTestId` 都已是 act 边界。 |
| **保留唯一一个 `await act(...)` 在 `seedVerifiedEvidence` 里**（line 534，narrowly justified） | ✅ 完成 | `testRepo.transact(...)` 是 **外部对 Memory repo 的直写**，不是 userEvent。同步触发 `subscribe(...)` 回调 → ProjectHome 调 `setEvidence(...)` useState setState。userEvent 的 act 边界没覆盖到这条路径。代码上方贴了窄口径注释说明为什么这条是 manual act（narrow direct external-store seed）。 |
| **删掉 test-local `beforeEach` 反复设 `IS_REACT_ACT_ENVIRONMENT = true`** | ✅ 完成 | `beforeEach` 块里只剩业务清理（`resetTestRepo` / `__resetFeatureFlagsForTests` / `setWorkspaceFlavour` / `draftLayer.__resetForTests` / `registerSafeActions` / `locationStore.replace(...)`）。Flag 在 `src/test/setup.ts` 模块加载时设一次就够。 |
| **删掉 `beforeAll` 的 DTL `asyncWrapper` 覆盖**（Round 4 试错遗留） | ✅ 完成 | import 同步删 `beforeAll` / `configureDTL` / `React` 上冗余的 `ReactWithInternals` 类型。 |
| **删掉 Round 4 误导性注释**（"userEvent v14 + React 18 框架交互"、"v15 升级路径"、"configureDTL 失败原因" 等） | ✅ 完成 | 留下唯一一段精简注释：act 边界归 userEvent / RTL，test body 不重复包，唯一例外是 direct external-store seed。 |

### 2.2 业务代码 `src/features/ai/ui/IntentCapsule.tsx`

| 子项 | 状态 | 关键证据 |
|------|------|---------|
| **去掉 `TaskSuggestionsBody` useEffect 里 `draftLayer.transition` 的 silent try/catch** | ✅ 完成 | `lastTransitionedRef` 已经防重复 transition；剩下的 throw 路径只能是真合同冲突，**让它冒出来**而不是 swallow。注释显式说明这点。 |

---

## 3. 验证（精确数字）

| 验证项 | 结果 |
|--------|------|
| `npx vitest run src/app/v04/v04ResearchDesignProduction.test.tsx` 退出码 | ✅ **0** |
| 同上 stdout 最后行 | ✅ `Tests 4 passed (4)` |
| **同上的 stderr 文件大小** | ✅ **0 bytes**（`wc -c` = 0） |
| `grep -c "configured to support act"` on stderr | ✅ **0** |
| `grep -c "An update to"` on stderr | ✅ **0** |
| `grep -ic "warn"` on stderr | ✅ **0** |
| `npx tsc -b --noEmit` | ✅ 无输出（clean） |
| `researchDesignUseCases.test.ts` | ✅ 57/57 passed |
| `dexieResearchRepository.test.ts` | ✅ 15/15 passed |
| `npx vitest run`（全量） | ✅ **710 passed / 2 skipped / 0 failed**（与 Round 4 同） |
| `npm run build` | ✅ 2.06s, dist 2.45 MB bundle |
| `git diff --check` | ✅ clean |
| `grep -nE "^\s*await act\(" src/app/v04/v04ResearchDesignProduction.test.tsx` | ✅ **唯一 1 行**（line 534，`seedVerifiedEvidence` 的 direct external repo seed，已加窄口径注释） |
| `grep -nE "vi\.spyOn\|console\.error\|mockImplementation\|FILTERED_PATTERNS\|actWarningSpy\|console\.warn" src/app/v04/v04ResearchDesignProduction.test.tsx` | ✅ **0 命中** |
| `grep -nE "best.effort\|process\.stdout\|stderr\|console" src/app/v04/v04ResearchDesignProduction.test.tsx` | ✅ 只剩 2 处**注释**说明"已删除 best-effort / 已删 console 兜底"，无运行时代码 |

---

## 4. Round 5 关键决策（相对 Round 4 的反向修正）

1. **撤销所有 `asyncWrapper` 覆盖 / `Object.defineProperty` / `__CLIENT_INTERNALS_DO_NOT_USE` 黑魔法** —— Round 4 那些是 Round 4 误诊方向的产物，全部回退。
2. **撤销 test-local `beforeEach` 的 `IS_REACT_ACT_ENVIRONMENT = true` 反复设值** —— 单一来源 `src/test/setup.ts` 模块加载时设一次足够。
3. **去掉 10 个手写 `await act(...)` 包装**（6 个 `user.click(save)` + 2 个 navigation+findBy + 1 个 render + 1 个 microtask drain）。
4. **保留唯一一个 manual act** 在 `seedVerifiedEvidence`（line 534），是 direct external repo seed 的窄口径唯一合理使用。
5. **`TaskSuggestionsBody` 去掉 silent try/catch** —— `lastTransitionedRef` 防重复 transition；剩下的 throw 是真冲突，应该冒出来而不是 swallow。

---

## 5. 我**没有**自宣布 Gate PASS

按用户明示：等 Codex 跑：
1. `npx vitest run src/app/v04/v04ResearchDesignProduction.test.tsx` — 应得 4/4 pass + stderr **0 字节**。
2. `npx tsc -b --noEmit` — 应得 0 错。
3. `npx vitest run` — 应得 710+ pass。
4. `npm run build` — 应得 0 错。
5. `git diff --check` — 应得 clean。
6. `grep -nE "^\s*await act\(" src/app/v04/v04ResearchDesignProduction.test.tsx` — 应得**唯一 1 行**（line 534 已加注释说明 narrow direct external-store seed）。
7. `grep -nE "vi\.spyOn|console\.error|console\.warn|mockImplementation|FILTERED_PATTERNS|actWarningSpy" src/app/v04/v04ResearchDesignProduction.test.tsx` — 应得 0 命中。
8. Real-browser smoke — Codex 自跑。

Canvas 脏文件未触碰；没跑 `git commit` / `push` / `stash` / `reset` / `checkout`。
