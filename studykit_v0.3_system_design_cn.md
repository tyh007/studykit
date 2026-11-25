# StudyKit v0.3 系统设计方案

> 版本：0.3.0 (draft)
> 日期：2026-07-19
> 配套文档：`studykit_v0.3_product_spec_cn.md`
> 适用对象：前端 / 后端 / 数据库 实施者，LLM coding agent
> 实施依据：v0.2 现有代码（codex/lit-hub-redesign 分支），**所有 P0 改动不破坏 v0.2 数据**

---

## 0. 摘要

v0.3 系统设计承接 v0.2 全部能力，**只做四件事**：

1. **画布范式升级**：从 Lit Hub 专属的 LiteratureCanvas 抽成通用 `<CanvasSpace>`，复用到 module / lecture / revision。
2. **路由化**：引入 react-router v6，撤掉 `sidebarMode` 字符串状态机。
3. **Store 切片化**：把 350 行单 store 拆成 6 个 slice。
4. **节点类型收口**：用 11 种节点 + 7 种关系统一表达 v0.2 已有能力。

**不重写后端 schema**，**不破坏 v0.2 数据**，**不引入新数据库**。

---

## 1. 当前架构基线（v0.2 代码现状）

> 实施 P0 之前必须先理解现状。下面的事实来自直接读 `codex/lit-hub-redesign` 分支。

### 1.1 前端

| 文件 | 行数 | 角色 | v0.3 处置 |
|---|---|---|---|
| `frontend/src/App.tsx` | 600+ | App shell + Auth + 3 个 mode 分支 + LectureView | **拆**：shell 留 ~150 行，3 个 mode 改路由 |
| `frontend/src/store/useStore.ts` | 350 | 全局 zustand store | **拆**：6 个 slice |
| `frontend/src/components/SidebarContent.tsx` | 695 | 侧栏内容（modules / literature 混合） | **拆**：按模块拆分 |
| `frontend/src/components/NoteEditor.tsx` | 1310 | 富文本笔记编辑器 | **拆**：5 个子组件 |
| `frontend/src/components/literature/canvas/LiteratureCanvas.tsx` | 553 | 画布主组件（ReactFlow 包装） | **复用 + 抽 CanvasSpace** |
| `frontend/src/components/literature/canvas/` | ~3000 | 画布生态 | **保留** paper/note/question/pdf/relation/AI/group；shape/text 归到 🎨 表达 工具组 |
| `frontend/src/components/PDFViewer.tsx` | 146 | PDF 渲染 | **复用**，作为 pdf node 的渲染器 |
| `frontend/src/components/AnnotationLayer.tsx` | 355 | 批注层 | **复用**，作为 pdf node 内的批注层 |
| `frontend/src/components/ExportDialog.tsx` | 425 | 导出对话框 | **保留** |
| `frontend/src/lib/api.ts` | 193 | REST API 客户端（modules/lectures/source-docs） | **保留**，扩展画布 API |
| `frontend/src/lib/literature-api.ts` | 261 | Literature REST 客户端 | **保留**，改用 litSlice |
| `frontend/src/lib/literature-canvas-api.ts` | 195 | 画布 REST 客户端 | **保留**，通用化为 canvas-api |
| `frontend/src/lib/db.ts` | 51 | Dexie 本地数据库 schema | **保留**，扩展画布本地表 |

### 1.2 后端

| Route | 行数 | 角色 | v0.3 处置 |
|---|---|---|---|
| `backend/routes/auth.js` | - | 登录/注册 | **保留** |
| `backend/routes/modules.js` | - | module CRUD | **保留** |
| `backend/routes/lectures.js` | 192 | lecture CRUD | **保留** |
| `backend/routes/source-documents.js` | 217 | PDF 上传/处理 | **保留** |
| `backend/routes/note-blocks.js` | - | note CRUD | **保留** |
| `backend/routes/paper-annotations.js` | - | PDF 批注 | **保留** |
| `backend/routes/exports.js` | 426 | PDF/Markdown 导出 | **保留** |
| `backend/routes/sync.js` | 275 | operation log 同步 | **保留** |
| `backend/routes/literature-projects.js` | - | literature project CRUD | **保留** |
| `backend/routes/literature-papers.js` | 273 | paper CRUD | **保留** |
| `backend/routes/literature-canvas.js` | 781 | 画布 nodes/edges/scenes | **保留 + 通用化**（改名为 `canvas.js`） |
| `backend/routes/literature-ai.js` | 446 | AI 助手 | **保留** |
| `backend/routes/zotero.js` | 956 | Zotero 集成 | **保留** |

### 1.3 现有数据模型（核心）

来自 `frontend/src/types.ts` + `backend/schema.sql`：

```
workspaces
  └── modules (title, code, term, sort_order, deleted_at)
       └── lectures (module_id, title, lecture_date, settings_json)
            ├── source_documents (lecture_id, original_filename, storage_key, page_count, processing_status)
            │    └── source_pages (source_document_id, page_number, width, height, extracted_text)
            ├── note_blocks (lecture_id, block_type, content_json, source_links_json, sort_order)
            ├── annotations (source_page_id, annotation_type, geometry_json, style_json, semantic_label)
            └── attachments (lecture_id, original_filename, storage_key)

literature_projects
  └── literature_papers (project_id, title, authors, doi, extracted_data, reading_status, citation_item_id)
       └── paper_relations (project_id, source_paper_id, target_paper_id, relation_kind)
       └── paper_annotations (paper_id, geometry_json)
       └── paper_notes (paper_id, content_json)

literature_canvases (project_id, name, viewport_json)
  └── literature_canvas_nodes (canvas_id, node_type, position_json, data_json, size_json, parent_group_id)
  └── literature_canvas_edges (canvas_id, source_node_id, target_node_id, relation_kind, style_json)
  └── literature_canvas_scenes (canvas_id, name, viewport_json, node_filter_json)
  └── literature_canvas_groups (canvas_id, label, position_json, size_json, color)

reading_lists
  └── reading_list_items (reading_list_id, paper_id, sort_order)

external_accounts (Zotero connector)
external_objects
connector_sync_events
```

