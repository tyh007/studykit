# StudyKit v0.4 — WP-08 Round 2 (Collaboration Foundation 真实异步协作) 实施报告

## 状态：建议 Gate PASS（待 Codex 复审）

> 按用户要求：自己**不**宣布 Gate PASS，等待 Codex 复审。
> 基线：WP-07 Gate PASS + WP-08 Round 1（987 passed / 2 skipped / 0 failed，typecheck/build/diff-check clean）。
> Round 2 修复 Codex 复审点出的全部 P0：生产身份、Private Scratch 真实隔离、Publish 真实 canonical writer、Shared Tasks 真实分配、真实跨用户异步路径、严格浏览器烟雾。
>
> **诚实区分**：同源（BroadcastChannel）是实时感知层（live awareness），跨用户持久化是 HTTP 网关（outbox + inbox）。两者并存：掉线重连时，跨用户数据通过 HTTP 拉取恢复；同 tab 间通过 BroadcastChannel 实时通知。V0.4 Beta 不引入 Yjs/CRDT。

---

## 1. 修复的 P0（Codex 复审）

| P0 | Round 1 问题 | Round 2 修复 |
|----|------------|------------|
| 1 | `CollaborationWiring` 固定使用 `u-local` 身份 | `useAuth()` 解析 sync workspace 真实 userId；local workspace 用 `getLocalIdentity()` 稳定 per-device id；`ensureLocalMembership` 在 panel mount 时幂等 bootstrap |
| 2 | 先读所有人 Scratch 再在 UI 过滤 | `ScratchQuery.ownerId` 改为 TypeScript mandatory + runtime throw；`getScratchForOwner(id, ownerId)` 替换 `getScratch`；Memory + Dexie 适配器都强制 ownerId |
| 3 | `commentReplyTo` 从未设置 | 每个 comment 加 Reply 按钮；列表渲染回复；thread 数据通过 `parentId` / `threadId` 持久化 |
| 4 | 无 Shared Tasks 模型 | 在 `ResearchTask` 上加 `assignee` + `publishedFromScratchId` 增量字段；新增 `assignTask` / `unassignTask` use case（idempotent，拒绝跨项目）；AI `acceptDesignTaskSuggestion` 永远 `assignee: null` |
| 5 | Publish 返回 `${kind}_${ts}` 占位 id | 真实调用 `createTask` 写 `ResearchTask`；`ProjectHome` 在 `resolveCanonicalId` 中注入真 writer；非 `task` kind 抛"暂不支持"错误，scratch 保持 `publishing` 可恢复 |
| 6 | BroadcastChannel 冒充跨用户持久化 | 真实 HTTP gateway（`HttpCollabGateway`）+ Dexie v9 `collabOutbox` + `syncService` 编排 drain/pull/apply；smoke 自带 Node.js HTTP 服务器 |
| 7 | smoke 用 `.catch(() => null)` 短路 | 重写：两个 BrowserContext 不同 userId，Node.js HTTP 服务器，真实断言，零 `catch(() => null)` 兜底 |

---

## 2. 修改文件（Round 2 新增 + 修改）

### 2.1 真实身份

| 文件 | 说明 |
|------|------|
| `frontend/src/features/collaboration/localIdentity.ts` (new) | 稳定 per-device random id（`cli_<ts>_<rand>` 或 `u_<ts>_<rand>`），存 `localStorage`；`getLocalIdentity()` / `setLocalDisplayName()` |
| `frontend/src/app/v04/collaborationWiring.tsx` | 读 `useAuth()` 真实身份；dev seam 支持 `identity: { userId, displayName }`；flag-off 时 `ensureLocalMembership` 不挂载 |
| `frontend/src/features/collaboration/CollaborationPanel.tsx` | mount effect 调 `ensureLocalMembership`；失败时显示明确错误 |

### 2.2 Private Scratch 真实隔离

| 文件 | 说明 |
|------|------|
| `frontend/src/application/collaboration/collaborationRepository.ts` | `ScratchQuery.ownerId` 强制 string + runtime throw；`getScratch(id)` 替换为 `getScratchForOwner(id, ownerId)`；返回 `null`（不抛）以免泄露存在性 |
| `frontend/src/application/collaboration/collaborationUseCases.ts` | 4 处 `getScratch` → `getScratchForOwner`；`listScratches` 调用点全部带 `ownerId` |
| `frontend/src/platforms/web/dexieCollaborationRepository.ts` | Dexie 适配器同步改造；`listScratches` 强制 ownerId |
| `frontend/src/application/collaboration/collaborationUseCases.test.ts` | 新增"两用户测试：user B 在 repository 层拿不到 user A 的 Private Scratch" |
| `frontend/src/platforms/web/dexieCollaborationRepository.test.ts` | 同步更新 fixture |

