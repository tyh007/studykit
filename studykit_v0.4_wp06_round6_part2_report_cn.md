# StudyKit v0.4 — WP-06 Round 6 P0-1/2/3 补漏

## 修复
- **P0-1** 拆出 `CanvasSurfaceProvider` 单独导出;`<CanvasSurface>` 本体不再自建 `ReactFlowProvider`,父组件 (`LiteratureCanvas` / `CognitiveCanvasView`) 用 `CanvasSurfaceProvider` 包住自身 hooks + surface,确保共享同一个 xyflow store;`LiteratureCanvas` 加真实 render 测试 (mock 数据 API,无 xyflow mock) 验证 `useReactFlow` 父端与 surface 同 store,Fit 按钮真调用共享 store 的 `fitView`。
- **P0-2** `buildRelationCandidates` 改为从 *selected placements* 派生 (Evidence↔Claim→`supports`,Question→`qualifies`,Free↔*→`untyped`);按 `(from,to,kind)` 去重 (跳过 accepted/preview 已有边);`MAX_CANDIDATES=24` 防组合爆炸;AI 测试 seed 2 Evidence + 1 Claim,断言 `providerRouter.chat` 的 user message 包含 `ev-*` + `cl-1` + `supports`,且 canonical `accepted` 关系数 = 0 (AI 仅产 draft,Accept 才是真写)。
- **P0-3** `assistantSession.close()` 清 `actionArgsById`;`openCapsule` 总是 `setActionArgs(input.precomputedActionArgs ?? {})`;`open()` 不再清。新增测试:Canvas Ask AI→3 chip→close→generic Cmd+K reopen→chip 消失→再开 Canvas→chip 重建。`onRetry` 不再对 terminal `failed` draft 调 `transition('cancelled')` (会抛),直接 `setDraft(null)` + 重新 `runAction`;AI-off 测试真实断言 `draft.status==='failed'` + 错误文案 + Retry 后 `chat` 第二次被调。
- **清理** 删未读 `CognitiveToolbarContext`;`selectedRefIds` 在 `useMemo` 内派生 (稳定依赖);`useLiteratureCanvas` 内部仍直接 `useReactFlow` (由 `CanvasSurfaceProvider` 包住,共享 store)。

## 验证
- 全量 640 / 640 测试通过,typecheck 0 error;新增 `LiteratureCanvas.render.test.tsx` 2 个真实 render 测试覆盖 xyflow 单 store 不变量。
- 静态门禁: A 单一 `ReactFlowProvider` mount ✓ B `useResearchDeps`/`useStudyDeps` optional ✓ C buildRelationCandidates 派生新候选 ✓ D close→reopen 无 stale chip ✓ E 工具栏无 no-op handler ✓。
- 50-节点 FPS 仍 PARTIAL (browser smoke 留给后续)。