**v0.3 不会改变上述任何表结构**。P0 只在前端做架构升级。

---

## 2. 路由结构（P0 必做）

### 2.1 引入依赖

```json
// frontend/package.json 新增
{
  "dependencies": {
    "react-router-dom": "^6.26.0"
  }
}
```

### 2.2 路由表

```tsx
// frontend/src/App.tsx 改造为
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ModuleCanvasRoute from './routes/ModuleCanvasRoute';
import LectureCanvasRoute from './routes/LectureCanvasRoute';
import LiteratureCanvasRoute from './routes/LiteratureCanvasRoute';
import SettingsRoute from './routes/SettingsRoute';
import TrashRoute from './routes/TrashRoute';
import OnboardingRoute from './routes/OnboardingRoute';

function App() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <AuthPage />;
  return (
    <BrowserRouter>
      <StudyKitShell>
        <Routes>
          <Route path="/" element={<Navigate to="/m/recent" replace />} />
          <Route path="/m/:moduleId" element={<ModuleCanvasRoute />} />
          <Route path="/m/:moduleId/l/:lectureId" element={<LectureCanvasRoute />} />
          <Route path="/lit/:projectId" element={<LiteratureCanvasRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/trash" element={<TrashRoute />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
        </Routes>
      </StudyKitShell>
    </BrowserRouter>
  );
}
```

### 2.3 路由组件映射

| 路由 | 组件 | 内部组件 | 备注 |
|---|---|---|---|
| `/m/:moduleId` | `<ModuleCanvasRoute>` | `<CanvasShell kind="module">` → `<ModuleCanvasSpace moduleId={id}>` | `moduleId="recent"` 时打开最近一个 |
| `/m/:moduleId/l/:lectureId` | `<LectureCanvasRoute>` | `<CanvasShell kind="lecture">` → `<LectureCanvasSpace lectureId={id}>` | 主力路由 |
| `/lit/:projectId` | `<LiteratureCanvasRoute>` | `<CanvasShell kind="literature">` → `<LiteratureCanvasSpace projectId={id}>` | v0.2 现有 LiteratureCanvas 改造 |
| `/settings` | `<SettingsRoute>` | 现有导出/账户/Zotero 入口 | |
| `/trash` | `<TrashRoute>` | 跨 space 的回收站 | |
| `/onboarding` | `<OnboardingRoute>` | 首次引导 | |

### 2.4 URL 同步 sidebar 状态

v0.2 的 sidebar 当前选中的 module / lecture 来自 `useStore.selectedModuleId` / `selectedLectureId`。v0.3 改为**从 URL 读**：

```tsx
// SidebarContent 改造
import { useParams, useNavigate, useLocation } from 'react-router-dom';
function SidebarContent() {
  const { moduleId, lectureId } = useParams();
  const navigate = useNavigate();
  const selectModule = (id) => navigate(`/m/${id}`);
  const selectLecture = (id) => navigate(`/m/${moduleId}/l/${id}`);
  // ...
}
```

`useStore.selectedModuleId` 等字段保留作为"最近选中"的镜像（用于 ⌘K 命令面板回车跳转），但**不再驱动渲染**。

---

## 3. Store 切片设计（P0 必做）

### 3.1 现状问题

`useStore.ts` 350 行，30+ 字段，涵盖：
- 5 个不同领域的实体（modules / lectures / litProjects / litPapers / citations / readingLists / noteBlocks / annotations / sourceDocs）
- UI 状态（sidebarMode / currentLayout / cornellMode / activeLectureTab / activeLiteratureTab）
- Sync 状态、device id、Zotero 状态

**v0.2 的 fix(ux): decouple Modules and Library views** 这个 commit 本质是状态机混乱后的补丁。v0.3 通过路由化 + 切片化根除。

### 3.2 切片设计

```
src/store/
  index.ts                  // 组合 slices + 选择器
  slices/
    workspaceSlice.ts       // workspace_id, user, deviceId, syncStatus
    modulesSlice.ts         // modules[], selectedModuleId (mirror)
    lecturesSlice.ts        // lectures[], selectedLectureId (mirror), currentDocument, currentPages
    noteBlocksSlice.ts      // noteBlocks[], annotations[]
    litSlice.ts             // litProjects[], litPapers[], selectedLitProjectId, citationItems, readingLists
    canvasSlice.ts          // 通用画布状态：currentCanvas, nodes, edges, scenes, viewport
    uiSlice.ts              // sidebarOpen, theme, cornellMode, softMode, aiAssistantOpen
```

### 3.3 关键改动

#### canvasSlice 取代 sidebarMode

```ts
// canvasSlice.ts
interface CanvasState {
  kind: 'module' | 'lecture' | 'literature' | 'revision' | null;
  canvasId: string | null;
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
  scenes: CanvasScene[];
  activeSceneId: string | null;
  viewport: Viewport;
  selectedNodeIds: string[];
  softMode: 'select' | 'connect' | 'annotate' | 'cornell' | 'ai' | 'present';
  setKind: (kind) => void;
  setNodes: (nodes) => void;
  setEdges: (edges) => void;
  setViewport: (vp) => void;
  setSoftMode: (mode) => void;
}
```

