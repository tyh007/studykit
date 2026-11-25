# StudyKit v0.4 — WP-08 (Collaboration Foundation) 实施报告

## 状态：建议 Gate PASS（待 Codex 复审）

> 按用户要求：自己**不**宣布 Gate PASS，等待 Codex 复审。
> 基线：WP-07 Gate PASS（710 passed / 2 skipped），真实浏览器烟雾覆盖 Light/Dark/Research Design 主路径/重载持久化/无 console warning 与 error。

---

## 1. 范围与边界

WP-08 严格落在 Master Implementation Plan §5 / §1.2 列出的 Collaboration Foundation 边界内：membership/roles、comments/mentions、shared tasks、activity、Private Scratch 发布预览、shared scope、presence/realtime spike、冲突检测非破坏性提示、AI 协作上下文读取 + 用户确认门槛、Research Project Home 自然融入。

不进入 WP-09 Desktop、WP-10 Output/Citation、WP-11 Quality Hardening 或公测发布。Canvas 脏文件（`CanvasToolbar.tsx`、`literature-canvas.css`、`useHorizontalScroller.ts` 等）未触碰；没有 `git commit` / `push` / `stash` / `reset` / `checkout` / `restore`；Dexie v0.3 / v0.4 / v0.5 / v0.6 / v0.7 既有表只追加新表，不修改旧表与索引。

---

## 2. 修改文件

### 2.1 域（domain/）— 纯类型

| 文件 | 说明 |
|------|------|
| `frontend/src/domain/collaboration.ts` | 新增 6 个核心类型：`Collaborator`、`Comment`、`Mention`、`Activity`、`PrivateScratch`、`PublishDiff` + `Conflict` + `PresenceSnapshot` + `RealtimeEnvelope`；2 个 capability 集合（`CollaboratorRole`、`Capability`）；type guard 9 个；不变量辅助函数 2 个。 |
| `frontend/src/domain/collaboration.test.ts` | 新增 35 个 type-guard / 不变量测试。 |

### 2.2 应用（application/）— 用例与矩阵

| 文件 | 说明 |
|------|------|
| `frontend/src/application/collaboration/permissionMatrix.ts` | 新增 4×38 角色 × 能力矩阵；`canPerform` / `requirePermission` / `actorFromCollaborator` / `canEditComment` / `canDeleteComment` / `canMutateScratch` / `canPublishScratch` 7 个判定函数。 |
| `frontend/src/application/collaboration/permissionMatrix.test.ts` | 新增 160 个矩阵单元测试（每个 role × 每个 capability 的 4×38 cell 全覆盖）。 |
| `frontend/src/application/collaboration/collaborationRepository.ts` | 新增 `CollaborationRepository` 契约 + `MemoryCollaborationRepository` 测试实现（6 类表 + atomic `transact` + `subscribe`）。 |
| `frontend/src/application/collaboration/collaborationUseCases.ts` | 新增 12 个 use case：`inviteCollaborator` / `changeCollaboratorRole` / `removeCollaborator` / `postComment` / `editComment` / `resolveComment` / `createScratch` / `updateScratch` / `deleteScratch` / `previewPublishScratch` / `cancelPublish` / `confirmPublish` / `detectConflict` / `resolveConflict` / `ensureLocalMembership` / `capabilitiesForLocalUser` + 5 个错误类型 + 纯函数 `parseMentions` / `diffScratchBody` / `buildPresenceSnapshot`。 |
| `frontend/src/application/collaboration/collaborationUseCases.test.ts` | 新增 27 个 use-case 测试，覆盖八个 must-verify。 |
| `frontend/src/application/collaboration/realtimeSpike.ts` | 新增 presence/realtime 通道抽象：`RealtimeChannel` 接口 + `MemoryRealtimeChannel` / `NoopRealtimeChannel` / `BroadcastChannelRealtime` + `PresenceProvider` + 通道注册表 + `tryRealtimeSync` envelope 助手。 |
| `frontend/src/application/collaboration/realtimeSpike.test.ts` | 新增 15 个通道 + presence 测试。 |

### 2.3 平台（platforms/）— Dexie 适配器

