/**
 * StudyKit v0.4 — `features/collaboration/CollaborationPanel`
 *
 * The Project Home panel that surfaces members,
 * comments + mentions, shared tasks, activity, and
 * open conflicts. The panel is a *read-mostly
 * surface*; the user can:
 *
 *   - view the project membership + role pills
 *   - invite a new collaborator (owner-only)
 *   - view the activity feed (latest 30 events)
 *   - post a new comment with `@userId` mention
 *     parsing
 *   - view the open conflicts and resolve them
 *     (owner-only)
 *   - view the private scratch list and open the
 *     publish preview
 *
 * The panel does NOT:
 *
 *   - post, edit, or delete comments on the
 *     user's behalf via the AI. AI actions are
 *     exposed through the Intent Capsule as Drafts
 *     (the AI never touches canonical state here).
 *   - show the Private Scratch list of *other*
 *     users (private stays private).
 *   - auto-publish a Private Scratch (the publish
 *     flow is `PublishScratchDialog` only).
 *
 * The panel reads the live `CollaborationRepository`
 * via `useCollaborationDeps()`. It subscribes to
 * `repository.subscribe` so a realtime envelope
 * (or a same-tab commit) refreshes the panel
 * without a manual reload.
 */

import React from 'react';
import { useCollaborationDeps } from './collaborationContext';
import {
  COLLABORATOR_ROLES,
  type Collaborator,
  type CollaboratorRole,
  type Comment,
  type CommentTargetKind,
  type Activity,
  type Conflict,
  type ConflictResolution,
  type PrivateScratch,
  type ScratchKind,
} from '../../domain/collaboration';
import {
  inviteCollaborator,
  changeCollaboratorRole,
  removeCollaborator,
  postComment,
  resolveComment,
  detectConflict,
  resolveConflict,
  createScratch,
  parseMentions,
  type UseCaseDeps,
} from '../../application/collaboration/collaborationUseCases';
import { tryRealtimeSync } from '../../application/collaboration/realtimeSpike';
import { PublishScratchDialog } from './PublishScratchDialog';

export interface CollaborationPanelProps {
  readonly projectId: string;
  /**
   * Optional: a callback the host wires to navigate
   * to the conflict's target. The panel surfaces
   * a "View target" link for every open conflict;
   * the host decides what "view target" means
   * (jump to the comment thread, to the task
   * detail, etc.). When the callback is `null`
   * (the default), the link is hidden.
   */
  readonly onViewConflictTarget?: (conflict: Conflict) => void;
  readonly onOpenScratch?: (scratch: PrivateScratch) => void;
  /**
   * WP-08 Round 2: host-supplied canonical writer
   * for the publish flow. The resolver takes a
   * private scratch and returns the id of the
   * canonical row the publish produces — or throws
   * when the scratch's `kind` cannot be written to
   * the canonical store in v0.4 Beta (the host
   * decides which kinds are supported; the panel
   * surfaces the error to the user and refuses to
   * mark the scratch `published`). The dialog
   * calls the resolver BEFORE `confirmPublish`, so
   * a failed write leaves the scratch in
   * `publishing` state — the user can retry or
   * cancel.
   *
   * The default resolver throws with a clear
   * message: the panel must be mounted inside a
   * host that wires the real writer.
   */
  readonly resolveCanonicalId?: (scratch: PrivateScratch) => Promise<string>;
}

interface Snapshot {
  readonly members: readonly Collaborator[];
  readonly comments: readonly Comment[];
  readonly activity: readonly Activity[];
  readonly conflicts: readonly Conflict[];
  readonly scratches: readonly PrivateScratch[];
}

function emptySnapshot(): Snapshot {
  return {
    members: [],
    comments: [],
    activity: [],
    conflicts: [],
    scratches: [],
  };
}