**v0.2 `sidebarMode` 字段删除**。`currentLayout` 字段删除（v0.3 画布自由布局）。`activeLectureTab` 字段删除（v0.3 lecture 默认就是 note 视图，切换靠场景）。

#### litSlice 保留 litPapers 缓存

```ts
// litSlice.ts
interface LitState {
  projects: LiteratureProject[];
  papers: LiteraturePaper[];
  customFields: LiteratureCustomField[];
  citations: CitationItem[];
  readingLists: ReadingList[];
  readingListItems: Record<string, ReadingListItem[]>;
  selectedProjectId: string | null;  // mirror URL
  selectedPaperId: string | null;     // mirror URL
  // actions
}
```

`sidebarMode === 'literature'` 的清场逻辑（v0.2 useStore.setSidebarMode 里 60+ 行的清场代码）可以删掉，因为路由切换时组件 unmount 自然清理。

### 3.4 迁移步骤

1. 创建 6 个 slice 文件，**逐个从 useStore 抽出字段和 action**。
2. 创建一个临时的 `useStore` 兼容层（re-export 各 slice 的 hooks），保证其他组件不需要一次性改完。
3. 每抽一个 slice，跑一遍现有 typecheck + 单测。
4. 全部抽完，删除 v0.2 的 350 行单 store。
5. 全局替换 `useStore(x => x.xxx)` 为 `useXxxSlice(x => x.xxx)`（可以用 jscodeshift codemod）。

---

## 4. CanvasSpace 抽象（P0 核心）

### 4.1 为什么需要

v0.2 的 `LiteratureCanvas` 是个硬编码的"画布"——它从 `useLiteratureCanvas(projectId)` 读数据，内部硬编码了 paper / note / question / group / shape 节点类型 + AI 助手 + Zotero 导入按钮。

v0.3 要把它抽成**通用 `<CanvasSpace>`**，让 module / lecture / literature / revision 都用同一套画布容器。

### 4.2 抽象接口

```tsx
// src/components/canvas/CanvasSpace.tsx
interface CanvasSpaceProps {
  kind: 'module' | 'lecture' | 'literature' | 'revision';
  spaceId: string;                  // moduleId / lectureId / projectId / revisionId
  availableNodeTypes: NodeType[];   // 哪些节点类型可用
  availableRelations: RelationKind[];
  toolbarActions?: ToolbarAction[]; // 工具栏额外按钮
  defaultViewport?: Viewport;
  defaultLayout?: NodeLayout[];     // 首次打开的布局（v0.3.0 给 lecture 预设）
  children?: React.ReactNode;       // 画布内额外 UI 浮层
}

export function CanvasSpace(props: CanvasSpaceProps) {
  const { kind, spaceId, availableNodeTypes } = props;
  return (
    <CanvasShell>
      <CanvasReactFlow
        nodeTypes={buildNodeTypes(availableNodeTypes)}  // 通用节点注册
        edgeTypes={buildEdgeTypes(props.availableRelations)}
        defaultViewport={props.defaultViewport}
        defaultLayout={props.defaultLayout}
      />
      <CanvasToolbar spaceKind={kind} extraActions={props.toolbarActions} />
      <CanvasStatusBar spaceKind={kind} />
      <CanvasMinimapCluster />
      <CanvasSearch />
      <CanvasSceneNavigator />
      <SelectionToolbar />
      <AIAssistantOverlay />  {/* ⌘K 唤起，统一在 v0.3.2 完成 */}
    </CanvasShell>
  );
}
```

### 4.3 NodeType 注册表

v0.3 引入"工具组（Tool Group）"概念——节点按用途归到 5 个工具组，工具栏从 v0.2 的平铺改为 tab 切换。