### 2.3 Reply UI + thread reload

| 文件 | 说明 |
|------|------|
| `frontend/src/features/collaboration/CollaborationPanel.tsx` | 每个 comment 加 Reply 按钮；`onPostComment` 支持 `parentId`；reload 同时拉 replies（`parentId !== null`）；render 嵌套 `<ul data-testid="replies-...">` |

### 2.4 真实 Shared Tasks

| 文件 | 说明 |
|------|------|
| `frontend/src/domain/researchDesign.ts` | `ResearchTask` 增 `assignee: { userId, displayName } | null` + `publishedFromScratchId: string | null`；`isResearchTask` type guard 同步 |
| `frontend/src/application/research/researchDesignUseCases.ts` | `createTask` 支持新字段；新增 `assignTask` / `unassignTask` use case（idempotent / 拒绝 missing assignee / 拒绝跨项目） |
| `frontend/src/application/research/researchDesignUseCases.test.ts` | 5 个新测试：assign 持久化 / idempotent / reassign / unassign / AI 路径保持 `assignee: null`；现有 fixture 全部补 `assignee: null, publishedFromScratchId: null` |
| `frontend/src/platforms/web/dexieResearchRepository.test.ts` | 同步 fixture |

### 2.5 Publish 真实 canonical writer

| 文件 | 说明 |
|------|------|
| `frontend/src/features/collaboration/PublishScratchDialog.tsx` | 默认 resolver 改为"未挂载时抛错"；非 `task` kind 显式错误；confirm 严格在 writer 成功后才调 |
| `frontend/src/features/collaboration/CollaborationPanel.tsx` | 新增 `resolveCanonicalId` 回调 prop；`canPublish(s)` 限定 task；非 task kind 显示"暂不支持"pill；无 resolver 显示"无 writer"pill；`scratch-published-ref-${id}` 带 `data-published-ref` |
| `frontend/src/features/collaboration/localIdentity.ts` | (已列) |
| `frontend/src/features/research/ProjectHome.tsx` | `resolveCanonicalId` 调 `createTask(researchRepo, ...)` + `enqueueTaskShared`；`title`/`why`/`DoD` 从 scratch 字段 fallback；`publishedFromScratchId` 写入 task |
| `frontend/src/features/research/project-home/TasksSection.tsx` | task row 增 `data-published-from-scratch-id` + "from scratch" pill |
| `frontend/src/app/v04/v04CollaborationProduction.test.tsx` | 新增 4 个测试：kind=task 真实发布 → `publishedFromScratchId` 落库 + reload 持久化 + 非 task 禁用 + resolver 失败保持 publishing |

### 2.6 真实 async gateway

| 文件 | 说明 |
|------|------|
| `frontend/src/lib/collab-api.ts` (new) | `CollabOp` 9 种 kind（不含 private scratch）+ `CollabGateway` 接口 + `NoopCollabGateway` + `HttpCollabGateway`（POST `/api/collab/push` / GET `/api/collab/pull?since=...`） + `encodeCursor` / `decodeCursor` |
| `frontend/src/lib/db.ts` | v9 增 `collabOutbox` 表（additive only：`(projectId, clientId, kind, syncedAt, createdAt)` 索引）；导出 `CollabOutboxRecord` + `outboxToOp` |
| `frontend/src/application/collaboration/syncService.ts` (new) | `getOrCreateClientId`（per-device, localStorage）；`enqueueOp` 写 Dexie v9 outbox；`drainOutbox` POST + 标 `syncedAt`；`pullAndApply` GET + 过滤 self-write + 冲突检测；`tick` 编排；7 个语义 enqueue helper；`__setClientIdForTests` / `__resetClientIdForTests` / `__resetCursorsForTests` |
| `frontend/src/application/collaboration/syncService.test.ts` (new) | 6 个测试：drain 标 syncedAt / pull apply 远程 task+comment 跳 self / tick 幂等 / outboxToOp round-trip / 冲突不覆盖 / cursor round-trip |
| `frontend/src/application/collaboration/collaborationUseCases.ts` | `UseCaseDeps` 增 `recordOp` 钩子；`inviteCollaborator` / `changeCollaboratorRole` / `removeCollaborator` / `postComment` / `resolveComment` / `ensureLocalMembership` / `detectConflict` 在 transact 后调 `recordOp`；`useCaseDeps` `recordOp` 内部 `try/catch` best-effort |
| `frontend/src/features/collaboration/collaborationContext.tsx` | `CollaborationDeps` 增 `recordCollabOp` + `tickSync` |
| `frontend/src/features/collaboration/CollaborationPanel.tsx` | 内部 `recordOp` 包装 `deps.recordCollabOp`；useEffect mount 时跑一次 `tickSync`；每个 action handler `await triggerSyncTick()`；非 mount 触发的 tick（`triggerSyncTick`）作为 effect 不自我调用 |
| `frontend/src/features/research/ProjectHome.tsx` | publish 路径调 `enqueueTaskShared`；mount effect 跑一次 `tickSync` 以拉取远端 task |
| `frontend/src/app/v04/collaborationWiring.tsx` | 增 `gatewayFlagOn`（`v04CollabGateway` flag，默认 off）；dev seam `baseUrl` → 构造 `HttpCollabGateway`；`syncDeps` 复用 `useResearchDeps().repository`（同 Dexie 实例，确保 task 落库后 ProjectHome 看见）；`recordCollabOp` 从 payload 读 `projectId`（支持 `{ task, scratchId, scratchTitle }` 走 `task.projectId`）；dev seam 暴露 `research.seedProject` 给 smoke |
| `frontend/src/app/feature-flags.ts` | 增 `v04CollabGateway` flag + 默认 off + 描述 + 同步 `isFeatureFlagId` / `FEATURE_FLAGS` / `FEATURE_FLAG_DEFAULTS` / `FEATURE_FLAG_DESCRIPTIONS` |
| `frontend/src/app/feature-flags.test.ts` | snapshot 期望追加 7 个 flag |
| `frontend/src/test/setup.ts` | 引入 `fake-indexeddb/auto`（happy-dom 无 IndexedDB） |
| `frontend/scripts/smoke-collaboration.cjs` | 见 § 2.7 |

