# StudyKit v0.4 — WP-06 Round 9 报告 (Cognitive Canvas 浏览器烟雾 + 50 节点性能)

**结果：PASS** — 实修后 Outline UI round-trip 真实通过，**109.46 fps**（elapsed 2202ms / 241 frames，env `{webdriver: true}` headless Chromium）。
**命令**：`cd frontend && node scripts/smoke-canvas.cjs`（或 `npm run smoke:canvas`）；`tsc -b --noEmit` 0 错；`vitest run` 643/643（+3 新增 Dexie 订阅测试）。
**真因**：Round 9 PARTIAL 误判 —— `dexieCanvasRepository.ts` 用 Dexie 3 的对象式 `table.hook({...})` 注册 hook，**Dexie 4 静默忽略对象式参数**（视为未知事件名），导致所有 5 个 canvas 表的 `creating/updating/deleting` hook 实际从未注册；`setViewMode` 写 Dexie 成功但无 hook 触发、无 notify、无 listener 回调。
**实修**（`src/platforms/web/dexieCanvasRepository.ts`）：1) 改用 Dexie 4 事件式 API `table.hook('creating', cb)` × 3；2) views 表主键即 viewId（`obj.id ?? key`），其他表用 `obj.viewId`；3) emit 只通知 dirty views（无空 dirty 时 fallback 全通知，防御 race）；4) `deleting` hook 对 views 表用 `key` 精确标，对其他表 fan out（无 row 拿不到 viewId）。
**Outline UI 真路径**（`src/features/canvas/CanvasOutline.tsx`）：新增 `← Back to canvas` 按钮 + 'o' 键盘 handler（调 `useCases.setViewMode({mode:'spatial'})` 而非直写 Dexie）；`<ol role="tree" aria-label="…">` + 50 `<li role="treeitem" tabIndex={0} aria-selected>`；ArrowUp/Down/Home/End 键盘导航、Enter/Space 翻转 `aria-selected`。
**烟雾脚本 step 6 强断言**（无 Dexie 后门、无 `tx.putView` 直写回退）：按下 'o' 必须挂载 `[data-testid="cognitive-canvas-outline"]`、ReactFlow 节点必须为 0、tree 必须有 aria-label、必须 ≥50 treeitem、Tab 必须落在 `role=treeitem`、Enter 必须把 `aria-selected` 翻为 `true`、点 `Back to canvas` 按钮必须让 ReactFlow 重新出现 ≥50 节点且 outline 必须消失。
**实跑**：所有断言逐项通过；FPS 109.46、Reload 50、Light/Dark 50、no `pageerror` / `console error`。
