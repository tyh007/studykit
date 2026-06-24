# StudyKit Stage Two to Stage Six LLM Coding PRD Guide

作者: Yh T  
状态: Draft for agentic coding  
日期: 2026-05-15  
前提: Stage One 已完成  
用途: 给大模型、coding agent、Claude Code、Cursor、Codex、Traycer 或其他 agentic coding workflow 使用的后续阶段 PRD 指令包  

## 使用说明

这份文件不是普通产品计划，而是给大模型编程用的 **控制型 PRD 指南**。它的作用是让后续开发 agent 明确知道：

- 哪些功能应该做。
- 哪些功能现在不能做。
- 哪些数据结构必须保持兼容。
- 哪些用户数据不能被破坏。
- 哪些功能必须经过验收测试才算完成。
- 哪些阶段依赖前一阶段，不允许跳步。

如果之后你把这份文件交给大模型编程工具，建议每次只让 agent 实现一个阶段、一个 epic、或一个 issue，不要一次让它“实现所有后续功能”。StudyKit 的复杂度很高，必须通过阶段性 PRD 控制 scope creep。

---

# 全局开发指令

```yaml
prd_id: studykit-post-stage-one-master-prd
title: StudyKit Post-Stage-One LLM Coding Guide
version: 1.0.0
owner: Yh T
status: draft
last_updated: 2026-05-15
assumption: Stage One MVP has been completed
llm_directives:
  temperature: 0.2
  persona: >
    You are a senior full-stack product engineering agent extending StudyKit
    after Stage One. You MUST preserve all Stage One data, exports, annotations,
    source documents, note blocks, sync operations, and user-created content.
    You MUST implement only the requested stage or issue. You MUST NOT silently
    add AI generation, public sharing, marketplace features, write-back to
    external tools, real-time collaboration, or destructive migrations unless
    the PRD explicitly allows it. You MUST write tests for each acceptance
    criterion and report every schema migration.
```

## 全局原则

### 原则一: 不破坏 Stage One

后续所有功能都必须兼容 Stage One 已经完成的能力：

- Module 和 lecture hierarchy。
- PDF slide import。
- Slide-linked note blocks。
- Cornell cue column。
- Annotation overlays。
- Equation blocks。
- Attachments。
- Local autosave。
- Conflict-safe sync。
- PDF export。
- Markdown export。
- Future hooks for Zotero, plugins, AI provenance, Obsidian-compatible export, flashcards, mind maps, and code notebooks。

任何后续开发都不能破坏这些核心流程。

### 原则二: 每个阶段只解决一个核心问题

- **Stage Two**: Academic sources and Zotero。
- **Stage Three**: AI-grounded revision system。
- **Stage Four**: Plugin SDK and external-tool ecosystem。
- **Stage Five**: Coding and computational study。
- **Stage Six**: Collaboration and institutional workflows。

如果一个 agent 在 Stage Two 中主动实现 AI flashcards、插件市场、多人协作或代码执行，必须视为 scope violation。

### 原则三: 数据模型必须向后兼容

所有 schema migration 必须满足：

- 不删除用户现有 notes。
- 不删除 source documents。
- 不删除 annotations。
- 不改变 existing IDs。
- 不把 external provider ID 当成本地唯一 source of truth。
- 不把 AI-generated content 当成 verified user notes。
- 不把 plugin-generated content 当成 core content，除非用户接受或系统明确标记。

### 原则四: 外部工具默认 read-only

所有外部工具连接，包括 Zotero、Anki、Google Drive、OneDrive、Canvas、Moodle、GitHub、Overleaf、Notion 和 Obsidian，都应遵循：

- 第一个版本默认 read-only 或 import-only。
- Write-back 必须是单独阶段。
- Write-back 必须有用户确认。
- Write-back 必须有 audit log。
- Write-back 必须支持 conflict preservation。
- Connector failure 不能破坏本地 notes。

