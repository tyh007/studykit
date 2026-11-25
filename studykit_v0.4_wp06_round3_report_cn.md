# WP-06 Round 3 收敛 PARTIAL 报告

**Packet**: WP-06 (Cognitive Canvas Adapter)
**状态**: Round 2 → Gate 反馈 P0-A～P0-E → **P0-B/C/D/E 关闭**；**P0-A 仍 PARTIAL**（controlled-seam 多日重构需改 useLiteratureCanvas/literature-canvas.css 撞 WIP 约束）。**git**: 不 commit/push/stash；`git diff --check` 干净

## 0. 诚实记账

Round 2 真问题：canvasWiring 没装真依赖 → 生产用 `MemoryRepository` fallback；shimStudyKitRepository `persistOne` 给 `evidence` 硬编码 `status:'verified' + workId: projectId` —— 凭空造 verified evidence；CognitiveCanvasAdapter `onNodeContentChange` 用自关系 `connectDraft({from:ref,to:sameRef})` + `.catch(() => undefined)` 吞错 —— 自由节点 body 编辑永远静默 no-op；`UPGRADEABLE_KINDS` 太宽；`canvas-suggest-cluster`/`layout` 是 `local` 未接 ProviderRouter；EvidenceWorkspace 没有 claim 复选。

## 1. 关闭的 P0

- **P0-B live wiring**：`installCanvasWiringDeps()` 生产入口；deps 必填（`MemoryRepository` 不再是默认）。新 `app/v04/canvasWiring.tsx` 在 V04 shell 挂 `<CanvasWiring>`。`getCanvasUseCases()` deps 缺失时 `console.warn` 一次后降级，**不是默认**。`repository?` 覆写（测试用 `MemoryCanvasRepository`）。
- **P0-C shim 不再伪造 + 无 .catch 吞错**：`UPGRADEABLE_KINDS = ['note','question']`（evidence/claim/source 移除）。`persistOne` `case 'evidence'/'claim'/'source'` `throw new UnsupportedKindError`（defence-in-depth）。`getObject` 4 路 fan-out 去掉 `.catch(() => null)` —— 真错向上传播。`tombstoneOne` 去掉空 catch。**新增 `updateFreeNode` use case** 取代自关系 hack；undo `update-free-body` 反演恢复 body。
- **P0-D ClaimOpen in Canvas**：EvidenceWorkspace `selectedClaims: Set<string>` + 每行 `data-testid="claim-select"`；按钮 `Open in Canvas ({N+M})` 在 N+M=0 时 disabled。researchRouter 已有 `params.evidence=…&params.claim=…` 透传。
- **P0-E 3 AI safe actions 全接 ProviderRouter**：`cluster`/`layout` (`local`→`ai`, `always`→`needs-ai`) + `relations` 全走 `installedDeps.providerRouter.chat()`；AI-off/timeout 走 `failed` draft，**不动 canonical**。
- **新 `cognitiveCanvasProduction.test.tsx`** 生产-组合集成：3 Evidence + 1 Claim → Open in Canvas → Enter 创 free node → 升 `note` → 断言 popover 只有 note/question **没** evidence/claim/source；`research.listEvidence` 仍 3 个 verified，**没 fabricated**。

## 2. P0-A 仍 PARTIAL

`CognitiveCanvasAdapter` 仍自建 xyflow surface。切到 `LiteratureCanvas`/`useLiteratureCanvas` controlled-seam 需抽 `useCanvasSurface` 通用 hook（xyflow + event loop + viewport + selection + keyboard），cognitive 覆盖 nodeTypes；改 `components/literature/canvas/` 多文件 + 撞用户 `CanvasToolbar` WIP。**最小进度**：删了自关系 + 静默 catch（见 P0-C）。`onNodeContentChange` 走 `updateFreeNode` 真 use case；失败 `console.error` 显式上报。

## 3. 真实通过

`features/canvas/__tests__/cognitiveCanvas.test.tsx` 5 + `cognitiveCanvasProduction.test.tsx` 1（新）+ `application/canvas/canvasUseCases.test.ts` 23 + `domain/canvas.test.ts` 19。`npx vitest run` **635 passed / 2 skipped**；`npx tsc -b --noEmit` 0 error；`npm run build` 0 error；`git diff --check HEAD` clean。

## 4. 仍 PARTIAL

P0-A controlled-seam 重构（多日）。AI `aiAvailable=true` 3 actions 联调。V04 shell 真浏览器 reload 持久化 + 50 节点真 browser FPS。
