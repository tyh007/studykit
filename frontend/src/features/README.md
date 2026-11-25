# `features/`

Vertical slices that combine domain rules, application services, and
UI for one product surface. Future packets will add:

- `features/study/` — Course / Lecture / Review.
- `features/research/` — Project / Library / Evidence / Output.
- `features/reader/` — Shared source reader used by both modes.
- `features/canvas/` — Cognitive canvas adapter (WP-06).
- `features/review/` — Active recall queue.
- `features/ai/` — Intent Capsule, Action Registry, Draft Layer
  (WP-03).

WP-00 ships nothing here. The existing `components/literature/canvas/`
codebase is the Research Canvas *legacy adapter*; it stays where it
is and is reached through a thin wrapper from `features/canvas/`
when WP-06 lands. **Do not** rename or move it in this packet.

## Import rules

`features/` consumes inner layers and `shared/`. It must not
import the things that would couple it to a specific composition
choice or to a specific platform runtime.

- `features/*` MAY import from `domain/*`, `repositories/*`,
  `application/*`, `shared/*`.
- `features/*` MAY import from legacy `components/*` **only from
  the dedicated legacy-adapter slice** (e.g. `features/canvas/`
  when WP-06 lands). The rest of `features/*` MUST NOT reach into
  `components/` directly.
- `features/*` MUST NOT import from `platforms/`. The composition
  root (`app/`) binds a platform adapter; a feature never picks
  one itself.
- `features/*` MUST NOT import from `app/`. Feature flags are
  read by the composition root and passed in, or read at the
  feature's outermost entry component only.
- `features/*` MUST NOT import from other `features/*` slices. If
  two features need to share code, lift it to `shared/*` first.

### Why these rules matter

- A feature that imports `platforms/` is no longer a clean slice
  — it can no longer be mounted in a different runtime without
  its dependencies changing.
- A feature that imports `app/` pulls in the composition root,
  which is the wrong direction: the composition root mounts the
  feature, not the other way around.
- A feature that imports another feature creates a hidden
  cross-slice dependency that the composition root can no longer
  reason about.
