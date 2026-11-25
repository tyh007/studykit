# StudyKit v0.4 系统设计：Web + 本地桌面版

> 版本：0.4.0-draft  
> 日期：2026-07-19  
> 目标：在复用现有 React + Vite 产品的前提下，支持 Web 与可下载桌面版，并让本地存储、本地 AI、可选同步成为一等能力。

---

## 1. 架构结论

v0.4 推荐采用：

- **Shared UI / Domain**：React + TypeScript，共享 Study、Research、Reader、Canvas、AI 与导出逻辑；
- **Web shell**：Vite Web App，使用 Dexie / IndexedDB；
- **Desktop shell**：Tauri v2，使用 SQLite + workspace assets；
- **Repository contract**：业务层不直接依赖 Dexie、SQLite 或 API；
- **Optional cloud**：现有 Node/Postgres 服务作为账号、同步、connector 和团队扩展，不是本地核心功能的前置；
- **AI provider layer**：No AI、Ollama、本地兼容 provider、云 provider 可替换；
- **One canonical schema**：Web、Desktop、Cloud 共享对象 ID、schema version 和迁移语义。

这不是把当前 Web 页面简单包进桌面壳，而是先把数据访问和平台能力从组件中剥离，再复用产品层。

## 2. 目标架构

```text
React UI
├── App Shell / Router
├── Study Mode
├── Research Mode
├── Shared Reader / Canvas / Review / Output
└── AI Interaction Surfaces / Universal Intent Capsule
            │
Application Services
├── Learning Loop Service
├── Evidence / Claim Service
├── Search / Index Service
├── AI Interaction Kernel
│   ├── Context Resolver / Permission Gate
│   ├── Action Registry / Preview / Undo
│   ├── AI Orchestration / Provider Router
│   └── Background Job Runtime / Provenance
├── Import / Export Service
└── Sync Service (optional)
            │
Domain + Repository Contracts
├── Objects / Relations / Provenance
├── Repository / FileStore / SecretStore
├── AIProvider / EmbeddingProvider
└── OperationLog / Migration
       │                 │
Web Adapters       Desktop Adapters
Dexie/IndexedDB    Tauri commands + SQLite
Browser File API   Workspace filesystem
Web auth/sync      OS keychain / updater
       └──────────────┬──────────────┘
                 Optional Cloud
              Node API + Postgres
```

## 3. 代码边界建议

不要求一次移动全部现有代码，先建立新边界并让新功能只进入新边界。

```text
frontend/src/
├── app/                 # app shell, router, mode state
├── domain/              # pure types, rules, migrations
├── application/         # use cases and services
├── repositories/        # interfaces only
├── platforms/
│   ├── web/             # Dexie, browser files, web auth
│   └── desktop/         # Tauri IPC client adapters
├── features/
│   ├── study/
│   ├── research/
│   ├── reader/
│   ├── canvas/
│   ├── review/
│   └── ai/
└── shared/              # design system, commands, utilities

src-tauri/
├── src/commands/        # narrow IPC commands
├── migrations/          # SQLite migrations
├── capabilities/        # least-privilege permissions
└── tauri.conf.json
```

现有 `frontend/src/components/literature/canvas/` 先作为 Research Canvas legacy feature 保留，通过 adapter 读取新的 View 与 Object；不要在重构第一阶段重写所有节点。

### 3.1 AI Interaction Kernel

系统级 AI Assistant 需要独立于任何页面的应用层内核，而不是让 `AIChatPanel` 在各 feature 中复制状态：

- `ContextResolver`：从 route、focus、selection、pinned context、project role 和 visibility 构造最小 Context Packet；
- `ActionRegistry`：将 `findLiterature`、`createEvidenceDraft`、`connectClaims`、`planTasks`、`auditCitations` 等注册为带输入、权限、预览和 undo contract 的产品动作；
- `PermissionGate`：检查本地/云 provider、Private/Shared、跨项目与文件访问边界；
- `AssistantSessionStore`：保存短期意图、显式固定上下文和 invocation surface，不保存未经选择的跨应用内容；
- `JobRuntime`：执行可暂停、取消和恢复的 search、OCR、extraction、synthesis 等后台任务；
- `ProvenanceRecorder`：记录 context snapshot、action、provider、生成者、目标对象和接受/拒绝历史。

