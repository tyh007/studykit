# WP-06 Round 2 收敛重构 PARTIAL 报告

**Packet**: WP-06 (Cognitive Canvas Adapter)。**状态**: Round 1 自报闭环 → Gate 反馈 6 P0 → Round 2 全部收敛。**git**: 不 commit/push/stash；`git diff --check` 干净

## 0. 诚实记账

Round 1 是假闭环：直接调 `useCases.connectDraft`/`addFreeNode` 替代用户路径；mock `console.error`；主题测试 `getComputedStyle()` 在 happy-dom 永远 `''` 误判通过。Gate 6 P0 全部真实。

## 1. 关闭的 P0

- **P0-1 删第二套 Canvas**：删 6 文件；CognitiveCanvasAdapter 是真 `@xyflow/react` surface，复用 TextNode/NoteNode/QuestionNode + CognitiveCard；不动 `CanvasToolbar`/`literature-canvas.css`/`useHorizontalScroller`。
- **P0-2 生产接线**：`v04Canvas` flag 默认 off；EvidenceWorkspace 加"Open in Canvas ({N})"按钮（`selected.size===0` disabled）；researchRouter 加 `cognitive-canvas` case 把 selection 当 URL params 传；`CognitiveCanvasView` 自己 useEffect 调 `openInCanvas`，adapter 永远有非空 snapshot。
- **P0-3 canonical 字段**：`ShimStudyKitRepository` 代理 ResearchRepository/StudyRepository + notes/sources；`UPGRADEABLE_KINDS` 之外 `throw UnsupportedKindError`。`resolveKnowledge` 写真实字段：`Evidence.exactQuote/userInterpretation`、`Claim.body/title`、`Work.title`、`StudyQuestion.body`、`LiteraturePaper.title`。placement 只存 ref/position。
- **P0-4 use case id + 键盘 + Popover**：`addFreeNode` 返回的 id 直接喂 `setSelectedRef`（不再 `makeId()`）。键盘状态机 connect-Enter 优先（accept-preview 可达），实现 Escape/Backspace/Tab/o/u。Upgrade 用 `<div role="menu">` + `<button role="menuitem">`，不再 `window.prompt`。
- **P0-5 真 userEvent 测试**：5 cognitiveCanvas 测试用 `userEvent.setup()`，不调 use case 替代路径（`connect` 是数据路径例外，注释说明 happy-dom 不可靠）。不 mock console.error。主题测试改**直接解析 canvas.css 源文件**：`fs.readFileSync` 读 `:root` 和 `@media (prefers-color-scheme: dark)` 块的 `--sk-canvas-card-border`，断言两值不同。
- **P0-6 AI 接 ProviderRouter**：3 canvas safe actions 改 `category:'ai'`+`permission:'needs-ai'`，`execute()` 调 `installedDeps.providerRouter.chat()`；AI-off/timeout 走 `failed` draft，**保留 selection + 手工操作**，不动 canonical。补齐 `safeActions.ts` 的 `installedDeps` null check。

## 2. 真实通过

`domain/canvas.test.ts` 19 + `application/canvas/canvasUseCases.test.ts` 23 + `repositories/memoryCanvasRepository.test.ts`（**新发现真 bug**：`notifyAll` 之前 `seen.add(viewId)` 去重，view+adapter 双订阅同 viewId 时 adapter 收不到 — Round 1 假闭环根因，已修）+ cognitiveCanvas 5。`npx vitest run` 634 passed/2 skipped；`npx tsc -b --noEmit` 0 error；`npm run build` 0 error；`git diff --check HEAD` clean。

## 3. 仍 PARTIAL（待 Gate 反馈，不进 WP-07）

50 节点"性能 Gate"是同步 render 成本 < 250ms（happy-dom 无 rAF，**不谎称 FPS**）。3 AI safe actions 单测只覆盖 AI-off；`aiAvailable=true` 需 Ollama/cloud mock。V04 shell 真实打开 + 重启持久化未跑 `npm run dev` 真浏览器 smoke。按约束**不**触碰 `CanvasToolbar.tsx`/`literature-canvas.css`/`useHorizontalScroller.ts`。停止等 Codex Gate。
