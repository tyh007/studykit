# ADR-003 — Research Workbench and project AI threads

Date: 2026-11-25
Status: Proposed (v0.5 P0). Product decisions confirmed in `studykit_v0.5_research_workbench_refactor_cn.md` §8. Product principles (verification ledger, structure-first thinking, zero-barrier onboarding) in `studykit_v0.5_product_strategy_cn.md`.

## Context

Research Mode renders one full-page surface at a time. `app/v04/researchRouter.tsx` switches on `location.surface` across nine surfaces (`research-home`, `project`, `design`, `task-detail`, `library`, `reader`, `evidence`, `output`, `cognitive-canvas`). Reading a paper hides the evidence; writing an output hides the source.

AI is a modal Intent Capsule (`role="dialog"`, `aria-modal`) backed by one global, in-memory `assistantSession` (`features/ai/kernel/sessionStore.ts`). It has no project scope and no history. Evidence suggestions, output drafts, canvas actions and the legacy `AIChatPanel` / `CanvasAIAssistant` are separate AI surfaces.

The legacy literature hub (`components/literature/`, ~9.6k lines) is unreachable from the v0.4 shell.

Confirmed product decisions:

1. Project workbench in the shape of VS Code: explorer, tabbed editors, right-hand AI panel.
2. AI panel is a conversation thread whose replies embed applicable draft cards.
3. AI threads are shared with project members by default; a thread can be private.
4. The workbench skeleton is mode-agnostic; Research adopts it first, Study later.
5. Legacy literature capabilities merge into the workbench; the old code is then removed.

Constraints this ADR must respect:

- Native storage is one `domain_records(namespace, entity_type, id, payload, updated_at)` table. Every pair is allow-listed in `src-tauri/src/ipc.rs` `validate_domain_pair`; payloads are capped at 2 MiB.
- Collaboration sync is an append-only op log (`collab_op_log`). The server allow-lists op `kind` per role (`ROLE_ALLOWED_OPS` in `backend/routes/collab.js`) and already rejects ops whose author is not the caller (`comment-posted`). Canonical Research objects are not synced; only collaboration ops are.
- AI calls run on the client through `ProviderRouter` with the requesting user's provider and credentials.
- No router dependency (ADR-001). Bundle budget enforced by `scripts/check-performance-budget.mjs`.

## Decision

### 1. Workbench shell

A new `features/workbench/` slice owns layout and editor state. It depends on `domain/` and `application/` only; Research registers into it, so Study can register later without changes to the shell.

Regions: activity bar, side bar (explorer and other views), editor area (tab groups), secondary side bar (project AI), bottom panel, status bar. P1 ships one editor group; P3 adds a second group for side-by-side.

**Progressive disclosure is part of the contract, not polish.** The regions above describe a mature project, not first launch:

- A new project opens with two panes only: sources and writing. The empty state offers exactly two actions, drop a PDF or write what you want to figure out.
- The activity bar, bottom panel, and the design, task and collaboration views stay hidden until the project has content for them or the user invokes them. Explorer groups render only when non-empty.
- The AI panel starts collapsed to a single "Ask" button and becomes a docked panel after first use.
- `WorkbenchState` records which regions have been revealed (`revealed: readonly Region[]`, where `Region` is `'activity' | 'side' | 'ai' | 'panel' | 'design' | 'tasks' | 'collaboration'`), so the layout grows with the project and never resets to the full chrome.
- User-facing copy uses plain words (excerpt, my point, what's missing, someone disagrees), not domain type names.

At widths below 1180 px the AI panel becomes an overlay; below 1024 px the side bar collapses to the activity bar. The 960×640 desktop minimum must stay usable.

Layout uses CSS grid and the existing `useDragResize` hook. No docking library in P1 (see Alternatives).

### 2. Editors

```ts
type EditorKind =
  | 'overview' | 'work' | 'evidence-matrix' | 'claim' | 'output'
  | 'canvas' | 'design' | 'task' | 'search';

interface EditorInput {
  readonly kind: EditorKind;
  readonly id: string;        // object id; projectId for 'overview' and 'search'
  readonly projectId: string;
}
// Tab identity: `${kind}:${id}`. Opening an already-open input focuses it.
```

`EditorRegistry` maps `kind` to `{ load: () => import(...), title(input), icon }`. Each entry stays a lazy chunk.

Editor contract:

```ts
interface EditorProps {
  readonly input: EditorInput;
  readonly active: boolean;
  readonly open: (input: EditorInput, opts?: { preview?: boolean; toSide?: boolean }) => void;
  readonly setDirty: (dirty: boolean) => void;
}
```

Existing surfaces become editors by removing their page header and back button and replacing `onOpenX` / `onBackX` callbacks with `open(...)`. They are already prop-driven (`projectId`, `workId`, callbacks), so no surface is rewritten:

| Editor kind | Existing component |
|---|---|
| `overview` | `ProjectHome` (becomes the default tab, like VS Code's Welcome) |
| `work` | `ResearchReader` |
| `evidence-matrix`, `claim` | `EvidenceWorkspace` |
| `output` | `OutputWorkspace` |
| `canvas` | `CognitiveCanvasView` |
| `design`, `task` | `DesignWorkspace`, `TaskDetail` |
| `search` | `Discovery` |

`Library` and `Sources` become explorer views, not editors.

Single-click in the explorer opens a preview tab (replaced by the next preview); editing or double-click pins it.

### 3. Workbench state and URLs

```ts
interface WorkbenchState {
  readonly projectId: string;
  readonly groups: readonly { tabs: readonly EditorInput[]; active: number }[];
  readonly sideView: 'explorer' | 'search' | 'evidence' | 'tasks' | 'collaboration';
  readonly sideOpen: boolean;
  readonly aiOpen: boolean;
  readonly panelOpen: boolean;
  readonly sizes: { side: number; ai: number; panel: number };
  readonly activeThreadId: string | null;
  readonly revealed: readonly Region[];       // regions the user has grown into
}
```

- Per user, per device, per project. Never synced.
- Desktop: `domain_records` namespace `workbench`, entity type `state`, id = projectId. It travels with the Workspace and its backups.
- Web: a new Dexie table `workbenchStates` (Dexie v12), keyed by projectId.
- Writes are debounced (500 ms) and flushed on blur and on unload.
- Implemented in P1 behind a `WorkbenchStorage` port backed by `localStorage` (see “P1 implementation notes”); the Workspace-backed stores above replace it without touching callers.

URL grammar keeps ADR-001's hash store and encodes only the active editor:

```
#/research/workbench/<projectId>?open=<kind>:<id>
```

Reload restores the full `WorkbenchState` from storage, then focuses `open`. Existing deep links are decoded and redirected to the workbench with the matching `open`:

| Old link | Redirect |
|---|---|
| `#/research/reader/<projectId>?__sid=<workId>` | `open=work:<workId>` |
| `#/research/reader/<projectId>?view=discovery` | `open=search:<projectId>` |
| `#/research/evidence/<projectId>?claim=…` / `evidence=…` / `question=…` | `open=claim:<id>` or `open=evidence-matrix:<projectId>` |
| `#/research/output/<projectId>?__sid=<outputId>` | `open=output:<outputId>` |
| `#/research/cognitive-canvas/<projectId>?__sid=<viewId>` | `open=canvas:<viewId>` (default view id `canvas-<projectId>`) |
| `#/research/project/<projectId>`, `library/…` | workbench with restored tabs |

`AppLocation` gains one surface kind, `workbench`; the nine old surfaces stay decodable for redirects.

### 4. Project AI threads — data model

Two new Research entity types plus one append-only decision record:

```ts
interface AiThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;                      // user-editable; defaults to first prompt
  readonly visibility: 'shared' | 'private';
  readonly createdBy: string;                  // userId, or 'local' in a local-only workspace
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

interface AiMessage {                          // append-only, never edited
  readonly id: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly role: 'user' | 'assistant';
  readonly authorId: string;                   // user who wrote it, or who requested the reply
  readonly body: string;                       // markdown, ≤ 64 KiB
  readonly context: readonly AiContextRef[];   // what the model was given
  readonly drafts: readonly AiDraftProposal[]; // assistant only
  readonly provider: { id: string; model: string } | null;  // assistant only
  readonly status: 'complete' | 'failed' | 'cancelled';
  readonly createdAt: string;
}

interface AiContextRef {
  readonly kind: 'work' | 'evidence' | 'claim' | 'output-section' | 'note' | 'selection';
  readonly objectId: string | null;
  readonly locator: ResearchSourceLocator | null;   // existing type: page, quote hash
  readonly excerpt: string | null;                  // ≤ 2,000 chars, exactly as sent
}

interface AiDraftProposal {
  readonly draftId: string;
  readonly actionId: string;                   // ActionRegistry id that would apply it
  readonly target: { kind: EditorKind; id: string };
  readonly summary: string;
  readonly args: Readonly<Record<string, unknown>>;
}

interface AiDraftDecision {                    // append-only
  readonly id: string;
  readonly messageId: string;
  readonly draftId: string;
  readonly decision: 'applied' | 'rejected';
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly resultRef: { kind: string; id: string } | null;  // canonical object created/changed
}
```

Storage: `research` namespace, entity types `ai_thread`, `ai_message`, `ai_draft_decision`. The only Rust change is extending `validate_domain_pair`. Web uses three new Dexie tables in the same v12 migration. `ResearchRepository` gains matching read/put methods and transaction members.

Messages are append-only, so local storage and sync have no edit conflicts. Regenerate creates a new message. Draft outcomes are separate decision records, so a message never changes after it is written.

`excerpt` records exactly what the model was sent. This keeps the "every answer has context" promise auditable. It is also the privacy surface: shared threads carry paper text to other members.

### 5. Sharing

Default `visibility` is `shared`. The composer shows "Visible to project members" whenever the active thread is shared and the project has other members.

| Transition | Allowed | Why |
|---|---|---|
| private → shared | Yes, with confirmation | Publishes the existing messages |
| shared → private | No | Members may already have the content; claiming it is private again would be false |

Shared threads sync through three new op kinds, appended to the existing outbox in the same transaction as the local write (the WP-08 pattern):

| Op kind | Payload | Allowed roles |
|---|---|---|
| `ai-thread-created` / `ai-thread-updated` | `AiThread` | owner, editor |
| `ai-message-appended` | `AiMessage` | owner, editor |
| `ai-draft-decided` | `AiDraftDecision` | owner, editor |

Commenters and viewers read shared threads but do not post. Server-side checks, mirroring `comment-posted`:

- `authorId` / `decidedBy` / `createdBy` must equal `req.user.id`. An assistant message is attributed to the member who requested it, so AI never posts as itself or as someone else.
- The message's `threadId` must belong to a shared thread in the same project.
- Payload limit 256 KiB per op.

Private threads never enter the outbox. In a local-only project, `shared` has no effect. When a local project is first shared, the share dialog lists its shared-visibility threads and lets the owner exclude any of them before the first push.

Applying a draft runs locally through the applying member's canonical use case. Other members receive the `ai-draft-decided` record, not the canonical change. Canonical Research objects remain unsynced, as they are today.

### 6. AI panel behaviour

- `AiThreadStore` replaces the global `assistantSession` for the panel. It holds the active thread, composer text and in-flight request per project. The Intent Capsule remains as the ⌘K quick-ask; it posts into the active thread and opens the panel.
- Context: `ContextResolver` keeps its order, selection > active editor > project. The active editor supplies context through a `useEditorAiContext()` hook. Context chips are shown before sending and are removable. Users can pin additional objects.
- Tools (Summarize, Extract evidence, Compare papers, Find gaps, Draft section, Search literature) are existing `ActionRegistry` actions surfaced as chips. No AI path bypasses `ActionRegistry` or `PermissionGate`.
- Drafts: an assistant reply may carry `AiDraftProposal`s. "Apply" runs the proposal's `actionId` through `ActionRegistry` → canonical use case → records an `AiDraftDecision`. Nothing is written to canonical objects without that click.
- Offline or AI off: threads stay readable; the composer explains why it cannot send and keeps the typed text.

### 7. Rollout

- Behind flag `v05Workbench`, default off on Web and Desktop until the P1 gate passes. With the flag off, the v0.4 router and Intent Capsule are unchanged.
- Phase order follows the revised plan (§5 of the refactor plan): P1 minimal workbench (shell, editors, explorer, state, URL redirects, progressive disclosure); P2 highlight-to-excerpt verification and the ledger; P3 argument editor (Output upgraded to claim / evidence / reasoning / rebuttal / limitation slots, an `argument` editor kind replacing `output`); P4 AI threads, sync and the panel as specified in §4–§6 of this ADR; P5 canvas brainstorming and collaboration; P6 provenance report and MCP.
- §4–§6 (AI threads) are decided now so P1–P3 do not paint the data model into a corner, but they are implemented in P4.
- Every phase gate includes a zero-barrier check: a new user completes that phase's core task without help.
- Legacy literature merge (P4) needs its own ADR: mapping `legacy/literature_project` and `legacy/literature_paper` rows to canonical `Work`, and annotations to Reader. Nothing is deleted before that mapping is tested.

## P1 implementation notes (2026-11-25)

What shipped in P1 and where it differs from the decisions above:

- **Storage.** `WorkbenchState` persists through the `WorkbenchStorage` port with a `localStorage` adapter (`studykit.workbench.v1.<projectId>`), debounced 300 ms and flushed on `pagehide`, `visibilitychange` and unmount. It does not yet travel with Workspace backups; moving it to `domain_records` (`workbench`/`state`) is deferred until a phase needs it.
- **One-shot params.** Editor params that only express an opening request (`add`, `details`) are marked transient and are not restored after reload.
- **Editor kinds.** P1 registers `overview`, `library` (the existing `Sources` surface), `search`, `work`, `evidence` (the existing `EvidenceWorkspace`, covering both the planned `evidence-matrix` and `claim` kinds), `output`, `design`, `task` and `canvas`. Page headers and back buttons inside surfaces are kept for now; their callbacks open tabs.
- **Mounting.** Only the active editor is mounted, so PDF readers and canvases do not stay alive in hidden tabs. Editor-internal state (scroll, unsaved form text) is therefore not kept across tab switches; revisit if users notice.
- **URL ⇄ tabs.** The URL always names the active editor. Two guards prevent feedback loops: the key last written to the URL is ignored when it echoes back, and an editor requested by the URL suppresses URL writes until it is active.
- **Progressive disclosure.** Explorer groups render only when non-empty; Canvas and Research design appear in a “Thinking” group once opened. A brand-new project shows a start screen with two actions. The shell sidebar is hidden while the workbench is active. AI panel, activity bar and bottom panel are not part of P1.
- **Fix found on the way.** The Web Research, Study and Collaboration Dexie repositories registered change hooks with the Dexie 3 object form, which Dexie 4 silently ignores, so `subscribe` listeners never fired on Web. They now use the event form (as the Canvas repository already did), and the test fakes model Dexie 4's API.

## Alternatives rejected

- **Keep page routing and add a side AI panel.** Fixes AI scope but not the one-object-at-a-time problem.
- **Docking library (dockview, golden-layout, FlexLayout).** 30–90 KB gzipped and a second layout model. Fixed regions plus one optional split cover the confirmed design. Revisit if P3 needs arbitrary docking.
- **`react-router`.** ADR-001's reasons still hold; the workbench needs one route.
- **Server-side AI threads only.** Breaks local-first and offline reading; local-only projects would have no history.
- **Storing threads as `collab_activities`.** Activities are short feed items with their own retention and UI semantics. Threads need ordered, larger, append-only bodies.
- **Mutable messages with draft status inside.** Creates edit conflicts across members. Separate decision records keep both storage and sync append-only.
- **Shared → private un-sharing.** Cannot be honoured once synced. Not offered.

## Consequences

- Rust: three entity types added to the `research` allow-list; one `workbench`/`state` pair. No new table or IPC command.
- Web: Dexie v12 adds `workbenchStates`, `aiThreads`, `aiMessages`, `aiDraftDecisions`.
- Backend: three op kinds in `ROLE_ALLOWED_OPS`, author checks, payload limit; collaboration tests for each role.
- Backups include AI threads. The privacy and data notes must say that shared threads contain excerpts sent to the AI provider and shared with members.
- Research production tests that assert page-level `data-testid`s and router surfaces are rewritten in P1 to "open editor" assertions. Existing use-case and repository tests are unaffected.
- `features/ai/README.md` "Nothing here is a chat sidebar" is superseded for Research by this ADR; the kernel boundaries it lists still hold.
- The shell enters the first-load path; the performance budget gate applies to P1.

## Open questions for P1

1. Explorer grouping for sources: by reading status (default) or by tag/collection?
2. Should the `overview` tab reopen on every project open, or only when no tabs are restored?
3. Keyboard map: adopt VS Code defaults (⌘P, ⌘⇧P, ⌘B, ⌘\\) where they do not collide with existing StudyKit shortcuts (Quick Capture uses ⌘⇧Space)?