Desktop shell 只提供受限 OS bridge：global shortcut、Quick Capture、clipboard read-on-action、file open/share target 和菜单栏入口。所有 OS 输入先进入 inbox/draft，由用户选择 workspace 和 visibility；不得后台持续监听剪贴板或其他应用内容。

## 4. 统一领域模型

### 4.1 Identity

- 所有业务对象使用稳定的 UUID/ULID；
- ID 不携带平台、用户或路径信息；
- 同一对象在 List、Canvas、Reader、Review 和 Output 中不复制；
- Canvas 保存的是 view state 与 object placements，不保存另一份正文。

### 4.2 核心表/集合

| 实体 | 关键字段 |
|---|---|
| workspaces | id, name, schemaVersion, createdAt, settings |
| containers | id, workspaceId, kind(course/project), title, status |
| sources | id, containerLinks, kind, metadata, assetRef, contentHash |
| source_locators | sourceId, page/range/time/region, quoteHash |
| objects | id, kind, body, state, authorType, createdAt, updatedAt |
| object_links | objectId, containerId, role |
| relations | fromId, toId, relationType, confidence, authorType |
| views | id, containerId, kind, query/filter/layout settings |
| placements | viewId, objectId, x, y, width, height, collapsed |
| ai_drafts | contextSnapshot, provenance, provider, model, status |
| tasks | id, objectId?, status, dueAt, milestoneId? |
| review_events | questionId, attempt, result, confidence, reviewedAt |
| operations | opId, actorId, entityId, type, payload, timestamp |

具体物理 schema 可分别映射到 Dexie 与 SQLite，但 domain migration 必须共享测试样例。

### 4.3 来源定位

`SourceLocator` 至少支持：

```ts
type SourceLocator =
  | { kind: 'pdf-page'; page: number; rects?: Rect[]; quoteHash?: string }
  | { kind: 'text-range'; start: number; end: number; quoteHash: string }
  | { kind: 'media-time'; startMs: number; endMs?: number }
  | { kind: 'image-region'; rect: Rect }
  | { kind: 'web-snapshot'; url: string; selector?: string; capturedAt: string };
```

locator 需要可迁移和可校验。PDF 重新导入后先通过 content hash，再通过 quote hash 尝试恢复定位；失败时显示 broken source link，不静默指向错误位置。

## 5. Repository 与平台能力

### 5.1 Contract

```ts
interface StudyKitRepository {
  getObject(id: string): Promise<KnowledgeObject | null>;
  queryObjects(query: ObjectQuery): Promise<KnowledgeObject[]>;
  transact<T>(fn: (tx: StudyKitTransaction) => Promise<T>): Promise<T>;
  subscribe(query: ObjectQuery, listener: QueryListener): Unsubscribe;
  exportSnapshot(options: ExportOptions): Promise<ExportArtifact>;
}
```

UI 组件不得 import Dexie table、SQLite client 或 HTTP client。同步也不直接写 UI state，而通过 repository 写入并触发订阅。

### 5.2 Web adapter

- 继续使用 Dexie / IndexedDB 作为离线缓存和 Web local workspace；
- 大文件优先使用 OPFS 或 browser file handles，能力不足时回退 IndexedDB Blob；
- 浏览器清理存储风险必须在 Workspace 设置明确提示；
- Web 端提供导出/备份提醒，不把 IndexedDB 当永久保险箱。