Zotero 的 Web API 支持用户和 group library、collections、items、tags、formats、API key/OAuth authentication、conditional requests 和 version-aware behaviours，因此它适合作为第一个 academic connector，但写回必须非常谨慎。[Zotero Web API documentation](https://www.zotero.org/support/dev/web_api/v3/basics) 说明了这些 library、collection、item、tag 和 authentication 基础能力；[Zotero write request documentation](https://www.zotero.org/support/dev/web_api/v3/write_requests) 说明 write requests 需要版本处理，远程对象变化时可能返回 conflict-style failure。

### 原则五: AI 必须 source-grounded

所有 AI 功能必须：

- 让用户选择 source scope。
- 显示将使用哪些 notes、slides、citations、readings 或 attachments。
- 输出 draft。
- 保存 provenance。
- 支持 accept、edit、reject、regenerate。
- 不覆盖原始 notes。
- 不在 source 不足时编造内容。

### 原则六: 插件必须 permissioned

StudyKit 可以借鉴 Obsidian 的 plugin mental model，因为 Obsidian plugin 使用 TypeScript、manifest、commands、views 和用户启用流程。[Obsidian developer documentation](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin) 展示了这种 TypeScript 和 manifest-based plugin 开发模式。StudyKit 不能简单复制 Obsidian 的信任模型，因为 StudyKit 涉及 cloud sync、AI、lecture slides、external connectors 和 academic data，所以必须有更严格的 permission boundary。

### 原则七: Export 是 contract

任何新功能如果产生新内容类型，都必须定义：

- 如何在 StudyKit 内部存储。
- 如何在 Markdown export 中降级。
- 如何在 PDF export 中展示。
- 是否进入未来 Obsidian vault export。
- 是否进入 future Rmd、Quarto、Jupyter、Anki 或 citation export。
- Export 不支持时如何写入 export report。

---

# 全局数据模型扩展规范

## 必须保留的 Stage One 核心对象

后续阶段不得破坏以下对象：

- `workspaces`
- `modules`
- `lectures`
- `source_documents`
- `source_pages`
- `note_blocks`
- `annotations`
- `attachments`
- `block_attachments`
- `export_jobs`
- `device_clients`
- `sync_operations`
- `future_reserved_external_refs`

## 推荐新增通用对象

### external_accounts

用途: 保存外部工具连接账户。

字段建议：

```yaml
external_accounts:
  id: uuid
  workspace_id: uuid
  provider: enum # zotero, anki, google_drive, onedrive, github, overleaf, notion, canvas, moodle
  auth_method: enum # oauth, api_key, local_file, manual
  auth_status: enum # connected, expired, revoked, error
  granted_scopes_json: json
  provider_user_id: text
  provider_display_name: text
  created_at: timestamp
  updated_at: timestamp
  disconnected_at: timestamp | null
```

### external_objects

用途: 映射外部对象，例如 Zotero item、Zotero collection、Anki deck、GitHub repo、Drive file。

```yaml
external_objects:
  id: uuid
  external_account_id: uuid
  provider: enum
  provider_object_type: text
  provider_object_id: text
  provider_parent_id: text | null
  local_object_type: text | null
  local_object_id: uuid | null
  sync_direction: enum # read_only, import_only, export_only, two_way_manual, two_way_auto
  remote_version: text | null
  local_version: integer | null
  metadata_json: json
  created_at: timestamp
  updated_at: timestamp
  deleted_at: timestamp | null
```

### connector_sync_events

用途: 记录外部 connector 的同步历史和错误。

```yaml
connector_sync_events:
  id: uuid
  external_account_id: uuid
  provider: enum
  operation_type: enum # import, update, skip, conflict, error, disconnect
  local_object_type: text | null
  local_object_id: uuid | null
  provider_object_type: text | null
  provider_object_id: text | null
  status: enum # succeeded, failed, skipped, conflict
  message: text | null
  details_json: json
  created_at: timestamp
```

### ai_jobs

用途: 记录 AI 生成任务。

```yaml
ai_jobs:
  id: uuid
  workspace_id: uuid
  module_id: uuid | null
  lecture_id: uuid | null
  job_type: enum # study_guide, flashcards, mind_map, missing_content, schema_extraction, explanation, quiz
  source_scope_json: json
  instruction_json: json
  provider: text
  model: text
  status: enum # draft, running, succeeded, failed, accepted, rejected
  output_object_type: text | null
  output_object_id: uuid | null
  provenance_json: json
  warnings_json: json
  created_at: timestamp
  updated_at: timestamp
```

### flashcards

```yaml
flashcards:
  id: uuid
  workspace_id: uuid
  module_id: uuid
  lecture_id: uuid | null
  source_block_id: uuid | null
  source_page_id: uuid | null
  source_citation_id: uuid | null
  front_json: json
  back_json: json
  card_type: enum # basic, cloze, image_occlusion
  generation_source: enum # manual, ai_draft, imported
  review_state_json: json
  tags_json: json
  created_at: timestamp
  updated_at: timestamp
  deleted_at: timestamp | null
```

### plugin_manifests

```yaml
plugin_manifests:
  id: uuid
  plugin_id: text
  name: text
  version: text
  author: text
  description: text
  minimum_studykit_version: text
  permissions_json: json
  source_type: enum # internal, local_dev, private_package, marketplace
  status: enum # installed, disabled, blocked, error
  created_at: timestamp
  updated_at: timestamp
```

### plugin_permission_grants

```yaml
plugin_permission_grants:
  id: uuid
  plugin_manifest_id: uuid
  workspace_id: uuid
  permission: text
  scope_json: json
  granted_by_user_id: uuid
  granted_at: timestamp
  revoked_at: timestamp | null
```

### computational_notebooks

```yaml
computational_notebooks:
  id: uuid
  workspace_id: uuid
  module_id: uuid
  lecture_id: uuid | null
  title: text
  source_note_block_ids_json: json
  target_format: enum # rmd, qmd, ipynb
  export_settings_json: json
  created_at: timestamp
  updated_at: timestamp
  deleted_at: timestamp | null
```

---

# Stage Two PRD: Academic Sources and Zotero

```yaml
prd_id: studykit-stage-two-zotero-prd
title: Stage Two Academic Sources and Zotero Integration
version: 1.0.0
owner: Yh T
status: draft
depends_on:
  - Stage One completed
  - source_documents
  - note_blocks
  - attachments
  - future_reserved_external_refs
llm_directives:
  temperature: 0.2
  persona: >
    You are implementing StudyKit Stage Two only. You MUST build academic
    source management and Zotero read-only integration. You MUST NOT implement
    AI study guide generation, plugin marketplace, Zotero write-back, public
    sharing, or real-time collaboration. You MUST preserve all Stage One notes,
    annotations, exports, and sync behaviour.
```

## Stage Two 目标

Stage Two 的目标是让 StudyKit 从“lecture note app”升级为“academic source-aware note workspace”。核心功能是 Zotero read-only integration、citation insertion、reading list、bibliography export、source-linked notes。

## Stage Two 用户故事

### S2-US-001: Connect Zotero read-only

- **As a** ResearchStudent
- **I want to** connect my Zotero library in read-only mode
- **So that** I can use academic references without risking changes to my Zotero library

验收标准：

- **S2-AC-001-A**: 用户连接 Zotero 前，系统必须显示 requested permissions。
- **S2-AC-001-B**: Stage Two 只能 read-only，不允许 write-back。
- **S2-AC-001-C**: Auth failure 不能影响 StudyKit notes。
- **S2-AC-001-D**: Disconnect 后必须停止 background sync。
- **S2-AC-001-E**: Imported metadata 可以保留，但必须标记为 disconnected snapshot。

### S2-US-002: Import Zotero collections

- **As a** ResearchStudent
- **I want to** import Zotero collections as reading lists
- **So that** I can organise readings by module

验收标准：

- **S2-AC-002-A**: 用户可以选择一个或多个 Zotero collections。
- **S2-AC-002-B**: 每个 imported collection 必须映射为 StudyKit reading list。
- **S2-AC-002-C**: 每个 remote collection 必须保存 provider_object_id。
- **S2-AC-002-D**: Re-import 不得重复创建同一个 collection。

### S2-US-003: Import Zotero items

- **As a** ResearchStudent
- **I want to** import Zotero items into StudyKit
- **So that** I can cite readings inside my notes

验收标准：

- **S2-AC-003-A**: 必须导入 title、creators、year/date、item type、tags、collection links、remote key。
- **S2-AC-003-B**: 必须保存 portable citation metadata。
- **S2-AC-003-C**: 不得默认复制完整 PDF attachments。
- **S2-AC-003-D**: Remote update 必须 version-aware。
- **S2-AC-003-E**: Duplicate import 必须 merge metadata，而不是创建重复项。

### S2-US-004: Insert citation into note

- **As a** ResearchStudent
- **I want to** insert a citation into a note block
- **So that** I can connect lecture notes to academic sources

验收标准：

- **S2-AC-004-A**: 用户可以在 editor 中搜索 imported references。
- **S2-AC-004-B**: 用户选择 reference 后，系统插入 citation block 或 inline citation。
- **S2-AC-004-C**: Citation block 必须链接到 local citation item 和 external Zotero object。
- **S2-AC-004-D**: Markdown export 必须保留 citation key 或 CSL-compatible metadata。

### S2-US-005: Bibliography export

- **As a** ResearchStudent
- **I want to** export a bibliography from cited items
- **So that** my notes can become academic study documents

验收标准：

- **S2-AC-005-A**: PDF export 可以包含 bibliography section。
- **S2-AC-005-B**: Markdown export 可以包含 bibliography metadata 或 references section。
- **S2-AC-005-C**: 未被引用的 imported items 默认不进入 bibliography。
- **S2-AC-005-D**: Missing citation metadata 必须进入 export report。

## Stage Two 非目标

**CRITICAL**: 以下内容不允许在 Stage Two 实现：

- Zotero write-back。
- AI reading summarisation。
- AI flashcard generation。
- Public sharing of reading packs。
- Full Zotero PDF attachment sync。
- Plugin marketplace。
- Real-time collaboration。

## Stage Two 数据模型新增

必须新增或实现：

- `external_accounts`
- `external_objects`
- `connector_sync_events`
- `citation_items`
- `reading_lists`
- `reading_list_items`

### citation_items

```yaml
citation_items:
  id: uuid
  workspace_id: uuid
  provider: enum # zotero, manual
  external_object_id: uuid | null
  citekey: text | null
  title: text
  creators_json: json
  issued_year: integer | null
  item_type: text
  publisher: text | null
  doi: text | null
  url: text | null
  abstract: text | null
  tags_json: json
  csl_json: json
  bibtex: text | null
  created_at: timestamp
  updated_at: timestamp
  deleted_at: timestamp | null
```

## Stage Two 给大模型的实施提示词

```text
You are implementing StudyKit Stage Two: Academic Sources and Zotero.

Read the existing Stage One codebase first. Preserve all existing user data models,
sync behaviour, note blocks, annotations, PDF import, and export functionality.

Implement only the following:
1. external_accounts, external_objects, connector_sync_events.
2. Zotero read-only authentication.
3. Zotero collection and item import.
4. citation_items and reading_lists.
5. Citation insertion into StudyKit notes.
6. Bibliography support in PDF and Markdown export.
7. Tests for every S2 acceptance criterion.

Do NOT implement Zotero write-back, AI summaries, plugin marketplace, real-time
collaboration, public sharing, or full attachment sync.

Every imported Zotero object must keep provider_object_id, provider version metadata,
local object mapping, and sync event logs. Connector failure must never corrupt local
notes. If metadata is missing, preserve partial data and show warnings instead of
failing destructively.
```

---

# Stage Three PRD: AI-Grounded Revision System

```yaml
prd_id: studykit-stage-three-ai-revision-prd
title: Stage Three AI-Grounded Revision System
version: 1.0.0
owner: Yh T
status: draft
depends_on:
  - Stage One notes, slides, annotations, exports
  - Stage Two citation and source objects recommended
llm_directives:
  temperature: 0.2
  persona: >
    You are implementing StudyKit Stage Three only. You MUST build AI revision
    features that are source-grounded, draft-first, auditable, and user-approved.
    You MUST NOT overwrite original notes, invent unsupported content, train on
    user content without opt-in, or generate plagiarism-oriented coursework.
```

## Stage Three 目标

Stage Three 的目标是让 StudyKit 可以把用户已有 notes、slides、annotations、citations 和 readings 转化成 revision materials，包括 study guide、flashcards、mind map、missing-content report 和 schema-based extraction。

## Stage Three 核心规则

所有 AI 功能必须：

- 先选择 source scope。
- 生成前显示 source list。
- 输出 draft。
- 每个 output object 有 provenance。
- 支持用户 edit、accept、reject。
- 不覆盖原始 notes。
- Source 不足时标记 missing，而不是 hallucinate。
- 对 AI 输出写入 `ai_jobs`。

## Stage Three 用户故事

### S3-US-001: Source-scoped AI generation

验收标准：

- **S3-AC-001-A**: 用户必须选择 module、lecture、selected slides、selected blocks、citation items 或 reading list。
- **S3-AC-001-B**: 系统必须在生成前展示 source summary。
- **S3-AC-001-C**: 用户可以取消 generation。
- **S3-AC-001-D**: AI job 必须保存 source_scope_json。

### S3-US-002: Generate study guide

验收标准：

- **S3-AC-002-A**: AI 生成内容必须标记为 draft。
- **S3-AC-002-B**: Study guide sections 必须链接到 source blocks/slides/citations。
- **S3-AC-002-C**: 用户 accept 后，study guide 才能成为正式 note block 或 revision document。
- **S3-AC-002-D**: Reject 不得删除原始 sources。

### S3-US-003: Generate flashcards

验收标准：

- **S3-AC-003-A**: AI flashcards 默认是 draft。
- **S3-AC-003-B**: 每张 flashcard 必须包含 source link。
- **S3-AC-003-C**: 用户可以逐张 accept、edit、reject。
- **S3-AC-003-D**: Accepted flashcards 进入 `flashcards` table。
- **S3-AC-003-E**: Flashcard export 不得包含 rejected cards。

### S3-US-004: Missing-content detection

验收标准：

- **S3-AC-004-A**: 系统比较 slide text、note blocks、annotations 和 citations。
- **S3-AC-004-B**: 输出必须是 suggestion，不是 guaranteed truth。
- **S3-AC-004-C**: Low confidence 必须显示。
- **S3-AC-004-D**: 用户 dismiss 后，不应重复显示同一 suggestion，除非 source 改变。

### S3-US-005: Schema-based extraction

适合 psychology 和 research methods 学习场景，例如：

- Method。
- Findings。
- Implications。
- Limitations。
- Evaluation。
- Key terms。
- Exam application。

验收标准：

- **S3-AC-005-A**: 用户可以创建 extraction schema。
- **S3-AC-005-B**: Schema 可以保存和复用。
- **S3-AC-005-C**: 每个 schema field 必须尝试 source-grounding。
- **S3-AC-005-D**: Unsupported field 必须显示 missing。

### S3-US-006: AI-generated mind map draft

验收标准：

- **S3-AC-006-A**: AI 可以从 selected sources 生成 nodes 和 edges。
- **S3-AC-006-B**: 每个 node 应链接到 source。
- **S3-AC-006-C**: 用户 accept 后才能保存为 mind map。
- **S3-AC-006-D**: 用户可以 edit node labels 和 edge labels。

## Stage Three 非目标

- 不做 fully autonomous lecture note-taking。
- 不做 essay writing。
- 不做 coursework answer generation。
- 不做 AI 自动覆盖 notes。
- 不做没有 source 的 general tutoring bot。
- 不做自动公开分享 revision packs。

## Stage Three 给大模型的实施提示词

```text
You are implementing StudyKit Stage Three: AI-grounded revision.

Implement AI features only as source-grounded draft generation. Before generation,
the user must select sources. After generation, all outputs must be marked as drafts,
store provenance, and require user acceptance before becoming normal content.

Implement:
1. ai_jobs table and lifecycle.
2. Source scope selector.
3. Study guide generation draft flow.
4. Flashcard draft generation and accept/edit/reject flow.
5. Missing-content detection suggestions.
6. Schema-based extraction.
7. Optional mind map draft objects if the canvas model exists.
8. Tests for provenance, draft state, source insufficiency, rejection, and export.

Do NOT implement autonomous note-taking, coursework writing, unsourced AI chat,
AI overwrite of original notes, public sharing, or model training on user data.
When sources are insufficient, output 'missing/uncertain' rather than inventing.
```

---

# Stage Four PRD: Plugin SDK and External Tool Ecosystem

```yaml
prd_id: studykit-stage-four-plugin-sdk-prd
title: Stage Four Plugin SDK and External Tool Ecosystem
version: 1.0.0
owner: Yh T
status: draft
depends_on:
  - Stable core block model
  - Stable export IR
  - Stable connector object model
  - Permission system
llm_directives:
  temperature: 0.2
  persona: >
    You are implementing StudyKit Stage Four only. You MUST create a safe,
    permissioned extension system. You MUST NOT give plugins raw database access,
    full workspace access by default, network access by default, or destructive
    permissions without user approval.
```

## Stage Four 目标

Stage Four 的目标是建立 Obsidian-like 但更安全的 StudyKit plugin architecture，让高级用户和开发者可以扩展：

- Commands。
- Views。
- Export adapters。
- Block types。
- Importers。
- AI transforms。
- Connectors。

## 插件安全模型

插件默认没有任何权限。所有权限必须显式声明并由用户批准。

权限类型：

- `read:selected_notes`
- `read:module_notes`
- `write:selected_notes`
- `write:created_blocks`
- `read:attachments`
- `write:attachments`
- `read:citations`
- `network:external`
- `ai:use_selected_sources`
- `export:register_adapter`
- `block:register_type`
- `view:register_panel`
- `command:register`

## Stage Four 用户故事

### S4-US-001: Plugin manifest

验收标准：

- **S4-AC-001-A**: 每个 plugin 必须有 manifest。
- **S4-AC-001-B**: Manifest 必须包含 plugin_id、name、version、author、description、minimum_studykit_version、permissions。
- **S4-AC-001-C**: Invalid manifest 必须被拒绝。
- **S4-AC-001-D**: Permission summary 必须用自然语言显示给用户。

### S4-US-002: Register command

验收标准：

- **S4-AC-002-A**: Plugin 有 command permission 才能注册 command。
- **S4-AC-002-B**: Command 执行时只能访问授权 scope。
- **S4-AC-002-C**: Command 修改 notes 时必须可 undo 或 versioned。
- **S4-AC-002-D**: Plugin disabled 后 command 必须消失。

### S4-US-003: Register export adapter

验收标准：

- **S4-AC-003-A**: Plugin 有 export permission 才能注册 export target。
- **S4-AC-003-B**: Export 前必须显示 plugin 将访问的内容。
- **S4-AC-003-C**: Plugin export failure 不得修改原始 notes。
- **S4-AC-003-D**: Export output 必须标记 produced by plugin。

### S4-US-004: Register custom block type

验收标准：

- **S4-AC-004-A**: Plugin block type 必须 namespaced。
- **S4-AC-004-B**: Plugin block 必须定义 fallback export。
- **S4-AC-004-C**: Plugin disabled 后，已有 plugin blocks 不能消失，必须以 fallback block 显示。
- **S4-AC-004-D**: Plugin block 不能破坏 core editor schema。

### S4-US-005: Developer mode

验收标准：

- **S4-AC-005-A**: Developer mode 默认关闭。
- **S4-AC-005-B**: 开启 developer mode 必须显示风险提示。
- **S4-AC-005-C**: Local plugins 只能在 test workspace 或用户明确选择的 workspace 中启用。
- **S4-AC-005-D**: Developer plugin error 必须被 sandbox 捕获。

## Stage Four 非目标

- 不做 public marketplace 第一版。
- 不做自动安装第三方插件。
- 不做 plugin raw DB access。
- 不做 plugin unrestricted network access。
- 不做 plugin unrestricted AI calls。

## Stage Four 给大模型的实施提示词

```text
You are implementing StudyKit Stage Four: permissioned plugin SDK.

Implement the plugin architecture, not a public marketplace. Plugins must use a
manifest, declare permissions, and run through a controlled SDK. No plugin gets
raw database access. No plugin gets all notes by default. Network and AI access
must require explicit permission.

Implement:
1. plugin_manifests.
2. plugin_permission_grants.
3. Plugin manifest validation.
4. Command registration API.
5. View registration API if feasible.
6. Export adapter registration API.
7. Custom block registration with fallback rendering.
8. Developer mode with warnings.
9. Tests for permission denial, disabling plugins, export failures, and fallback blocks.

Do NOT implement public marketplace, automatic plugin installation, unrestricted
network access, unrestricted AI access, or raw database access.
```

---

# Stage Five PRD: Coding and Computational Study

```yaml
prd_id: studykit-stage-five-computational-prd
title: Stage Five Coding and Computational Study
version: 1.0.0
owner: Yh T
status: draft
depends_on:
  - Stage One code-display blocks
  - Export IR
  - Attachments
  - Optional plugin/export adapter system
llm_directives:
  temperature: 0.2
  persona: >
    You are implementing StudyKit Stage Five only. You MUST support computational
    note-taking and reproducible export. You MUST NOT implement unsafe cloud code
    execution unless explicitly approved. Code blocks are non-executable by
    default unless a safe local execution model is separately specified.
```

## Stage Five 目标

Stage Five 的目标是支持 statistics、R、Python、Jupyter、Quarto、R Markdown 等课程。StudyKit 不需要变成完整 IDE，但要能把 lecture notes 和 code learning 合并。

## Stage Five 用户故事

### S5-US-001: Enhanced code blocks

验收标准：

- **S5-AC-001-A**: Code block 支持 language、caption、filename、execution_status。
- **S5-AC-001-B**: Code block 默认 non-executable。
- **S5-AC-001-C**: Code block Markdown export 保留 language fence。
- **S5-AC-001-D**: Code block 可以链接到 dataset attachment。

### S5-US-002: R Markdown export

验收标准：

- **S5-AC-002-A**: R code block 可以导出为 Rmd chunk。
- **S5-AC-002-B**: Equation 和 headings 保留。
- **S5-AC-002-C**: Unsupported block 写入 export report。
- **S5-AC-002-D**: Dataset attachment path 必须被转换为相对路径或 warning。

### S5-US-003: Quarto export

验收标准：

- **S5-AC-003-A**: R/Python code block 可以导出为 qmd chunk。
- **S5-AC-003-B**: YAML frontmatter 可配置。
- **S5-AC-003-C**: Citation metadata 可进入 bibliography fields。
- **S5-AC-003-D**: Unsupported StudyKit blocks 必须有 fallback。

### S5-US-004: Jupyter notebook export

验收标准：

- **S5-AC-004-A**: Python code block 导出为 code cell。
- **S5-AC-004-B**: Text notes 导出为 markdown cell。
- **S5-AC-004-C**: Equations 保留为 markdown math。
- **S5-AC-004-D**: Attachments 和 images 需要相对路径或 warning。

### S5-US-005: Dataset attachment workflow

验收标准：

- **S5-AC-005-A**: 用户可以把 CSV、TSV、JSON、XLSX 等文件标记为 dataset。
- **S5-AC-005-B**: Dataset 可以链接到 code block。
- **S5-AC-005-C**: Export 时 dataset 进入 export folder。
- **S5-AC-005-D**: Missing dataset 必须阻止 silent broken export。

## Stage Five 非目标

- 不默认支持 cloud code execution。
- 不执行任意用户代码。
- 不做完整 IDE。
- 不做 package manager。
- 不做 notebook collaboration。

## Stage Five 给大模型的实施提示词

```text
You are implementing StudyKit Stage Five: coding and computational study.

Implement computational note support and reproducible export. Code blocks are
non-executable by default. Do not run arbitrary code. Do not build a full IDE.

Implement:
1. Enhanced code block metadata.
2. Dataset attachment type and linking.
3. R Markdown export.
4. Quarto export.
5. Jupyter Notebook export.
6. Export reports for unsupported blocks and missing datasets.
7. Tests for Rmd, qmd, ipynb, Markdown, attachment paths, and unsupported block fallback.

Do NOT implement cloud execution, package installation, remote kernels, or arbitrary
code execution unless a separate security PRD explicitly approves it.
```

---

# Stage Six PRD: Collaboration and Institutional Workflows

```yaml
prd_id: studykit-stage-six-collaboration-institution-prd
title: Stage Six Collaboration and Institutional Workflows
version: 1.0.0
owner: Yh T
status: draft
depends_on:
  - Stable sync engine
  - Stable permission model
  - Mature privacy model
  - Export and external connectors
llm_directives:
  temperature: 0.2
  persona: >
    You are implementing StudyKit Stage Six only. You MUST add collaboration
    and institutional workflows without public-sharing copyrighted lecture
    materials by default. You MUST implement permissions, audit logs, and
    sharing boundaries before collaborative editing.
```

## Stage Six 目标

Stage Six 是最后阶段，因为 collaboration、institutional use 和 LMS integration 都涉及隐私、版权、权限和复杂 sync。它不应该早于 Stage One 到 Stage Five 的基础完成。

## Stage Six 用户故事

### S6-US-001: Share personal notes without slides

验收标准：

- **S6-AC-001-A**: 用户可以分享 personal notes。
- **S6-AC-001-B**: 默认不包含原始 lecture slides。
- **S6-AC-001-C**: 如果包含 slide-derived content，必须显示 copyright warning。
- **S6-AC-001-D**: 分享链接可以 revoke。

### S6-US-002: Group study workspace

验收标准：

- **S6-AC-002-A**: 用户可以创建 group workspace。
- **S6-AC-002-B**: Members 有 role: owner、editor、commenter、viewer。
- **S6-AC-002-C**: Role permissions 必须被 server-side enforced。
- **S6-AC-002-D**: Group activity 必须有 audit log。

### S6-US-003: Commenting without full collaboration

验收标准：

- **S6-AC-003-A**: 用户可以在 shared notes 上 comment。
- **S6-AC-003-B**: Comment 不改变原 note block。
- **S6-AC-003-C**: Owner 可以 resolve 或 delete comments。
- **S6-AC-003-D**: Comment notifications 可开关。

### S6-US-004: Real-time collaboration

验收标准：

- **S6-AC-004-A**: Real-time editing 只能在 explicit collaborative documents 中启用。
- **S6-AC-004-B**: 必须有 presence indicator。
- **S6-AC-004-C**: 必须有 conflict-safe merge 或 CRDT。
- **S6-AC-004-D**: 必须有 version history。

### S6-US-005: LMS import

验收标准：

- **S6-AC-005-A**: LMS connector 默认 read-only。
- **S6-AC-005-B**: 可以导入 module structure、lecture files、deadlines 或 reading list。
- **S6-AC-005-C**: LMS failure 不得破坏 StudyKit modules。
- **S6-AC-005-D**: Imported LMS files 必须保留 source metadata。

### S6-US-006: Institutional admin

验收标准：

- **S6-AC-006-A**: Institution admin 不能默认读取学生私人 notes。
- **S6-AC-006-B**: Institution policy 必须清晰显示给学生。
- **S6-AC-006-C**: Retention policy 必须可配置。
- **S6-AC-006-D**: Data export 和 deletion rights 必须保留。

## Stage Six 非目标

- 不默认公开分享 lecture slides。
- 不默认让 university admin 读取私人 notes。
- 不无审计地启用 group editing。
- 不在没有 permission model 的情况下做 real-time collaboration。

## Stage Six 给大模型的实施提示词

```text
You are implementing StudyKit Stage Six: collaboration and institutional workflows.

Implement sharing and collaboration only with strict permissions, audit logs, and
copyright-aware defaults. Personal notes may be shared, but original lecture slides
must not be publicly shared by default. Institutional features must not give admins
access to private student notes unless an explicit policy and permission model allows it.

Implement:
1. Share personal notes without slides by default.
2. Revocable sharing links.
3. Role-based group workspaces.
4. Commenting system.
5. Optional real-time collaboration only after permissions and versioning.
6. LMS read-only import connector.
7. Institutional policy and retention controls.
8. Tests for access control, revoke, audit logs, and copyright warning flows.

Do NOT implement public lecture-slide sharing, admin access to private notes by
default, collaboration without audit logs, or LMS write-back.
```

---

# 推荐执行顺序

## 不建议并行开发的部分

以下功能不建议同时做：

- Stage Three AI 和 Stage Two Zotero write-back。
- Stage Four plugin SDK 和 Stage Six collaboration。
- Stage Five code execution 和 Stage Three AI execution。
- Stage Six real-time collaboration 和 Stage One sync refactor。

原因是它们都涉及权限、数据安全、sync、external calls 或 user trust。如果同时开发，很容易产生不可控复杂度。

## 推荐顺序

### Step 1: Stage Two read-only Zotero

先实现 read-only Zotero 和 citation insertion，因为它能增强 academic workflow，而且风险可控。

### Step 2: Stage Three AI revision

在有 citations 和 source metadata 后做 AI，更容易实现 source-grounding 和 provenance。

### Step 3: Stage Five computational export

如果你的目标用户包括 psychology statistics、research methods、data science 或 cognitive modelling students，可以把 Stage Five 提前到 Stage Four 前。

### Step 4: Stage Four plugin SDK

等 core features 和 export model 稳定后再开放 plugin SDK，否则 SDK 会被早期架构变化破坏。

### Step 5: Stage Six collaboration

最后做 collaboration 和 institutional，因为这是权限、版权、同步和商业化复杂度最高的阶段。

## 可选调整

如果你最想服务 UCL psychology/data students，推荐顺序可以改成：

1. Stage Two Zotero。
2. Stage Three AI revision。
3. Stage Five Rmd/Quarto/Jupyter export。
4. Stage Four plugin SDK。
5. Stage Six collaboration。

---

# 全局验收总表

## Stage Two done when

- [ ] Zotero read-only connection works。
- [ ] Collections import as reading lists。
- [ ] Items import as citation items。
- [ ] Citations can be inserted into notes。
- [ ] Bibliography can be included in export。
- [ ] Connector failures do not corrupt notes。
- [ ] Zotero write-back is not implemented。

## Stage Three done when

- [ ] AI generation requires source selection。
- [ ] AI outputs are drafts。
- [ ] Provenance is stored。
- [ ] Study guides can be accepted/rejected。
- [ ] Flashcards can be accepted/edited/rejected。
- [ ] Missing-content suggestions show confidence。
- [ ] Unsupported claims are marked missing or uncertain。
- [ ] Original notes are never overwritten。

## Stage Four done when

- [ ] Plugin manifest validation works。
- [ ] Permission grant/revoke works。
- [ ] Commands can be registered safely。
- [ ] Export adapters can be registered safely。
- [ ] Plugin block fallback works。
- [ ] Disabled plugins cannot keep executing。
- [ ] Plugins do not get raw DB access。

## Stage Five done when

- [ ] Enhanced code blocks work。
- [ ] Dataset attachments work。
- [ ] Rmd export works。
- [ ] Quarto export works。
- [ ] Jupyter export works。
- [ ] Missing datasets generate warnings。
- [ ] No arbitrary code execution is implemented by default。

## Stage Six done when

- [ ] Sharing excludes slides by default。
- [ ] Sharing links are revocable。
- [ ] Role-based group workspace works。
- [ ] Commenting works without modifying source notes。
- [ ] Audit logs exist。
- [ ] LMS import is read-only。
- [ ] Institutional admin cannot read private notes by default。

---

# Master prompt for future coding agents

把下面这段作为给大模型编程的总 prompt，然后再附上对应阶段的 PRD。

```text
You are extending StudyKit after Stage One.

Before coding:
1. Read the Stage One technical PRD and existing implementation.
2. Identify the current schema, editor model, sync model, export pipeline, and tests.
3. Confirm that the requested stage depends only on completed features.
4. Do not implement unrelated stages.

Global constraints:
- Preserve all existing Stage One data and behaviours.
- Do not delete or rename existing IDs.
- Do not overwrite user notes, annotations, source documents, or exports.
- Use additive schema migrations where possible.
- Every migration must be reversible or safely recoverable.
- Every new object must have stable IDs, timestamps, and soft-delete where relevant.
- Every external tool must be read-only first unless write-back is explicitly approved.
- Every AI output must be draft, source-grounded, and user-approved.
- Every plugin must be permissioned and sandboxed through the StudyKit SDK.
- Every export-impacting feature must define PDF and Markdown fallback behaviour.

Implementation process:
1. Create a technical plan for the selected stage only.
2. List files/modules to modify.
3. Implement schema migrations.
4. Implement backend/API changes.
5. Implement frontend UI.
6. Implement export/sync integration where needed.
7. Add unit tests.
8. Add integration tests.
9. Run the relevant test suite.
10. Report what changed, what was tested, and what remains out of scope.

Do not:
- Implement public sharing unless the requested stage is Stage Six.
- Implement Zotero write-back unless a dedicated write-back PRD is provided.
- Implement plugin marketplace in Stage Four initial SDK.
- Implement cloud code execution in Stage Five.
- Implement unsourced AI chat or coursework-writing automation.
- Use external APIs without auth, rate-limit, and failure handling.
- Store external provider IDs as the only local source of truth.
```

---

# 下一步建议

如果 Stage One 真的已经完成，最合理的下一步是写 **Stage Two GitHub issue list**，不要直接让大模型“做 Stage Two”。Stage Two 应该拆成这些 tickets：

1. Add external account schema。
2. Add external object mapping schema。
3. Add connector sync event log。
4. Add Zotero auth connection flow。
5. Add Zotero read-only collection import。
6. Add Zotero item import。
7. Add citation item model。
8. Add reading list model。
9. Add citation search UI。
10. Add citation insertion block。
11. Add bibliography export support。
12. Add Zotero disconnect flow。
13. Add connector failure tests。
14. Add export fallback tests。

建议一次只给 coding agent 一个 ticket 或一个 epic。这样最安全，也最符合 StudyKit 这种复杂产品的开发节奏。

