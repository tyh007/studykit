# Literature AI Research Canvas Agent Implementation Plan

## Objective

Refactor the current Literature Graph into a Freeform-like AI research canvas for literature work.

The target product is not a generic whiteboard clone. It is a literature-specialized canvas where papers, PDFs, AI summaries, research questions, notes, and paper relationships are first-class objects.

The implementation must preserve the existing Literature Library, Reading Lists, PDF upload, PDF preview, AI summary, AI chat, paper notes, and paper relations features while adding a new canvas layer around them.

## Product Definition

Build a project-level `Literature Canvas` with these core behaviors:

- Users can drag PDF papers onto an infinite canvas.
- Uploaded PDFs become paper cards on the canvas.
- Clicking a paper card opens a right-side PDF preview drawer.
- Users can run the existing AI summary flow from a paper card.
- Users can ask AI about one selected paper or multiple selected papers.
- AI answers can be inserted as nearby canvas notes.
- Users can freely add text boxes, notes, question cards, and group frames.
- Users can connect papers to papers with semantic relation edges.
- Paper-to-paper relation edges sync to the existing `paper_relations` table.
- Canvas-only edges can connect notes, questions, and papers without polluting `paper_relations`.
- All node positions, sizes, edges, styles, and viewport state persist.

## Current Codebase Context

Relevant existing files:

- `frontend/src/App.tsx`
  - Literature mode currently has tabs: `papers`, `readingLists`, `graph`.
  - `graph` currently renders `PaperRelationsGraph`.
- `frontend/src/components/literature/SummaryTable.tsx`
  - Existing PDF upload UI.
  - Existing batch/single AI extraction flow.
  - Existing paper table.
- `frontend/src/hooks/useLiteratureFileUpload.ts`
  - Existing PDF upload hook.
  - Calls `/api/literature/papers/upload`.
- `frontend/src/components/literature/PaperWorkspace.tsx`
  - Existing single-paper workspace with PDF, summary, notes, relations, AI.
- `frontend/src/components/literature/LiteraturePDFViewer.tsx`
  - Existing PDF viewer to reuse inside the canvas preview drawer.
- `frontend/src/components/literature/AIChatPanel.tsx`
  - Existing AI chat panel that supports `paper` and `paperIds`.
- `frontend/src/lib/literature-api.ts`
  - Existing literature API client.
- `backend/routes/literature-papers.js`
  - Existing paper CRUD and PDF upload.
- `backend/routes/literature-ai.js`
  - Existing AI profile, extraction, vision extraction, and chat endpoints.
- `backend/routes/paper-relations.js`
  - Existing semantic relations between papers.
- `backend/routes/paper-notes.js`
  - Existing notes for papers.
- `backend/schema.sql`
  - Existing literature schema.

Important implementation note:

- In `backend/routes/literature-papers.js`, `router.post('/upload')` is currently declared after `router.get('/:id')` and `router.patch('/:id')`.
- Express route matching can treat `upload` as an `:id` path for some methods if route order is not handled carefully.
- When working on upload behavior, move the upload route above `/:id` routes or otherwise verify the current route works end-to-end.

## Recommended Library

Use `@xyflow/react` for the canvas.

Reasons:

- It already supports nodes, edges, dragging, zooming, panning, custom nodes, custom edges, selection, handles, mini-map, controls, and viewport persistence.
- It has whiteboard examples for rectangles, drawing-like interaction, and save/restore.
- It is a better fit than hand-writing SVG or canvas interaction code.

Add dependency:

```bash
cd frontend
npm install @xyflow/react
```

If dependency installation fails because of network restrictions, request escalation and retry.

## Architecture

Add a new `Canvas` tab beside the existing literature tabs.

Initial tab structure:

```ts
type LiteratureTab = 'papers' | 'readingLists' | 'canvas';
```

Do not delete `SummaryTable`, `ReadingListsView`, or `PaperWorkspace` during the first implementation phase.

The new canvas should coexist with the existing table and workspace until it is stable.

## Data Model

Add these tables to `backend/schema.sql`.