Dexie 支持 IndexedDB 的响应式数据访问；若未来采用 Dexie Cloud，应先验证其和现有后端、账户模型以及本地桌面同步是否重复，而不是默认同时维护两套云同步。[Dexie 文档](https://dexie.org/docs)

### 5.3 Desktop adapter

- Tauri v2 提供 desktop shell、IPC、窗口、菜单、更新器和平台集成；
- SQL plugin 连接 SQLite，并通过 migrations 管理 schema；
- 文件能力只授权 workspace 目录与用户显式选择的导入/导出路径；
- Rust commands 保持窄接口，不向前端暴露任意 filesystem 或 shell；
- 重型本地处理可使用受控 sidecar，但首发不因此引入第二套常驻服务。

Tauri 可复用现有 Web frontend，并使用系统 WebView；SQL、Updater 与 Sidecar 均有官方 v2 插件/机制。[Tauri v2](https://v2.tauri.app/start/)、[架构](https://v2.tauri.app/concept/architecture/)、[SQL plugin](https://v2.tauri.app/plugin/sql/)、[Updater](https://v2.tauri.app/plugin/updater/)、[Sidecar](https://v2.tauri.app/develop/sidecar/)

## 6. 本地 Workspace 格式

### 6.1 推荐运行时格式

```text
My StudyKit Workspace/
├── workspace.json          # id, schema, human-readable settings
├── studykit.sqlite         # canonical structured data
├── assets/
│   ├── originals/          # imported PDFs/images
│   ├── derived/            # thumbnails/OCR/index artifacts
│   └── temp/               # recoverable processing files
├── backups/                # rotating local snapshots, optional
└── exports/                # user-created exports, optional
```

- 默认导入复制到 `assets/originals`，保证移动原文件后仍可用；
- 高级选项可只引用原文件，并显示 link health；
- asset 文件名使用内容哈希或稳定 ID，原始文件名保存在 metadata；
- 删除对象先进入 workspace trash，清理 assets 前做引用计数；
- workspace 可打包成 `.studykit` ZIP 交换，但解包目录仍是实际运行格式；
- Markdown/JSON/PDF/BibTeX 等是开放导出，不作为内部唯一真相源。

### 6.2 备份与恢复

- 首次创建 workspace 后解释数据位置；
- SQLite 使用在线备份或一致性 snapshot，不能直接复制正在写入的数据库文件；
- 自动保留最近 N 个本地快照，策略可配置；
- 启动时检查 migration 与数据库完整性；
- crash 后从 operation log 恢复未提交编辑；
- 导入旧 workspace 前先创建可回滚快照。

## 7. 本地 AI 与云 AI

### 7.1 Provider contract

```ts
interface AIProvider {
  capabilities(): Promise<AICapabilities>;
  generate(request: GenerationRequest): AsyncIterable<GenerationEvent>;
  embed?(request: EmbeddingRequest): Promise<EmbeddingResult>;
  cancel(requestId: string): Promise<void>;
}
```

应用层根据动作要求选择 capability，不直接写死模型名。例如 Evidence Extractor 需要 structured output 与足够 context；Review feedback 需要低延迟但不一定需要最大模型。

### 7.2 Ollama

- 桌面端启动时非阻断检测本机 Ollama；
- 不自动下载模型，不默认启动隐藏服务；
- 设置页显示检测到的模型、能力、上下文长度与建议用途；
- embedding 与 generation 可选择不同模型；
- 请求只发往用户配置的本地 endpoint；
- 兼容接口是便利层，仍保留 StudyKit provider capability 检测。

Ollama 提供本地 API、embedding 和部分 OpenAI-compatible endpoints，可作为首个本地 provider，但实际模型质量和硬件需求需要单独验证。[Ollama API](https://docs.ollama.com/api/introduction)、[Embeddings](https://docs.ollama.com/capabilities/embeddings)、[OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)

### 7.3 云 Provider

- API key 存 OS keychain/credential store，不存普通 localStorage；
- 每次请求记录 provider、model、scope 与发送时间；
- provider adapter 负责重试、限流、流式事件与数据保留说明；
- 云 AI 关闭后仍保留用户已接受内容和 provenance；
- 不把整个 workspace 建成长久云端 vector store，除非用户单独授权。

### 7.4 Indexing

- 文本抽取、chunking、embedding 与 search index 分离；
- chunk 保留 source locator 和 content hash；
- embedding 模型切换创建新 index version，不覆盖旧索引后假装兼容；
- index 可删除和重建，不作为唯一数据；
- 设备低电量、课堂输入或高负载时暂停后台索引。

## 8. 同步模型

同步不是桌面版首发的依赖，但数据模型现在就应避免阻塞未来同步。

### 8.1 基本原则

- 所有用户写操作有 opId、deviceId、entityId 与 timestamp；
- 正文冲突保留两个版本，不做 last-write-wins 静默覆盖；
- Canvas position 可按字段合并，但同一 placement 冲突也必须可恢复；
- 删除是 tombstone，跨设备确认后再物理清理；
- assets 使用 content hash 去重与断点上传；
- sync server 不参与本地事务提交。

### 8.2 首发边界

v0.4 Desktop Alpha 可以只有本地 workspace + 手动导出/备份。账号同步应在操作日志、冲突 UI、加密与恢复演练通过后再开放，避免“为了同步”牺牲本地可靠性。

### 8.3 Research Collaboration

本地单人 workspace 与共享 Research Project 是两种运行状态：前者无需账号、完全本地；后者由用户显式创建或加入，获得 project-scoped identity、permissions 和 sync。协作不得成为使用本地产品的前置条件。

#### 权限与内容层

- `project_memberships`：Owner、Editor、Commenter、Viewer；
- `object_comments / mentions / review_requests`：用于 Evidence、Claim、Decision、Task、Output；
- `visibility`：`private`、`project`，后续再验证 public/link sharing；
- Private Scratch 默认不进入共享 operation log；发布时创建显式 publish operation 和 diff；
- assets 独立检查访问权限，拥有 metadata 权限不代表拥有受限全文权限；
- AI run 记录发起人、scope、provider、费用归属和 publish 状态。

Zotero Groups 与 OSF 都采用简单的项目/库成员权限，StudyKit 首期沿用相近心智模型，不引入企业 RBAC。[Zotero Groups](https://www.zotero.org/support/groups)、[OSF contributor permissions](https://help.osf.io/article/246-understand-contributor-permissions)

#### 数据同步分层

| 数据 | 推荐同步机制 | 原因 |
|---|---|---|
| Domain objects、tasks、decisions、comments | operation log + server validation | 需要权限、审计和事务约束 |
| Canvas placement、shared rich text | CRDT document（proposed） | 高频并发、离线合并 |
| Presence、cursor、selection | ephemeral awareness | 不应持久化为项目内容 |
| PDFs、images、datasets | content-addressed asset sync | 大文件、断点、去重与权限 |
| Private Scratch | local repository，显式 publish | 保护个人思考空间 |

推荐用 Yjs 做 Canvas/协作文档 spike，而不是直接把所有领域数据放入 CRDT。Yjs 提供编辑器/网络 adapter、持久化 provider 与独立 Awareness protocol；presence 状态不需要写入正式文档。[Yjs docs](https://docs.yjs.dev/)、[Yjs Awareness](https://docs.yjs.dev/getting-started/adding-awareness)

技术选型必须经过 spike，验证现有 React Flow Canvas、未来富文本编辑器、撤销语义、权限撤回、离线重连、历史回放和大项目性能。若 CRDT 增加的复杂度高于收益，对低冲突对象继续使用 operation log 和显式版本冲突。

#### Collaboration Gateway

- WebSocket 只负责实时 update/presence，不成为唯一持久化层；
- Postgres 保存 project membership、operation log、comments、snapshots 与 CRDT update references；
- 每个共享文档定期 snapshot + compact，保留可审计的发布版本；
- 客户端先写本地 replica，再异步推送；离线时仍可编辑有权限的已缓存内容；
- 权限撤回后停止新同步并清理共享密钥/缓存策略，但不得删除用户自有 private content；
- 评论、任务、decision 和 AI publish 使用 server-authoritative permission check。

## 9. 安全与隐私

- Tauri capabilities 采用最小权限；
- 禁止 arbitrary shell、任意路径读取与未声明远程 origin；
- 导入的 HTML/Markdown/PDF annotation 做内容隔离与 sanitization；
- 外部链接和附件打开有明确目标；
- workspace 可设置闲置锁定；
- secrets 使用平台安全存储；
- 云 AI 与 sync 权限分开；
- 提供“本工作区从未发送到哪里”的 activity log；
- telemetry 默认收集最小产品事件，不收正文、文件名或 prompt；本地版可关闭。

## 10. 性能预算

当前产品“没那么跟手”不能只靠换壳解决。v0.4 设置以下预算：

| 体验 | 目标 |
|---|---|
| Desktop warm start 到可操作 | < 2 s（目标设备） |
| 打开 Course / Project shell | < 300 ms 感知延迟 |
| 本地保存确认 | < 100 ms，实际 durable write 可后台完成并有状态 |
| 打开已有 PDF 首屏 | < 1 s（100 MB 以下样例集分档测试） |
| Canvas pan/zoom/drag | 稳定 60 fps，降级不低于可用阈值 |
| 选区菜单 | < 100 ms |
| 全局搜索首批本地结果 | < 300 ms |
| 路由首包 | 每个 Mode 独立 code split，不加载另一 Mode 重型编辑器 |

工程要求：

- Study、Research、PDF、Canvas、Output Editor 分 route chunk；
- 不在 app boot 初始化所有 DB、AI、Zotero 与 PDF workers；
- 大列表和 Canvas 节点虚拟化；
- Dexie/SQLite query 有索引与 explain/benchmark；
- React render profiler 与真实 1k/10k 对象数据集进入 CI 性能基线；
- 后台 OCR/index 与前台交互使用优先级队列。

## 11. 迁移路径

### Phase A：边界与测量

1. 建立 app performance baseline；
2. 引入 domain objects 与 repository interfaces；
3. 为现有 Dexie 封装 adapter，不先迁移数据；
4. 为现有 Canvas 写 legacy adapter；
5. 加 schema fixture 与 round-trip tests。

### Phase B：双 Mode Shell

1. 新增 routes 和 mode context；
2. 现有 Lecture 进入 Study legacy route；
3. 现有 Literature Project 进入 Research legacy route；
4. 不再使用单一全局 sidebarMode 作为业务真相；
5. 增加 cross-mode global search contract。

### Phase C：Desktop Spike

1. 创建 Tauri v2 shell；
2. 完成 workspace 选择、SQLite migration、PDF import、保存、重启恢复；
3. 对比 Web 与 Desktop 同一 repository contract tests；
4. 验证中文路径、OneDrive/iCloud 路径、大 PDF、休眠唤醒和 crash recovery；
5. spike 通过后才开始发布签名和 updater。

### Phase D：共享对象迁移

1. 将 lecture notes / literature nodes 映射到 objects；
2. 增加 source locator；
3. Canvas 正文与 placement 分离；
4. AI draft 与 provenance 正式落表；
5. 提供迁移预览、备份与 rollback。

### Phase E：可选云同步

在本地数据可靠、operation log 与冲突 UI 验证后接入现有 backend/Postgres。

## 12. 测试策略

- Domain：对象规则、关系限制、Review、Draft Layer 的纯单元测试；
- Contract：同一 repository suite 同时跑 Dexie 与 SQLite；
- Migration：每个历史 schema fixture 向前迁移、重复运行、rollback；
- Desktop E2E：安装、创建 workspace、导入、编辑、重启、导出、升级；
- Data safety：断电模拟、磁盘满、权限变更、文件移动、数据库锁；
- AI：scope、provenance、cancel、provider failure、offline、local/cloud parity；
- Performance：100/1k/10k objects、10/100/500 MB PDFs、低端设备；
- Accessibility：键盘、screen reader、reduced motion、Canvas outline alternative。

## 13. 发布与分发

- macOS：签名与 notarization；Windows：code signing；
- 发布 stable / beta channel，数据库 schema 兼容策略独立于 app version；
- updater 只在完成 migration backup 后安装；
- 安装包不捆绑大模型；
- download page 明确操作系统、CPU、磁盘、AI 可选项和数据位置；
- 每个版本都提供离线导出与降级路径；
- Linux 在输入法、PDF、filesystem 与 updater 验证后加入。

## 14. Architecture Decision Records

| ADR | 决策 | 状态 |
|---|---|---|
| ADR-001 | Tauri v2 作为桌面 shell | proposed / spike required |
| ADR-002 | SQLite + assets 作为桌面 runtime format | proposed |
| ADR-003 | Dexie 保留为 Web adapter | accepted for v0.4 |
| ADR-004 | UI 不直接访问持久化实现 | accepted |
| ADR-005 | Canvas placement 与 object content 分离 | accepted |
| ADR-006 | AI provider 可替换，Ollama 为首个本地 provider | proposed / benchmark required |
| ADR-007 | sync 不作为 Desktop Alpha 前置 | accepted |
| ADR-008 | Markdown 是导出格式，不是唯一真相源 | proposed / user validation required |
| ADR-009 | Research Collaboration 不影响单人本地使用 | accepted |
| ADR-010 | Operation log 管领域对象，CRDT 只用于高频共同编辑 | proposed / spike required |
| ADR-011 | Private Scratch 默认本地私有，显式发布到共享层 | accepted |

## 15. 首个技术 Gate

在扩大桌面开发前，必须用一个 5 天 spike 证明：

- 同一 Course 可通过 Dexie 与 SQLite adapter 读写；
- 导入 PDF、创建 page-linked Note、重启应用后定位仍正确；
- 断网和没有账号时全流程可用；
- 中文/空格路径正常；
- 100 MB PDF 与 1,000 对象下达到性能预算；
- export snapshot 可被新 workspace 恢复；
- Tauri capability 不暴露 workspace 外任意文件访问。
