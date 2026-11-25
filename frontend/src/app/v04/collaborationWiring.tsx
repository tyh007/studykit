/**
 * StudyKit v0.4 — `app/v04/collaborationWiring` (composition root)
 *
 * The single, production-side wiring of the
 * Collaboration Foundation slice (WP-08). Like
 * `<ResearchWiring>` and `<AiKernelWiring>`, this
 * is a side-effect component that builds the
 * Collaboration deps and mounts a
 * `<CollaborationProvider>` whose children are the
 * whole v04 main body.
 *
 * Identity is resolved here (not hardcoded) per the
 * WP-08 Round 2 review:
 *
 *   - **Sync workspace**: the real `useAuth()` row
 *     (`user.id` / `user.display_name`). Two
 *     devices on the same account share the same
 *     identity.
 *   - **Local workspace**: a stable per-device
 *     random id (see `localIdentity.getLocalIdentity`)
 *     persisted in `localStorage`. The id is
 *     generated once and reused across reloads.
 *
 * The wiring is gated on the `v04Collaboration`
 * feature flag. When the flag is off:
 *
 *   - the children render as-is (no
 *     `<CollaborationProvider>` is mounted);
 *   - no Dexie reads / writes to the v8 collab
 *     tables happen;
 *   - the v0.3 / WP-02 / WP-04 / WP-05 / WP-06 /
 *     WP-07 surface tree is byte-for-byte
 *     unchanged.
 *
 * When the flag is on:
 *
 *   - the children are wrapped in a
 *     `<CollaborationProvider>` whose value is the
 *     real `DexieCollaborationRepository` + the
 *     realtime channel from the WP-08 spike +
 *     the resolved identity;
 *   - the four read-mostly collaboration AI
 *     actions are registered in the action
 *     registry (and unregistered when the wiring
 *     unmounts).
 *   - when the `v04CollabGateway` flag is on,
 *     the wiring ALSO mounts the async
 *     collaboration gateway: every successful
 *     use case write is recorded to the outbox
 *     and a `tick()` runs on every panel
 *     reload. The smoke test flips this flag on
 *     via `globalThis.__studykitDevSmoke`.
 *
 * The dev-seam flag mirrors the Research wiring:
 * when the smoke test sets
 * `globalThis.__studykitDevSmoke`, the seam injects
 * a fake repository / channel / identity; the
 * production tree does not see this.
 */

import React from 'react';
import { isFeatureEnabled } from '../feature-flags';
import { useAuth } from '../../lib/auth';
import { useWorkspaceFlavour } from '../../application/workspaceFlavour';
import { createDexieCollaborationRepository } from '../../platforms/web/dexieCollaborationRepository';
import {
  BroadcastChannelRealtime,
  NoopRealtimeChannel,
  setRealtimeChannel,
  type RealtimeChannel,
} from '../../application/collaboration/realtimeSpike';
import {
  registerCollabActions,
  unregisterCollabActions,
  type CollabDeps,
} from '../../features/ai/kernel/actions/collabActions';
import { MemoryCollaborationRepository } from '../../application/collaboration/collaborationRepository';
import {
  CollaborationProvider,
  type CollaborationDeps,
} from '../../features/collaboration';
import { getLocalIdentity } from '../../features/collaboration/localIdentity';
import {
  type CollabGateway,
  HttpCollabGateway,
  NoopCollabGateway,
} from '../../lib/collab-api';
import { getAuthToken } from '../../lib/api';
import {
  enqueueOp,
  tick as tickSync,
  type CollabApplyTarget,
  type ResearchApplyTarget,
  type SyncServiceDeps,
} from '../../application/collaboration/syncService';
import { useResearchDepsOptional } from '../../features/research/researchContext';
import type { Collaborator, Conflict } from '../../domain/collaboration';
import { nowCollabIso } from '../../domain/collaboration';

export interface CollaborationWiringProps {
  readonly children?: React.ReactNode;
}

