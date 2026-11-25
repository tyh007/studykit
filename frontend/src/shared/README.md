# `shared/`

Cross-cutting utilities and design-system primitives that are *not*
domain-specific. Future packets will add:

- `shared/ui/` — Button, Input, Surface, Pill, IconButton,
  StatusLabel, VisuallyHidden (WP-01).
- `shared/theme/` — Theme runtime (system / light / dark) (WP-01).
- `shared/commands/` — global keyboard / intent handlers.
- `shared/format/` — dates, citation rendering, markdown helpers.

WP-00 ships nothing here. The existing `index.css`,
`styles/liquid-glass.css`, and `components/ui/*` are the *legacy*
design system; new components in v0.4 should consume the future
`shared/ui/*` primitives, but **only** new components — do not
mechanically rewrite old ones.

## Import rules

`shared/` is the **independent utility** layer. It does not know
about StudyKit's domain, persistence, use cases, features, or
boot order.

- `shared/*` MAY import only from `shared/*` (itself) and from
  external npm packages. It has no business or platform
  dependencies.
- `shared/*` MUST NOT import from `domain/`, `repositories/`,
  `application/`, `platforms/`, `features/`, `app/`, or
  `components/`.
- The UI/composition layers (`features/` and `app/`) MAY import from
  `shared/*` when they need a design-system primitive or a generic
  utility. The pure inner layers and platform adapters do not.

### Why the rules matter

- `shared/` is the only layer with no inner dependency; pulling
  in `domain/` or `repositories/` would make it a hidden
  business module and re-introduce the cycle we are trying to
  prevent.
- Keeping shared primitives available to `features/` and `app/`
  avoids duplication without weakening the inward dependency rule.