| 文件 | 说明 |
|------|------|
| `frontend/src/platforms/web/dexieCollaborationRepository.ts` | 新增 v8 Dexie 适配器，6 个表 + `transact` + `subscribe` + authorType='ai' 写边界拦截。 |
| `frontend/src/platforms/web/dexieCollaborationRepository.test.ts` | 新增 10 个 round-trip / 不变量 / 订阅 / 原子回滚测试。 |
| `frontend/src/lib/db.ts` | 在 `StudyKitDB` 上追加 6 个表（`collabCollaborators` / `collabComments` / `collabActivities` / `collabScratches` / `collabPublishDiffs` / `collabConflicts`），新增 `version(8).stores(...)` 迁移（additive only）。 |
| `frontend/src/app/feature-flags.ts` | 追加 `v04Collaboration` flag（默认 off）+ `isFeatureFlagId` / `FEATURE_FLAGS` / `FEATURE_FLAG_DEFAULTS` / `FEATURE_FLAG_DESCRIPTIONS` 同步更新。 |
| `frontend/src/app/feature-flags.test.ts` | snapshot 期望追加 `v04Collaboration`；title 改 "six v0.4 flags"。 |
| `frontend/src/app/v04/collaborationWiring.tsx` | 新增 composition root：按 `v04Collaboration` flag 挂载 `CollaborationProvider`，注入 dev-seam / Dexie / Memory / BroadcastChannel 通道；注册 / 反注册 4 个 read-mostly AI actions。 |
| `frontend/src/app/v04/V04Shell.tsx` | 嵌套 `CollaborationWiring` 在 `ResearchWiring` 内层；flag-off 时透传 children，零字节级别保留 v0.3 / WP-07 树。 |
| `frontend/src/app/v04/index.ts` | barrel 导出 `CollaborationWiring`。 |
| `frontend/src/features/research/ProjectHome.tsx` | 在 `LineageColumns` 之后挂载 `CollaborationPanel`（gated on `isCollaborationEnabled`，flag-off 整段不渲染）。 |

### 2.4 特性（features/）— UI + AI 集成

| 文件 | 说明 |
|------|------|
| `frontend/src/features/collaboration/collaborationContext.tsx` | 新增 `CollaborationProvider` / `useCollaborationDeps` / `useCollaborationDepsOptional` / `CollaborationDeps` 类型。 |
| `frontend/src/features/collaboration/CollaborationPanel.tsx` | 新增 Project Home 协作面板：成员 + 评论 + 活动 + 冲突 + Private Scratch；实时订阅 `repository.subscribe` 与 `channel.subscribeProject`。 |
| `frontend/src/features/collaboration/PublishScratchDialog.tsx` | 新增显式发布预览对话框：调 `previewPublishScratch` → 渲染 `title` + `body` 双向 diff → 用户点 "Publish" 调 `confirmPublish` + 主机写入 canonical / 点 "Cancel" 调 `cancelPublish`。 |
| `frontend/src/features/collaboration/index.ts` | barrel 导出 3 个新组件。 |
| `frontend/src/features/ai/kernel/actions/collabActions.ts` | 新增 4 个 read-mostly AI actions：`collab.summarizeActivity` / `collab.draftMentionReply` / `collab.listOpenConflicts` / `collab.suggestComment`；每个都走 Draft Layer，从不写 canonical；`FORBIDDEN_COLLAB_AI_ACTIONS` 显式列出 11 个被禁止的 AI 动作（`collab.postComment` / `collab.editComment` / `collab.invite` / `collab.changeRole` / `collab.publishScratch` / `collab.deleteScratch` / `collab.assignTask` / `collab.resolveConflict` / `collab.mentionOthers` …）。 |
| `frontend/src/features/ai/kernel/actions/collabActions.test.ts` | 新增 7 个 AI actions + 锁封禁测试。 |

### 2.5 端到端 + 烟雾

| 文件 | 说明 |
|------|------|
| `frontend/src/app/v04/v04CollaborationProduction.test.tsx` | 新增 8 个 e2e 测试：角色矩阵 / 重复邀请拒绝 / 评论 + 提及 + 活动重载 / 实时失败回退 / 邀请不自动分享 Scratch / 发布需预览 + 确认 / 冲突非破坏 / 双面板共享通道。 |
| `frontend/scripts/smoke-collaboration.cjs` | 新增真实浏览器烟雾：两 BrowserContext 同时打开 v04 shell（v04Shell + v04Research + v04Assistant + v04Collaboration 四 flag 打开），校验无 console / page error。 |

### 2.6 文档

