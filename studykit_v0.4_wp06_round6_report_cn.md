# StudyKit v0.4 — WP-06 Round 6 (Cognitive Canvas 适配层)

## 静态门禁
- **A** `<ReactFlow>/<ReactFlowProvider>` mount 唯一存在于 `components/literature/canvas/CanvasSurface.tsx`;`LiteratureCanvas` 改用 `<CanvasSurface>`(无 `reactFlow.fitView` no-op;`useSurfaceControls()` 暴露真实 `fitView`);`CognitiveCanvasAdapter` 无 `@xyflow` / CSS import。
- **B** `CanvasRuntime { useCases, repository }` 单一来源;`CanvasUseCasesProvider` 一次 `useMemo` 构造 provider+runtime,`ResearchRouter` 仅 `useCanvasRuntime()`,**不**再 `createDexieCanvasRepository()`;无 `MemoryRepository()` 回退 / `console.warn` downgrade。
- **C** `useCanvasRuntime()` 在 `ResearchRouter` 函数顶部无条件调用(无 Rules of Hooks 违规);`useResearchDeps` / `useStudyDeps` 改为 optional 变体 `useResearchDepsOptional` / `useStudyDepsOptional`,无 `try/catch` 包裹 hook。
- **D** 新增 `features/canvas/canvasActionArgs.ts`:`buildCanvasActionArgs({ viewId, snapshot, selectedRefIds })` 返回 typed `{ args, preview, requiresAi }`;`openCapsule({ precomputedActionArgs })` 写入 session,`IntentCapsule.buildArgsForAction` 优先读取;`IntentChips` 仅在 `actionArgsById` 有 canvas-suggest-* 时显示对应 chip。
- **E** `CognitiveCanvasAdapter` 删除所有 `cognitive-canvas__*` 类名(改用 `canvas-toolbar` / `canvas-topbar` / `canvas-status` / `canvas-toolbar-btn` 等引擎类名,inline 样式仅用于 preview-tray + 升级弹层);不渲染 `CanvasToolbar`(其 PDF / Shape / Group 按钮 cognitive 不支持),改用自建 `CognitiveToolbar` 仅含 connector / mode / undo / fit / Ask AI。

## 测试
- `cognitiveCanvas.test.tsx`(5)+ `cognitiveCanvasProduction.test.tsx`(1,real `ResearchRouter` + `CanvasRuntimeOverride`)+ `cognitiveCanvasAi.test.tsx`(2,real `IntentCapsuleProvider` + `providerRouter.chat` 间谍)全部通过。
- 单元+生产+AI 集成:637 / 637 通过(全量),typecheck 0 error。
- 50-节点 FPS 性能仍 PARTIAL(happy-dom 不支持拖拽/连线;browser smoke 留给后续)。

## 修改文件
- `components/literature/canvas/CanvasSurface.tsx` 增强(共享 xyflow 桥 + `useSurfaceFlow` / `useSurfaceControls`)。
- `components/literature/canvas/LiteratureCanvas.tsx` 改用 `<CanvasSurface>`(无 `ReactFlow` import)。
- `features/canvas/CognitiveCanvasAdapter.tsx` / `CognitiveCanvasView.tsx` / `useCanvasView.ts` / `canvasActionArgs.ts` 重写。
- `app/v04/canvasWiringContext.tsx` + `app/canvas/canvasWiring.ts` 改为 `CanvasRuntime` + `useResearchDepsOptional`。
- `app/v04/researchRouter.tsx` 改用 `useCanvasRuntime()`(无条件顶部调用)。
- `features/ai/kernel/sessionStore.ts` 加 `actionArgsById`;`features/ai/ui/openCapsule.ts` + `IntentCapsule.tsx` 转发 / 读取。
- `features/research/researchContext.tsx` + `features/study/studyContext.tsx` 加 optional 变体。
