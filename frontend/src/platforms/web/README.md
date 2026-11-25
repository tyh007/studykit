# `platforms/web/`

Web-only adapters. WP-00 ships nothing here. Future packets will add:

- `web-repository.ts` — a `StudyKitRepository` that wraps the existing
  Dexie tables in `src/lib/db.ts` without changing the on-disk schema
  or the live behaviour of current components.
- `web-files.ts` — browser File / OPFS / clipboard helpers.
- `web-auth.ts` — current `useAuth` flow becomes a thin adapter
  around the future, auth-optional shell (WP-02).

Until that work lands, **do not** import Dexie from new code. New
features and application services read and write through the
`StudyKitRepository` contract in `repositories/*`; the in-memory
`MemoryRepository` is good enough for spike work and tests.