```sql
CREATE TABLE IF NOT EXISTS literature_canvases (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES literature_projects(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Canvas',
  viewport_json JSONB NOT NULL DEFAULT '{}',
  settings_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lit_canvases_project
  ON literature_canvases(project_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS literature_canvas_nodes (
  id           UUID PRIMARY KEY,
  canvas_id    UUID NOT NULL REFERENCES literature_canvases(id) ON DELETE CASCADE,
  node_type    TEXT NOT NULL
               CHECK (node_type IN ('paper','note','text','question','group','shape')),
  ref_type     TEXT,
  ref_id       UUID,
  x            DOUBLE PRECISION NOT NULL,
  y            DOUBLE PRECISION NOT NULL,
  width        DOUBLE PRECISION NOT NULL DEFAULT 260,
  height       DOUBLE PRECISION NOT NULL DEFAULT 160,
  z_index      INTEGER NOT NULL DEFAULT 0,
  content_json JSONB NOT NULL DEFAULT '{}',
  style_json   JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lit_canvas_nodes_canvas
  ON literature_canvas_nodes(canvas_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lit_canvas_nodes_ref
  ON literature_canvas_nodes(ref_type, ref_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS literature_canvas_edges (
  id             UUID PRIMARY KEY,
  canvas_id      UUID NOT NULL REFERENCES literature_canvases(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES literature_canvas_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES literature_canvas_nodes(id) ON DELETE CASCADE,
  relation_id    UUID REFERENCES paper_relations(id) ON DELETE SET NULL,
  edge_type      TEXT NOT NULL DEFAULT 'canvas'
                 CHECK (edge_type IN ('canvas','paper_relation')),
  label          TEXT,
  content_json   JSONB NOT NULL DEFAULT '{}',
  style_json     JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lit_canvas_edges_canvas
  ON literature_canvas_edges(canvas_id) WHERE deleted_at IS NULL;
```

Data ownership rules:

- Paper metadata remains in `literature_papers`.
- AI summary remains in `literature_papers.extracted_data`.
- Canonical paper relations remain in `paper_relations`.
- Canvas node position, size, style, and canvas-only content live in `literature_canvas_nodes`.
- Canvas edge position/style/label and note/question links live in `literature_canvas_edges`.
- A paper node points to a paper by `ref_type='paper'` and `ref_id=<paper_id>`.

## Backend API

Create:

- `backend/routes/literature-canvas.js`

Mount in `backend/index.js`:

```js
const literatureCanvasRoutes = require('./routes/literature-canvas');
app.use('/api/literature/canvas', authenticateToken, literatureCanvasRoutes);
```

Add API endpoints:

### List Or Create Default Canvas

`GET /api/literature/canvas?projectId=:projectId`

Behavior:

- Verify the project belongs to the current user's workspace.
- Return existing non-deleted canvases for the project.
- If no canvas exists, create one default canvas and return it.

### Get Canvas State

`GET /api/literature/canvas/:canvasId/state`

Return:

```ts
{
  canvas: LiteratureCanvas;
  nodes: LiteratureCanvasNode[];
  edges: LiteratureCanvasEdge[];
  papers: LiteraturePaper[];
}
```

Rules:

- Include paper rows referenced by paper nodes.
- Include only non-deleted nodes and edges.
- Keep paper full text out of the default response to avoid huge payloads.
- Include fields needed for cards: `id`, `title`, `file_name`, `authors`, `year`, `journal`, `abstract`, `extracted_data`, `reading_status`, `importance`, `processing_status`, `storage_key`, `error_message`.

### Save Viewport

`PATCH /api/literature/canvas/:canvasId/viewport`

Body:

```ts
{
  viewport: { x: number; y: number; zoom: number }
}
```

### Create Node

`POST /api/literature/canvas/:canvasId/nodes`

Body:

```ts
{
  node_type: 'paper' | 'note' | 'text' | 'question' | 'group' | 'shape';
  ref_type?: string;
  ref_id?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z_index?: number;
  content_json?: Record<string, unknown>;
  style_json?: Record<string, unknown>;
}
```