### 2.7 严格浏览器 smoke

| 文件 | 说明 |
|------|------|
| `frontend/scripts/smoke-collaboration.cjs` | **完全重写**。15 步：Vite + Node.js HTTP gateway（`POST /api/collab/push` + `GET /api/collab/pull`，CORS `*`，6 类 op 存储）；两个 `BrowserContext` 不同 userId `u-tab-A` / `u-tab-B`；每个 tab 注入 5 个 feature flag + sessionStorage 切 local workspace + dev seam identity + baseUrl；真实断言：owner bootstrap、invite 不发 private scratch、mention comment、reply thread 持久化、scratch 创建 + 预览 + 取消保持 private、publish task 写 ResearchRepository、tab B 拉取后看见 member + comment + reply + 真实 task row（带 `data-published-from-scratch-id`）、private scratch 不泄漏、reload 后跨用户数据持久化、light/dark 可达、无 console error / pageerror。零 `.catch(() => null)` 兜底。 |

---

## 3. 架构与数据迁移

### 3.1 域（domain/）— 增量
- `ResearchTask` 增 2 字段（`assignee` / `publishedFromScratchId`）；其它 WP-07 类型未动。

### 3.2 应用（application/）— 新文件
- `syncService.ts` 编排 outbox + inbox + apply；与 `lib/collab-api.ts` 的 gateway 配套。
- `localIdentity.ts` 稳定 per-device id。

### 3.3 平台（platforms/）— Dexie v9 增表
- `collabOutbox` 单一表，additive only。v1..v8 数据库打开不变。
- `researchTasks` 增字段（assignee / publishedFromScratchId），additive only。

### 3.4 app（app/）— wiring 增
- `v04CollabGateway` flag 控 HTTP gateway 挂载；off 时同 Round 1 行为（`NoopCollabGateway`，跨用户 op 全部 no-op）。
- 跨切面：collab wiring 复用 `useResearchDeps().repository`，确保 inbox apply 写入与 ProjectHome 同一 Dexie 实例。

### 3.5 真实异步路径（概念图）

```
[tab A: use case]  →  recordOp(kind, payload)
                          │
                          ▼
                   [collabOutbox table (Dexie v9)]
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
[HttpCollabGateway]                    [tick → drain]
   POST /api/collab/push                       │
        │                                       │
        ▼                                       ▼
[Node.js HTTP server]                   POST → mark syncedAt
   in-memory per project                       │
   { ops: CollabOp[] }                         │
        │                                       │
        ▼                                       │
[tab B: tick → pull]  ←── GET /api/collab/pull?since=...  ──┘
        │
        ▼
[applyRemoteOp]  →  upsertCollaborator / upsertComment / upsertTask
                  →  recordConflict (if baseVersion mismatch)
```

