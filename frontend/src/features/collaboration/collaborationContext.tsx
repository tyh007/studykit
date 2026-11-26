/**
 * StudyKit v0.4 — `features/collaboration/collaborationContext`
 *
 * The single React context that hands a `CollaborationDeps`
 * (the live `CollaborationRepository` + the local user
 * id / display name + the realtime channel) to every
 * Collaboration surface. The context value is built
 * once by the wiring component and never changes
 * identity (the repository, the user identity and the
 * channel are stable across the session).
 *
 * The default value is a `null` so a misuse (no
 * `<CollaborationProvider>` ancestor) fails fast at the
 * call site instead of silently returning `undefined`.
 * The `useCollaborationDeps()` hook throws with a
 * helpful message.
 *
 * Mounting is gated on the `v04Collaboration` feature
 * flag (see `app/feature-flags.ts`); a flag-off build
 * never mounts the provider, and the surfaces do not
 * render at all.
 */

import React from 'react';
import type { CollaborationRepository } from '../../application/collaboration/collaborationRepository';
import type { RealtimeChannel } from '../../application/collaboration/realtimeSpike';
import type { SharedProjectSummary } from '../../lib/collab-api';

export interface CollaborationDeps {
  readonly repository: CollaborationRepository;
  readonly localUserId: string;
  readonly localUserDisplayName: string;
  readonly channel: RealtimeChannel;
  readonly workspaceFlavour?: 'local' | 'sync';
  readonly listSharedProjects?: () => Promise<readonly SharedProjectSummary[]>;
  readonly createSharedProject?: (input: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
  }) => Promise<void>;
  readonly syncProjectMembers?: (projectId: string) => Promise<void>;
  readonly inviteSharedMember?: (input: {
    readonly projectId: string;
    readonly userId: string;
    readonly displayName: string;
    readonly role: 'editor' | 'commenter' | 'viewer';
  }) => Promise<void>;
  readonly changeSharedMemberRole?: (input: {
    readonly projectId: string;
    readonly userId: string;
    readonly role: 'editor' | 'commenter' | 'viewer';
  }) => Promise<void>;
  readonly removeSharedMember?: (input: {
    readonly projectId: string;
    readonly userId: string;
  }) => Promise<void>;
  readonly bootstrapLocalOwner?: (projectId: string) => Promise<void>;
  /**
   * WP-08 Round 2: best-effort outbox enqueue.
   * The use cases call this after a successful
   * `transact(...)` so the cross-user op log
   * carries the event. The wiring sets this to
   * a real `enqueueOp` from `syncService.ts`
   * when the gateway is enabled; the default
   * (when the slice is mounted without a
   * gateway) is a no-op so unit tests and the
   * realtime-only path keep working.
   */
  readonly recordCollabOp?: (input: {
    readonly kind:
      | 'membership-bootstrap'
      | 'member-added'
      | 'member-role-changed'
      | 'member-removed'
      | 'comment-posted'
      | 'comment-resolved'
      | 'activity-logged'
      | 'task-shared'
      | 'conflict-detected'
      | 'ai-thread-created'
      | 'ai-thread-updated'
      | 'ai-message-appended'
      | 'ai-draft-decided';
    readonly payload: unknown;
    readonly baseVersion?: number | string;
  }) => void;
  /**
   * WP-08 Round 2: best-effort sync tick. The
   * panel calls this on every reload so a
   * `drainOutbox` + `pullAndApply` pass runs
   * against the gateway. The wiring sets this
   * to a real `tick` from `syncService.ts`
   * when the gateway is enabled. The default
   * is a no-op.
   */
  readonly tickSync?: (projectId: string) => Promise<unknown>;
  /**
   * When `true`, the collaboration slice is in
   * "dev seam" mode: the wiring has injected test
   * fixtures and the production hot-reload should
   * not overwrite the channel. The default
   * `false` keeps the production tree unchanged.
   */
  readonly devSeamActive?: boolean;
}

const CollaborationContext = React.createContext<CollaborationDeps | null>(null);

export interface CollaborationProviderProps {
  readonly value: CollaborationDeps;
  readonly children: React.ReactNode;
}

export function CollaborationProvider(
  props: CollaborationProviderProps,
): React.ReactElement {
  return (
    <CollaborationContext.Provider value={props.value}>
      {props.children}
    </CollaborationContext.Provider>
  );
}

export function useCollaborationDeps(): CollaborationDeps {
  const value = React.useContext(CollaborationContext);
  if (!value) {
    throw new Error(
      'useCollaborationDeps: no <CollaborationProvider> ancestor. The Collaboration slice ' +
        'is opt-in; mount <CollaborationProvider> in the v04 composition root when the ' +
        'v04Collaboration flag is on.',
    );
  }
  return value;
}

export function useCollaborationDepsOptional(): CollaborationDeps | null {
  return React.useContext(CollaborationContext);
}