### Update Node

`PATCH /api/literature/canvas/:canvasId/nodes/:nodeId`

Allow partial updates:

- `x`
- `y`
- `width`
- `height`
- `z_index`
- `content_json`
- `style_json`

### Delete Node

`DELETE /api/literature/canvas/:canvasId/nodes/:nodeId`

Soft-delete the node and soft-delete connected canvas edges.

Do not delete the referenced paper.

### Create Edge

`POST /api/literature/canvas/:canvasId/edges`

Body:

```ts
{
  source_node_id: string;
  target_node_id: string;
  edge_type: 'canvas' | 'paper_relation';
  relation_type?: 'cites' | 'extends' | 'contradicts' | 'supports' | 'related' | 'method' | 'dataset';
  label?: string;
  content_json?: Record<string, unknown>;
  style_json?: Record<string, unknown>;
}
```

Behavior:

- If `edge_type === 'paper_relation'`, both source and target nodes must be `paper` nodes.
- Create or update a row in `paper_relations`.
- Save returned `paper_relations.id` into `literature_canvas_edges.relation_id`.
- If `edge_type === 'canvas'`, only create the canvas edge.

### Update Edge

`PATCH /api/literature/canvas/:canvasId/edges/:edgeId`

Allow:

- `label`
- `content_json`
- `style_json`

For `paper_relation` edges, updating semantic relation type can be a later phase.

### Delete Edge

`DELETE /api/literature/canvas/:canvasId/edges/:edgeId`

Soft-delete canvas edge.

Do not delete `paper_relations` in phase one. The relation may still be used elsewhere.

### Import Papers Into Canvas

`POST /api/literature/canvas/:canvasId/import-papers`

Body:

```ts
{
  paperIds: string[];
  origin?: { x: number; y: number };
}
```

Behavior:

- Create paper nodes for papers not already on the canvas.
- Place them in a compact grid around `origin`.
- Return created nodes.

## Frontend Types

Add to `frontend/src/types.ts`:

```ts
export interface LiteratureCanvas {
  id: string;
  project_id: string;
  workspace_id: string;
  title: string;
  viewport_json: { x?: number; y?: number; zoom?: number };
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type LiteratureCanvasNodeType = 'paper' | 'note' | 'text' | 'question' | 'group' | 'shape';

export interface LiteratureCanvasNode {
  id: string;
  canvas_id: string;
  node_type: LiteratureCanvasNodeType;
  ref_type?: string | null;
  ref_id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  content_json: Record<string, any>;
  style_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface LiteratureCanvasEdge {
  id: string;
  canvas_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_id?: string | null;
  edge_type: 'canvas' | 'paper_relation';
  label?: string | null;
  content_json: Record<string, any>;
  style_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}
```

## Frontend API Client

Create:

- `frontend/src/lib/literature-canvas-api.ts`

Export:

```ts
export const literatureCanvasApi = {
  listOrCreate(projectId: string),
  state(canvasId: string),
  updateViewport(canvasId: string, viewport: { x: number; y: number; zoom: number }),
  createNode(canvasId: string, data: CreateCanvasNodeInput),
  updateNode(canvasId: string, nodeId: string, data: UpdateCanvasNodeInput),
  deleteNode(canvasId: string, nodeId: string),
  createEdge(canvasId: string, data: CreateCanvasEdgeInput),
  updateEdge(canvasId: string, edgeId: string, data: UpdateCanvasEdgeInput),
  deleteEdge(canvasId: string, edgeId: string),
  importPapers(canvasId: string, paperIds: string[], origin?: { x: number; y: number }),
};
```

Use the same auth/header pattern as `frontend/src/lib/literature-api.ts`.

## Frontend Component Tree

Create directory:

- `frontend/src/components/literature/canvas/`

Files:

- `LiteratureCanvas.tsx`
- `CanvasToolbar.tsx`
- `CanvasStatusBar.tsx`
- `PaperNode.tsx`
- `NoteNode.tsx`
- `TextNode.tsx`
- `QuestionNode.tsx`
- `GroupNode.tsx`
- `RelationEdge.tsx`
- `PaperPreviewDrawer.tsx`
- `CanvasAIAssistant.tsx`
- `RelationTypeMenu.tsx`
- `useLiteratureCanvas.ts`
- `canvas-types.ts`
- `canvas-utils.ts`

Add CSS:

- Either `frontend/src/components/literature/canvas/literature-canvas.css`
- Or extend `frontend/src/index.css` if the project currently centralizes styles there.

Import React Flow styles once:

```ts
import '@xyflow/react/dist/style.css';
```

Prefer importing this in `LiteratureCanvas.tsx` or global CSS. Verify it does not break existing styling.

## Canvas State Hook

`useLiteratureCanvas(projectId: string)` responsibilities:

- Load or create default canvas.
- Load canvas state.
- Convert backend nodes to React Flow nodes.
- Convert backend edges to React Flow edges.
- Keep a `papersById` map.
- Provide actions:
  - `createPaperNode`
  - `createNoteNode`
  - `createTextNode`
  - `createQuestionNode`
  - `updateNodeContent`
  - `updateNodePosition`
  - `deleteNode`
  - `createEdge`
  - `deleteEdge`
  - `runSummary`
  - `askAIForSelection`
  - `insertAIAnswerAsNode`

Persistence rules:

- During drag, update local React Flow state only.
- On drag stop, PATCH node position.
- During resize, update local state only.
- On resize stop, PATCH node width/height.
- During text edit, update local state immediately.
- Debounce PATCH content by 500-800ms.
- On canvas move, debounce viewport save by 1000ms.

## React Flow Node Mapping

Backend node to React Flow node:

```ts
{
  id: node.id,
  type: node.node_type,
  position: { x: node.x, y: node.y },
  width: node.width,
  height: node.height,
  zIndex: node.z_index,
  data: {
    canvasNode: node,
    paper: node.ref_type === 'paper' ? papersById[node.ref_id] : undefined,
    actions,
  },
}
```

Backend edge to React Flow edge:

```ts
{
  id: edge.id,
  type: 'relation',
  source: edge.source_node_id,
  target: edge.target_node_id,
  label: edge.label,
  data: { canvasEdge: edge, actions },
}
```

## Node UX Requirements

### Paper Node

Display:

- Title or file name.
- Authors/year if available.
- Reading status.
- Importance stars or compact indicator.
- Summary status:
  - `No summary`
  - `Summarizing`
  - `Summarized`
  - `Summary failed`

Actions:

- Open PDF.
- Run summary.
- Ask AI.
- Create note.
- Remove from canvas.

Interaction:

- Single click selects.
- Double click opens PDF preview drawer.
- Drag moves card.
- Connection handles should be visible on hover or when selected.

### Note Node

Display:

- Editable body.
- Small source chips if linked to papers.

Actions:

- Ask AI from this note.
- Convert to question card.
- Delete.

Editing:

- Phase one: textarea/contenteditable.
- Phase two: Tiptap editor.

### Text Node

Lightweight free text.

Behavior:

- Double click to edit.
- `/ai` command opens local AI assistant menu.

### Question Node

Display:

- Prompt/question.
- AI answer.
- Source paper chips.

Actions:

- Regenerate.
- Insert as note.
- Open source paper.

### Group Node

Freeform frame for clustering papers and notes.

Phase one:

- Visual frame only.
- Does not need nested node behavior.

Phase two:

- Parent/child grouping with React Flow subflows.

## PDF Preview Drawer

Create `PaperPreviewDrawer.tsx`.

Use:

- `LiteraturePDFViewer`
- Existing paper summary fields
- Existing `paperNotesApi`
- Existing `literatureAiApi.chat`

Drawer layout:

- Header with paper title and close button.
- Main PDF viewer.
- Tabs or segmented control:
  - PDF
  - Summary
  - Notes
  - Ask

Behavior:

- Opens when paper node is double clicked or PDF action is clicked.
- Drawer width is resizable and persisted in localStorage.
- Does not navigate away from the canvas.
- Avoid loading PDF until drawer opens.