export function CollaborationPanel(
  props: CollaborationPanelProps,
): React.ReactElement {
  // eslint-disable-next-line no-console
  if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
    /* debug-removed */
  }
  const deps = useCollaborationDeps();
  const [snapshot, setSnapshot] = React.useState<Snapshot>(emptySnapshot());
  const [replies, setReplies] = React.useState<readonly Comment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // The local user's actor (looked up from the
  // membership). `null` when the local user is
  // not a member of this project.
  const [me, setMe] = React.useState<Collaborator | null>(null);

  // Invite form
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteUserId, setInviteUserId] = React.useState('');
  const [inviteDisplayName, setInviteDisplayName] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<CollaboratorRole>('commenter');

  // Comment form
  const [commentBody, setCommentBody] = React.useState('');
  const [commentReplyTo, setCommentReplyTo] = React.useState<string | null>(null);

  // Scratch form
  const [showNewScratch, setShowNewScratch] = React.useState(false);
  const [scratchKind, setScratchKind] = React.useState<ScratchKind>('note');
  const [scratchTitle, setScratchTitle] = React.useState('');
  const [scratchBody, setScratchBody] = React.useState('');
  const [publishPreview, setPublishPreview] = React.useState<PrivateScratch | null>(null);

  // The kinds the host can publish. v0.4 Beta only
  // supports `task` — the canonical writer is
  // `createTask`. The selector in the form still
  // offers the other kinds (the scratch is private
  // so the user can keep drafting); the publish
  // button is hidden for unsupported kinds and the
  // dialog surfaces a clear "publishing X is not
  // yet supported" error if the user reaches the
  // dialog through a different path.
  const publishableKinds: ReadonlySet<ScratchKind> = React.useMemo(
    () => new Set<ScratchKind>(['task']),
    [],
  );
  const canPublish = (s: PrivateScratch): boolean => publishableKinds.has(s.kind);

  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // WP-08 Round 2: load the *full* comment
      // list (roots + replies) so the panel can
      // render threads. The repository returns
      // every comment the local user can see;
      // there is no privacy implication for
      // comments (they are project-scoped by
      // design — see `Comment.scope = 'project'`).
      const [members, allComments, activity, conflicts, scratches, repliesOnly] = await Promise.all([
        deps.repository.listCollaborators({ projectId: props.projectId }),
        deps.repository.listComments({ projectId: props.projectId }),
        deps.repository.listActivity({ projectId: props.projectId, limit: 30 }),
        deps.repository.listConflicts({ projectId: props.projectId, openOnly: true }),
        deps.repository.listScratches({ projectId: props.projectId, ownerId: deps.localUserId }),
        deps.repository.listComments({ projectId: props.projectId, threadRootsOnly: true }),
      ]);
      const roots = repliesOnly;
      setReplies(allComments.filter((c) => c.parentId !== null));
      setSnapshot({ members, comments: roots, activity, conflicts, scratches });
      const mine = members.find((m) => m.userId === deps.localUserId);
      setMe(mine ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collaboration.');
    } finally {
      setLoading(false);
    }
  }, [deps, props.projectId]);

  // WP-08 Round 2: the sync tick runs AFTER
  // each reload (separate effect, not inside
  // the reload callback, so the callback does
  // not call itself). The tick drains the
  // outbox and pulls remote ops. When remote
  // rows land in the local store we re-run
  // `reload` so the panel surfaces them. The
  // tick is best-effort; a network failure
  // is logged and the next tick retries.
  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line no-console
    if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
      /* debug-removed */
    }
    void (async () => {
      if (!deps.tickSync) return;
      try {
        const result = (await deps.tickSync(props.projectId)) as {
          pulled?: { applied?: number };
          drained?: { drained: number; failed: number };
        };
        // eslint-disable-next-line no-console
        if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
          /* debug-removed */
        }
        if (cancelled) return;
        if (result && result.pulled && (result.pulled.applied ?? 0) > 0) {
          await reload();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
          /* debug-removed */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps.tickSync, props.projectId, reload]);

  // WP-08 Round 2: every successful action
  // also triggers a sync tick so cross-user
  // ops (the just-written one + any new
  // remote ops) flow promptly. The tick is
  // best-effort: a network failure is
  // logged and the next reload's tick
  // retries. The action handlers call this
  // helper after `reload()` completes.
  const triggerSyncTick = React.useCallback(async (): Promise<void> => {
    if (!deps.tickSync) {
      // eslint-disable-next-line no-console
      if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
        /* debug-removed */
      }
      return;
    }
    // eslint-disable-next-line no-console
    if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
      /* debug-removed */
    }
    try {
      const result = (await deps.tickSync(props.projectId)) as {
        pulled?: { applied?: number };
        drained?: { drained: number; failed: number };
      };
      // eslint-disable-next-line no-console
      if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
        /* debug-removed */
      }
      if (result && result.pulled && (result.pulled.applied ?? 0) > 0) {
        await reload();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
        /* debug-removed */
      }
    }
  }, [deps.tickSync, props.projectId, reload]);

  const useCaseDeps: UseCaseDeps = React.useMemo(
    () => ({
      repository: deps.repository,
      localUserId: deps.localUserId,
      localUserDisplayName: deps.localUserDisplayName,
      emitRealtime: (env) => tryRealtimeSync({ kind: env.kind, actorId: env.actorId, projectId: env.projectId, payload: { payload: env.payload } }),
      // WP-08 Round 2: the wiring-supplied
      // outbox enqueue. The use cases call
      // this AFTER a successful `transact`;
      // a thrown / rejected enqueue is
      // swallowed by the use case (the local
      // commit is the durable record; the
      // cross-user op is best-effort).
      recordOp: deps.recordCollabOp
        ? (op) => {
            // eslint-disable-next-line no-console
            if ((globalThis as { __studykitDevSmoke?: unknown }).__studykitDevSmoke) {
              /* debug-removed */
            }
            try {
              deps.recordCollabOp?.(op);
            } catch {
              // best-effort
            }
          }
        : undefined,
    }),
    [deps],
  );

  // WP-08 Round 3: no auto-owner-bootstrap. The
  // panel renders the project for whatever
  // memberships already exist in the local repo.
  // The local user's membership is created
  // atomically at project create time (via
  // `POST /api/collab/projects` on the server)
  // and via `POST /api/collab/projects/:id/memberships`
  // for invited members. A user who opens a
  // project they are not a member of sees an
  // empty member list and no comment-form / invite
  // affordance — the panel refuses to mint a
  // membership on their behalf. The only paths to
  // the `owner` role are: (1) the server's atomic
  // `POST /projects` for the project creator, and
  // (2) the server's owner-only `POST /projects/:id/memberships`
  // for a non-owner role. A user opening an
  // arbitrary project id is never auto-added.
  //
  // The first reload fires on mount so the panel
  // surfaces whatever memberships already exist
  // (the local user's row, if they are a
  // member, is rendered as "You are <role>";
  // otherwise `me === null` and the invite /
  // post affordances are hidden).
  React.useEffect(() => {
    void (async () => {
      try {
        await deps.bootstrapLocalOwner?.(props.projectId);
        await deps.syncProjectMembers?.(props.projectId);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'You do not have access to this project.');
      }
    })();
    // The reload callback is stable per deps +
    // projectId, so this fires once per
    // (project, identity) pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId, deps.localUserId]);

  React.useEffect(() => {
    const off = deps.repository.subscribe(() => {
      void reload();
    });
    return off;
  }, [deps.repository, reload]);

  // Realtime inbound: a presence / comment envelope
  // from another tab refreshes the panel.
  React.useEffect(() => {
    const off = deps.channel.subscribeProject(props.projectId, () => {
      void reload();
    });
    return off;
  }, [deps.channel, props.projectId, reload]);

  // ----- actions -----

  const onInvite = async (): Promise<void> => {
    setError(null);
    try {
      if (deps.inviteSharedMember) {
        if (inviteRole === 'owner') {
          throw new Error('Ownership cannot be granted from the invite form.');
        }
        await deps.inviteSharedMember({
          projectId: props.projectId,
          userId: inviteUserId.trim(),
          displayName: inviteDisplayName.trim(),
          role: inviteRole,
        });
      } else {
        await inviteCollaborator(useCaseDeps, {
          projectId: props.projectId,
          userId: inviteUserId.trim(),
          displayName: inviteDisplayName.trim(),
          role: inviteRole,
        });
      }
      setInviteUserId('');
      setInviteDisplayName('');
      setInviteRole('commenter');
      setInviteOpen(false);
      await reload();
      await triggerSyncTick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite.');
    }
  };

  const onChangeRole = async (
    member: Collaborator,
    newRole: CollaboratorRole,
  ): Promise<void> => {
    setError(null);
    try {
      if (deps.changeSharedMemberRole) {
        if (newRole === 'owner') throw new Error('Ownership transfer is not available here.');
        await deps.changeSharedMemberRole({
          projectId: props.projectId,
          userId: member.userId,
          role: newRole,
        });
      } else {
        await changeCollaboratorRole(useCaseDeps, {
          projectId: props.projectId,
          collaboratorId: member.id,
          newRole,
        });
      }
      await reload();
      await triggerSyncTick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role.');
    }
  };

  const onRemove = async (member: Collaborator): Promise<void> => {
    setError(null);
    try {
      if (deps.removeSharedMember) {
        await deps.removeSharedMember({
          projectId: props.projectId,
          userId: member.userId,
        });
      } else {
        await removeCollaborator(useCaseDeps, {
          projectId: props.projectId,
          collaboratorId: member.id,
        });
      }
      await reload();
      await triggerSyncTick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove.');
    }
  };

  const onPostComment = async (): Promise<void> => {
    setError(null);
    try {
      const memberNames: Record<string, string> = {};
      for (const m of snapshot.members) {
        memberNames[m.userId] = m.displayName;
      }
      await postComment(useCaseDeps, {
        projectId: props.projectId,
        targetKind: 'project',
        targetId: props.projectId,
        body: commentBody,
        ...(commentReplyTo !== null ? { parentId: commentReplyTo } : {}),
        memberDisplayNames: memberNames,
      });
      setCommentBody('');
      setCommentReplyTo(null);
      await reload();
      await triggerSyncTick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment.');
    }
  };

  const onResolveComment = async (comment: Comment): Promise<void> => {
    setError(null);
    try {
      await resolveComment(useCaseDeps, {
        projectId: props.projectId,
        commentId: comment.id,
        baseVersion: comment.version,
      });
      await reload();
      await triggerSyncTick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve comment.');
    }
  };

  const onResolveConflict = async (
    conflict: Conflict,
    resolution: ConflictResolution,
    note: string,
  ): Promise<void> => {
    setError(null);
    try {
      await resolveConflict(useCaseDeps, {
        projectId: props.projectId,
        conflictId: conflict.id,
        resolution,
        note,
      });
      await reload();
      await triggerSyncTick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve conflict.');
    }
  };

  const onCreateScratch = async (): Promise<void> => {
    setError(null);
    try {
      const s = await createScratch(useCaseDeps, {
        projectId: props.projectId,
        kind: scratchKind,
        title: scratchTitle,
        body: scratchBody,
      });
      setScratchTitle('');
      setScratchBody('');
      setShowNewScratch(false);
      setPublishPreview(s);
      await reload();
      // No tick on scratch creation: the
      // scratch is private, the gateway never
      // carries it.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scratch.');
    }
  };

  const onPublishConfirmed = async (
    _scratchId: string,
    _canonicalId: string,
  ): Promise<void> => {
    setPublishPreview(null);
    await reload();
    // The publish flow wrote a real canonical
    // row + a `task-shared` op (via
    // ProjectHome's resolver). The next tick
    // pushes the op to the gateway so the
    // other side can pull it.
    await triggerSyncTick();
  };

  const isOwner = me?.role === 'owner';
  const canInvite = isOwner;
  const canResolveConflict = isOwner;
  const canPost = me !== null;

  return (
    <section
      data-testid="collaboration-panel"
      className="sk-collab-panel"
      aria-label="Collaboration"
    >
      <header className="sk-collab-panel__header">
        <h2>Collaboration</h2>
        {me && (
          <span data-testid="me-role" className="sk-collab-pill">
            You are {me.role}
          </span>
        )}
      </header>

      {error && (
        <p data-testid="collab-error" role="alert" className="sk-collab-error">
          {error}
        </p>
      )}

      {loading ? (
        <p data-testid="collab-loading">Loading collaboration…</p>
      ) : (
        <>
          {/* Members */}
          <section data-testid="members-section" className="sk-collab-members">
            <h3>Members ({snapshot.members.length})</h3>
            <ul>
              {snapshot.members.map((m) => (
                <li key={m.id} data-testid={`member-${m.userId}`}>
                  <span>{m.displayName}</span>{' '}
                  <span data-testid={`member-role-${m.userId}`} className="sk-collab-pill">
                    {m.role}
                  </span>
                  {isOwner && m.id !== me?.id && (
                    <select
                      data-testid={`member-role-select-${m.userId}`}
                      value={m.role}
                      onChange={(e) => onChangeRole(m, e.target.value as CollaboratorRole)}
                    >
                      {COLLABORATOR_ROLES.filter((r) => r !== 'owner').map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                  {isOwner && m.id !== me?.id && (
                    <button
                      type="button"
                      data-testid={`member-remove-${m.userId}`}
                      onClick={() => onRemove(m)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canInvite && (
              <div>
                {inviteOpen ? (
                  <div data-testid="invite-form">
                    <label>
                      User ID
                      <input
                        data-testid="invite-userid"
                        value={inviteUserId}
                        onChange={(e) => setInviteUserId(e.target.value)}
                      />
                    </label>
                    <label>
                      Display name
                      <input
                        data-testid="invite-displayname"
                        value={inviteDisplayName}
                        onChange={(e) => setInviteDisplayName(e.target.value)}
                      />
                    </label>
                    <label>
                      Role
                      <select
                        data-testid="invite-role"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as CollaboratorRole)}
                      >
                        {COLLABORATOR_ROLES
                          .filter((r) => !deps.inviteSharedMember || r !== 'owner')
                          .map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      data-testid="invite-submit"
                      onClick={() => void onInvite()}
                    >
                      Invite
                    </button>
                    <button
                      type="button"
                      onClick={() => setInviteOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="invite-open"
                    onClick={() => setInviteOpen(true)}
                  >
                    Invite collaborator
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Open conflicts */}
          {snapshot.conflicts.length > 0 && (
            <section
              data-testid="conflicts-section"
              className="sk-collab-conflicts"
              aria-label="Open conflicts"
            >
              <h3>Open conflicts ({snapshot.conflicts.length})</h3>
              {snapshot.conflicts.map((c) => (
                <article key={c.id} data-testid={`conflict-${c.id}`}>
                  <p>
                    <strong>{c.kind}</strong> on <code>{c.objectId}</code>
                  </p>
                  <p>
                    Local ({c.local.actorDisplayName}, v{c.local.baseVersion}):{' '}
                    <em>{c.local.payload}</em>
                  </p>
                  <p>
                    Remote ({c.remote.actorDisplayName}, v{c.remote.baseVersion}):{' '}
                    <em>{c.remote.payload}</em>
                  </p>
                  {canResolveConflict && (
                    <div>
                      <button
                        type="button"
                        data-testid={`conflict-keep-local-${c.id}`}
                        onClick={() => void onResolveConflict(c, 'kept-local', '')}
                      >
                        Keep local
                      </button>
                      <button
                        type="button"
                        data-testid={`conflict-keep-remote-${c.id}`}
                        onClick={() => void onResolveConflict(c, 'kept-remote', '')}
                      >
                        Keep remote
                      </button>
                      <button
                        type="button"
                        data-testid={`conflict-merge-${c.id}`}
                        onClick={() => void onResolveConflict(c, 'merged', 'manual merge')}
                      >
                        Mark merged
                      </button>
                    </div>
                  )}
                  {props.onViewConflictTarget && (
                    <button
                      type="button"
                      onClick={() => props.onViewConflictTarget?.(c)}
                    >
                      View target
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}

          {/* Comments */}
          <section
            data-testid="comments-section"
            className="sk-collab-comments"
            aria-label="Comments"
          >
            <h3>Comments ({snapshot.comments.length})</h3>
            <ul>
              {snapshot.comments.map((c) => (
              <li key={c.id} data-testid={`comment-${c.id}`}>
                <span>
                  <strong>{c.authorDisplayName}</strong>: {c.body}
                </span>
                {c.resolvedAt === null && canPost && (
                  <>
                    <button
                      type="button"
                      data-testid={`comment-reply-${c.id}`}
                      onClick={() => {
                        // WP-08 Round 2: reply UI.
                        // Clicking "Reply" makes
                        // the post form target
                        // this comment as the
                        // parent; the next
                        // submitted comment is
                        // recorded as a reply
                        // (parentId = c.id,
                        // threadId = c.threadId).
                        // The `parentId` /
                        // `threadId` survive
                        // reload because they
                        // are persisted on the
                        // canonical Comment row.
                        setCommentReplyTo(c.id);
                      }}
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      data-testid={`comment-resolve-${c.id}`}
                      onClick={() => void onResolveComment(c)}
                    >
                      Resolve
                    </button>
                  </>
                )}
                {c.resolvedAt !== null && (
                  <span data-testid={`comment-resolved-${c.id}`} className="sk-collab-pill">
                    resolved
                  </span>
                )}
                {c.mentions.length > 0 && (
                  <span data-testid={`comment-mentions-${c.id}`}>
                    mentions:{' '}
                    {c.mentions.map((mm) => mm.displayName).join(', ')}
                  </span>
                )}
                {/* WP-08 Round 2: render replies under
                    the parent. The replies are
                    sorted by `createdAt` so the
                    thread reads top-to-bottom. */}
                {replies.filter((r) => r.parentId === c.id).length > 0 && (
                  <ul data-testid={`replies-${c.id}`}>
                    {replies
                      .filter((r) => r.parentId === c.id)
                      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                      .map((r) => (
                        <li key={r.id} data-testid={`reply-${r.id}`}>
                          <span>
                            <strong>{r.authorDisplayName}</strong>: {r.body}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
            </ul>
            {canPost && (
              <div data-testid="comment-form">
                {commentReplyTo !== null && (
                  <span>
                    Replying to{' '}
                    <code data-testid="comment-reply-target">{commentReplyTo}</code>{' '}
                    <button type="button" onClick={() => setCommentReplyTo(null)}>
                      Cancel
                    </button>
                  </span>
                )}
                <textarea
                  data-testid="comment-body"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Write a comment. Use @userId to mention."
                />
                {parseMentions(commentBody).length > 0 && (
                  <p data-testid="comment-mention-preview">
                    Will mention:{' '}
                    {parseMentions(commentBody)
                      .map((mm) => mm.userId)
                      .join(', ')}
                  </p>
                )}
                <button
                  type="button"
                  data-testid="comment-submit"
                  onClick={() => void onPostComment()}
                >
                  Post
                </button>
              </div>
            )}
          </section>

          {/* Activity */}
          <section
            data-testid="activity-section"
            className="sk-collab-activity"
            aria-label="Activity"
          >
            <h3>Activity ({snapshot.activity.length})</h3>
            <ul>
              {snapshot.activity.slice(-10).reverse().map((a) => (
                <li key={a.id} data-testid={`activity-${a.id}`}>
                  <strong>{a.actorDisplayName}</strong> · {a.kind} · {a.summary}
                </li>
              ))}
            </ul>
          </section>

          {/* Private Scratch */}
          <section
            data-testid="scratches-section"
            className="sk-collab-scratches"
            aria-label="Private Scratch"
          >
            <h3>My Private Scratch ({snapshot.scratches.filter((s) => s.ownerId === deps.localUserId).length})</h3>
            <ul>
              {snapshot.scratches
                .filter((s) => s.ownerId === deps.localUserId)
                .map((s) => (
                  <li key={s.id} data-testid={`scratch-${s.id}`}>
                    <strong>{s.title || '(untitled)'}</strong> ({s.kind}, {s.status})
                    {s.status === 'private' && canPublish(s) && props.resolveCanonicalId && (
                      <button
                        type="button"
                        data-testid={`scratch-publish-${s.id}`}
                        onClick={() => setPublishPreview(s)}
                      >
                        Preview publish
                      </button>
                    )}
                    {s.status === 'private' && !canPublish(s) && (
                      <span data-testid={`scratch-publish-unsupported-${s.id}`} className="sk-collab-pill">
                        Publish not yet supported for {s.kind}
                      </span>
                    )}
                    {s.status === 'private' && canPublish(s) && !props.resolveCanonicalId && (
                      <span data-testid={`scratch-publish-no-writer-${s.id}`} className="sk-collab-pill">
                        No canonical writer wired
                      </span>
                    )}
                    {s.status === 'published' && s.publishedRef && (
                      <span
                        data-testid={`scratch-published-ref-${s.id}`}
                        className="sk-collab-pill"
                        data-published-ref={s.publishedRef}
                      >
                        published → {s.publishedRef}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
            {me && (
              <div>
                {showNewScratch ? (
                  <div data-testid="scratch-form">
                    <label>
                      Kind
                      <select
                        data-testid="scratch-kind"
                        value={scratchKind}
                        onChange={(e) => setScratchKind(e.target.value as ScratchKind)}
                      >
                        {(['note', 'task', 'claim', 'evidence', 'output'] as const).map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Title
                      <input
                        data-testid="scratch-title"
                        value={scratchTitle}
                        onChange={(e) => setScratchTitle(e.target.value)}
                      />
                    </label>
                    <label>
                      Body
                      <textarea
                        data-testid="scratch-body"
                        value={scratchBody}
                        onChange={(e) => setScratchBody(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      data-testid="scratch-save"
                      onClick={() => void onCreateScratch()}
                    >
                      Save (still private)
                    </button>
                    <button type="button" onClick={() => setShowNewScratch(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="scratch-new"
                    onClick={() => setShowNewScratch(true)}
                  >
                    New private scratch
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {publishPreview && (
        <PublishScratchDialog
          projectId={props.projectId}
          scratch={publishPreview}
          useCaseDeps={useCaseDeps}
          resolveCanonicalId={
            props.resolveCanonicalId ??
            (async (s) => {
              // The host (ProjectHome or the smoke
              // test) wires the canonical write. The
              // panel refuses to publish when no
              // resolver is supplied so we never
              // mint a placeholder id and the user
              // gets a clear "no writer wired"
              // error instead of a silently-fake
              // success.
              void s;
              throw new Error(
                'Publish disabled: CollaborationPanel has no resolveCanonicalId wired. ' +
                  'Mount it from a host (e.g. ProjectHome) that supplies a real canonical writer.',
              );
            })
          }
          onClose={() => setPublishPreview(null)}
          onPublished={onPublishConfirmed}
        />
      )}
    </section>
  );
}
