# `application/`

Use cases and orchestration. Pure functions / services that combine
domain rules and repository contracts to do work for features — for
example: "explain a selection", "audit citations for an output",
"rebuild the local search index".

WP-00 ships no application services; the existing top-level
`App.tsx` and `lib/*` modules continue to hold the current
behaviour. Application services land alongside the WP-04 / WP-05
longitudinal paths.

## Import rules

`application/` is an **inner** layer. It must not depend on any
outer layer.

- `application/*` MAY import from `domain/*`, `repositories/*`.
- `application/*` MUST NOT import from `platforms/*`, `app/*`,
  `features/*`, `shared/*`, or `components/*`.

### Why the rules matter

- A use case must run against the `StudyKitRepository` *contract*,
  not a concrete platform adapter. Reaching into `platforms/`
  would bind a use case to a specific runtime and break the
  Web / Desktop swap the architecture exists to support.
- A use case must not read feature flags. The composition root
  (`app/`) reads flags and passes the result in, so a use case
  never has to know whether `v04Shell` is on.
- A use case must not import UI from `features/` or `components/`.
  Application services are headless; rendering is the feature's
  job.
