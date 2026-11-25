# StudyKit v0.4 — WP-06 Round 8 假阳性修补

## 改动
- `LiteratureCanvas.render.test.tsx`: 删 `FlowProbe` + 外层 `CanvasSurfaceProvider`,直接 `render(<LiteratureCanvas projectId="project-1" />)`;真实控制 = 派发 `Ctrl+'='` window keydown → 父 `useSurfaceFlow().zoomIn` → xyflow 共享 store → `.react-flow__viewport` 的 `style.transform` 必须实际变化 (`before !== after`)。mock 加 `updateViewport` 防止 debounce 抛 unhandled。
- `canvasActionArgs.ts` `pickKind`: `evidence → claim` 才提议 `supports`,`claim → evidence` 落到 `untyped` (A→B 支持,B→A 在认知语义上无意义,Round 8 P0-2 enforce direction)。
- `cognitiveCanvasAi.test.tsx`: 点击 Ask AI 后**先**从 `assistantSession.actionArgsById['canvas-suggest-relations']` 读 typed `seedCandidates`,断言 `ev-1→cl-1` 与 `ev-2→cl-1` 都是 `supports`,且 `cl-1→ev-1` / `cl-1→ev-2` (若存在) **不是** `supports`;再 click chip 跑 AI,assert 失败前 canonical `accepted=0`。

## 验证
- targeted: `LiteratureCanvas.render` (2) + `cognitiveCanvasAi` (3) 全过;全量 640 / 640 pass,typecheck 0 error。
- 静态门禁 A 单一 xyflow mount / B `useResearchDeps` optional / C typed Evidence→Claim supports only / D close→reopen 无 stale chip 全部保持。
