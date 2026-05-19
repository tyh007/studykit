# StudyKit Stage One Technical PRD

Owner: Yh T  
Status: Draft  
Version: 0.2.0  
Prepared: 2026-05-13  
Revised: 2026-05-13  
Scope: Stage One MVP vertical slice  

```yaml
prd_id: studykit-stage-one-technical-prd-001
title: StudyKit Stage One Technical PRD
version: 0.2.0
owner: Yh T
status: draft
last_updated: 2026-05-13
target_release: Stage One MVP
llm_directives:
  temperature: 0.2
  persona: >
    You are a senior technical product and engineering agent building only
    the StudyKit Stage One MVP. You MUST prioritise slide-linked notes,
    Cornell cues, annotations, equations, attachments, local autosave,
    conflict-safe sync foundations, and PDF/Markdown export. You MUST NOT
    implement AI generation, public plugin marketplace, Zotero write-back,
    real-time collaboration, cloud code execution, public sharing, or full
    native mobile apps without explicit approval.
```

---

## Revision log

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-13 | Initial draft. |
| 0.2.0 | 2026-05-13 | Added primary user persona (Section 1.1). Added non-functional requirements (Section 1.2). Promoted PDF export renderer to Milestone 0 spike. Clarified single-owner multi-device sync scope (Section 8.1). Added `note_blocks.module_id` consistency rule (Section 5.2). Added annotation undo/redo acceptance criteria (TECH-005). Stated explicit WCAG 2.2 AA conformance target (Section 7.4, Section 13). Added performance testing to testing strategy (Section 13). Fixed `lectures.settings_json` schema example (Section 5.2). Added export job retention policy (Section 5.2). Added `list` block type example (Section 6.2). Tightened Milestone 0 exit criteria. Added PPTX out-of-scope note (Section 2.2). |

---

## 1. Executive summary

Stage One should implement one excellent vertical slice: a student can create a module, import lecture slides, write structured notes beside slides, add Cornell cue notes, annotate and highlight the slides, insert equations and attachments, keep working offline, sync safely, and export the lecture to PDF and Markdown.

The technical goal is not to build every future feature now. The goal is to choose an architecture that does not block later Zotero, plugins, Obsidian-compatible export, AI study generation, flashcards, mind maps, and computational notebook export. The correct technical posture is therefore: narrow MVP surface, extensible internal schema, local-first data safety, and a proper export pipeline.

### 1.1 Primary user persona

**Target user**: An undergraduate or postgraduate student at a UK university who attends live lectures and needs to take structured notes alongside lecturer-provided slide decks. The student typically works on a laptop during lectures and may switch to a second device (tablet or desktop) later for review. Connectivity may be intermittent during lectures held in older buildings. The student is not primarily a developer or technical user; they expect the editor to be reliable, fast to start, and easy to navigate during a 50-minute lecture.

Key implications for product decisions:
- Local-first reliability is more important than cloud features at MVP.
- Startup speed and low friction for note creation matter more than visual richness.
- PDF import and export are core—students receive slides as PDFs and submit or share notes as PDFs or plain text.
- Accessibility cannot be deferred; students may use assistive technology or have specific access needs.

### 1.2 Non-functional requirements

These targets are mandatory for Stage One acceptance. Any feature that ships without meeting its relevant NFRs requires explicit product-owner approval and a documented exception.

#### Performance

| Metric | Target | Measurement method |
|--------|--------|--------------------|
| First page render of a 50-slide PDF | ≤ 3 seconds on a mid-range laptop (2021 or later) on a 50 Mbps connection | Lighthouse performance audit or manual stopwatch |
| Slide-to-slide navigation | ≤ 300 ms perceived transition | Manual timing in browser DevTools |
| Local autosave commit after keystroke | ≤ 500 ms | Unit test with simulated keystroke |
| App cold start to usable editor state | ≤ 4 seconds on supported browsers | Lighthouse performance audit |
| PDF export (40-slide deck, 20 annotations) | ≤ 30 seconds | End-to-end test with defined fixture deck |
| Markdown export (any lecture) | ≤ 5 seconds | End-to-end test |

#### Storage

| Metric | Target |
|--------|--------|
| Minimum assumed local IndexedDB budget | 100 MB per workspace before prompting the user |
| Local metadata and notes (excluding binary files) | ≤ 50 MB for a typical 12-week module |
| Large binary files (original PDFs, attachments) | Cached opportunistically; re-downloaded from cloud when evicted |

#### Reliability and sync

| Metric | Target |
|--------|--------|
| Sync push after reconnect | Pending operations pushed within 30 seconds of network restoration |
| Note durability on crash after local commit | 100%—no committed note block may be permanently lost |
| Conflict preservation | 100%—unsafe conflicts must always produce a conflict record, never a silent overwrite |

#### Accessibility

WCAG 2.2 Level AA is the mandatory conformance target for all Stage One UI components. This is the standard expected for educational software deployed to UK university students. Components with known partial conformance limitations (e.g., the PDF canvas annotation layer) must be documented with workarounds and addressed no later than Stage Two.

#### Browser support

Stage One must support the current and one previous major version of Chrome, Firefox, and Safari on macOS and Windows. Mobile browser support (Chrome for Android, Safari for iOS) is desirable but not required for Stage One.

---

## 2. Stage One product scope

### 2.1 In scope

- **Module and lecture hierarchy**: Users can create modules and lectures.
- **PDF slide import**: Users can upload a PDF lecture slide deck.
- **Slide viewer**: Users can view slide thumbnails and selected slide pages.
- **Side-by-side note editor**: Users can write notes linked to the selected slide.
- **Cornell cue column**: Users can add cue notes and summaries beside the main note.
- **Structured note blocks**: Notes support headings, paragraphs, lists, callouts, equations, images, files, and code-display blocks.
- **Annotation and highlighting**: Users can highlight or draw on slides without modifying the original PDF.
- **Annotation undo/redo**: Users can undo and redo annotation actions locally.
- **Local autosave**: Edits persist locally even if connectivity fails.
- **Same-owner multi-device sync**: User data syncs between devices owned by the same user, with conflict-preserving behaviour.
- **PDF export**: Users can export a lecture with slides and notes in a clean layout.
- **Markdown export**: Users can export notes in a portable text format.
- **Extensibility-ready schema**: The schema leaves space for citations, plugins, external connectors, AI provenance, flashcards, and computational export.

### 2.2 Out of scope