```ts
// src/components/canvas/nodeTypes.ts

// ===== 工具组定义 =====
export type ToolGroup = 'documents' | 'notes' | 'content' | 'organization' | 'expression';

export const TOOL_GROUP_META: Record<ToolGroup, { id: ToolGroup; label: string; icon: string; defaultVisible: boolean }> = {
  documents:    { id: 'documents',    label: 'Documents',    icon: '📄', defaultVisible: true  },
  notes:        { id: 'notes',        label: 'Notes',        icon: '✏️', defaultVisible: true  },
  content:      { id: 'content',      label: 'Content',      icon: '🧮', defaultVisible: true  },
  organization: { id: 'organization', label: 'Organization', icon: '📦', defaultVisible: true  },
  expression:   { id: 'expression',   label: 'Expression',   icon: '🎨', defaultVisible: false }, // 学术向默认隐藏
};

// ===== 节点注册（按工具组组织）=====
import PaperNode from './nodes/PaperNode';
import NoteNode from './nodes/NoteNode';
import CueNode from './nodes/CueNode';
import QuestionNode from './nodes/QuestionNode';
import PdfNode from './nodes/PdfNode';
import ImageNode from './nodes/ImageNode';
import FileNode from './nodes/FileNode';
import CodeNode from './nodes/CodeNode';
import EquationNode from './nodes/EquationNode';
import GroupNode from './nodes/GroupNode';
import FrameNode from './nodes/FrameNode';
import TextNode from './nodes/TextNode';        // v0.2 已有，重分类到 expression
import CalloutNode from './nodes/CalloutNode';  // v0.3 从 note 抽出
import ShapeNode from './nodes/ShapeNode';      // v0.2 已有，重分类到 expression
import DividerNode from './nodes/DividerNode';  // v0.3 新增
import ArrowNode from './nodes/ArrowNode';      // v0.3 新增
import FlashcardNode from './nodes/FlashcardNode';  // v0.3 新增（revision）
import AIDraftNode from './nodes/AIDraftNode';  // v0.3 占位（v0.3.2 完善）

export const NODE_TYPE_TO_GROUP: Record<NodeType, ToolGroup> = {
  // 内容型
  pdf:       'documents',
  paper:     'documents',
  citation:  'documents',
  file:      'documents',
  note:      'notes',
  cue:       'notes',
  question:  'notes',
  flashcard: 'notes',
  equation:  'content',
  code:      'content',
  image:     'content',
  ai_draft:  'content',
  group:     'organization',
  frame:     'organization',
  // 表达型（v0.3 不删，归类）
  text:      'expression',
  callout:   'expression',
  shape:     'expression',
  divider:   'expression',
  arrow:     'expression',
};

export const ALL_NODE_TYPES = {
  // documents
  pdf: PdfNode, paper: PaperNode, citation: PaperNode, file: FileNode,
  // notes
  note: NoteNode, cue: CueNode, question: QuestionNode, flashcard: FlashcardNode,
  // content
  equation: EquationNode, code: CodeNode, image: ImageNode, ai_draft: AIDraftNode,
  // organization
  group: GroupNode, frame: FrameNode,
  // expression
  text: TextNode, callout: CalloutNode, shape: ShapeNode, divider: DividerNode, arrow: ArrowNode,
} as const;

export type NodeType = keyof typeof ALL_NODE_TYPES;

export function buildNodeTypes(allowed: NodeType[]) {
  return Object.fromEntries(
    allowed.map((t) => [t, ALL_NODE_TYPES[t]])
  );
}
```

**v0.3 关键变化**：
- 节点数从 v0.2 的 6 种扩展到 19 种（含 v0.3 新增的 flashcard / ai_draft / divider / arrow / callout / citation / frame）
- 工具组从平铺改为 5 tab，工具栏实现见 §6.6
- 学术向用户默认隐藏"表达"组，UI 入口在画布设置里

### 4.4 Relation 注册表

```ts
// src/components/canvas/relationTypes.ts
export const RELATION_KINDS = [
  'anchors-to', 'cites', 'extends', 'contradicts', 'defines', 'related', 'groups'
] as const;
export type RelationKind = typeof RELATION_KINDS[number];

export const RELATION_META: Record<RelationKind, { label: string; color: string; style: 'solid' | 'dashed'; thickness: number }> = {
  'anchors-to': { label: 'Anchors to',  color: '#0A84FF', style: 'solid',  thickness: 2 },
  'cites':      { label: 'Cites',       color: '#5E5CE6', style: 'solid',  thickness: 2 },
  'extends':    { label: 'Extends',     color: '#34C759', style: 'dashed', thickness: 1.5 },
  'contradicts':{ label: 'Contradicts', color: '#FF3B30', style: 'dashed', thickness: 1.5 },
  'defines':    { label: 'Defines',     color: '#AF52DE', style: 'solid',  thickness: 1 },
  'related':    { label: 'Related',     color: '#8E8E93', style: 'solid',  thickness: 1 },
  'groups':     { label: 'Groups',      color: '#FFD60A', style: 'solid',  thickness: 2 },
};
```

v0.2 的 `relation-types.ts` 已有 259 行实现，**v0.3 收口到 7 种**——保留核心，删细分。

### 4.5 各 Space 类型的可用节点 / 关系

| Space | 内容型节点 | 表达型节点 | 关系 |
|---|---|---|---|
| `module` | paper, note, cue, question, pdf, image, file, code, equation, group, frame | text, callout, shape, divider, arrow（默认隐藏） | anchors-to, cites, extends, contradicts, defines, related, groups |
| `lecture` | note, cue, question, pdf, image, file, code, equation, group, frame | text, callout, shape, divider, arrow（默认隐藏） | anchors-to, defines, extends, contradicts, related, groups |
| `literature` | paper, citation, note, cue, question, image, file, group, frame | text, callout, shape, divider, arrow（默认隐藏） | cites, extends, contradicts, defines, related, groups |
| `revision` | flashcard, question, ai_draft, note, paper (read-only) | text, callout（默认隐藏） | related, extends |

**默认工具组可见性**：

| Space | 📄 文档 | ✏️ 笔记 | 🧮 内容块 | 📦 组织 | 🎨 表达 |
|---|---|---|---|---|---|
| `lecture` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `module` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `literature` | ✓ | ✓ | ✗ | ✓ | ✗ |
| `revision` | ✗ | ✓ | ✓ (flashcard/ai_draft only) | ✗ | ✗ |

学生在画布设置里可以独立切换每个工具组的可见性。"🎨 表达"是 opt-in。

---

## 5. 数据模型映射（v0.2 → v0.3）

### 5.1 节点 ↔ v0.2 数据后端

