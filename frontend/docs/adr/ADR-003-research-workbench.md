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

## P2 implementation notes (2026-11-26)

- **Verification is the relation choice.** `captureExcerpt` creates an excerpt (Evidence) and, when the user picks a point (Claim), verifies it and writes the link in one transaction. The required user interpretation is the user's note, or, if none, their explicit choice recorded as `Supports: <point>` / `Contradicts: …` / `Qualifies: …`. It is the user's act, never AI text, so the "verified evidence carries the user's interpretation" invariant holds. An excerpt saved without a point or note stays a `candidate`.
- **Two actions.** Select text → "Add to a point…" → click a point (or type one and press Enter). The older full form stays behind "Details…".
- **Ledger.** `buildLedger` (pure) classifies each point as no support, contested, single source or supported (two or more sources, no contradiction), and lists unconnected excerpts. The workbench shows it as a "What's missing" bottom panel that appears once a project has a point or an excerpt; items open the evidence editor or the source at the excerpt's page.
- **Fix found on the way.** `LiteraturePDFViewer` rendered only a canvas, so PDF text could not be selected in the real app; selection capture only worked in tests. It now renders pdf.js's `TextLayer` (minimal CSS in `pdf-text-layer.css`), and the canvas is no longer scaled down by `max-width`, which would misalign the text layer.
- Selections outside the PDF area are ignored; excerpts are capped at 2,000 characters (previously 240, silently).

## P3 implementation notes (2026-11-26)

- **Argument editor (`argument` kind, one per project).** The project's points in order, each with four slots: *Evidence* (supports), *Why it holds* (the claim body), *Against it* (contradicts) and *Limits* (qualifies). An empty slot is a dashed gap with one action. *Against it* and *Limits* can instead be marked "Looked — none found", so a point is complete only when the user has considered each slot, not merely filled the easy ones.
- **No new tables.** Slots are `ClaimEvidenceLink`s, reasoning is `Claim.body`, and order plus the two "none found" marks live in a new optional `Claim.argument` field (`order`, `noCounter`, `noLimits`). Older records without it sort by creation time. Web (Dexie) and desktop (`domain_records`) storage are unchanged.
- **Only checked excerpts can be cited** (`citeInSlot` rejects candidates; citing the same excerpt in the same slot twice is a no-op). The picker lists only verified excerpts; when there are none, it offers to open a source beside the argument to highlight one (P2 capture), which updates the argument live.
- **Sources beside the argument.** Clicking a cite opens the Reader at that page in a side pane inside the editor (stacked when the editor is narrower than 960 px, via a container query), with "Open in a tab". The general split-editor layout stays out of scope.
- **Write it up.** Enabled only when every slot of every point is filled or considered. `composeArgumentDraft` writes, in one transaction, a new Output ("Draft from your argument", numbered if taken): one section per point and one statement per filled slot, with every cited excerpt attached as a `StatementSupport` of the matching relation. The text is assembled from the user's own words (point, reasoning, notes); no AI. In the workbench, a draft's evidence citation opens the source at the cited page.
- "What's missing" point gaps now open the argument scrolled to that point; the explorer lists *Argument* under *Writing* once the project has an excerpt or a point.

## P4a implementation notes (2026-11-26)

P4 is delivered in two steps. **P4a** (this one) is local: threads, the panel and the thinking-partner moves. **P4b** syncs shared threads to project members (op kinds, server-side author and role checks, share dialog).