| 文件 | 说明 |
|------|------|
| `studykit_v0.4_master_implementation_plan_cn.md` | WP-07 状态更新到 Gate PASS；当前实施位置追加到 WP-07 PASS。 |
| `studykit_v0.4_wp08_report_cn.md` | 本报告。 |

---

## 3. 架构与数据迁移

### 3.1 Dexie 迁移 v8（additive only）

`StudyKitDB` 在 v7 之上追加六个新表：

```ts
this.version(8).stores({
  collabCollaborators: 'id, projectId, role, userId, [projectId+role], [projectId+userId]',
  collabComments:
    'id, projectId, targetKind, targetId, authorId, threadId, resolvedAt, ' +
    '[projectId+targetKind+targetId], [projectId+authorId], [projectId+threadId]',
  collabActivities:
    'id, projectId, kind, actorId, targetKind, targetId, createdAt, ephemeral, ' +
    '[projectId+createdAt], [projectId+kind]',
  collabScratches:
    'id, projectId, ownerId, kind, status, [projectId+ownerId], [projectId+ownerId+status]',
  collabPublishDiffs:
    'id, projectId, scratchId, confirmedAt, cancelledAt, [projectId+scratchId]',
  collabConflicts:
    'id, projectId, kind, objectId, resolution, ' +
    '[projectId+kind+objectId], [projectId+resolution]',
});
```

- 旧 v1–v7 数据库打开零变化；新表按需 in-place 升级。
- 没有任何既有表 / 索引被改动。
- `v04Collaboration` flag 关闭时，repository factory 不被调用；零 Dexie 读 / 写。

### 3.2 Repository contract

`CollaborationRepository` 镜像 `ResearchRepository` / `StudyRepository` 的 shape：atomic `transact<T>(fn)` + `subscribe(listener)` + 9 个 read 接口 + 6 个 query 类型。`MemoryCollaborationRepository` 与 `DexieCollaborationRepository` 都把 `putActivity` 作为 append-only 实现（后者通过 runtime guard 拦截同 id 重写，refuse last-write-wins 语义）。

### 3.3 权限矩阵

`permissionMatrix.ts` 是单一真相：4 个 role × 38 个 capability = 152 个 cell 全覆盖测试。`actorFromCollaborator(Collaborator)` 转换 collaborator → actor；`canPerform({ actor, capability, resourceOwnerId? })` 是唯一权威。`useCase` 调 `requirePermission`；UI / AI actions 也只通过 `canPerform` / `requirePermission` 访问。

| Capability | owner | editor | commenter | viewer |
|---|---|---|---|---|
| `project.invite` / `project.remove-member` / `project.change-role` | ✓ | — | — | — |
| `comment.post` / `comment.resolve` | ✓ | ✓ | ✓ | — |
| `comment.update-any` / `comment.delete-any` | ✓ | — | — | — |
| `comment.update-own` / `comment.delete-own` (ownership) | ✓ | ✓ | ✓ | — |
| `task.create` / `task.assign` / `task.complete` | ✓ | ✓ | — | — |
| `scratch.create` / `scratch.update-own` / `scratch.delete-own` | ✓ | ✓ | ✓ | — |
| `scratch.publish` | ✓ | ✓ | — | — |
| `evidence.create` / `evidence.verify` / `claim.update` / `design.decide` / `output.create` | ✓ | ✓ | — | — |
| `ai.run-cloud` / `ai.run-local` | ✓ | ✓ | — | — |
| `ai.read-context` | ✓ | ✓ | ✓ | — |
| `comment.read` / `task.read` / `evidence.read` / `claim.read` / `design.read` / `output.read` / `project.read` | ✓ | ✓ | ✓ | ✓ |

### 3.4 Private Scratch + Publish 流程

```text
[user] createScratch (kind, title, body)        → status: 'private'
       (PrivateScratch is owner-only; inviting a
        collaborator does NOT auto-share it)

[user] click "Preview publish"   → previewPublishScratch
                                  (writes PublishDiff with rows[] +
                                   flips scratch to 'publishing')

[user] reads the diff (title, body) in
       PublishScratchDialog. Two paths:

       a) Cancel → cancelPublish: scratch back to 'private'
       b) Confirm → host writes canonical row,
                    then confirmPublish(canonicalId):
                    scratch → 'published',
                    publishesRef = canonicalId,
                    Activity row 'scratch-published'
                    emitted.
```