| v0.3 Node | v0.2 数据后端 | 备注 |
|---|---|---|
| `pdf` | source_documents + source_pages | 通过 source_document_id 引用；1 lecture → N PDF，UI 全部暴露 |
| `note` | note_blocks (block_type=paragraph/heading/list/callout) | 通过 lecture_id 引用 |
| `cue` | note_blocks (block_type=cue) | Cornell 专用 |
| `question` | note_blocks (block_type=question) | active recall 专用 |
| `paper` | literature_papers | 通过 project_id 引用 |
| `citation` | citation_items | 独立于 paper 的引用条目 |
| `image` | attachments (mime starts with image/) | |
| `file` | attachments | |
| `code` | note_blocks (block_type=code) | |
| `equation` | note_blocks (block_type=equation) | |
| `group` | literature_canvas_groups | 通用化，重命名 canvas_groups |
| `frame` | literature_canvas_groups (kind=frame) | v0.3 新增 |
| `text` | literature_canvas_nodes (node_type=text) | v0.2 已有，重分类到 expression |
| `callout` | note_blocks (block_type=callout) | 提升为独立 node |
| `shape` | literature_canvas_nodes (node_type=shape) | v0.2 已有，重分类到 expression |
| `divider` | literature_canvas_nodes (node_type=divider) | v0.3 新增 |
| `arrow` | literature_canvas_edges (kind=decorative-arrow) | v0.3 新增，与数据关系区分 |
| `flashcard` | **新建 flashcards 表（v0.3.0 一次出）** | user 决策：与 v0.3.0 一起出 |
| `ai_draft` | **新建 ai_drafts 表（v0.3.0 占位）** | user 决策：与 v0.3.0 一起出，AI 内容 v0.3.2 完善 |

### 5.2 关系 ↔ v0.2 数据后端

| v0.3 Relation | v0.2 数据后端 | 备注 |
|---|---|---|
| `anchors-to` | note_blocks.linked_source_page_id | v0.2 已存，无需新建 |
| `cites` | paper_relations（kind=cites）+ note_blocks.source_links_json.citations | 统一字段 |
| `extends` / `contradicts` / `defines` / `related` | paper_relations（kind=对应）+ literature_canvas_edges | 统一到 canvas_edges |
| `groups` | literature_canvas_groups | 容器关系，由 group node 隐含 |

**关键决策**：v0.3 把所有画布上的关系**统一存到 `literature_canvas_edges` 表**（改名为 `canvas_edges`），加 `space_kind` 字段区分来自哪种 space。这样：
- lecture 空间的关系（anchors-to note→pdf）也存在这张表
- literature 空间的关系也存在这张表
- 一个 edge 通过 `source_node_id` + `target_node_id` 反查来源 node

### 5.3 数据迁移（v0.3 不做，向后兼容）

v0.3.0 **不做数据迁移**。原因：
- v0.2 的数据全部按原 schema 存储。
- v0.3 的画布 nodes 引用 v0.2 的 ID（lecture_id / note_block_id / source_document_id / paper_id）。
- 老的 `paper_relations` 保留，画布上自动渲染（迁移到 canvas_edges 留 v0.3.1 做）。

v0.3.0 的"画布 node"对 v0.2 lecture 来说是**虚拟视图**——lecture 本身不在画布上存新数据，只是**渲染时把 note_blocks + source_documents 当作 nodes 显示**。

只有当学生在画布上**新建** node（例如新建 frame、调整位置）时，才把 position 存到 `canvas_node_positions` 新表（v0.3.0 不建，v0.3.1 建）。

### 5.4 字段映射示例：lecture space 的虚拟 node 渲染

```ts
// useLectureCanvasSpace(lectureId)
function useLectureCanvasSpace(lectureId: string) {
  const { data: lecture } = useLecture(lectureId);
  const { data: sourceDoc } = useSourceDocument(lecture.active_source_document_id);
  const { data: noteBlocks } = useNoteBlocks(lectureId);
  const { data: annotations } = useAnnotations(lectureId);
  
  // 1. 渲染 PDF node（自动放在左侧）
  const pdfNode: CanvasFlowNode = useMemo(() => ({
    id: `pdf-${sourceDoc.id}`,
    type: 'pdf',
    position: { x: 80, y: 80 },        // v0.3.1 后可被用户拖动
    data: { sourceDocument: sourceDoc, annotations },
  }), [sourceDoc, annotations]);
  
  // 2. 渲染 note node 网格（每个 note_block 一个 node）
  const noteNodes: CanvasFlowNode[] = useMemo(() =>
    noteBlocks.map((block, i) => ({
      id: `note-${block.id}`,
      type: 'note',
      position: computeGridPosition(i, noteBlocks.length),
      data: { noteBlock: block, sourcePageId: block.linked_source_page_id },
    })),
  [noteBlocks]);
  
  // 3. 渲染 anchors-to 关系（自动从 note_blocks.linked_source_page_id 推断）
  const edges: CanvasFlowEdge[] = useMemo(() =>
    noteNodes
      .filter(n => n.data.sourcePageId)
      .map(n => ({
        id: `edge-${n.id}-pdf`,
        source: n.id,
        target: `pdf-${sourceDoc.id}`,
        type: 'relation',
        data: { kind: 'anchors-to', page: n.data.sourcePageId },
      })),
  [noteNodes, sourceDoc]);
  
  return { nodes: [pdfNode, ...noteNodes], edges };
}
```

**关键洞察**：v0.3.0 的 lecture canvas **不需要存任何新数据**——所有 nodes 位置由 v0.2 数据 + 默认布局算法算出。v0.3.1 才引入"用户自定义布局"（`canvas_node_positions` 表）。

---

## 6. 关键组件设计

### 6.1 `<CanvasShell>` 容器

```tsx
// src/components/canvas/CanvasShell.tsx
function CanvasShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div className="canvas-shell">
      <Breadcrumb />  {/* 显示 Module > Lecture */}
      {children}
      <CommandPalette />  {/* ⌘K */}
      <KeyboardShortcuts />  {/* 全局快捷键 */}
    </div>
  );
}
```

