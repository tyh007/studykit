/**
 * StudyKit v0.4 — `useDataApi` hook
 *
 * Returns the active `DataApi` for the current workspace flavour.
 * When the flavour is `'local'`, the gateway hits Dexie; when
 * `'sync'`, it forwards to the existing v0.3 `lib/api` clients.
 *
 * The component does NOT have to `if (local)` itself — it just
 * calls `dataApi.modules.list()` and the gateway routes the call.
 * This is the single switch point required by WP-02 Gate §2.
 *
 * The flavour comes from the module-level
 * `workspaceFlavour.subscribe` / `getSnapshot` in
 * `application/workspaceFlavour`. No React rules violations.
 */

import { useSyncExternalStore } from 'react';
import { getDataApi, type DataApi } from './dataGateway';
import { workspaceFlavour } from './workspaceFlavour';

export function useDataApi(): DataApi {
  const flavour = useSyncExternalStore(
    workspaceFlavour.subscribe,
    workspaceFlavour.getSnapshot,
    workspaceFlavour.getSnapshot,
  );
  return getDataApi(flavour);
}