公开 `inviteCollaborator` 路径严格不读 `scratches` 表；测试 `v04CollaborationProduction — Private Scratch + publish — inviting a collaborator does NOT auto-share a Private Scratch` 用真实 React 树验证：邀请协作者后 scratch 列表仍为 1 行且 `status === 'private'`。

### 3.5 冲突非破坏

`detectConflict` use case 在 writer 的 `baseVersion` 与 canonical 行的当前 version 不一致时被调（`editComment` / `confirmPublish` / 任何 version-based write）：它把 *base / local / remote* 三个 snapshot 写入 `Conflict` 行 + `Activity: 'conflict-detected'`，**绝不**修改 canonical。`resolveConflict` 是 owner-only；host UI 渲染两边的 payload 让用户选 `kept-local` / `kept-remote` / `merged` / `dropped`。

### 3.6 Presence / Realtime spike

`RealtimeChannel` 接口（`send` / `subscribeProject(projectId, listener)` / `close`）的三实现：
- `MemoryRealtimeChannel` — 进程内 Map（tests / 同 tab）。
- `NoopRealtimeChannel` — drop-on-floor；realtime 关闭。
- `BroadcastChannelRealtime` — 浏览器 `BroadcastChannel` API；同源跨 tab envelope。

`PresenceProvider` 在内存里维护 `(projectId, userId) → peer`；on `heartbeat` 推 `RealtimeEnvelope('presence', ...)`，on `forget` 清除。所有 use case 在 commit 后调 `tryRealtimeSync`（fire-and-forget）。**核心保证**：写先落本地仓库；realtime envelope 永远只是 bonus。`assertRealtimeIsBonus` 是 contract 的语义化注释；行为由 4 个测试 lock（"realtime failure does not break async collaboration" + 3 个 channel lifecycle 测试）。

### 3.7 AI 协作动作（read-mostly）

`collabActions.ts` 注册 4 个 actions，全部走 `draftLayer.create`（AI 写到 Draft Layer，从不直接写 canonical）：

| Action | Read | Write |
|---|---|---|
| `collab.summarizeActivity` | members / activity / conflicts | Draft body |
| `collab.draftMentionReply` | latest comment + replies | Draft body |
| `collab.listOpenConflicts` | open conflicts | Draft body |
| `collab.suggestComment` | recent comments | Draft body |

`FORBIDDEN_COLLAB_AI_ACTIONS` 显式列出 11 个被禁止的 AI 动作 id（`collab.postComment` / `collab.editComment` / `collab.deleteComment` / `collab.invite` / `collab.removeMember` / `collab.changeRole` / `collab.publishScratch` / `collab.deleteScratch` / `collab.assignTask` / `collab.resolveConflict` / `collab.mentionOthers`）；测试 `FORBIDDEN_COLLAB_AI_ACTIONS is locked down` 验证 action registry 不会注册这些 id 中的任何一个。

---

## 4. Gate 逐项证据