## AI Behavior

Reuse current AI systems.

### Summary

Use existing extraction flow:

- `createAIExtractionService`
- `smartExtract`
- `literaturePapersApi.update`

Keep result format compatible with current summary table:

- `background`
- `theory`
- `methodology`
- `measures`
- `results`
- `implications`
- `limitations`
- Custom fields if available in future phase.

After summary:

- Update local paper cache.
- Update paper node status.
- Offer `Create summary note`.

### Ask AI About Selection

Selection cases:

- One paper selected: call `literatureAiApi.chat({ paperId })`.
- Multiple papers selected: call `literatureAiApi.chat({ paperIds })`.
- Note/text selected with linked paper IDs: include linked `paperIds`.
- No paper selected: use generic research assistant context.

Output options:

- Insert answer as `question` node near selected nodes.
- Insert answer as `note` node.
- Copy answer into active text node only if user explicitly chooses.

Never overwrite user-authored text by default.

### AI Assistant Entry Points

Add AI entry points:

- Floating toolbar button.
- Paper node action.
- Note node action.
- Text node `/ai` command.
- Selection toolbar action.

Suggested prompt shortcuts:

- Summarize selected papers.
- Compare selected papers.
- Find literature gap.
- Suggest relation between selected papers.
- Generate research questions.
- Extract methodology differences.
- Turn this into a literature review paragraph.
- Make a concise note from this answer.

## Relationship Behavior

When connecting nodes:

### Paper To Paper

Show `RelationTypeMenu`.

Options:

- Cites
- Extends
- Contradicts
- Supports
- Related
- Same Method
- Same Dataset

Then:

- Create or update `paper_relations`.
- Create `literature_canvas_edges` with `edge_type='paper_relation'`.

### Other Connections

For note/text/question/group connections:

- Create `literature_canvas_edges` with `edge_type='canvas'`.
- Default label can be blank.
- Allow label editing later.

## App Integration

Modify `frontend/src/App.tsx`.

Current:

```tsx
{(['papers', 'readingLists', 'graph'] as const).map(...)}
```

Target:

```tsx
{(['papers', 'readingLists', 'canvas'] as const).map(...)}
```

Render:

```tsx
{activeLiteratureTab === 'canvas' && (
  <LiteratureCanvas projectId={selectedLitProjectId} />
)}
```

Keep old `PaperRelationsGraph` import until removed cleanly. Do not delete tests in the first pass.

Update Zustand store type if `activeLiteratureTab` is typed elsewhere.

Search for:

```bash
rg "activeLiteratureTab|graph'|\"graph\"" frontend/src
```

Update all necessary types and labels.

## Styling Direction

Canvas should feel quiet, fast, and study-focused.

Avoid:

- Marketing-style hero layouts.
- Big decorative gradients.
- Card-inside-card layouts.
- Overly rounded pill-heavy UI.

Use:

- Subtle grid background.
- Compact top-left toolbar.
- Small icon buttons.
- Selected item toolbar.
- Right-side drawer.
- Muted semantic edge colors.

Suggested colors:

- Paper nodes: white / neutral surface.
- Notes: soft yellow or neutral.
- Question nodes: soft blue.
- Contradiction edges: red.
- Support edges: green.
- Method/data edges: amber/cyan.

## Implementation Phases

### Phase 0: Safety And Setup

Tasks:

- Run typecheck and tests to capture baseline.
- Install `@xyflow/react`.
- Add canvas schema.
- Add canvas API route.
- Add frontend API client.

Verification:

```bash
cd frontend
npm run typecheck
npm test
```

```bash
cd backend
npm test
```

### Phase 1: Minimal Persistent Canvas

Tasks:

- Add `canvas` literature tab.
- Render React Flow with empty state.
- Load or create default canvas.
- Persist viewport.
- Add manual text/note nodes.
- Move nodes and persist positions.

Acceptance:

- Open a project and switch to Canvas.
- Add text node.
- Move it.
- Refresh page.
- Node and viewport restore.