- **Storage as decided in §4.** `ResearchRepository` gains `ai_thread`, `ai_message` and `ai_draft_decision` (memory, Dexie v12 tables, desktop `domain_records`, Rust allow-list). `appendAiMessage` / `appendAiDraftDecision` refuse an id that already exists, so messages and decisions are append-only in every adapter. Deleting a thread removes its messages and decisions. Additions to the §4 shape: `AiContextRef.label`, and on `AiMessage` the optional `move` (`ask | challenge | missing`), `aiRole` and `skippedOwnThinking`. `AiDraftDecision` also carries `projectId` and `threadId`.
- **Panel.** The right side bar (`state.aiOpen`, persisted; floats over the editor below 1180 px). The header Ask button and Cmd/Ctrl+K open it while the workbench is showing, through `setCapsuleOverride` in `openCapsule`. Requests carrying their own context or action args (canvas, selection) still open the capsule. On screen: a conversation picker, the context chips (removable), one input with Send, one **Challenge** button with four voices (skeptic, methods reviewer, outside reader, second examiner) and **What am I missing?**.
- **Small steps by prompt.** The system prompt limits replies to three sentences, one step and a question back, and to the project context. The context is the focused editor (the argument outline, a source's excerpts, a draft's title, otherwise the point list) plus the project question, stored on both messages exactly as sent (≤ 2,000 chars each).
- **Think first, then look.** What am I missing? asks for the user's own ideas first. "Just show me" is always available; the message records `skippedOwnThinking` and the thread shows "Asked before writing own ideas".
- **Drafts.** A reply may end with a fenced `suggestions` block (`{"points": [...]}`, at most two). These become cards; nothing is written until **Add to argument**, which runs `addPoint` (claim marked `aiSuggested`, `authorType: 'ai'`, `draftId`) and appends an `applied` decision with the claim as `resultRef`. Dismiss appends `rejected`. A card can be decided once. P4a ships the `add-point` action only (see P4b for why cards don't go through `ActionRegistry`).
- **Sharing.** New threads are `shared`; a checkbox keeps a new one private; private → shared asks for confirmation; there is no way back. In a local-only workspace `shared` has no effect until P4b.
- **AI off / failures.** Without a reachable provider the panel says so, keeps the typed text and leaves threads readable. A provider error is stored as a `failed` reply with **Try again**, which posts a new turn (no message is edited).
- Messages are attributed to the signed-in user, or `local` (`useCurrentUserId`).

## P4b implementation notes (2026-11-26)

- **When threads are sent.** Shared threads go to the collaboration outbox only while the project has another member. The server keeps the op log and a member who joins later pulls all of it, so pushing while alone would hand every earlier conversation to the first person invited. Instead, a thread gets `publishedAt` when it is first sent. When a project gains members, the AI panel asks the user which of their unsent shared conversations members may see ("Earlier conversations"). Ticked ones are sent in full (thread, then messages, then decisions). Unticked ones become private, which is honest because they never left the device. This replaces the share-dialog step in §5: in this codebase a sync project exists on the server from creation, and "first shared" means "first other member".
- **After that.** New messages and decisions in a sent thread follow immediately. A new shared thread is sent from its first message. Rename sends `ai-thread-updated`. Private → shared sends the whole history (`publishThread`). Private threads never enter the outbox. Ops are enqueued through `recordCollabOp` right after the local write. They are not in the same transaction, because AI threads live in the Research store and the outbox in the collaboration store. The op id makes resends safe, and the drain retries failures.
- **Server (`backend/routes/collab.js`).** `ai-thread-created`, `ai-thread-updated`, `ai-message-appended` and `ai-draft-decided` are allowed for owners and editors only. `checkAiThreadOp` enforces:
  - payloads up to 256 KiB, in the same project;
  - only `shared` threads;
  - `createdBy` / `authorId` / `decidedBy` equal to the caller;
  - a thread id can't be claimed by another member, and its creator can't change;
  - messages and decisions only for a thread already published in that project.

  The rules are checked in `backend/tests/collab.test.js`.
- **Client rule.** The permission matrix gains `ai-thread.read` (all roles) and `ai-thread.post` (owner, editor). Commenters and viewers see shared conversations read-only. Their new conversations are private.
- **Receiving.** `syncService` validates incoming AI ops with the domain guards and writes them through `aiApplyTarget`. A received thread counts as sent. Messages and decisions that already exist are skipped. Private or malformed payloads are ignored. A remote "applied" decision is recorded, not re-applied: the canonical point stays on the applying member's device, as §5 says. Messages from other members show their name ("asked by Ana").
- **Draft actions.** Cards are accepted through one typed table, `AI_DRAFT_ACTIONS` in `aiPartner.ts`, that runs the same use case a user action would. They don't go through the capsule's `ActionRegistry`: those actions create new drafts from a context packet and appear as capsule chips, while a card is already a draft being accepted.
- **Not verified end to end in two browsers.** The Playwright collaboration smoke's API phase passes against the real backend. Its browser phase needs a Playwright browser download that was not done.

## P5a implementation notes (2026-11-26)

P5 is delivered in two steps. **P5a** (this one) works for one person: brainstorming that turns into the argument, and disagreements as records. **P5b** adds the group parts: brainwriting (write separately, reveal together), syncing ideas and disagreements to members, the AI moderator and the meeting agenda.

- **Not the spatial canvas.** The existing cognitive canvas (React Flow, its own store, `v04Canvas`) has no groups and needs pointer skill to use. Brainstorming is a new `brainstorm` editor instead: type an idea and press Enter (one card each), name groups, and move cards into them with each card's Group menu. The canvas stays as it is, reachable from the explorer; unifying the two is P7 work.
- **Storage.** New Research entity types `brainstorm` (groups embedded), `idea`, `disagreement` and `disagreement_position`, with the same adapters as P4 (memory, Dexie v13, desktop `domain_records`, Rust allow-list).
- **Clusters → argument in one step.** "Turn into argument" makes each group that has ideas a point, in group order, after the existing points, in one transaction. A group remembers its point (`claimId`), so running it again adds only new groups. Ideas are not copied into "Why it holds": that slot stays a gap until the user writes the reasoning.
- **Think first.** "What am I missing?" appears after three of the user's own ideas. "Show me now" is always offered; using it sets `askedAiEarly` on the brainstorm. Suggestions are temporary cards; **Add** stores them as ideas with `authorType: 'ai'`.
- **Disagreements.** Raised from a point ("Someone disagrees") or free-standing. Each view (`DisagreementPosition`) states a stance, optionally whose view it is ("Supervisor"), and is backed only by checked excerpts. Settling requires a written outcome. A view can prevail only if it has evidence, or the outcome can be "neither outright / both in part". Settled disagreements are read-only records; to revisit, open a new one. Open disagreements appear on their point, in "What's missing" and in the explorer's **Thinking** group (which also offers **+ Brainstorm** once the project has a source or a point).
- **Found while testing.** Fast typing in the idea box merged ideas, because the box was cleared only after the save. It now clears at once and restores the text if the save fails. Idea order stays in typing order even when saves overlap.

## P5b implementation notes (2026-11-27)

P5b adds the group parts on top of P5a.

- **What is shared.** Once the project has other members: group brainstorms (and their ideas) and every disagreement with its views. Solo brainstorms stay on the device. Disagreements written before anyone joined go out on the first sync: they are about the project, not private notes (unlike AI threads, there is no "earlier conversations" chooser).
- **How it is sent.** Not a call in every use case. `useThinkingSync` runs `pushThinking` after local changes (debounced): it sends each row whose content hash differs from what this device last sent or received, and `idea-removed` for an idea that is gone. Received rows are marked, so they are never echoed. Marks live in `localStorage` per project; losing them only re-sends rows. Five op kinds: `brainstorm-saved`, `idea-saved`, `idea-removed`, `disagreement-saved`, `disagreement-position-saved`. Conflicts: last write wins by `updatedAt`, except that a settled disagreement is never reopened and a reveal is never undone.
- **Points and excerpts don't sync**, so a disagreement carries its point's title (`pointTitle`) and each view a copy of its excerpts (`citations`: quote, source, page), taken when attached. Members without the excerpt see the copy; a settled record keeps it even if the excerpt is later removed.
- **Who does what.** New capabilities `thinking.contribute` (owner, editor, commenter) and `thinking.manage` (owner, editor). Managers open and settle disagreements and may group or back anyone's ideas and views; commenters add and change their own ideas and views; viewers read. A group brainstorm's prompt, groups, reveal and conversion belong to the person who started it. The server (`checkThinkingOp` in `backend/routes/collab.js`) enforces the same rules: nobody writes as someone else, changing another member's row needs an existing row by that member, a settled disagreement can't be reopened, a reveal can't be undone.
- **Brainwriting.** The host chooses "Just me" or "The group" before the first idea. In group mode each member sees only their own ideas and how many each other member has written, until the host reveals them all at once. The AI's "What am I missing?" sees only the asking member's ideas before the reveal. Unrevealed ideas do reach members' devices and are hidden by the editor: the aim is to avoid anchoring, not secrecy.
- **AI moderator, not author.** After a reveal, a note lists ideas nobody has put in a group ("not picked up yet"), computed, no AI. On a disagreement with two or more views, "Where do we stand?" asks the AI to restate each view with what its evidence shows and name the evidence that would settle it. It is told not to pick a side; its text is shown labelled and is not stored in the record. Devil's-advocate turns are the P4 roles.
- **Meeting agenda.** A new `agenda` editor (explorer: **Meeting agenda**, shown once the project has members or disagreements) built from the project: open disagreements to decide, excerpts linked against a point since the last meeting, disagreements settled since then, group brainstorms waiting on a reveal or a decision, and up to five points missing support. **Copy as text** gives Markdown; **Mark meeting held** stores `lastMeetingAt` on the project (this device's user), so the next agenda shows only what's new.
- **Not verified end to end with two members.** Two-device behaviour is covered by tests that push from one in-memory repository through `pullAndApply` into another, and by backend tests per role. A real two-browser run against the backend was not done.

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
