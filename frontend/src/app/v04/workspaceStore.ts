/**
 * StudyKit v0.4 — `WorkspaceAuthBridge` (converged)
 *
 * Thin React glue between the v0.3 `useAuth()` hook and the
 * pure-JS `workspaceFlavour` store in `application/`. The store
 * is the single source of truth; this component keeps it in sync
 * with the v0.3 auth state.
 *
 * Mounted once, inside `<AuthProvider>`. The component renders
 * nothing; its only effect is to call
 * `workspaceFlavour.reconcileAuth(...)` whenever auth changes.
 *
 * No try/catch around hooks. No closure-on-first-render bugs.
 */

import { useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import { workspaceFlavour } from '../../application/workspaceFlavour';

export function WorkspaceAuthBridge(): null {
  const auth = useAuth();
  useEffect(() => {
    workspaceFlavour.reconcileAuth({ user: auth.user, workspace_id: auth.workspace_id });
  }, [auth.user, auth.workspace_id]);
  return null;
}