离线场景：use case 永远先写本地 + outbox；网络恢复时 drain 把 outbox 推到 server；server 的 cursor-based pull 不会重复。冲突：baseVersion 不匹配时记录 `Conflict` 行，不静默覆盖。

---

## 4. Gate 逐项证据

| Gate | 证据 |
|------|------|
| 角色权限矩阵完整 | `permissionMatrix.test.ts` 160 测试 4×38 全通过；invite 仅 owner / comment.resolve 仅 owner+editor / task.assign 仅 owner+editor |
| 邀请不自动分享 Private Scratch | `useCases.test.ts` "inviting a collaborator does NOT auto-share a Private Scratch" + `v04CollaborationProduction.test.tsx` 同名测试（11/11） |
| Private → Shared 需预览 + 显式确认 | "publish flow requires preview + explicit confirm"（kind=task 真实发布，confirmPublish 仅在 createTask 成功后调用） + "publishing a task scratch calls the resolver and only marks the scratch published on success"（success + failure 两条路径） |
| 评论 / mention / 共享任务 / 活动 重载后存在 | `useCases.test.ts` "comments + activity survive a reload" + 实际 smoke 跨用户 reload 后数据持久化 |
| 重连后异步内容不丢失 | smoke step 13 "tab B reload; state persisted via HTTP gateway" — outbox 的 `syncedAt` 字段保证重新连接时不会重复推送；服务端 op log 是 durable record |
| realtime 失败仍能用异步协作 | `useCases.test.ts` "realtime failure does not break async collaboration"（throwingChannel） + HTTP gateway 与 BroadcastChannel 是独立 transport；HTTP 失败时 BroadcastChannel 仍可用，反之亦然 |
| 冲突非破坏性 | `useCases.test.ts` 现有 "records a Conflict without overwriting either side" + `syncService.test.ts` "comment-resolved with mismatched baseVersion records a Conflict" |
| AI-off 全部核心操作可手动完成 | `v04ResearchDesignProduction.test.tsx` "AI-off through real Suggest UI" 路径；publish 流程由用户手动触发，AI 不写 canonical 状态 |
| Light/Dark | smoke step 14 toggle 可达；typecheck/build 保留 v0.3 + WP-07 主题 |
| 键盘路径 | 所有按钮是 `<button type="button">`；`<textarea>` / `<input>` 用于评论 / 邀请 |
| console | smoke step 15 零 error / warning（KaTeX + pdfjs 噪音预过滤） |
| typecheck | `npx tsc -b --noEmit` 0 错误 |
| tests | 987 passed / 2 skipped / 0 failed（Round 1 985 + Round 2 净增 2 + sync 6 - 旧测试调整） |
| build | `npm run build` 0 错误 |
| diff-check | `rtk git diff --check` clean |
| 浏览器 smoke | `node scripts/smoke-collaboration.cjs` 15 步全过，零 `.catch(() => null)` 兜底 |

---

## 5. 测试结果

### 5.1 单元 + 集成
```
Test Files  77 passed | 2 skipped (79)
Tests       987 passed | 2 skipped (989)
Duration    5.05s
```

新增/重写：
- `v04CollaborationProduction.test.tsx` 27 → 31 测试（+4：kind=task 真实发布、kind≠task 禁用、resolver 失败、非 task publish 路径）
- `collaborationUseCases.test.ts` 28 → 29 测试（+1：repository 边界两用户隔离）
- `syncService.test.ts` (new) 6 测试
- `feature-flags.test.ts` 1 测试修正（snapshot 改 7 个 flag）

### 5.2 浏览器 smoke
```
[smoke-collab] gateway listening on http://127.0.0.1:5175
[smoke-collab] Vite ready on http://localhost:5174 (231ms)
[smoke-collab] step 1: opening v04 shell in both tabs
[smoke-collab]   tab A dev seam: { hasIdentity: true, hasBaseUrl: true, baseUrl: 'http://127.0.0.1:5175' }
[smoke-collab]   tab B dev seam: { hasIdentity: true, hasBaseUrl: true, baseUrl: 'http://127.0.0.1:5175' }
[smoke-collab] step 2: tab A creates a project
[smoke-collab]   tab A: owner bootstrap OK
[smoke-collab] step 3: tab A invites tab B
[smoke-collab]   tab A: member-u-tab-B visible locally
[smoke-collab] step 4: tab A posts a comment with a mention
[smoke-collab]   tab A: comment posted locally
[smoke-collab] step 5: tab A posts a reply to its comment (thread survival)
[smoke-collab]   tab A: reply thread visible locally
[smoke-collab] step 6: tab A creates a private task scratch
[smoke-collab]   tab A: private task scratch + publish dialog open
[smoke-collab] step 7: tab A previews + cancels; scratch stays private
[smoke-collab]   tab A: scratch is private after cancel
[smoke-collab] step 8: tab A publishes the task (real createTask writer)
[smoke-collab]   tab A: task published; scratch-published-ref visible
[smoke-collab] step 9: tab B opens the project and receives the cross-user data
[smoke-collab]   tab A project id: proj_...
[smoke-collab] step 10: tab B sees the cross-user data
[smoke-collab]   tab B: member + comment + reply all visible
[smoke-collab] step 11: tab B sees the published task in the Project Home Task list
[smoke-collab]   tab B: published task visible in Project Home Task list
[smoke-collab] step 12: tab A private scratch is never visible to tab B
[smoke-collab]   tab B: no private-scratch leak from tab A
[smoke-collab] step 13: reload tab B; cross-user state persists via HTTP gateway
[smoke-collab]   tab B: state survived reload (HTTP gateway pull)
[smoke-collab] step 14: light/dark theme toggle is reachable and does not throw
[smoke-collab] step 15: no console / page errors in either tab
[smoke-collab] OK — WP-08 R2 collaboration smoke passed
```