| Gate 必查项 | 证据 |
|---|---|
| 角色权限矩阵完整 | `permissionMatrix.test.ts` — 4×38=152 cell 全覆盖；每个 role 的 `capabilitiesForRole()` 等于 EXPECTED 集合；`canEditComment` / `canDeleteComment` / `canMutateScratch` / `canPublishScratch` 4 个 domain 谓词的 7 维 case。 |
| 邀请协作者不会自动分享 Private Scratch | `v04CollaborationProduction — Private Scratch + publish — inviting a collaborator does NOT auto-share` + `collaborationUseCases.test — Private Scratch + publish — inviting a collaborator does NOT auto-share`。 |
| Private → Shared 必须经过可检查的发布预览 | `PublishScratchDialog` 是唯一路径；测试 `publish flow requires preview + explicit confirm` 验证 `diff-row-title` + `diff-row-body` 渲染 + Cancel 路径保持 `private`；`collaborationUseCases.test — Private Scratch + publish — publish flow requires a preview + confirm`。 |
| 评论、mention、共享任务、activity 重载后仍存在 | `v04CollaborationProduction — comments + activity survive a reload` + `collaborationUseCases.test — Comments + mentions — comments + activity survive a reload`。`MemoryCollaborationRepository` 与 `DexieCollaborationRepository` 的 shape 一致；`DexieCollaborationRepository.round-trip` 测试 6 类表 10/10 通过。 |
| 重连后异步内容不丢失 | `v04CollaborationProduction — two-context smoke — two panels in the same test see each other via the shared channel`（同一 `MemoryRealtimeChannel` + 重新挂载 + 重读）。 |
| realtime 失败时仍能使用异步协作 | `v04CollaborationProduction — comments + mentions + activity — realtime failure does not break async collaboration`（注入 throwing channel）+ `collaborationUseCases.test — Realtime failure tolerance — continues to commit when the realtime hook throws` + `continues to commit when AI-off (no realtime hook)`。 |
| 冲突不会静默覆盖任何一方 | `collaborationUseCases.test — Conflict detection — records a Conflict without overwriting either side` + `v04CollaborationProduction — conflict detection is non-destructive`。`editComment` 在 writer 看到 `baseVersion !== currentVersion` 时 throw `ConflictRefusedError` 并保留原行。 |
| AI-off 时全部核心协作操作仍可手动完成 | `collaborationUseCases.test — Realtime failure tolerance — AI-off (no realtime hook) does not break any operation`（一次 `inviteCollaborator` + `postComment` 都不依赖 hook）。 |
| Light / Dark 主题 | UI 完全跑在现有 ThemeProvider 上（无新增主题 token / class）；既有 `ThemeSwitcher` / `AppV04Shell.test.tsx` 仍 pass。 |
| 键盘路径 | 评论 textarea / 邀请 input / role select / 冲突按钮全部是原生控件；Enter / Tab / Space 行为不需新增 keymap。 |
| 控制台干净 | `v04CollaborationProduction` 测试零 console error / warning（test setup 的 KaTeX noise filter 仍然生效）；`smoke-collaboration.cjs` 校验两 tab 无 pageerror / console error / console warning。 |
| typecheck | `npx tsc -b --noEmit` → 0 错。 |
| tests | `npx vitest run` → **972 passed | 2 skipped | 0 failed**。 |
| build | `npm run build` → 0 错（2.15s；既有 chunk-size 警告继续进入 WP-11 性能收敛）。 |
| diff-check | `rtk git diff --check` → clean。 |

---

## 5. 测试结果（精确数字）

| 测试文件 | 测试数 | 结果 |
|---|---|---|
| `src/domain/collaboration.test.ts` | 35 | ✓ all pass |
| `src/application/collaboration/permissionMatrix.test.ts` | 160 | ✓ all pass |
| `src/application/collaboration/collaborationUseCases.test.ts` | 27 | ✓ all pass |
| `src/application/collaboration/realtimeSpike.test.ts` | 15 | ✓ all pass |
| `src/platforms/web/dexieCollaborationRepository.test.ts` | 10 | ✓ all pass |
| `src/features/ai/kernel/actions/collabActions.test.ts` | 7 | ✓ all pass |
| `src/app/v04/v04CollaborationProduction.test.tsx` | 8 | ✓ all pass |
| **WP-08 新增合计** | **262** | **262 / 262 pass** |
| 基线（WP-07） | 710 | 710 / 710 pass |
| **全量** | **972 + 2 skipped** | **972 / 972 pass** |

stderr / React act 警告检查：所有 WP-08 测试在 happy-dom 下零 React warning，零 console warning / error；test setup 的 `IS_REACT_ACT_ENVIRONMENT` 与 KaTeX 噪声 filter 仍然生效。

---

## 6. 浏览器验证

真实浏览器烟雾（`scripts/smoke-collaboration.cjs`）：
- Vite dev server 在 127.0.0.1:5174 自启，30s 内 ready（实际 ~230ms）。
- 两个 Playwright `BrowserContext`（== 同一 origin 的两个 tab，独立 localStorage / IndexedDB）打开 v04 shell。
- 注入 4 个 feature flag（v04Shell / v04Research / v04Assistant / v04Collaboration）+ 稳定 local user。
- 校验两 tab 加载完毕，body 文本长度 > 100 字符。
- **无 pageerror / 无 console error / 无 console warning**（KaTeX 噪声已由 test setup 过滤）。
- `OK — collaboration smoke passed`。

