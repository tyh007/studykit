# WP-06 Round 4 收敛报告

**Packet**: WP-06 (Cognitive Canvas Adapter)
**状态**: Round 3 → Gate 反馈 P0-A～P0-E + 5 静态门禁 (A-E) → **P0-B/C/D/E + 静态门禁 A-E 全过**；P0-A 通过共享 `<CanvasSurface>` seam 收敛。**git**: 不 commit/push/stash；`git diff --check` 干净

## 0. 诚实记账

Round 1-3 三轮自报"闭环"，但 Gate 静态核验全可复现：第二套自建 ReactFlow + 自带 toolbar + 自带 CSS；模块全局 `installCanvasWiringDeps` + `MemoryRepository` fallback + `console.warn` 降级；`deleteRelation({ relationId: placement.id })` 永远静默 no-op；`cognitiveCanvasProduction.test.tsx` 直接 `renderView(CognitiveCanvasView)` 跳过 EvidenceWorkspace 点击 + location route；IntentCapsule 仅注释提。

## 1. 关闭的 P0 + 静态门禁

- **P0-A + Gate A**：新增 `components/literature/canvas/CanvasSurface.tsx`（引擎的 ReactFlow 单一 surface），`CognitiveCanvasAdapter` 改为薄 mapper：snapshot → `snapshotToFlowGraph` → 引擎 nodeTypes (TextNode/NoteNode/QuestionNode + CognitiveCard)；事件回写 use cases；用引擎的 `CanvasToolbar` + 引擎的 `literature-canvas.css`；type-only import 通过 `CanvasSurface` 重导出。**`grep "@xyflow/react"` 0 hit**。
- **P0-B + Gate B**：删 `installCanvasWiringDeps` / `getCanvasUseCases` / `MemoryRepository` fallback / `console.warn` 降级；新增 `app/v04/canvasWiringContext.tsx` `<CanvasUseCasesProvider>` 嵌在 `ResearchWiring`+`StudyWiring` 内，useMemo 构 CanvasUseCases（每次 render 重建，无模块缓存）；`<CanvasUseCasesOverride>` 仅测试用；`researchRouter` 改 `useCanvasUseCases()` hook，null 时显示 `cognitive-canvas-unavailable` 状态而非降级。**`grep "MemoryRepository()\|console.warn"` 在生产源码 0 hit**。
- **P0-C + Gate C/C2**：新增 `removePlacement` + `deleteFreeNode` use case + undo lineage（`remove-placement`/`delete-free-node`）；Backspace/Delete 调 `removePlacement({ placementId: ... })`（id 是 placement id，**不是 relation id**）；自关系 `connectDraft({from:ref,to:sameRef})` hack 全删；所有 async user 动作 (Enter/p/Backspace/connect/move/upgrade/undo/accept) 走 `setError(visible aria-live)`，**`grep ".catch(() => undefined/null)"` 0 hit**。
- **P0-D + Gate D**：重写 `cognitiveCanvasProduction.test.tsx` 为真用户路径：mount 真实 `EvidenceWorkspace`（不是 `CognitiveCanvasView`），userEvent 点 3 evidence 复选框（work-1/2/3 各一 verified）+ 1 claim 复选框 + "Open in Canvas" 按钮；`TestDriver` 翻 route 到 `cognitive-canvas`；断言 canvas view 4 placement + 3 distinct workId + 1 preview relation（use case 数据路径）+ 1 free node；unmount + remount 后持久且 canonical Evidence/Claim 不重复（3 evidence / 1 claim 数量不变）。
- **P0-E + Gate E**：CognitiveCanvasAdapter 工具栏加 "Ask AI" 按钮，调用引擎 `openCapsule({ surface: 'intent-capsule', selectedObjectIds, container })`；3 canvas safe actions（`canvas-suggest-relations` / `-cluster` / `-layout`）通过 ContextResolver 的 selection 流到 ProviderRouter.chat；AI-off/timeout 走 `failed` draft 不写 canonical。

## 2. 真实通过

`npx vitest run` **635 passed / 2 skipped**（+1 production-composition）；`npx tsc -b --noEmit` 0 error；`npm run build` 0 error；`git diff --check HEAD` clean。

## 3. 仍 PARTIAL

50 节点真 browser FPS（happy-dom 无 rAF，sync render < 250ms 报即可）。
