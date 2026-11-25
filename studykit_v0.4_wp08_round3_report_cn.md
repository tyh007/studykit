# StudyKit v0.4 — WP-08 Round 3 生产协作收口报告

## 状态：Gate PASS（2026-07-28）

Round 3 将 WP-08 从“前端协作原型 + smoke gateway”收口为可接真实账号和 Postgres 的生产路径。本报告覆盖本轮实际代码与验收结果；Round 1/2 报告仅作为历史记录。

## 1. 本轮解决的问题

| 问题 | 最终实现 |
|---|---|
| 打开项目会自动把当前用户变成 Owner | 仅本地、无网关工作区允许本地 Owner bootstrap；同步项目的 Owner 只能由服务端创建项目时原子产生 |
| 项目与成员没有服务端真相 | 新增 JWT 保护的 `/api/collab` 项目、成员、角色、Activity、Push/Pull API；所有项目级操作复查数据库 membership |
| 重复 Owner / 重复成员 | `(project_id, user_id)` 主键；Owner 不可由邀请或角色变更接口授予、移除 |
| Outbox 可能在 canonical write 后丢失 | Collaboration transaction 同时提交 canonical row 与 outbox staging；Shared Task 的 Activity、`task-assigned` 和 `activity-logged` 同事务 |
| Shared Task 只有外观，没有可靠同步 | Owner/Editor 可分配；受派人必须是项目成员；远端 inbox 更新 assignee；UI 显示 queued/synced/failed |
| Activity 只在本机 | Activity 通过 op log 跨用户同步；canonical Activity 强制归属认证用户，拒绝 AI 冒充 |
| HTTP gateway 只用于 smoke | `HttpCollabGateway` 使用生产 `VITE_API_URL` 与真实 auth token；Research Home 从服务端发现受邀项目 |
| 登录恢复可能触发 Hooks 数量变化 | Collaboration wiring 保持固定 Hook 顺序；未认证/flag-off 使用无副作用占位资源 |
| 数据库启动迁移会破坏协作数据 | 移除启动时 DROP；协作表使用 additive `CREATE ... IF NOT EXISTS`；客户端生成的项目/op/activity ID 统一为 `TEXT` |

## 2. 权限边界

- 创建项目：调用者必须等于 `owner_user_id`；项目与 Owner membership 在同一数据库事务。
- 邀请、改角色、移除：仅 Owner；可授予 `editor/commenter/viewer`，不可授予 Owner。
- Commenter 只能发布评论和 Activity；Viewer 不可写；Editor 可操作任务但不可管理成员。
- 非成员对 memberships、activities、push、pull 全部返回 403。
- `comment-posted.authorId` 必须等于认证用户。
- `task-assigned.assignee.userId` 必须已经是项目成员。
- canonical Activity 只能是 `actor_type=user`；AI 仍须通过 Draft Layer 和用户接受。

## 3. 验收证据

### 自动化

- 前端全量：78 files passed、2 skipped；992 tests passed、2 skipped、0 failed。
- 后端全量：31 tests passed、0 failed。
- TypeScript：`tsc -b --noEmit` 通过。
- Production build：Vite build 通过。
- Diff hygiene：`git diff --check` 通过。

现存 Canvas `act(...)` 与 bundle size 信息属于本轮前已有警告；没有造成测试或构建失败，本轮未改动相关画布实现。

### 严格浏览器 smoke

`frontend/scripts/smoke-collaboration.cjs` 使用真实 Express 路由、JWT、三个真实注册身份和两个隔离 BrowserContext，已验证：

1. A 创建项目并唯一成为 Owner；
2. A 邀请 B 为 Commenter；
3. A/B 均在真实 Research Home 发现同一项目；
4. UI 成员严格为 A=Owner、B=Commenter，无重复 Owner；
5. B 看不到邀请入口；
6. 未邀请的 C 对全部项目级端点均为 403；
7. B 能读取 A 的跨用户 Activity 和 op；
8. Push 重试幂等，client ID 伪造被拒绝；
9. Light/Dark 的 DOM theme 状态真实变化；
10. 两个浏览器上下文均为 0 console error、0 page error。

## 4. Feature flag 与发布

- `v04Collaboration` 和 `v04CollabGateway` 仍默认关闭，避免在未配置生产数据库/API 时影响既有用户。
- 开启同步协作前必须部署本轮 backend schema 和 routes，并配置 `VITE_API_URL`、JWT 与 Postgres。
- 本地工作区仍无需账号、无需网络；Private Scratch 不进入跨用户 op log。

## 5. 后续边界

WP-08 的“可靠异步协作”已完成。多人同时编辑同一富文本/画布的 CRDT、在线 presence 产品化、邮件邀请与通知不属于本 Gate，应作为后续独立工作包，不能以隐藏自动合并替代当前冲突保留机制。