### 6.2 `<ModuleCanvasSpace>`

```tsx
// src/components/canvas/spaces/ModuleCanvasSpace.tsx
function ModuleCanvasSpace({ moduleId }: { moduleId: string }) {
  const { data: module } = useModule(moduleId);
  const { data: lectures } = useLectures(moduleId);
  const { data: papers } = useModulePapers(moduleId);  // 该 module 引用的 paper
  
  // 渲染 lectures 为 frame nodes，每个 frame 内是 lecture space（嵌套）
  // 渲染 papers 为 paper nodes
  // 渲染跨 lecture 关系（共享 paper / shared note）
  return (
    <CanvasSpace
      kind="module"
      spaceId={moduleId}
      availableNodeTypes={['paper', 'note', 'cue', 'pdf', 'image', 'file', 'code', 'equation', 'group', 'frame']}
      availableRelations={['anchors-to', 'cites', 'extends', 'contradicts', 'defines', 'related', 'groups']}
      defaultLayout={defaultModuleLayout(lectures, papers)}
    />
  );
}
```

### 6.3 `<LectureCanvasSpace>`

```tsx
// src/components/canvas/spaces/LectureCanvasSpace.tsx
function LectureCanvasSpace({ lectureId }: { lectureId: string }) {
  const { nodes, edges } = useLectureCanvasSpace(lectureId);
  return (
    <CanvasSpace
      kind="lecture"
      spaceId={lectureId}
      availableNodeTypes={['note', 'cue', 'pdf', 'image', 'file', 'code', 'equation', 'question', 'group']}
      availableRelations={['anchors-to', 'defines', 'extends', 'contradicts', 'related', 'groups']}
      defaultLayout={defaultLectureLayout(nodes)}
      toolbarActions={[
        { id: 'toggle-cornell', label: 'Cornell Cues', shortcut: '⌘⇧C' },
        { id: 'add-question', label: 'Add Question', shortcut: '⌘Q' },
        { id: 'export', label: 'Export', shortcut: '⌘E' },
      ]}
    />
  );
}
```

### 6.4 `<LiteratureCanvasSpace>`

```tsx
// src/components/canvas/spaces/LiteratureCanvasSpace.tsx
function LiteratureCanvasSpace({ projectId }: { projectId: string }) {
  // 复用 v0.2 的 LiteratureCanvas 内部逻辑，但用 v0.3 CanvasSpace 包装
  return (
    <CanvasSpace
      kind="literature"
      spaceId={projectId}
      availableNodeTypes={['paper', 'citation', 'note', 'cue', 'question', 'image', 'file', 'group', 'frame']}
      availableRelations={['cites', 'extends', 'contradicts', 'defines', 'related', 'groups']}
    />
  );
}
```

### 6.5 `<RevisionCanvasSpace>`（v0.3.0 一起出）

```tsx
// src/components/canvas/spaces/RevisionCanvasSpace.tsx
function RevisionCanvasSpace({ revisionId }: { revisionId: string }) {
  const { data: revision } = useRevision(revisionId);
  const { data: sourceNodes } = useRevisionSourceNodes(revisionId);
  // sourceNodes 是从 module / lecture 拉过来的 note / cue / paper 节点快照

  return (
    <CanvasSpace
      kind="revision"
      spaceId={revisionId}
      availableNodeTypes={['flashcard', 'question', 'ai_draft', 'note', 'paper']}
      availableRelations={['related', 'extends']}
      defaultLayout={defaultRevisionLayout(sourceNodes)}
      toolbarActions={[
        { id: 'start-recall', label: 'Start Active Recall', shortcut: '⌘R' },
        { id: 'mark-mastered', label: 'Mark as Mastered', shortcut: '⌘M' },
      ]}
    />
  );
}
```

revision space 的特殊设计：
- source nodes 来自其他 space，是**只读快照**（防止复习时改坏原 note）
- 学生可以创建 flashcard / question / ai_draft 节点，这些是 revision 专属的
- ai_draft 节点在 v0.3.0 是占位（点击显示 "AI generation coming in v0.3.2"），v0.3.2 实装

### 6.5 defaultLectureLayout 算法

```ts
// src/components/canvas/layouts/defaultLectureLayout.ts
export function defaultLectureLayout(nodes: CanvasFlowNode[]): Record<string, Position> {
  const pdfs = nodes.filter(n => n.type === 'pdf');
  const others = nodes.filter(n => n.type !== 'pdf');
  
  const positions: Record<string, Position> = {};
  
  // ===== 1 PDF 节点：固定在左上 =====
  // ===== N PDF 节点（v0.3 1 lecture → N PDF）：垂直堆叠在左侧 =====
  pdfs.forEach((pdf, i) => {
    positions[pdf.id] = { x: 80, y: 80 + i * 360 };
  });
  
  // ===== Note 节点：按 source page 分组网格排列（右侧） =====
  const byPage = groupBy(others, n => n.data.sourcePageId ?? 0);
  let yOffset = 80;
  for (const [page, pageNodes] of Object.entries(byPage)) {
    pageNodes.forEach((node, i) => {
      positions[node.id] = {
        x: 480 + (i % 3) * 280,
        y: yOffset + Math.floor(i / 3) * 180,
      };
    });
    yOffset += Math.ceil(pageNodes.length / 3) * 180 + 40;
  }
  
  return positions;
}
```

**v0.3 N PDF 处理**：当 lecture 有多个 PDF 时，PDF 节点垂直堆叠在左侧（每个 PDF 间距 360px），note 节点网格仍按 source page 分组在右侧。

