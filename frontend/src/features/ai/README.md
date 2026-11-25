# `features/ai/` — AI Interaction Kernel + Universal Intent Capsule

This is the **system-level** AI surface for StudyKit v0.4. The whole
slice implements WP-03. Nothing here is a chat sidebar; every interaction
is `intent → product action → draft → accept/reject`.

## Mental model

```
                    ┌────────────────────────────┐
                    │     AppShell (one mount)   │
                    │  <IntentCapsuleProvider/>  │
                    └────────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
   ┌──────────▼────────┐  ┌──────▼──────┐  ┌────────▼───────┐
   │ ContextResolver   │  │  Action     │  │ Assistant      │
   │ (route, focus,    │  │  Registry   │  │ SessionStore   │
   │  selection, pin)  │  │  (typed)    │  │ (pure JS)      │
   └──────────┬────────┘  └──────┬──────┘  └────────┬───────┘
              │                  │                  │
              └────────┬─────────┘                  │
                       ▼                            ▼
                ┌──────────────┐               ┌────────────┐
                │ Permission   │               │ DraftLayer │
                │ Gate         │               │ (lifecycle │
                └──────┬───────┘               │  + prov.)  │
                       ▼                       └────────────┘
                ┌──────────────┐
                │ Provider     │  ──► application/dataApi (gateway)
                │ Router       │
                └──────────────┘
```

## What is in scope (WP-03)

- `ContextResolver` (pure): selection > current view > container.
- `ActionRegistry` (typed): four safe actions live here —
  `navigate`, `search-local`, `create-free-note-draft`, `explain-selected-text`.
- `PermissionGate` (pure): workspace flavour, provider, visibility,
  cross-container, no-undo checks.
- `ProviderRouter`: thin wrapper over `application/dataApi`. **No raw
  provider imports.**
- `AssistantSessionStore` (pure JS): prompt, selection, pinned, scope,
  draft, error, focus-restore.
- `DraftLayer`: lifecycle `suggested → generating → draft → accepted |
  rejected | failed | cancelled`.
- `IntentCapsule` + `IntentCapsuleProvider` + `openCapsule` adapter.

## What is out of scope (deferred to later packets)

- `Question`, `Attempt`, `Feedback`, `Review` (WP-04).
- `Evidence`, `Claim`, `Citation`, `ResearchDecision` (WP-05).
- `CanvasAIAssistant` replacement (WP-06 — the existing panel stays).
- `desktop-quick-access` / `transition` / `workspace` invocation
  surfaces (reserved ids, not wired).
- AI-generated body streaming (the layer has the seam; the action
  does not exercise it).

## Import rules

- `features/ai/*` MAY import from `domain/*`, `repositories/*`,
  `application/*`, `shared/*`, `app/feature-flags`, `app/v04`.
- `features/ai/*` MUST NOT import from `lib/api`, `lib/literature-api`,
  `lib/literature/*`, or any AI client.
- `features/ai/*` MUST NOT import from `platforms/*`. The composition
  root binds the dataApi.
- `features/ai/*` MUST NOT import from `components/*`. The integration
  adapters live in this slice as the public `openCapsule` API.

## How to use

```ts
import {
  IntentCapsuleProvider,
  registerSafeActions,
  openCapsule,
  __resetAiKernelForTests,
} from './features/ai';
import { buildProviderRouter } from './features/ai';
import { getDataApi, type Capability } from './application/dataApi';

// 1. Register the safe actions once, after the dataApi is wired.
registerSafeActions({
  providerRouter: buildProviderRouter({
    flavourProbe: () => getDataApi().flavour,
    capabilityProbe: (cap) => getDataApi().supports(cap as Capability),
    chat: async (req) => {
      const r = await literatureAiApi.chat({ messages: req.messages });
      return { content: r.message.content, provider: 'cloud' as const };
    },
  }),
  noteWriter: async ({ title, body, moduleId }) => {
    const note = await notesApi.create({ title, body, module_id: moduleId });
    return { id: note.id };
  },
});

// 2. Mount the provider once, in the AppShell, behind v04Assistant.
<V04Shell>
  <StudyKitAppContent mode="embedded" />
  <IntentCapsuleProvider />
</V04Shell>

// 3. Open the capsule from any surface.
openCapsule({
  surface: 'selection',
  selectedText: window.getSelection()?.toString() ?? null,
  selectedObjectIds: ['note-7'],
});
```

## Tests

| File | What it covers |
|---|---|
| `kernel/contextResolver.test.ts` | scope ranking, hash determinism, visibility rules |
| `kernel/actionRegistry.test.ts` | register / get / list / run / scope filter |
| `kernel/permissionGate.test.ts` | provider / visibility / scope / mismatch |
| `kernel/draftLayer.test.ts` | lifecycle, terminal freeze, body / provenance patch |
| `kernel/sessionStore.test.ts` | open / close / pin / clearTransient / cancel |
| `kernel/providerRouter.test.ts` | local refusal, sync probe, error normalisation |
| `kernel/actions/safeActions.test.ts` | four safe actions + Accept/Reject flow |
| `ui/IntentCapsule.test.tsx` | two-surface open, scope edit, AI failure, Accept/Reject, flag-off |

## Gate evidence (WP-03)

- `npm test -- --run` passes; tests are *behavioural* (no
  placeholder assertions, no string-reading the source).
- `npm run typecheck` passes.
- `npm run build` passes.
- `git diff --check` passes.
- `isFeatureEnabled('v04Assistant') === false` → no new UI is mounted.
- Two surfaces (Lecture / Reader+Canvas) reach the same
  `assistantSession` via `openCapsule`.
- AI failure produces a `failed` draft, prompt + selection preserved.
- Reject does not write to canonical state.