**CRITICAL**: Stage One MUST NOT include the following unless the product owner explicitly approves a scope change.

- Full AI study guide generation.
- Zotero connector implementation.
- Zotero write-back.
- Public plugin marketplace.
- Real-time multiplayer collaboration (multi-user, simultaneous editing).
- LMS integration.
- Public sharing.
- Cloud code execution.
- Full native iOS, Android, Windows, or macOS apps.
- Obsidian direct vault sync.
- Full flashcard scheduler.
- Full mind map editor.
- PPTX slide import (noted as a future `source_documents.type`; not implemented in Stage One).

---

## 3. Recommended technical stack

### 3.1 Summary recommendation

| Layer | Recommendation | Why |
|---|---|---|
| App | TypeScript + React web app or PWA | Fastest path to web-first MVP, compatible with many editor and PDF libraries. |
| Editor | Tiptap over ProseMirror | Tiptap is built on ProseMirror, is headless, modular, framework-compatible, and extension-based according to [Tiptap documentation](https://tiptap.dev/docs/editor/getting-started/overview). |
| Slide rendering | PDF.js | PDF.js is a web-standards-based platform for parsing and rendering PDFs according to [PDF.js](https://mozilla.github.io/pdf.js/). |
| Equation rendering | KaTeX | KaTeX supports TeX-style math rendering, renders synchronously, and supports server-side rendering according to [KaTeX](https://katex.org/). |
| Code block display | CodeMirror | CodeMirror is an in-browser code editor with syntax highlighting, language packages, accessibility support, and extensibility according to [CodeMirror](https://codemirror.net/). |
| Local persistence | IndexedDB-backed local store plus operation log | IndexedDB is the realistic browser storage layer for serious local-first data, while localStorage and sessionStorage are too small for serious user data according to [Evil Martians](https://evilmartians.com/chronicles/cool-front-end-arts-of-local-first-storage-sync-and-conflicts). |
| Sync model | Operation log with selective CRDT use | Yjs is a high-performance CRDT model for local-first software that can merge changes without merge conflicts according to [Yjs documentation](https://docs.yjs.dev/). |
| Cloud metadata | Postgres-backed backend, Supabase-compatible | Supabase projects include a full Postgres database and realtime server extension according to [Supabase documentation](https://supabase.com/docs/guides/database/overview). |
| Export | Internal export IR to PDF/Markdown; Pandoc-compatible later | Pandoc supports conversion among Markdown, HTML, DOCX, LaTeX/PDF, Jupyter notebooks, BibTeX, BibLaTeX, CSL JSON, and many other formats according to [Pandoc](https://pandoc.org/). |

### 3.2 Editor framework options

#### Option A: Tiptap/ProseMirror

Recommendation: **Use for Stage One**.

Tiptap is built on ProseMirror and provides a headless, modular, framework-compatible editor API based on events, commands, and extensions according to [Tiptap documentation](https://tiptap.dev/docs/editor/getting-started/overview). This fits StudyKit because Stage One needs custom academic blocks, Cornell cue behaviours, equation nodes, attachment nodes, export metadata, and later plugin-defined block types.

Advantages:

- Strong fit for custom blocks.
- Extension architecture maps well to future StudyKit plugins.
- Mature ProseMirror foundation.
- Can represent content as structured nodes rather than plain HTML.
- Good fit for command palette and slash-menu workflows.

Risks:

- ProseMirror-style schemas and transactions can become complex.
- Custom table, equation, annotation, and export behaviours need careful engineering.
- The team must avoid treating editor HTML as the canonical source of truth.

Decision:

- Use Tiptap as the rich note editor.
- Store StudyKit block metadata separately from editor rendering.
- Use custom nodes for equation, attachment, callout, code-display, citation-placeholder, slide-reference, and future plugin blocks.

#### Option B: Lexical

Recommendation: **Keep as fallback**.

Lexical uses editor instances, editor states, a plugin interface, modular packages, and claims WCAG-aware accessibility compatibility according to [Lexical](https://lexical.dev/). It is attractive if the implementation team wants a lighter Meta-backed editor framework and is willing to build more of the academic object model itself.

Advantages:

- Modern plugin-oriented editor architecture.
- Strong performance and accessibility positioning.
- Good candidate for a block-first writing interface.

Risks:

- Stage One still needs custom export, slide links, annotations, and schema discipline.
- Collaboration and sync details are not clearly established from the homepage information available.

Decision:

- Do not select for first implementation unless the engineering team has stronger Lexical expertise than ProseMirror/Tiptap expertise.

#### Option C: Slate

Recommendation: **Do not use for Stage One unless custom editor control is the overriding priority**.

Slate is a completely customisable React-based framework with a pluggable `contenteditable` implementation, a nested recursive document model, plugin-first logic, and collaboration can be layered on top according to [Slate documentation](https://docs.slatejs.org/). However, Slate's own docs state that the project is currently in beta and APIs are not finalised, which adds avoidable implementation risk for StudyKit Stage One according to [Slate documentation](https://docs.slatejs.org/).

Advantages:

- Very customisable.
- React-native mental model.
- Good for highly bespoke editors.

Risks:

- Beta status and API churn risk.
- More custom work for complex editor behaviours.
- Higher risk of building editor infrastructure instead of StudyKit.

Decision:

- Do not choose Slate for Stage One unless there is a strong engineering reason.

---

## 4. Architecture overview

### 4.1 Architecture principles

- **Local-first safety**: Users must be able to keep writing during lectures without network access.
- **Structured source of truth**: Store academic objects as structured data, not only HTML, rendered canvas, or PDFs.
- **Overlay model**: Original PDFs remain immutable; annotations, highlights, and notes are stored as separate overlays.
- **Export-first design**: The export pipeline reads structured objects and produces deterministic outputs.
- **Future connector readiness**: The schema includes placeholders for citations and external provider references even though Zotero is not implemented in Stage One.
- **Future plugin readiness**: Block and command models include namespacing and metadata for later plugin-defined features.

### 4.2 Logical components

```text
Client App
  ├─ Module/Lecture Navigator
  ├─ PDF Slide Viewer
  ├─ Structured Note Editor
  ├─ Cornell Cue Panel
  ├─ Annotation Layer
  ├─ Equation Renderer
  ├─ Attachment Manager
  ├─ Local Store
  ├─ Sync Engine
  └─ Export UI

Backend
  ├─ Auth
  ├─ Metadata API
  ├─ File/Object Storage
  ├─ Sync API
  ├─ Export Worker
  └─ Audit/Telemetry
```

### 4.3 Data flow

```text
PDF upload
  → SourceDocument record
  → file storage object
  → SourcePage records
  → slide thumbnails and page metadata

Lecture note edit
  → NoteBlock transaction
  → local operation log
  → local materialised view
  → background sync push
  → cloud operation store
  → other device pull

PDF export
  → select lecture scope
  → resolve SourceDocument, SourcePage, NoteBlock, Annotation records
  → build export intermediate representation
  → render HTML/CSS print layout
  → generate PDF
  → save ExportJob and output file
```

---

## 5. Concrete data model

### 5.1 Identifier rules

- All client-created objects MUST use collision-resistant IDs.
- Suggested format: UUIDv7 or ULID for human-sortable IDs; UUIDv4 is acceptable if implementation simplicity matters more than chronological sorting.
- IDs MUST be generated client-side before sync.
- IDs MUST remain stable across exports and sync.
- Soft-deleted records MUST retain IDs until compaction.

### 5.2 Core tables or collections

The following schema can be implemented in Postgres, SQLite, IndexedDB, or a hybrid local/cloud model. Column types are intentionally conceptual so implementation agents can map them to the selected stack.

#### users

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Auth user ID. |
| email | text | yes | Account email. |
| display_name | text | no | User-visible name. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update time. |

#### workspaces

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Workspace ID. |
| owner_user_id | uuid | yes | Owner. |
| name | text | yes | Usually "My StudyKit". |
| settings_json | json | yes | User preferences. See settings schema note below. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| deleted_at | timestamp | no | Soft delete. |

> **`settings_json` minimum shape for workspaces:**
> ```json
> {
>   "theme": "system",
>   "default_cornell_mode": false,
>   "default_export_template": "slide_left_notes_right"
> }
> ```

#### modules

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Module ID. |
| workspace_id | uuid | yes | Parent workspace. |
| title | text | yes | Example: "PSYC0005 Research Methods". |
| code | text | no | University module code. |
| academic_term | text | no | Example: "2026 Spring". |
| colour | text | no | UI colour token. |
| sort_order | decimal | yes | Fractional index for ordering. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| deleted_at | timestamp | no | Soft delete. |

#### lectures

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Lecture ID. |
| module_id | uuid | yes | Parent module. |
| title | text | yes | Lecture title. |
| lecture_date | date | no | Scheduled or actual date. |
| week_label | text | no | Example: "Week 3". |
| sort_order | decimal | yes | Fractional index. |
| active_source_document_id | uuid | no | Current slide deck. |
| settings_json | json | yes | Layout, Cornell mode, export defaults. See settings schema note below. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| deleted_at | timestamp | no | Soft delete. |

> **`settings_json` minimum shape for lectures:**
> ```json
> {
>   "cornell_mode": false,
>   "layout": "slide_left_notes_right",
>   "export_defaults": {
>     "include_cornell_cues": true,
>     "include_annotations": true,
>     "include_page_numbers": true,
>     "template": "slide_left_notes_right"
>   }
> }
> ```

#### source_documents

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Source document ID. |
| lecture_id | uuid | yes | Parent lecture. |
| type | enum | yes | Stage One: `pdf`. Future: `pptx`, `reading_pdf`, `dataset`. Note: PPTX import is not implemented in Stage One. |
| original_filename | text | yes | Original upload name. |
| storage_key | text | yes | File storage path. |
| mime_type | text | yes | Example: `application/pdf`. |
| file_size_bytes | integer | yes | Upload size. |
| checksum | text | no | Deduplication and integrity. |
| page_count | integer | no | Extracted after processing. |
| processing_status | enum | yes | `pending`, `processing`, `ready`, `failed`. |
| processing_error | text | no | User-facing error if failed. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| deleted_at | timestamp | no | Soft delete. |

#### source_pages

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Source page ID. |
| source_document_id | uuid | yes | Parent document. |
| page_number | integer | yes | 1-indexed page number. |
| width | number | yes | PDF coordinate width. |
| height | number | yes | PDF coordinate height. |
| thumbnail_storage_key | text | no | Optional generated thumbnail. |
| extracted_text | text | no | Optional text extraction for search. |
| layout_json | json | no | Future OCR/text boxes. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |

#### note_blocks

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Stable block ID. |
| lecture_id | uuid | yes | Parent lecture. |
| module_id | uuid | yes | Denormalised for search. **Must be kept consistent with the parent lecture's `module_id`. If a lecture is moved to a different module, all its `note_blocks.module_id` values must be updated in the same transaction. Application code must never set `module_id` independently of the parent lecture.** |
| parent_block_id | uuid | no | For nested structures. |
| linked_source_page_id | uuid | no | Slide-linked note. |
| block_type | enum | yes | `heading`, `paragraph`, `list`, `callout`, `equation`, `image`, `file`, `code`, `cue`, `summary`, `placeholder_citation`. |
| content_json | json | yes | Canonical content payload. |
| render_json | json | no | Optional editor-specific representation. |
| source_links_json | json | yes | Links to slides, attachments, citations, future AI sources. |
| sort_order | decimal | yes | Fractional order within lecture or parent. |
| created_by_device_id | uuid | yes | Local-first traceability. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| version | integer | yes | Incremented on accepted changes. |
| deleted_at | timestamp | no | Soft delete. |

#### annotations

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Annotation ID. |
| lecture_id | uuid | yes | Parent lecture. |
| source_page_id | uuid | yes | Annotated page. |
| annotation_type | enum | yes | `highlight`, `ink`, `shape`, `comment`, `underline`. |
| geometry_json | json | yes | Coordinates in source-page coordinate space. |
| style_json | json | yes | Colour, thickness, opacity, semantic label. |
| text_content | text | no | Comment or OCR fallback. |
| layer | text | yes | Example: `student`, `ai_suggestion`, `teacher`. Stage One default: `student`. |
| created_by_device_id | uuid | yes | Device traceability. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| version | integer | yes | Incremented on change. |
| deleted_at | timestamp | no | Soft delete. |

#### attachments

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Attachment ID. |
| workspace_id | uuid | yes | Parent workspace. |
| module_id | uuid | no | Optional module scope. |
| lecture_id | uuid | no | Optional lecture scope. |
| original_filename | text | yes | User filename. |
| storage_key | text | yes | Storage path. |
| mime_type | text | yes | File type. |
| file_size_bytes | integer | yes | Size. |
| checksum | text | no | Deduplication. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |
| deleted_at | timestamp | no | Soft delete. |

#### block_attachments

| Field | Type | Required | Notes |
|---|---|---|---|
| block_id | uuid | yes | Linked note block. |
| attachment_id | uuid | yes | Linked attachment. |
| role | enum | yes | `embed`, `reference`, `export_asset`. |
| created_at | timestamp | yes | Link creation time. |

#### export_jobs

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Export job ID. |
| workspace_id | uuid | yes | Parent workspace. |
| module_id | uuid | no | Scope. |
| lecture_id | uuid | no | Scope. |
| export_type | enum | yes | Stage One: `pdf`, `markdown`. |
| template_id | text | yes | Export template. |
| status | enum | yes | `queued`, `running`, `succeeded`, `failed`. |
| output_storage_key | text | no | File path if succeeded. |
| report_json | json | yes | Warnings and unsupported blocks. |
| created_at | timestamp | yes | Request time. |
| completed_at | timestamp | no | Completion time. |

> **Export job retention policy**: Succeeded export output files are retained for 30 days from `completed_at`. After 30 days, output files are eligible for cloud storage compaction; the `export_jobs` metadata record is retained indefinitely. Failed and queued records are retained indefinitely for audit. Clients should prompt the user to re-export if a download link has expired.

#### device_clients

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Device/client ID. |
| user_id | uuid | yes | Owner user. |
| label | text | no | Example: "MacBook Safari". |
| last_seen_at | timestamp | no | Last sync event. |
| created_at | timestamp | yes | Creation time. |

#### sync_operations

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | Operation ID. |
| workspace_id | uuid | yes | Scope. |
| device_id | uuid | yes | Origin device. |
| sequence_number | integer | yes | Monotonic per device. |
| target_table | text | yes | Target object type. |
| target_id | uuid | yes | Target object ID. |
| operation_type | enum | yes | `create`, `update`, `delete`, `move`, `merge`, `restore`. |
| patch_json | json | yes | Atomic patch or CRDT update reference. |
| base_version | integer | no | Version seen by origin device. |
| created_at | timestamp | yes | Operation time. |
| applied_at | timestamp | no | Cloud application time. |

#### future_reserved_external_refs

This table should exist in the schema design but can remain unused in Stage One.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | uuid | yes | External reference ID. |
| provider | enum | yes | Future: `zotero`, `obsidian`, `anki`, `github`, `drive`, `overleaf`. |
| provider_object_type | text | yes | Example: `zotero_item`. |
| provider_object_id | text | yes | Remote key or ID. |
| local_object_type | text | yes | Example: `note_block`. |
| local_object_id | uuid | yes | Local object ID. |
| metadata_json | json | yes | Provider-specific metadata. |
| created_at | timestamp | yes | Creation time. |
| updated_at | timestamp | yes | Last update. |

---

## 6. Block model specification

### 6.1 Canonical block envelope

Every `note_blocks.content_json` MUST follow this envelope:

```json
{
  "schema_version": "1.0",
  "type": "paragraph",
  "attrs": {},
  "content": [],
  "plain_text": "",
  "export_hints": {},
  "accessibility": {
    "alt_text": null,
    "semantic_label": null
  }
}
```

### 6.2 Block types

#### heading

```json
{
  "schema_version": "1.0",
  "type": "heading",
  "attrs": { "level": 2 },
  "content": [{ "type": "text", "text": "Working memory models" }],
  "plain_text": "Working memory models",
  "export_hints": { "include_in_outline": true },
  "accessibility": { "semantic_label": "Heading level 2" }
}
```

#### paragraph

```json
{
  "schema_version": "1.0",
  "type": "paragraph",
  "attrs": {},
  "content": [{ "type": "text", "text": "The central executive controls attention..." }],
  "plain_text": "The central executive controls attention...",
  "export_hints": {},
  "accessibility": {}
}
```

#### list

```json
{
  "schema_version": "1.0",
  "type": "list",
  "attrs": {
    "list_style": "bullet",
    "ordered": false
  },
  "content": [
    {
      "type": "list_item",
      "content": [{ "type": "text", "text": "Phonological loop" }]
    },
    {
      "type": "list_item",
      "content": [{ "type": "text", "text": "Visuospatial sketchpad" }]
    },
    {
      "type": "list_item",
      "content": [{ "type": "text", "text": "Central executive" }]
    }
  ],
  "plain_text": "Phonological loop\nVisuospatial sketchpad\nCentral executive",
  "export_hints": { "markdown_list_style": "unordered" },
  "accessibility": { "semantic_label": "Unordered list" }
}
```

For ordered lists, set `"list_style": "decimal"` and `"ordered": true`, and `"markdown_list_style": "ordered"`.

#### cue

```json
{
  "schema_version": "1.0",
  "type": "cue",
  "attrs": {
    "cue_kind": "question",
    "linked_main_block_id": "uuid"
  },
  "content": [{ "type": "text", "text": "What does the phonological loop store?" }],
  "plain_text": "What does the phonological loop store?",
  "export_hints": { "cornell_column": "cue" },
  "accessibility": { "semantic_label": "Cornell cue question" }
}
```

#### equation

```json
{
  "schema_version": "1.0",
  "type": "equation",
  "attrs": {
    "latex": "z = \\frac{x - \\mu}{\\sigma}",
    "display": true,
    "render_status": "valid"
  },
  "content": [],
  "plain_text": "z = (x - mu) / sigma",
  "export_hints": { "latex": "z = \\frac{x - \\mu}{\\sigma}" },
  "accessibility": { "alt_text": "z equals x minus mean divided by standard deviation" }
}
```

#### image

```json
{
  "schema_version": "1.0",
  "type": "image",
  "attrs": {
    "attachment_id": "uuid",
    "caption": "Diagram of Baddeley and Hitch model"
  },
  "content": [],
  "plain_text": "Diagram of Baddeley and Hitch model",
  "export_hints": { "max_width": "100%" },
  "accessibility": { "alt_text": "Diagram showing central executive, phonological loop, and visuospatial sketchpad" }
}
```

#### code

```json
{
  "schema_version": "1.0",
  "type": "code",
  "attrs": {
    "language": "r",
    "executable": false
  },
  "content": [
    { "type": "text", "text": "model <- lm(score ~ condition, data = df)" }
  ],
  "plain_text": "model <- lm(score ~ condition, data = df)",
  "export_hints": { "markdown_fence_language": "r" },
  "accessibility": { "semantic_label": "R code block" }
}
```

### 6.3 Future-compatible fields

Stage One MUST include but does not need to actively use:

- `source_links_json.citations`
- `source_links_json.external_refs`
- `source_links_json.ai_provenance`
- `content_json.export_hints`
- `content_json.accessibility`
- `block_type` namespace support, such as `core/equation` and future `plugin-name/block-name`

---

## 7. Annotation model

### 7.1 Coordinate system

Annotations MUST be stored in source-page coordinates, not viewport pixels. This prevents annotations from drifting when zoom level, screen size, or export layout changes.

### 7.2 Highlight geometry

```json
{
  "coordinate_space": "source_page",
  "page_width": 1280,
  "page_height": 720,
  "rects": [
    { "x": 120, "y": 240, "width": 360, "height": 28 }
  ]
}
```

### 7.3 Ink geometry

```json
{
  "coordinate_space": "source_page",
  "page_width": 1280,
  "page_height": 720,
  "strokes": [
    {
      "points": [
        { "x": 100, "y": 100, "pressure": 0.4, "t": 0 },
        { "x": 104, "y": 102, "pressure": 0.5, "t": 8 }
      ]
    }
  ]
}
```

### 7.4 Semantic highlight labels

Stage One SHOULD include semantic labels for highlight colours:

- Definition.
- Method.
- Finding.
- Limitation.
- Exam point.
- Confusing.
- Important.
- Question.

Colour MUST NOT be the only meaning carrier. Accessibility labels are required because WCAG 2.2 Level AA (the mandatory conformance target for Stage One—see Section 1.2) requires information not to rely only on sensory or visual characteristics. Every annotation must carry its semantic label as a text attribute so that screen readers and export outputs can convey meaning without colour.

---

## 8. Local-first sync design

### 8.1 Sync objective and scope

The user must not lose notes during lectures. Sync is a backup and cross-device feature, not a reason to block typing.

**Stage One sync scope**: Sync supports a single user owning multiple devices (e.g., a laptop used during a lecture and a tablet used for review). Real-time multiplayer collaboration between different users is explicitly out of scope for Stage One. This scope decision has direct implications for sync complexity:

- Concurrent edits to the same note block from two devices owned by the same user must be handled safely (see conflict policy in Section 8.5).
- Operational transform or full CRDT for real-time co-editing is not required.
- The custom operation log (Path B in Section 8.6) is sufficient for Stage One given single-owner multi-device use.

If multi-user real-time collaboration is approved in a future stage, the sync foundation must be revisited at that point.

### 8.2 Local storage

Local persistence MUST store:

- User workspace metadata.
- Active modules and lectures.
- Source document metadata.
- Note blocks.
- Annotations.
- Attachment metadata.
- Pending sync operations.
- Export job metadata.

Large binary files MAY be cached locally where browser storage permits, but the MVP can require re-download of original PDFs if cache eviction occurs. When re-download is required, the app must show a clear indicator and not silently fail.

### 8.3 Operation log

Every user edit SHOULD become a local operation:

```json
{
  "id": "op_uuid",
  "device_id": "device_uuid",
  "sequence_number": 42,
  "target_table": "note_blocks",
  "target_id": "block_uuid",
  "operation_type": "update",
  "patch": [
    { "op": "replace", "path": "/content_json/plain_text", "value": "new text" }
  ],
  "base_version": 7,
  "created_at": "2026-05-13T20:58:00Z"
}
```

### 8.4 Sync phases

1. **Local commit**: Apply edit locally and append operation.
2. **Push**: Send unapplied operations to cloud.
3. **Server validation**: Check permissions, object existence, and base version.
4. **Server apply**: Apply operation or create conflict record.
5. **Pull**: Fetch remote operations not seen by the device.
6. **Materialise**: Update local object view.
7. **Conflict UI**: Show preserved conflicts only when needed.

### 8.5 Conflict policies

| Object type | Conflict policy | Rationale |
|---|---|---|
| Module title | Field-level last-write-wins with history | Low risk and easy to restore. |
| Lecture title | Field-level last-write-wins with history | Low risk. |
| Block text | CRDT or conflict-preserving merge | High-value student content. |
| Block order | Fractional index plus conflict-preserving move log | Prevents order collisions. |
| Annotation creation | Append-only create operations | Usually independent. |
| Annotation geometry edit | Versioned update with conflict preservation | Prevents stroke loss. |
| Attachment delete | Soft delete with confirmation | Prevents file loss. |
| Export template | Manual conflict review | Could affect user outputs. |

### 8.6 CRDT decision

Stage One has two acceptable implementation paths:

- **Path A: Yjs for rich text and selected structured fields**. Yjs is designed as a high-performance CRDT for local-first software and can merge changes without merge conflicts according to [Yjs documentation](https://docs.yjs.dev/).
- **Path B: Custom operation log with conflict-preserving merge**. This is the recommended choice for Stage One given the single-owner multi-device sync scope. It is simpler to implement and audit, and does not carry the overhead of a full CRDT infrastructure. Migration to Yjs or a similar CRDT remains possible if real-time collaboration is approved in a later stage.

Recommendation:

- Use Path B (custom operation log) for Stage One.
- Use Yjs or another CRDT only for rich text blocks if simultaneous multi-device text editing from the same user proves problematic in practice.
- Re-evaluate for real-time collaboration if that feature is approved.

---

## 9. Export pipeline

### 9.1 Export architecture

Stage One export MUST use an intermediate representation rather than directly exporting from editor HTML.

```text
StudyKit objects
  → ExportScope
  → ExportDocument IR
  → Target renderer
  → Output file
  → Export report
```

### 9.2 ExportDocument IR

```json
{
  "schema_version": "1.0",
  "title": "Lecture 3: Working Memory",
  "metadata": {
    "module": "Cognitive Psychology",
    "lecture_date": "2026-02-03"
  },
  "sections": [
    {
      "type": "slide_note_pair",
      "source_page_id": "uuid",
      "slide_render_ref": "storage_or_render_ref",
      "note_blocks": ["block_uuid_1", "block_uuid_2"],
      "cue_blocks": ["block_uuid_3"],
      "annotations": ["annotation_uuid_1"]
    }
  ],
  "warnings": []
}
```

### 9.3 PDF export templates

Stage One MUST support at least two PDF templates:

- **Template A: Slide left, notes right**: Best for lecture review.
- **Template B: Slide top, notes below**: Best for printing and narrow pages.

Stage One SHOULD support:

- Optional Cornell cue column.
- Optional annotation layer inclusion.
- Optional page numbers.
- Module and lecture title header.

### 9.4 Markdown export

Markdown export MUST include:

- Lecture title.
- Module metadata.
- Headings.
- Paragraphs.
- Lists.
- Callouts.
- Equations as LaTeX.
- Code blocks with language fences.
- Image and file references.
- Slide references as text anchors.

Markdown export SHOULD include:

- YAML frontmatter.
- Relative attachment paths.
- Placeholder citation metadata for future Zotero integration.
- Obsidian-compatible wikilinks only in a later export profile.

### 9.5 Future export compatibility

The Stage One export IR should be Pandoc-compatible where possible because Pandoc can convert among Markdown, HTML, DOCX, LaTeX/PDF, Jupyter Notebook, BibTeX, BibLaTeX, CSL JSON, and many other formats according to [Pandoc](https://pandoc.org/). This does not mean Stage One must run Pandoc in production. It means StudyKit should avoid internal structures that cannot later be mapped into Pandoc-friendly documents.

---

## 10. API design

### 10.1 Authentication

Stage One API MUST require authentication for all cloud workspace data.

### 10.2 Suggested endpoints

```text
POST   /api/modules
GET    /api/modules
PATCH  /api/modules/:moduleId
DELETE /api/modules/:moduleId

POST   /api/lectures
GET    /api/modules/:moduleId/lectures
PATCH  /api/lectures/:lectureId
DELETE /api/lectures/:lectureId

POST   /api/lectures/:lectureId/source-documents
GET    /api/source-documents/:documentId
GET    /api/source-documents/:documentId/pages

POST   /api/sync/push
GET    /api/sync/pull?workspaceId=:id&since=:cursor

POST   /api/export-jobs
GET    /api/export-jobs/:jobId
GET    /api/export-jobs/:jobId/download
```

### 10.3 Sync push payload

```json
{
  "workspace_id": "uuid",
  "device_id": "uuid",
  "last_seen_server_cursor": "cursor",
  "operations": []
}
```

### 10.4 Sync pull response

```json
{
  "workspace_id": "uuid",
  "server_cursor": "new_cursor",
  "operations": [],
  "conflicts": []
}
```

---

## 11. Stage One acceptance criteria

### TECH-001: Create module and lecture

- **AC-TECH-001-A**: Given a signed-in user, when the user creates a module, then a module record MUST be created locally and queued for sync.
- **AC-TECH-001-B**: Given a module exists, when the user creates a lecture, then a lecture record MUST be created locally and linked to the module.
- **AC-TECH-001-C**: Given the app reloads offline, then locally created modules and lectures MUST remain visible.

### TECH-002: Import PDF slides

- **AC-TECH-002-A**: Given a user uploads a PDF, then a `source_documents` record MUST be created.
- **AC-TECH-002-B**: Given PDF processing succeeds, then `source_pages` records MUST be created for each page.
- **AC-TECH-002-C**: Given PDF rendering is shown, then the viewer MUST render the selected page using the original source document or cached page data.
- **AC-TECH-002-D**: Given processing fails, then the app MUST show an error and preserve the uploaded-file status.
- **AC-TECH-002-E**: Given a 50-slide PDF is uploaded on a mid-range laptop, then the first slide MUST be visible within 3 seconds of upload completion, meeting the performance NFR in Section 1.2.

### TECH-003: Write structured notes

- **AC-TECH-003-A**: Given the user writes text, then note content MUST be stored as structured block data.
- **AC-TECH-003-B**: Given a slide is selected, then newly created note blocks MUST link to the selected source page.
- **AC-TECH-003-C**: Given the note editor reloads, then block IDs and slide links MUST be preserved.
- **AC-TECH-003-D**: Given the user inserts an equation, then raw LaTeX MUST be stored even if rendering fails.

### TECH-004: Cornell cue notes

- **AC-TECH-004-A**: Given Cornell mode is enabled, then cue blocks MUST be stored as distinct `note_blocks`.
- **AC-TECH-004-B**: Given a cue block is linked to a main block, then the link MUST survive reload, sync, and export.
- **AC-TECH-004-C**: Given Cornell mode is disabled, then cue blocks MUST remain in storage.

### TECH-005: Slide annotations

- **AC-TECH-005-A**: Given a highlight is created, then geometry MUST be stored in source-page coordinates.
- **AC-TECH-005-B**: Given zoom changes, then the highlight MUST remain aligned with the source content.
- **AC-TECH-005-C**: Given an ink annotation is created, then the stroke data MUST be stored without modifying the original PDF.
- **AC-TECH-005-D**: Given an annotation is deleted, then it MUST be soft-deleted before permanent compaction.
- **AC-TECH-005-E**: Given the user creates an annotation, then the user MUST be able to undo the action with a standard undo gesture (Ctrl+Z / Cmd+Z), removing the annotation from the local view without permanent deletion.
- **AC-TECH-005-F**: Given the user has undone an annotation, then the user MUST be able to redo the action (Ctrl+Shift+Z / Cmd+Shift+Z), restoring the annotation.
- **AC-TECH-005-G**: Given the user modifies an annotation (e.g., moves a highlight), then undo MUST restore the previous geometry.
- **AC-TECH-005-H**: Given the undo/redo stack, then it MUST be local and session-scoped; undo history does not need to survive app reload in Stage One.

### TECH-006: Local autosave

- **AC-TECH-006-A**: Given the user types while offline, then the edit MUST be committed to local storage within 500 ms of the keystroke.
- **AC-TECH-006-B**: Given the browser closes after local commit, then the note MUST be recoverable on reopening.
- **AC-TECH-006-C**: Given local storage fails, then the system MUST show an urgent error.

### TECH-007: Cloud sync

- **AC-TECH-007-A**: Given pending local operations exist and network is available, then the client MUST push operations to the server within 30 seconds of network restoration.
- **AC-TECH-007-B**: Given remote operations exist, then the client MUST pull and apply them.
- **AC-TECH-007-C**: Given an unsafe conflict occurs, then the system MUST preserve both versions and never silently overwrite either.
- **AC-TECH-007-D**: Given sync fails, then the system MUST keep pending operations queued.

### TECH-008: PDF export

- **AC-TECH-008-A**: Given a lecture has slides and notes, then the user MUST be able to export a PDF.
- **AC-TECH-008-B**: Given Cornell cues exist, then the selected PDF template MUST include or intentionally omit them according to user settings.
- **AC-TECH-008-C**: Given annotations are included, then exported annotations MUST align with slide rendering.
- **AC-TECH-008-D**: Given export has unsupported content, then the export report MUST show warnings.
- **AC-TECH-008-E**: Given a 40-slide deck with 20 annotations, then the export MUST complete within 30 seconds, meeting the performance NFR in Section 1.2.
- **AC-TECH-008-F**: Given an export output file was generated more than 30 days ago, then the download link MUST show an expiry notice and prompt the user to re-export, consistent with the retention policy in Section 5.2.

### TECH-009: Markdown export

- **AC-TECH-009-A**: Given a lecture has note blocks, then Markdown export MUST preserve text hierarchy.
- **AC-TECH-009-B**: Given equations exist, then Markdown export MUST preserve LaTeX source.
- **AC-TECH-009-C**: Given code blocks exist, then Markdown export MUST preserve language fences.
- **AC-TECH-009-D**: Given attachments exist, then Markdown export MUST include references or warnings.

### TECH-010: Future compatibility

- **AC-TECH-010-A**: Given the schema is implemented, then it MUST include reserved external reference support for future Zotero and connectors.
- **AC-TECH-010-B**: Given block types are implemented, then block names MUST support namespacing for future plugin blocks.
- **AC-TECH-010-C**: Given export IR is implemented, then it MUST not depend on editor-specific DOM as the only source.

### TECH-011: Accessibility

- **AC-TECH-011-A**: Given any note editor UI component, then it MUST meet WCAG 2.2 Level AA for keyboard navigation, focus management, and colour contrast.
- **AC-TECH-011-B**: Given the PDF slide viewer and annotation layer, then a keyboard-accessible alternative workflow MUST exist for all annotation actions (create highlight, delete annotation); partial canvas accessibility must be documented if full WCAG AA conformance is not achievable in Stage One.
- **AC-TECH-011-C**: Given any export output (PDF or Markdown), then the output MUST be readable without relying solely on colour (all annotations include semantic labels per Section 7.4).
- **AC-TECH-011-D**: Given reduced-motion system preference is active, then all animations MUST be disabled or reduced per WCAG 2.2 SC 2.3.3 (AAA referenced as a target; AA compliance is mandatory).

---

## 12. Implementation milestones

### Milestone 0: Technical spike

Purpose: Validate hardest technical assumptions before building product UI. This milestone now also includes a PDF export renderer spike, as poor export quality would invalidate the Milestone 6 acceptance criteria.

Deliverables:

- Render a sample lecture PDF using PDF.js.
- Create a Tiptap editor with heading, paragraph, list, equation, image placeholder, and code block nodes.
- Store and restore note blocks from local IndexedDB or equivalent local store.
- Draw a highlight overlay on a PDF page using source-page coordinates.
- Implement and test annotation undo/redo for the highlight tool.
- **Export spike**: Produce a sample slide-plus-note PDF using the browser print pipeline. If the output quality is unacceptable (e.g., slides clip across pages, layout breaks), evaluate Playwright server-side rendering as an alternative and record a go/no-go decision before Milestone 1 begins.

Exit criteria:

- Annotation alignment survives zoom at 50%, 100%, and 150%.
- Note blocks survive browser reload.
- Undo/redo of a highlight annotation works correctly in the local session.
- **Export spike pass/fail decision is documented**: either "browser print pipeline is acceptable" or "Playwright (or alternative) is required, DEC-005 updated."
- Export output (whichever renderer) renders both PDF templates correctly in Chrome and Firefox.
- Engineering team confirms chosen editor framework is feasible.

### Milestone 1: Core workspace

Deliverables:

- Auth.
- Workspace.
- Modules.
- Lectures.
- Local device ID.
- Local-first object creation.

Exit criteria:

- User can create modules and lectures online or offline.
- Objects sync when online.

### Milestone 2: Slide import and viewer

Deliverables:

- PDF upload.
- Source document records.
- Source page records.
- Page viewer.
- Thumbnail navigation.

Exit criteria:

- User can import a PDF and navigate slides.
- First page of a 50-slide PDF is visible within 3 seconds on the target hardware profile.

### Milestone 3: Structured note editor

Deliverables:

- Tiptap editor integration.
- Block persistence.
- Slide-linked blocks.
- Cornell cue blocks.
- Equation rendering.
- Attachment placeholder blocks.
- List block (ordered and unordered).

Exit criteria:

- User can take a lecture note beside slides.
- Blocks persist, reload, and remain linked to slides.
- `module_id` consistency rule enforced for all `note_blocks` created or moved.

### Milestone 4: Annotation layer

Deliverables:

- Highlight tool.
- Basic ink tool.
- Annotation storage.
- Annotation rendering at different zoom levels.
- Annotation undo/redo (session-scoped).

Exit criteria:

- User can highlight and draw on slides.
- Annotation overlays export correctly.
- Undo/redo of annotations works for the current session.

### Milestone 5: Sync foundation

Deliverables:

- Operation log.
- Push/pull sync.
- Conflict preservation.
- Sync status UI.

Exit criteria:

- Offline edits sync after reconnect within 30 seconds.
- Unsafe conflicts are preserved, not overwritten.

### Milestone 6: Export

Deliverables:

- Export IR.
- PDF template A.
- PDF template B.
- Markdown export.
- Export report.
- Export job retention and expiry notice.

Exit criteria:

- User can export a lecture to PDF and Markdown.
- Unsupported content is reported.
- A 40-slide deck with 20 annotations exports in under 30 seconds.
- Both PDF templates render correctly in Chrome and Firefox (consistent with the Milestone 0 export spike decision).

---

## 13. Testing strategy

### Unit tests

- Block schema validation.
- Export IR generation.
- Markdown conversion.
- Annotation coordinate transforms.
- Sync operation validation.
- Soft delete behaviour.
- `note_blocks.module_id` consistency on lecture move.
- Annotation undo/redo state machine.
- `lectures.settings_json` schema validation.

### Integration tests

- PDF upload to slide viewer.
- Slide-linked note creation.
- Offline edit to sync push.
- Remote update to sync pull.
- PDF export with annotations.
- Markdown export with equations and code.

### End-to-end tests

User journey:

1. Create module.
2. Create lecture.
3. Upload PDF.
4. Navigate to slide 3.
5. Add notes and cue.
6. Add equation.
7. Highlight slide.
8. Undo the highlight; verify it is removed.
9. Redo the highlight; verify it is restored.
10. Go offline.
11. Add more notes.
12. Reload app.
13. Go online.
14. Sync.
15. Export PDF and Markdown.

### Performance tests

Performance tests must be automated where possible and run as part of the CI pipeline for Milestones 2, 3, and 6.

| Test | Fixture | Pass threshold |
|------|---------|----------------|
| PDF first-page render | 50-slide PDF, mid-range hardware profile | ≤ 3 seconds |
| Autosave commit | 100 rapid keystrokes | Every commit ≤ 500 ms |
| PDF export | 40-slide deck, 20 annotations | ≤ 30 seconds |
| Markdown export | Any lecture | ≤ 5 seconds |
| App cold start | Standard workspace with 3 modules | ≤ 4 seconds |

### Accessibility audits

- Run automated WCAG 2.2 AA audit (e.g., axe-core) on every major UI component before milestone sign-off.
- Include manual keyboard-navigation review for the note editor, slide viewer, and annotation tools.
- Test with VoiceOver (macOS Safari) and NVDA (Windows Chrome) before Stage One release.
- Document any known partial-conformance gaps for the PDF canvas annotation layer, with a remediation plan for Stage Two.

### Manual QA

- Test with large slide decks (100+ pages).
- Test with scanned PDFs (image-only, no text layer).
- Test annotation alignment at 50%, 100%, 150%, and 200% zoom.
- Test keyboard-only navigation.
- Test reduced-motion and high-contrast modes.
- Test print readability.

---

## 14. Technical risks and mitigations

### Risk: Editor complexity

- **Issue**: Custom academic blocks may be hard to maintain.
- **Mitigation**: Start with a small block set and document every block schema.
- **Fallback**: Use plain Markdown-style blocks for MVP if rich editor customisation becomes too slow.

### Risk: Annotation drift

- **Issue**: Highlights and ink may misalign after zoom, export, or page resizing.
- **Mitigation**: Store coordinates in source-page coordinate space. Verify alignment at multiple zoom levels in Milestone 0.
- **Fallback**: Disable freehand ink export until coordinate reliability is proven.

### Risk: Sync data loss

- **Issue**: Incorrect cloud sync could overwrite lecture notes.
- **Mitigation**: Local operation log, soft deletion, conflict preservation, and no destructive overwrites.
- **Fallback**: Limit Stage One sync to backup and single-device restore until multi-device sync is proven safe.

### Risk: PDF export quality

- **Issue**: Export may look worse than expected.
- **Mitigation**: Spike PDF export renderer in Milestone 0 with a pass/fail decision. Build export templates early and test with real lecture slides.
- **Fallback**: Offer Markdown export and printable browser preview while PDF rendering matures. If browser print pipeline fails the Milestone 0 spike, switch to server-side Playwright before Milestone 1.

### Risk: Browser storage limits

- **Issue**: Large PDFs and attachments may exceed local storage quotas.
- **Mitigation**: Store metadata and notes locally first; cache large files opportunistically. Prompt user when storage approaches the 100 MB budget threshold.
- **Fallback**: Re-download large source files from cloud when needed.

### Risk: Accessibility regression

- **Issue**: Rich editor, PDF canvas, and annotation tools can be inaccessible.
- **Mitigation**: Run axe-core automated audit at each milestone. Provide keyboard alternatives, semantic note structure, focus modes, and text exports. Target WCAG 2.2 AA throughout.
- **Fallback**: Ensure Markdown export remains accessible even if canvas annotation is not fully accessible. Document any gaps and schedule remediation for Stage Two.

### Risk: `note_blocks.module_id` drift

- **Issue**: If a lecture is moved to a different module, denormalised `module_id` values on existing note blocks could become stale, causing incorrect search results.
- **Mitigation**: Enforce a transactional update rule: any operation that changes `lectures.module_id` must atomically update all associated `note_blocks.module_id` values. Add a unit test and an integration test for this case. Add an integrity check in the sync server that validates `note_blocks.module_id` consistency on push.

---

## 15. Implementation decisions

### 15.1 Decisions to make before coding

- **DEC-001**: Select Tiptap, Lexical, or other editor framework.
- **DEC-002**: Select local store: IndexedDB wrapper, SQLite-in-browser, RxDB, Replicache, or custom.
- **DEC-003**: Select sync approach: custom operation log, Yjs, or hybrid.
- **DEC-004**: Select backend: Supabase/Postgres, custom Postgres API, or other.
- **DEC-005**: Select PDF export renderer: browser print pipeline, server-side Playwright, WeasyPrint, or PDF library. **This decision MUST be made at Milestone 0 based on the export spike results. It cannot be deferred to Milestone 6.**
- **DEC-006**: Select file storage strategy for original PDFs and exports.

### 15.2 Recommended initial decisions

- **DEC-001 Recommendation**: Use Tiptap/ProseMirror.
- **DEC-002 Recommendation**: Use IndexedDB through a typed wrapper for local metadata and operations.
- **DEC-003 Recommendation**: Start with custom operation log (Path B); isolate rich text sync so Yjs can be introduced later if needed.
- **DEC-004 Recommendation**: Use Supabase for auth, Postgres, file storage, and realtime.
- **DEC-005 Recommendation**: Evaluate browser print pipeline first in Milestone 0. Switch to server-side Playwright if the spike result is unacceptable.
- **DEC-006 Recommendation**: Use Supabase Storage for source PDFs and export outputs; use IndexedDB for local metadata cache.

---

## 16. Future stages (reference only)

The following are not commitments. They are listed to confirm Stage One architecture does not accidentally block them.

- **Stage Two**: Zotero connector, citation block rendering, Obsidian-compatible export profile, full flashcard scheduler, annotation search and filtering.
- **Stage Three**: AI study guide generation (flashcards, summaries, practice questions) with AI provenance tracking via `source_links_json.ai_provenance`.
- **Stage Four**: Plugin marketplace, third-party block types via `plugin-name/block-name` namespacing, LMS integration.
- **Stage Five**: Real-time multiplayer collaboration, shared module workspaces, teacher annotation layer.
- **Future**: Computational notebook export (Jupyter), native mobile apps, full mind map editor.