### 6.6 工具栏（Toolbar）Tab 化

```tsx
// src/components/canvas/CanvasToolbar.tsx
function CanvasToolbar({ spaceKind, visibleGroups, onToggleGroup }: Props) {
  const groups = ['documents', 'notes', 'content', 'organization', 'expression'] as const;
  
  return (
    <div className="canvas-toolbar">
      {groups.map(g => (
        visibleGroups.includes(g) && (
          <ToolGroupTab key={g} group={g} nodeTypes={NODE_TYPES_IN_GROUP[g]} />
        )
      ))}
      <button onClick={onToggleGroupPicker}>⚙</button>
    </div>
  );
}
```

**v0.2 → v0.3 工具栏变化**：
- v0.2 工具栏：`[Paper] [PDF] [Note] [Question] [Text] [Shape] [Group]` 7 个平铺按钮
- v0.3 工具栏：`[📄] [✏️] [🧮] [📦] [🎨]` 5 个 tab，点击 tab 展开对应工具组的节点按钮
- "表达"组默认隐藏，⚙ 按钮唤起工具组可见性设置

### 6.7 Revision space 数据模型（v0.3.0 一次出）

```sql
-- backend/schema.sql 新增
CREATE TABLE IF NOT EXISTS flashcards (
  id              UUID PRIMARY KEY,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision_id     UUID NOT NULL,                     -- revision space id
  lecture_id      UUID REFERENCES lectures(id),       -- 来源 lecture（可空）
  note_block_id   UUID REFERENCES note_blocks(id),    -- 来源 note（可空）
  paper_id        UUID REFERENCES literature_papers(id), -- 来源 paper（可空）
  front_text      TEXT NOT NULL,
  back_text       TEXT NOT NULL,
  source_links_json JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'new',         -- new / learning / mastered
  interval_days   INTEGER NOT NULL DEFAULT 0,
  ease_factor     DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  next_review_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS revisions (
  id              UUID PRIMARY KEY,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module_id       UUID REFERENCES modules(id),
  name            TEXT NOT NULL,
  scope_json      JSONB NOT NULL DEFAULT '{}',  -- 哪些 lecture / paper 包含在内
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_drafts (
  id              UUID PRIMARY KEY,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision_id     UUID REFERENCES revisions(id),
  space_kind      TEXT NOT NULL,                -- module / lecture / literature / revision
  source_node_ids JSONB NOT NULL DEFAULT '[]',  -- 引用了哪些 source nodes
  prompt          TEXT NOT NULL,
  content_json    JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'draft', -- draft / accepted / rejected
  provenance_json JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
```

**注意**：v0.3.0 这些表**只建不实装**。flashcard 节点可创建但没有 spaced repetition 逻辑，ai_draft 节点可创建但内容生成是 v0.3.2。

---

## 7. AI 助手架构（v0.3.2，本节仅占位）

v0.3.0 **不实现 AI**，但要预留：
- `CanvasSpace` 接受 `aiAssistantEnabled` prop
- `useStore.uiSlice.softMode === 'ai'` 时显示浮层
- `backend/routes/literature-ai.js` 已存在，v0.3.2 通用化为 `routes/ai.js`，支持任意 space

---

## 8. 导出兼容性

v0.2 的导出（PDF / Markdown）走 lecture → note_blocks → PDF 的链路，**不依赖 UI**。v0.3 改动 UI 不影响导出。

**v0.3.0 验证**：
- 现有 PDF 导出（`backend/routes/exports.js`）100% 兼容。
- 现有 Markdown 导出 100% 兼容。
- 未来从画布导出（"导出现在看到的画布布局"）是 v0.3.2+ 的工作。

---

## 9. P0 实施步骤（具体到 PR）

### PR 1: 引入 react-router，路由壳
- 新增 `react-router-dom` 依赖
- 创建 `routes/` 目录，每个 route 一个文件
- App.tsx 改为 `<BrowserRouter>` + `<Routes>`
- 所有现有页面**先 import 后用**，不重构
- 验证：URL 改 `/m/xxx` 还能正常显示（虽然还走旧组件）

### PR 2: 拆 store
- 创建 6 个 slice
- 写兼容层
- 全局替换 `useStore` 引用
- 删除 v0.2 单 store
- 验证：typecheck + 单测

### PR 3: 抽 CanvasSpace
- 提取 v0.2 LiteratureCanvas 内部为 `<CanvasSpace>`
- 新增 nodeTypes / relationTypes 注册表
- 验证：literature 路由仍然 1:1 渲染原来的画布

### PR 4: LectureCanvasRoute
- 实现 `<LectureCanvasSpace>`
- 写 defaultLectureLayout
- 替换 `LectureView` 旧组件
- 验证：在 `/m/x/l/y` 看到 PDF node + note node 自由排列

### PR 5: ModuleCanvasRoute
- 实现 `<ModuleCanvasSpace>`
- 渲染 lectures 为 frame / group nodes
- 验证：在 `/m/x` 看到整门课的画布

### PR 6: 画布工具重新分类（不删 Shape/Text）
- 实施 5 工具组（📄 文档 / ✏️ 笔记 / 🧮 内容块 / 📦 组织 / 🎨 表达）
- 工具栏从平铺改为 tab 切换
- "表达"组默认隐藏
- 实现 CalloutNode / DividerNode / ArrowNode（v0.3 新增）
- 把 ShapeNode / TextNode 从 lit hub 迁到 `src/components/canvas/nodes/expression/`
- 验证：现有 literature canvas 仍然能渲染这些节点，只是现在归到"表达"组