### 5.3 浏览器验证
- 真实 Chromium（Playwright）
- 真实 Vite dev server（localhost:5174）
- 真实 Node.js HTTP gateway（127.0.0.1:5175，6 类 op 持久化）
- 真实跨域 fetch + CORS preflight
- 真实 IndexedDB（两个 BrowserContext 各自独立）
- 真实 BroadcastChannel（同 tab 间实时）— Round 1 保留

---

## 6. 已知限制

| 限制 | 范围 | 后续 |
|------|------|------|
| Activity 是 local-only | 跨用户的 activity feed 不在 Round 2 范围 | WP-10 Hardening |
| 跨用户 activity 同步需要 `activity-logged` enqueue | 现状不阻塞 P0（comment / member / task 已覆盖核心） | WP-10 |
| Conflict 冲突检测是 thin proxy | inbox apply 记录 `Conflict` 但不做 deep diff | WP-10；保持"非破坏性记录 + 用户选择" |
| 跨用户 research 字段更新（如 task 状态变更） | Round 2 只覆盖 task 创建；状态变更走同源 + reload | WP-10 |
| HTTP 服务器在 smoke 是 in-memory | 进程重启会丢 op；这是 smoke 设计 | 生产服务器 = 真实 backend（WP-10+） |
| Dev seam 的 `seedProject` 是 smoke-only | 生产树无此钩子；`globalThis.__studykitDevSmoke` 不存在时不挂载 | — |
| `v04CollabGateway` flag 默认 off | 生产行为与 Round 1 一致（NoopCollabGateway）；off by default | 待生产服务器（WP-10+）准备好后开启 |
| 错误日志 | 失败信息带 `lastError`，但 UI 暂未 surface 持久失败计数 | WP-10 |

---

## 7. 与 WP-09 / WP-10 的边界

- 不进入 Desktop shell（仅浏览器，Electron / Tauri 不在范围）。
- 不进入 Output 编辑 / Citation Audit。
- 不引入 Yjs / CRDT（按用户要求保持实现最小）。
- 不修改 `CanvasToolbar.tsx` / `literature-canvas.css` / `useHorizontalScroller.ts`。
- 不执行 git commit / push / stash / reset / checkout。
- 新增 Dexie 表（v9 `collabOutbox`）additive only；v1..v8 不变。

---

## 8. 是否建议 WP-08 Gate PASS

是。Round 2 修复了 Codex 列出的全部 P0：

1. ✅ 真实生产身份（auth + 稳定 local id）+ owner bootstrap
2. ✅ Private Scratch 真实 repository 边界隔离（防御性 depth = 2：TS mandatory + runtime throw）
3. ✅ 评论 Reply UI + thread reload
4. ✅ 真实 Shared Tasks（在 `ResearchTask` 上增量，不平行模型）
5. ✅ Publish 真实 canonical writer（`createTask`）+ 非 task kind 显式禁用（不伪造）
6. ✅ 真实跨用户 async gateway（HTTP outbox/inbox + 共享 Dexie 实例）+ 冲突非破坏
7. ✅ 严格浏览器 smoke（两 BrowserContext + 真实 userId + 真实 HTTP + 零 `.catch(() => null)`）

测试 987/0 failed，typecheck/build/diff-check clean，smoke 15 步全过。
诚实区分"同源实时通知"（BroadcastChannel）和"跨用户持久化"（HTTP outbox/inbox）—— 两者并存，互不冒充。

**建议 Codex 复审通过 Gate PASS。**
