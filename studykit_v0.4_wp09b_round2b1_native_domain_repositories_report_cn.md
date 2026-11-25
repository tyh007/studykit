# StudyKit v0.4 — WP-09B Round 2B1 Native Domain Repositories 报告

- **Packet**：WP-09B Round 2B1（Native Domain Repositories）
- **状态**：CODEX GATE PASS
- **复核日期**：2026-07-30

## 1. 完成内容

- SQLite schema 从 v1 增量升级到 v2，新增 `domain_records(namespace, entity_type, id, payload, updated_at)`，复合主键避免 Study、Research、Canvas 同名对象碰撞。
- v1→v2 migration 使用既有 SAVEPOINT 驱动，幂等执行，不修改或清空 `knowledge_objects`。
- 新增 `read_domain_records_v1` 与 `transact_domain_records_v1`。一次 Repository transaction 对应一次 IPC 和一次 SQLite transaction。
- Rust 写入边界限制 namespace/entity type 白名单，拒绝空/NUL/超长 ID、非法 JSON、非 object payload、payload/envelope ID 不一致、非法 RFC 3339 和超过 2 MiB 的单条 payload。
- 新增 Desktop Study、Research、Canvas Repository。读取时从同一个 Workspace hydrate，写入时先在领域事务内完成校验与 staging，再原子提交原生 store。
- Desktop composition root 向三个 v0.4 Wiring 注入原生 Repository；Web composition 继续使用原有 Dexie adapter。
- 修复 `MemoryCanvasRepository` lineage 在事务回调抛错时提前修改内存的问题；lineage 现在与其他 Canvas 对象一起 staged/commit。

## 2. 关键设计

领域对象使用 lossless JSON payload，而不是压扁进 `knowledge_objects`。原因是 Study、Research 与 Canvas 已有不同的强类型结构、查询与不变量；强行映射到通用对象会丢失 locator、research design、task、relation 和 viewport 等字段。

SQLite 负责原子性、durability 和 envelope 边界；TypeScript Repository 继续负责领域语义、查询和既有 invariant。三套 adapter 共享一个 `DesktopDomainRecordStore` 和一个 `WorkspaceClient`，没有第二条全局 bridge。

## 3. 核心文件

- `frontend/src-tauri/src/workspace/db.rs`
- `frontend/src-tauri/src/workspace/ipc_types.rs`
- `frontend/src-tauri/src/ipc.rs`
- `frontend/src/platforms/desktop/domainRecordStore.ts`
- `frontend/src/platforms/desktop/sqliteStudyRepository.ts`
- `frontend/src/platforms/desktop/sqliteResearchRepository.ts`
- `frontend/src/platforms/desktop/sqliteCanvasRepository.ts`
- `frontend/src/app/v04/desktopWorkspaceContext.tsx`
- `frontend/src/app/v04/studyWiring.tsx`
- `frontend/src/app/v04/researchWiring.tsx`
- `frontend/src/app/v04/canvasWiringContext.tsx`

## 4. 验证结果

- 原生 Repository / IPC / composition 定向测试通过。
- 前端全量：Test Files **86 passed / 2 skipped**；Tests **1053 passed / 2 skipped**。
- Rust library：**62 passed**。
- TypeScript typecheck：通过。
- Production build：通过（904 modules）。
- Unsigned desktop build：通过，生成 `frontend/src-tauri/target/release/studykit-desktop`。
- `cargo fmt --check` 与 `git diff --check`：通过。

测试覆盖 Study 重启 round-trip、原生写失败不污染内存、Research project round-trip、Canvas view/lineage 持久化与 pop 删除、Workspace composition 共享同一个 client、SQLite v1 数据保留升级以及非法 envelope/JSON/时间/ID 拒绝。

现有 React `act(...)` 与 Vite 大 chunk/dynamic-import 提示仍存在，属于此前已记录的测试和性能债务，本轮没有新增失败。

## 5. 明确未做

本包没有自动读取、删除或迁移旧 Dexie 数据，也没有迁移 v0.3 modules、lectures、PDF assets、literature library、collaboration outbox。自动迁移会在用户确认和可回滚机制完成前制造数据风险。

下一包 **Round 2B2** 必须先完成：

1. 只读盘点与迁移预览；
2. 原始 Dexie snapshot 写入 Workspace `backups/`；
3. migration journal、源/目标 count 与 canonical hash；
4. 原子导入、重启后校验和失败回滚；
5. 用户确认后再停用对应 Dexie 事实来源；
6. assets 独立复制与引用重写，不把二进制塞进 JSON IPC。

本轮未执行 commit、push、stage、stash、reset 或 checkout，也未触碰无关业务改动。