### PR 7: Cornell 标签改名
- `activeLectureTab === 'notes' | 'citations'` 简化为默认 notes
- "Annotation" 按钮改回 "Cornell Cues"
- `cornellMode` 改为画布上的 soft mode（`C` 键或 ⌘⇧C）

### PR 8: 1 lecture → N PDF 支持
- 后端：source_documents schema 已支持，**无需改动**
- 前端：`<LectureCanvasSpace>` 渲染所有 lecture 下的 source_documents 为 PDF node
- UI 加 "Upload another PDF" 按钮
- `lectures.active_source_document_id` 字段保留，作为默认 focus
- 验证：上传 3 个 PDF 到同一 lecture，画布上看到 3 个 PDF node

### PR 9: Revision space 骨架（v0.3.0 一次出）
- 后端：建 `flashcards`, `revisions`, `ai_drafts` 三张表
- 前端：`<RevisionCanvasRoute>` + `<RevisionCanvasSpace>`
- flashcard node 可创建
- ai_draft node 可创建（点击显示 "AI coming in v0.3.2"）
- 验证：路由 `/rev/:id` 可访问，节点 CRUD 可用

### PR 10: 命令面板（⌘K）
- 引入 `cmdk` 或自实现
- 接入路由跳转
- 接入软模式切换
- 接入工具组可见性切换

### PR 11: 性能 + 测试
- 200 node 性能压测
- 节点 CRUD / 关系编辑 / 场景切换 / 工具组切换的 vitest 用例
- Playwright 端到端：登录 → 导入 PDF → 写 note → 画关系 → 切换 module → 打开 revision

### PR 12: 文档更新
- README 反映新路由
- 删除/归档过时的文档
- 更新部署文档

---

## 10. 测试策略

| 类型 | 工具 | 覆盖 |
|---|---|---|
| 单元测试 | vitest | node 渲染、layout 计算、关系校验、store slice |
| 组件测试 | vitest + @testing-library/react | 节点交互、关系编辑 |
| 路由测试 | @testing-library/react | URL 切换、参数解析 |
| E2E | Playwright | 完整场景：登录 → 创建 module → 导入 PDF → 写 note → 画关系 → 导出 |
| 性能 | 自写 benchmark | 200 node 渲染 TTI、pan/zoom fps |

---

## 11. 风险与回滚

### 11.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 路由化后 v0.2 用户找不到原有入口 | 中 | 中 | 保留 `sidebarMode` 兼容层，URL 兼容老格式 |
| CanvasSpace 抽离破坏 literature canvas | 中 | 高 | PR 3 抽离后跑现有 literature canvas 全部单测 + 视觉回归 |
| store 切片拆分引入类型错误 | 中 | 中 | 兼容层兜底，逐 PR 迁移 |
| 性能（200 node 画布卡顿） | 低 | 中 | v0.3.0 只验证 50 node 流畅；P1 处理 200+ |

### 11.2 回滚

每个 PR 都是独立可回滚的。如果 v0.3.0 整体不可用，**保留 v0.2 分支**，从 main 直接 cherry-pick 修复 bug。

---

## 12. 监控与成功指标

### 12.1 P0 成功指标

- [ ] Lecture 画布首次渲染 ≤ 1.5s
- [ ] 50 node 画布 pan/zoom ≥ 55fps
- [ ] 老用户登录后，lecture 自动以画布形式呈现（无需操作）
- [ ] PDF / Markdown 导出 100% 可用（CI 跑现有导出测试）
- [ ] App.tsx ≤ 200 行，SidebarContent ≤ 400 行
- [ ] 单元测试覆盖率 ≥ 60%（节点/关系/store）

### 12.2 v0.3 整体成功指标

- 日活用户在画布上停留时间 > 旧 lecture view 停留时间
- 学生在 lecture 里画 `anchors-to` 关系的密度 ≥ 5 / lecture
- Literature space → module space 的 paper 引用率 ≥ 30%

---

## 13. 用户已拍板的关键决策

| 决策点 | 选择 | 实施影响 |
|---|---|---|
| 画布默认布局 | **PDF 左、note 网格右** | defaultLectureLayout 算法规格如 §6.5，PDF 节点固定左上 |
| 画布工具分类 | **不删除 Shape/Text，按工具组重新分类** | 5 tab 工具栏，"表达"组默认隐藏（详见 §6.6） |
| Revision space 时机 | **v0.3.0 一次出** | PR 9 实施，建 flashcards/revisions/ai_drafts 三表 |
| PDF 共享 | **1 lecture → N PDF 支持；1 PDF → N lecture 不做** | 1:1 lecture→PDF 字段保留，UI 暴露 v0.2 schema 已支持的多 PDF 能力 |

---

## 14. 立即可执行的下一步

按用户拍板，P0 范围已定。下一步：

1. **建 worktree**：
   ```bash
   git worktree add .worktrees/v0.3-router -b feature/v0.3-router
   ```
   之后所有改动在 `.worktrees/v0.3-router` 里进行。

2. **PR 1 启动**：引入 react-router v6 + 创建空 route 组件 + 保留 v0.2 组件 import 不变。
   ```bash
   cd .worktrees/v0.3-router
   npm install react-router-dom@^6.26.0
   # 改 App.tsx 接入 BrowserRouter
   # 跑 typecheck
   ```

3. **每完成一个 PR，停下来让用户 review**。v0.3.0 预计 12 个 PR，每个 PR 跑完 typecheck + 现有测试再继续。

4. **保留 v0.2 文档作为历史参考**。新文档**不覆盖** v0.2。
