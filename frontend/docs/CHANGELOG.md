# StudyKit Changelog

## [unreleased] — Lit-Hub Refactor

A follow-up to the Literature Hub v2 PR (`codex/lit-hub-redesign`) that addresses the ~20 issues from code review. Touches 12 files, adds 11 new files.

### Data safety (P0)

- **#4 PaperWorkspace data-loss bug** — `useEffect` that re-seeded `editableData` from `paper.extracted_data` no longer clobbers unsaved edits when the parent refetches. The effect now bails on `paper.id` match via a `lastInitializedPaperIdRef`. See [PaperWorkspace.tsx:88-114](frontend/src/components/literature/PaperWorkspace.tsx#L88-L114).

### Security & a11y (P1)

- **#1 CSP tightened** — `connect-src` in [frontend/nginx.conf](frontend/nginx.conf) switched from `localhost` to `127.0.0.1` (predictable) for ports 8000/11434/1234. A block comment documents the threat model (loopback-only is acceptable; remote traffic must go through `/api/`).
- **#7 Drag handles get a11y** — New `useDragResize` hook returns `separatorProps` with `role="separator"`, `aria-orientation`, and live `aria-valuenow/min/max`. Applied to AI chat resize, PaperWorkspace PDF/side divider, and the App sidebar.
- **#8 `parseAIContent` is now robust** — Gates on the marker being on its own line (not mid-sentence), requires `1. <text>` (number + dot + non-space) for numbered steps, returns the original text when no numbered steps follow. The function is now exported for testing.
- **#9 localStorage writes on commit only** — `useDragResize` with `persistKey` writes once on `pointerup`, not on every `mousemove`. AI chat panel height and sidebar width both go through this path.
- **#18 react-markdown `<a>` security** — Added a `CustomLink` component (`target="_blank" rel="noopener noreferrer"`) and applied it via `components={{ a: CustomLink }}` to all chat message renders in `AIChatPanel.tsx`.
- **#2/#3 Localhost warning** — `handleSend` in `AIChatPanel` logs a `console.warn` if the custom LLM `baseUrl` is not on loopback. This makes credentials and paper content leaving the machine visible to the user.

### Correctness & performance (P2)

- **#5 PaperWorkspace save race** — `handleFieldChange` / `handleStatusChange` / `handleImportanceChange` now go through a single debounced `persist` that coalesces all changes into one PATCH ~400ms later. `handleSave` (the explicit button) flushes immediately. Burst-clicking the star 4× now sends one PATCH, not four.
- **#6 AI extraction dedup** — New [extract-batch.ts](frontend/src/lib/literature/extract-batch.ts) helper. Replaces 4+ near-duplicate `for (const paper of papers) { … extractWithFallback … }` loops in `SummaryTable`, `ReadingListsView`, `ZoteroImportPanel`. One `createAIExtractionService` per batch, consistent error handling, `AbortSignal` support, per-paper `onProgress` callback.
- **#10 `sanitizeResponse` JSON scan capped** — Pathological LLM output (lots of unmatched `{` `}`) can no longer hang the browser. The function bails after 20 `JSON.parse` attempts and returns the cleaned input.
- **#11 Dead code removed** — `ReadingListsView.handleExtractAll` no longer calls `literaturePapersApi.list('')` or builds a dead `projectIds` set; it now derives the target papers from `litPapers` already in the store.
- **#12 Zotero import progress** — `handleImportAndExtract` shows `"Extracting 3/7…"` via the new `onProgress` callback.
- **#13 Graph view auto-refreshes** — `App.tsx` graph fetch effect now also depends on `litPapers.length`, so adding a relation in `PaperWorkspace` reflects in the Graph tab without a manual refresh.
- **#16 Drag-resize consolidation** — New `useDragResize` hook unifies 4 of the 5 inline drag-resize handlers. The 5th (SummaryTable column/row resize with dynamic keys) stayed inline with pointer-event parity, since the hook's stable-startValue signature doesn't fit a dynamic-key use case. Pointer events are used everywhere for touch/pen support.
- **#19 `AddAnnotationButton` icon fix** — The two ternary branches used to render the same `AnnotationIcon`; now existing → `AnnotationIcon`, new → `CommentIcon` (new in [Icons.tsx](frontend/src/components/ui/Icons.tsx)).

### Style & process (P3)

- **#14 Tightened `importance` typing** — New [type-guards.ts](frontend/src/lib/literature/type-guards.ts) exports `isReadingStatus`, `safeReadingStatus`, and `clampImportance` (clamps to `0|1|2|3|4|5`). Replaces loose `paper.importance || 0` and `paper.reading_status as any` in PaperWorkspace.
- **#21 Dead code deleted** — [proxy-fetch.ts](frontend/src/lib/literature/proxy-fetch.ts) was orphaned (no callers, the backend endpoint doesn't exist). Removed.
- **#23 Explicit dependency** — `react-markdown` was already in `package.json`, no change needed.
- **Vitest added** — [vitest.config.ts](frontend/vitest.config.ts) + [src/test/setup.ts](frontend/src/test/setup.ts) wired in. New scripts: `pnpm typecheck`, `pnpm test`, `pnpm test:watch`. DevDeps added: `vitest@^2`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6`, `happy-dom@^15`.

### Test coverage

Six new test files:

- [useDragResize.test.ts](frontend/src/hooks/useDragResize.test.ts) — pointer events, axis, clamping, commit, localStorage, unmount cleanup, percent-of-container.
- [extract-batch.test.ts](frontend/src/lib/literature/extract-batch.test.ts) — success per paper, error patching, abort signal, vision mode.
- [custom-ai-client.test.ts](frontend/src/lib/literature/custom-ai-client.test.ts) — fence stripping, first-valid-JSON, candidate cap, fallback to original text.
- [AIChatPanel.test.ts](frontend/src/components/literature/AIChatPanel.test.ts) — `parseAIContent` edge cases (missing marker, mid-sentence marker, real CoT, no numbered steps, single step, leading whitespace).
- [PaperRelationsGraph.test.ts](frontend/src/components/literature/PaperRelationsGraph.test.ts) — N positions, determinism, bounds clamping, dangling edges.
- [type-guards.test.ts](frontend/src/lib/literature/type-guards.test.ts) — reading-status guards and importance clamping.

### Deferred

- **#20 Per-field Zustand selectors** — `useStore` selectors re-create on every render. Out of scope for this refactor (would touch every consumer). Tracked for follow-up.
- **Liquid Glass class migration** — Several inline-style patterns in `PaperWorkspace` could be replaced with `liquid-glass.css` classes (`.glass-header`, `.glass-tab`, `.glass-card`). Skipped to keep the diff focused; tracked for a follow-up UI pass.