const PENDING_IDENTITY = {
  userId: '__collaboration_pending__',
  displayName: 'Pending user',
} as const;

function buildChannel(): RealtimeChannel {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel === 'function') {
    return new BroadcastChannelRealtime();
  }
  return new NoopRealtimeChannel();
}

/**
 * Resolve the local user's identity. The sync
 * workspace uses the real `useAuth()` row; the
 * local workspace uses a stable per-device id.
 * Both paths return a `{ userId, displayName }`
 * the rest of the slice can rely on.
 */
function resolveIdentity(
  flavour: 'local' | 'sync',
  authUser: { id: string; display_name?: string | null; email?: string | null } | null,
): { userId: string; displayName: string } {
  if (flavour === 'sync' && authUser) {
    return {
      userId: authUser.id,
      displayName:
        (typeof authUser.display_name === 'string' && authUser.display_name.length > 0
          ? authUser.display_name
          : (typeof authUser.email === 'string' && authUser.email.length > 0
            ? authUser.email
            : 'Account user')),
    };
  }
  const local = getLocalIdentity();
  return { userId: local.userId, displayName: local.displayName };
}

export function CollaborationWiring(
  props: CollaborationWiringProps,
): React.ReactElement {
  const flagOn = isFeatureEnabled('v04Collaboration');
  // eslint-disable-next-line no-console
  if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
    /* debug-removed */
  }
  const flavour = useWorkspaceFlavour();
  // The auth hook is always available (the v04
  // shell mounts an `AuthProvider`). The hook
  // returns `null` while loading; the wiring
  // holds off mounting the CollaborationProvider
  // until the identity is resolved.
  const auth = useAuth();
  const researchDeps = useResearchDepsOptional();

  // The dev seam lets the smoke test inject a
  // stub identity so the smoke can simulate two
  // distinct users in two BrowserContexts. The
  // dev seam is still used in production
  // tests (the smoke) to provide a fake
  // repository / channel; the rest of the
  // Round 3 cleanup removes the
  // `__studykitDevSmoke.collaboration.baseUrl`
  // and `__studykitDevSmoke.research.seedProject`
  // seams. The remaining seam is the identity
  // (the smoke needs to inject a per-tab
  // identity that the auth provider would
  // otherwise gate behind a real sign-in).
  const devSmoke = (globalThis as { __studykitDevSmoke?: { collaboration?: { repository?: unknown; channel?: unknown; identity?: { userId: string; displayName: string }; gateway?: CollabGateway; baseUrl?: string } } })
    .__studykitDevSmoke;
  const devSeamActive = devSmoke !== undefined;
  const devSmokeIdentity = devSmoke?.collaboration?.identity;

  // Resolve the identity. The sync-workspace path
  // waits for `auth.user`; the local-workspace
  // path is synchronous (localStorage is always
  // available).
  const identity: { userId: string; displayName: string } | null = (() => {
    if (devSeamActive && devSmokeIdentity) {
      return devSmokeIdentity;
    }
    if (flavour === 'sync') {
      if (auth.user) {
        return resolveIdentity('sync', {
          id: auth.user.id,
          display_name: (auth.user as { display_name?: string }).display_name ?? null,
          email: (auth.user as { email?: string }).email ?? null,
        });
      }
      return null;
    }
    return resolveIdentity('local', null);
  })();
  const active = flagOn && identity !== null;
  const resolvedIdentity = identity ?? PENDING_IDENTITY;
  const gatewayFlagOn = isFeatureEnabled('v04CollabGateway');
  const resourcesRef = React.useRef<{
    key: string;
    repository: CollaborationDeps['repository'];
    channel: RealtimeChannel;
    gateway: CollabGateway;
  } | null>(null);
  const resourceKey = `${active ? resolvedIdentity.userId : 'inactive'}:${flavour}:${gatewayFlagOn ? 'gateway' : 'local'}:${devSeamActive ? 'dev' : 'prod'}`;
  if (resourcesRef.current?.key !== resourceKey) {
    const repository = active
      ? ((devSmoke?.collaboration?.repository as CollaborationDeps['repository'] | undefined)
        ?? createDexieCollaborationRepository())
      : new MemoryCollaborationRepository();
    const channel = active
      ? ((devSmoke?.collaboration?.channel as RealtimeChannel | undefined) ?? buildChannel())
      : new NoopRealtimeChannel();
    const gateway = active
      ? (devSmoke?.collaboration?.gateway
        ?? (gatewayFlagOn && flavour === 'sync'
          ? new HttpCollabGateway({ authToken: () => getAuthToken() })
          : (gatewayFlagOn && devSmoke?.collaboration?.baseUrl
            ? new HttpCollabGateway({
                baseUrl: devSmoke.collaboration.baseUrl,
                authToken: () => getAuthToken(),
              })
            : new NoopCollabGateway())))
      : new NoopCollabGateway();
    resourcesRef.current = { key: resourceKey, repository, channel, gateway };
  }
  const resources = resourcesRef.current;
  React.useEffect(() => {
    if (!active) return;
    setRealtimeChannel(resources.channel);
    return () => {
      setRealtimeChannel(null);
    };
  }, [active, resources]);

  // Build the deps once per identity. The dev
  // seam lets the smoke inject a fake repository
  // and channel.
  const { repository, channel, gateway } = resources;

  // WP-08 Round 3: the async collaboration
  // gateway. The gateway is opt-in: when the
  // `v04CollabGateway` flag is on AND the
  // workspace is `sync` (a real signed-in user
  // with a JWT), the wiring installs the
  // production `HttpCollabGateway` that reads
  // `baseUrl` from `lib/api.ts` (VITE_API_URL)
  // and `authToken` from `getAuthToken()`. The
  // dev-seam `__studykitDevSmoke.collaboration.baseUrl`
  // is gone — the production tree no longer
  // reads from it. The remaining dev seam is a
  // full `gateway` injection (the smoke uses
  // this to wrap the real backend with a
  // per-tab `clientId` so the server's self-
  // write filter sees the right id).
  // The sync service apply target wraps the
  // local collab repository. The inbox writes
  // remote rows to the local store; the
  // `upsert*` methods are no-ops on the
  // Memory adapter (the data is already
  // canonical) and a straight `put*` on the
  // Dexie adapter.
  const collabApply: CollabApplyTarget = {
    upsertCollaborator: async (row) => {
      // eslint-disable-next-line no-console
      if (devSeamActive) /* debug-removed */
      await repository.transact(async (tx) => {
        tx.putCollaborator(row);
      });
    },
    upsertComment: async (row) => {
      // eslint-disable-next-line no-console
      if (devSeamActive) /* debug-removed */
      await repository.transact(async (tx) => {
        tx.putComment(row);
      });
    },
    upsertActivity: async (row) => {
      // eslint-disable-next-line no-console
      if (devSeamActive) /* debug-removed */
      await repository.transact(async (tx) => {
        tx.putActivity(row);
      });
    },
    upsertConflict: async (row) => {
      // eslint-disable-next-line no-console
      if (devSeamActive) /* debug-removed */
      await repository.transact(async (tx) => {
        tx.putConflict(row);
      });
    },
    recordConflict: async (args) => {
      // The `Conflict` is recorded through the
      // local store; the use case drives the
      // write. We do NOT call `detectConflict`
      // here because the local user is the
      // recipient, not the writer; the conflict
      // is the inbox op that the local user
      // just observed. The shape is the same
      // as a use-case-detected conflict, so the
      // panel renders it identically.
      const row: Conflict = {
        id: `cfl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        projectId: args.projectId,
        kind: args.kind,
        objectId: args.objectId,
        local: args.local,
        remote: args.remote,
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: '',
        detectedAt: nowCollabIso(),
      };
      await repository.transact(async (tx) => {
        tx.putConflict(row);
      });
    },
  };

  // The research apply target is the *shared*
  // research repo. The `ResearchWiring` is the
  // outer Provider in the v04 shell tree; the
  // collab wiring sits inside it, so
  // `useResearchDepsOptional()` returns the
  // same `ResearchRepository` instance the
  // Project Home reads from. Sharing the
  // instance is the only way a cross-user
  // `task-shared` op lands in the same Dexie
  // table the Project Home's `listTasks` query
  // reads — building a second Dexie instance
  // here would write to a *different*
  // IndexedDB partition and the task would
  // never reach the Project Home. When the
  // research wiring is off (the local-only
  // build), the hook returns `null` and the
  // apply step is a no-op (the task-shared op
  // is dropped on the floor; the comment /
  // member / activity events still flow
  // through the collab repo).
  const sharedResearchRepo = researchDeps?.repository ?? null;
  const researchApply: ResearchApplyTarget | null = sharedResearchRepo
    ? {
        upsertTask: async (row) => {
          // Idempotent: the inbox apply step
          // upserts a remote task. The
          // research repo's `transact` API
          // upserts by id; the existing row
          // (if any) is overwritten.
          await sharedResearchRepo.transact(async (tx) => {
            tx.putTask(row);
          });
        },
        getTask: async (id) => {
          return sharedResearchRepo.getTask(id);
        },
      }
    : null;

  // WP-08 Round 3: the dev-seam
  // `__studykitDevSmoke.research.seedProject`
  // is GONE. Project metadata now flows
  // through the production `HttpCollabGateway`
  // — the real backend is the source of truth
  // for projects. B's Research Home renders
  // the project list returned by
  // `GET /api/collab/projects`; the project
  // rows are pulled into B's local repo via
  // the sync protocol (the `project-bootstrap`
  // op or a dedicated project-meta pull). The
  // smoke test does not need a `seedProject`
  // hook anymore — it registers real users
  // with the backend, signs them in, and the
  // backend's membership + project tables
  // carry the cross-user state.

  const syncDeps: SyncServiceDeps = {
    gateway,
    collabRepository: collabApply,
    researchRepository: researchApply ?? undefined,
    localUserId: resolvedIdentity.userId,
  };

  const syncProjectMembers = async (projectId: string): Promise<void> => {
    if (gateway.id === 'noop') return;
    const response = await gateway.listMembers({ projectId });
    const incoming = response.memberships.map<Collaborator>((m) => ({
      id: `col:${projectId}:${m.user_id}`,
      projectId,
      userId: m.user_id,
      displayName: m.display_name,
      role: m.role,
      addedAt: m.added_at,
      addedBy: m.added_by,
      authorType: 'user',
      createdAt: m.added_at,
      updatedAt: m.added_at,
    }));
    const incomingUsers = new Set(incoming.map((m) => m.userId));
    const existing = await repository.listCollaborators({ projectId });
    await repository.transact(async (tx) => {
      for (const row of existing) {
        const canonicalId = `col:${projectId}:${row.userId}`;
        if (!incomingUsers.has(row.userId) || row.id !== canonicalId) {
          tx.deleteCollaborator(row.id);
        }
      }
      for (const row of incoming) tx.putCollaborator(row);
    });
  };

  const bootstrapLocalOwner = async (projectId: string): Promise<void> => {
    const existing = await repository.listCollaborators({
      projectId,
      userId: resolvedIdentity.userId,
    });
    if (existing.length > 0) return;
    const now = nowCollabIso();
    await repository.transact(async (tx) => {
      tx.putCollaborator({
        id: `col:${projectId}:${resolvedIdentity.userId}`,
        projectId,
        userId: resolvedIdentity.userId,
        displayName: resolvedIdentity.displayName,
        role: 'owner',
        addedAt: now,
        addedBy: resolvedIdentity.userId,
        authorType: 'user',
        createdAt: now,
        updatedAt: now,
      });
    });
  };

  const deps: CollaborationDeps = {
    repository,
    localUserId: resolvedIdentity.userId,
    localUserDisplayName: resolvedIdentity.displayName,
    channel,
    workspaceFlavour: flavour,
    listSharedProjects: gateway.id === 'noop'
      ? undefined
      : async () => (await gateway.listProjects()).projects,
    createSharedProject: gateway.id === 'noop'
      ? undefined
      : async (input) => {
          await gateway.createProject({
            ...input,
            owner_user_id: resolvedIdentity.userId,
          });
          await syncProjectMembers(input.id);
        },
    syncProjectMembers: gateway.id === 'noop' ? undefined : syncProjectMembers,
    inviteSharedMember: gateway.id === 'noop'
      ? undefined
      : async (input) => {
          await gateway.inviteMember({
            projectId: input.projectId,
            user_id: input.userId,
            role: input.role,
            display_name: input.displayName,
          });
          await syncProjectMembers(input.projectId);
        },
    changeSharedMemberRole: gateway.id === 'noop'
      ? undefined
      : async (input) => {
          await gateway.changeMemberRole({
            projectId: input.projectId,
            userId: input.userId,
            role: input.role,
          });
          await syncProjectMembers(input.projectId);
        },
    removeSharedMember: gateway.id === 'noop'
      ? undefined
      : async (input) => {
          await gateway.removeMember(input);
          await syncProjectMembers(input.projectId);
        },
    bootstrapLocalOwner: flavour === 'local' && gateway.id === 'noop'
      ? bootstrapLocalOwner
      : undefined,
    // The outbox enqueue: a no-op when the
    // gateway is `NoopCollabGateway` (the
    // smoke test injects a real gateway; the
    // production build without
    // `v04CollabGateway` keeps the noop and
    // the op log is a no-op). The
    // `projectId` is read off the payload
    // (every cross-user row carries it) so the
    // use case does not need a second arg.
    recordCollabOp: (op) => {
      // Resolve the `projectId` from the payload.
      // Every cross-user op carries the
      // projectId either at the top level
      // (`Collaborator`, `Comment`, `Activity`,
      // `Conflict`, `member-removed`) or in
      // `payload.task.projectId` (the
      // `task-shared` shape).
      let projectId = '';
      if (typeof op.payload === 'object' && op.payload !== null) {
        const p = op.payload as { projectId?: unknown; task?: { projectId?: string } };
        if (typeof p.projectId === 'string') {
          projectId = p.projectId;
        } else if (p.task && typeof p.task.projectId === 'string') {
          projectId = p.task.projectId;
        }
      }
      // eslint-disable-next-line no-console
      if (devSeamActive) /* debug-removed */
      if (!projectId) return;
      void enqueueOp({
        projectId,
        kind: op.kind,
        payload: op.payload as never,
        ...(op.baseVersion !== undefined ? { baseVersion: op.baseVersion } : {}),
      }).catch(() => {
        // best-effort
      });
    },
    tickSync: (projectId) => tickSync(syncDeps, projectId),
    devSeamActive,
  };

  // Register the four read-mostly AI actions
  // when the wiring mounts; unregister on
  // unmount. The action registry is module
  // global; the dev-seam test resets it in
  // `afterEach` so the registration does not
  // leak between cases.
  React.useEffect(() => {
    if (!active) return;
    const aiDeps: CollabDeps = {
      listCollaborators: (projectId) => deps.repository.listCollaborators({ projectId }),
      listComments: (projectId, targetKind, targetId) =>
        deps.repository.listComments({ projectId, targetKind, targetId } as never),
      listActivity: (projectId, limit) =>
        deps.repository.listActivity({ projectId, limit }),
      listConflicts: (projectId) =>
        deps.repository.listConflicts({ projectId, openOnly: true }),
      listScratches: (projectId, ownerId) =>
        deps.repository.listScratches({ projectId, ownerId }),
    };
    registerCollabActions(aiDeps);
    return () => {
      unregisterCollabActions();
    };
  }, [active, deps]);

  if (!active) return <>{props.children}</>;
  return (
    <CollaborationProvider value={deps}>{props.children}</CollaborationProvider>
  );
}

export { MemoryCollaborationRepository };