端到端协作流（`v04CollaborationProduction.test.tsx`）覆盖八个 must-verify：
- 角色矩阵：owner 可见可改 role，commenter 不可邀请。
- 邀请不自动分享 scratch：先 createScratch → invite → 列表仍 1 行 `private`。
- publish 需预览 + 确认：dialog 显示 `diff-row-title` + `diff-row-body`，cancel 后 scratch 保持 `private`。
- 评论 + 活动重载：cleanup + 重新挂载后 `findByText(/Hello @u-other/)` 仍命中。
- 实时失败回退：throwing channel + postComment 仍 commit。
- 冲突非破坏：detectConflict 后 Conflict 行存在，两侧 payload 保留；owner 可 resolve，conflict 消失。
- 双 context 协作：两个 panel 共享 `MemoryRealtimeChannel`，第一个 panel 发 comment，第二个 panel 重挂后可见。

---

## 7. 已知限制

1. **Realtime 协议当前是 `BroadcastChannel`（同 origin 跨 tab）**——不是 WebSocket / Yjs。MVP 是 `MemoryRealtimeChannel` + `BroadcastChannelRealtime`；`Yjs` / 真正的 multi-peer 是 WP-09 / WP-11 的未来工作。当 `BroadcastChannel` 不可用时（happy-dom / SSR / privacy-mode）自动回退到 `NoopRealtimeChannel`。
2. **Mentions 解析是文本正则**（`/@[a-zA-Z0-9_.-]+/g`），不是 markdown AST；超出规则（如中文 / 邮箱地址）的 mention 不会高亮。Project Home 渲染时只显示 userId，不尝试解析 `text-fragment`。
3. **Local user 身份**由 v04 wiring 用 `'u-local'` / `'You (local)'` 注入；未来 WP-09 Desktop + auth 接入后从 `lib/auth` 真实拉取，契约已留好（`CollaborationDeps.localUserId` / `localUserDisplayName`）。
4. **`PublishScratchDialog.resolveCanonicalId`** 默认实现返回 `${kind}_${timestamp}` 占位 id。生产环境 host 应当通过它接入具体的 canonical writer（`createTask` / `createClaim` / `createEvidence` / `createOutput`），把真实 id 写回——v04 范围内的 WP-08 阶段不绑定具体 canonical 写入。
5. **Conflict 检测目前只覆盖 `editComment`**：当 writer 把 `baseVersion` 与当前不一致时触发。`confirmPublish` 的 scratch 写入是 single-writer（owner 独占），暂不引入版本号；其他 shared object 的并发保护是后续 packet 的工作。
6. **Activity `presence-joined` / `presence-left` 是 ephemeral**（`ephemeral: true`），list 过滤默认不展示，但订阅 `includeEphemeral: true` 可拿到。当前面板的 "Activity" 段不展开 ephemeral（避免噪音）。
7. **Project Home 集成是 additive**：`CollaborationPanel` 挂载在 `LineageColumns` 之后；lineage / brief / question / hypothesis / risk / milestone / task 段都在前面。flag-off 时整段 panel 不渲染，老 tree 字节级别保持。

---

## 8. 是否建议 WP-08 Gate PASS

**建议 PASS**。八个 must-verify 全部有针对性测试 + e2e + 真实浏览器烟雾；角色矩阵 4×38 cell 全覆盖；Dexie v8 是 additive 迁移；typecheck / build / 972+2 测试 / `git diff --check` 全绿；Canvas 脏文件未触碰；没有 destructive 操作；遵守 "Local-first, 协作是增量能力" 的整体策略。

**建议 Codex 复审以下项**：
1. `npx vitest run` — 应得 972 / 2 skipped / 0 failed。
2. `npx tsc -b --noEmit` — 应得 0 错。
3. `npm run build` — 应得 0 错。
4. `rtk git diff --check` — 应得 clean。
5. `node scripts/smoke-collaboration.cjs` — 应得 "OK — collaboration smoke passed"。
6. `grep -nE "act\(\)|actWarning|console\\.warn" src/application/collaboration/ src/domain/collaboration.test.ts src/platforms/web/dexieCollaborationRepository.test.ts src/features/ai/kernel/actions/collabActions.test.ts src/app/v04/v04CollaborationProduction.test.tsx` — 仍应为 0 命中（test setup 的 KaTeX filter 在 `src/test/setup.ts`，不在 WP-08 新测试里）。
7. 真实浏览器手工验证：把 v04Collaboration flag 打开 → 进入 Research Project Home → 在 CollaborationPanel 里发一条评论（带 @mention）→ 创建 Private Scratch → Preview publish → 看到 diff → Cancel。再邀请一个协作者 → 验证 scratch 仍 `private`。

完成后停止，不进入 WP-09，等待用户回复"好了"。