### Phase 2: Paper Nodes

Tasks:

- Import project papers into canvas.
- Render `PaperNode`.
- Open PDF drawer from paper node.
- Remove paper node from canvas without deleting paper.

Acceptance:

- Existing papers can appear on canvas.
- Paper node opens PDF drawer.
- Removing a paper node does not remove it from `SummaryTable`.

### Phase 3: PDF Drop Upload

Tasks:

- Support dragging PDFs onto canvas.
- Reuse `useLiteratureFileUpload` or extract upload function into a reusable API helper.
- Create paper node at drop position after upload.
- Show upload progress state on the canvas.
- Fix backend upload route order if needed.

Acceptance:

- Drop one PDF on canvas.
- Paper record is created.
- Paper node appears near drop location.
- PDF drawer can open the uploaded paper.

### Phase 4: Summary Integration

Tasks:

- Add summary action to paper node.
- Reuse existing summary extraction logic.
- Update `literature_papers.extracted_data`.
- Show summarized state on card.
- Add `Create summary note` action.

Acceptance:

- Click Summary on a paper node.
- Existing AI summary format is produced.
- Summary appears in both canvas and existing table/workspace.
- Summary note can be inserted beside paper.

### Phase 5: Relations

Tasks:

- Add handles to paper nodes.
- Connect paper to paper.
- Show relation type menu.
- Persist semantic relation to `paper_relations`.
- Persist visual edge to `literature_canvas_edges`.
- Render colored relation edge.

Acceptance:

- Draw edge between two paper cards.
- Pick `supports`.
- Refresh page.
- Edge remains.
- Existing relations endpoint sees the relation.

### Phase 6: AI Assistant

Tasks:

- Add floating `CanvasAIAssistant`.
- Support selected paper IDs.
- Support selected note/text context.
- Call `literatureAiApi.chat`.
- Insert AI answer as question/note node.

Acceptance:

- Select one paper and ask a question.
- AI answer appears.
- Insert answer as note creates a node next to the paper.
- Select multiple papers and ask for comparison.

### Phase 7: Freeform Polish

Tasks:

- Multi-select.
- Selection toolbar.
- Copy/paste nodes.
- Keyboard delete.
- Add group frame.
- Add canvas-only edges.
- Add minimap or fit-to-content control.
- Improve mobile/tablet interaction if needed.

Acceptance:

- Canvas feels fluid for normal research use.
- Common actions require one or two clicks.
- No navigation away from canvas for PDF/AI/note workflows.

## Verification Checklist

Before marking implementation complete:

- `npm run typecheck` passes in frontend.
- Frontend tests pass or failures are documented.
- Backend tests pass or failures are documented.
- Uploading PDFs from existing table still works.
- Uploading PDFs from canvas works.
- Existing paper workspace still opens.
- Existing AI settings still work.
- Existing AI summary output format remains unchanged.
- Paper relations created from canvas appear in existing relation APIs.
- Canvas state restores after refresh.
- Deleting a canvas node does not delete paper records.
- Large papers do not bloat canvas state payloads.

## Non-Goals For First Release

Do not implement these in the first release:

- Real-time multiplayer.
- Infinite undo/redo history.
- Handwriting-grade drawing engine.
- Full Apple Freeform feature parity.
- Export canvas to PDF/image.
- Nested group behavior.
- Full Tiptap rich text everywhere.
- Automatic AI relation inference for all papers.

These can come later after the core research workflow is stable.

## Suggested Agent Prompt For Implementation

Use this prompt when starting the coding task:

```text
Implement Phase 0 and Phase 1 from frontend/docs/plans/literature-ai-research-canvas-agent-plan.md.

Do not remove the existing Literature table, Reading Lists, PaperWorkspace, or PaperRelationsGraph yet.
Add the new canvas infrastructure in parallel.
Use @xyflow/react.
Keep changes scoped.
After implementation, run frontend typecheck and relevant tests.
Report any backend migration/runtime assumptions clearly.
```

For later phases, replace `Phase 0 and Phase 1` with the desired phase number.

