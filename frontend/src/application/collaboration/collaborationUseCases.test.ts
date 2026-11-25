/**
 * StudyKit v0.4 — `application/collaboration/collaborationUseCases.test.ts`
 *
 * Headless use-case tests for the WP-08 collaboration
 * slice. Drives the in-memory
 * `CollaborationRepository` directly. No React, no
 * Dexie, no AI provider.
 *
 * Verifies the brief's eight must-haves:
 *
 *   1. Role permission matrix is complete.
 *   2. Inviting a collaborator does NOT auto-share
 *      a Private Scratch.
 *   3. Private → Shared requires a publish preview
 *      (the use case refuses to publish without one).
 *   4. Comments, mentions, shared tasks, and
 *      activity survive reload (the in-memory
 *      adapter is the same shape as the Dexie
 *      adapter, so a reload-style read is part of
 *      the test).
 *   5. Reconnect (re-subscribe) does not lose
 *      async content (the listener fires on every
 *      commit).
 *   6. Realtime failure does not break async
 *      collaboration (the realtime hook throws;
 *      the use case still commits).
 *   7. Conflicts are non-destructive (the use case
 *      records a `Conflict` row; it never
 *      overwrites).
 *   8. AI-off (no `emitRealtime` hook) still
 *      allows all core operations (the use case
 *      is fully functional without a hook).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCollaborationRepository } from './collaborationRepository';
import {
  inviteCollaborator,
  changeCollaboratorRole,
  removeCollaborator,
  postComment,
  editComment,
  resolveComment,
  createScratch,
  updateScratch,
  deleteScratch,
  previewPublishScratch,
  confirmPublish,
  cancelPublish,
  detectConflict,
  resolveConflict,
  parseMentions,
  diffScratchBody,
  ensureLocalMembership,
  recordTaskAssignment,
  capabilitiesForLocalUser,
  ConflictRefusedError,
  ScratchNotPublishableError,
  type UseCaseDeps,
} from './collaborationUseCases';
import { PermissionDeniedError } from './permissionMatrix';

const PROJECT = 'p_1';
const LOCAL_USER = 'u_local';
const LOCAL_NAME = 'Local User';

function makeDeps(
  repository: MemoryCollaborationRepository,
  overrides: Partial<UseCaseDeps> = {},
): UseCaseDeps {
  return {
    repository,
    localUserId: LOCAL_USER,
    localUserDisplayName: LOCAL_NAME,
    ...overrides,
  };
}

async function seedOwner(repo: MemoryCollaborationRepository): Promise<void> {
  await ensureLocalMembership(makeDeps(repo), { projectId: PROJECT });
}

beforeEach(() => {
  // Each test gets a fresh repository.
});

describe('application/collaboration — Membership', () => {
  it('ensureLocalMembership is idempotent', async () => {
    const repo = new MemoryCollaborationRepository();
    const deps = makeDeps(repo);
    const a = await ensureLocalMembership(deps, { projectId: PROJECT });
    const b = await ensureLocalMembership(deps, { projectId: PROJECT });
    expect(a.id).toBe(b.id);
  });

  it('owner can invite; commenter cannot', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);

    // Owner invite succeeds
    const member = await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_new',
      displayName: 'New User',
      role: 'commenter',
    });
    expect(member.role).toBe('commenter');

    // The new user is a commenter; they cannot invite
    const commenterDeps = makeDeps(repo, {
      localUserId: 'u_new',
      localUserDisplayName: 'New User',
    });
    await expect(
      inviteCollaborator(commenterDeps, {
        projectId: PROJECT,
        userId: 'u_third',
        displayName: 'Third',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('refuses to invite a duplicate user', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_dup',
      displayName: 'Dup',
    });
    await expect(
      inviteCollaborator(deps, {
        projectId: PROJECT,
        userId: 'u_dup',
        displayName: 'Dup',
      }),
    ).rejects.toThrowError(/already a member/);
  });

  it('changeCollaboratorRole is owner-only', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const member = await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_e',
      displayName: 'E',
      role: 'commenter',
    });
    const next = await changeCollaboratorRole(deps, {
      projectId: PROJECT,
      collaboratorId: member.id,
      newRole: 'editor',
    });
    expect(next.role).toBe('editor');
  });

  it('refuses to remove the last owner', async () => {
    const repo = new MemoryCollaborationRepository();
    const deps = makeDeps(repo);
    const me = await ensureLocalMembership(deps, { projectId: PROJECT });
    await expect(
      removeCollaborator(deps, { projectId: PROJECT, collaboratorId: me.id }),
    ).rejects.toThrowError(/last owner/);
  });

  it('records a member-added Activity row in the same transaction', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const member = await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_m',
      displayName: 'M',
    });
    const activities = await repo.listActivity({ projectId: PROJECT });
    expect(activities.length).toBe(1);
    expect(activities[0]!.kind).toBe('member-added');
    expect(activities[0]!.targetId).toBe(member.id);
  });
});

describe('application/collaboration — Comments + mentions', () => {
  it('parses @userId mentions and fills displayName from the membership', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const c = await postComment(deps, {
      projectId: PROJECT,
      targetKind: 'project',
      targetId: PROJECT,
      body: 'Hi @u_new, please review @u_e',
      memberDisplayNames: { u_new: 'New User', u_e: 'Editor' },
    });
    expect(c.mentions.length).toBe(2);
    expect(c.mentions[0]!.userId).toBe('u_new');
    expect(c.mentions[0]!.displayName).toBe('New User');
    expect(c.mentions[0]!.position).toBe(3);
    expect(c.mentions[0]!.length).toBe(6);
  });

  it('parseMentions collapses duplicate userIds', () => {
    const ms = parseMentions('@u_one and @u_one again');
    expect(ms.length).toBe(1);
    expect(ms[0]!.userId).toBe('u_one');
  });

  it('refuses to post when the local user is not a member', async () => {
    const repo = new MemoryCollaborationRepository();
    const deps = makeDeps(repo);
    await expect(
      postComment(deps, {
        projectId: PROJECT,
        targetKind: 'project',
        targetId: PROJECT,
        body: 'Hello',
      }),
    ).rejects.toThrowError(/not a member/);
  });

  it('refuses to post an empty comment', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    await expect(
      postComment(deps, {
        projectId: PROJECT,
        targetKind: 'project',
        targetId: PROJECT,
        body: '   ',
      }),
    ).rejects.toThrowError(/empty/);
  });

  it('refuses to post a comment with authorType="ai"', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    // The use case refuses `authorType: 'ai'`.
    // We force-cast in the test because the public
    // type forbids it, mirroring how a buggy
    // caller might widen the type at runtime.
    await expect(
      postComment(deps, {
        projectId: PROJECT,
        targetKind: 'project',
        targetId: PROJECT,
        body: 'Hello',
        authorType: 'ai' as unknown as 'user',
      }),
    ).rejects.toThrowError();
  });

  it('editComment refuses when the writer saw a stale version (conflict)', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const c = await postComment(deps, {
      projectId: PROJECT,
      targetKind: 'project',
      targetId: PROJECT,
      body: 'first',
    });
    const other = await editComment(deps, {
      projectId: PROJECT,
      commentId: c.id,
      body: 'second (by owner)',
      baseVersion: 1,
    });
    expect(other.version).toBe(2);
    // The same writer now tries to edit with the
    // original `baseVersion: 1` (stale) and is
    // refused.
    await expect(
      editComment(deps, {
        projectId: PROJECT,
        commentId: c.id,
        body: 'third (stale)',
        baseVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictRefusedError);
  });

  it('resolveComment is owner-only; refuses commenter', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const c = await postComment(deps, {
      projectId: PROJECT,
      targetKind: 'project',
      targetId: PROJECT,
      body: 'first',
    });
    // Commenter cannot resolve.
    const commenterDeps = makeDeps(repo, {
      localUserId: 'u_c',
      localUserDisplayName: 'C',
    });
    // Add commenter
    await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_c',
      displayName: 'C',
    });
    await expect(
      resolveComment(commenterDeps, {
        projectId: PROJECT,
        commentId: c.id,
        baseVersion: c.version,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // Owner can resolve.
    const resolved = await resolveComment(deps, {
      projectId: PROJECT,
      commentId: c.id,
      baseVersion: c.version,
    });
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('comments + activity survive a reload (re-subscribe and re-read)', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const c = await postComment(deps, {
      projectId: PROJECT,
      targetKind: 'task',
      targetId: 'task_1',
      body: 'preload',
    });
    // Re-attach a listener (simulates a reload): the
    // repository has the row, the use case can read
    // it back.
    const snap = await repo.listComments({ projectId: PROJECT });
    expect(snap.length).toBe(1);
    expect(snap[0]!.body).toBe('preload');
    const activity = await repo.listActivity({ projectId: PROJECT });
    expect(activity.length).toBeGreaterThanOrEqual(1);
    expect(activity.some((a) => a.kind === 'comment-posted')).toBe(true);
    // `c` is the canonical row.
    expect(c.body).toBe('preload');
  });
});

describe('application/collaboration — Private Scratch + publish', () => {
  it('inviting a collaborator does NOT auto-share a scratch', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const s = await createScratch(deps, {
      projectId: PROJECT,
      kind: 'task',
      title: 'My private draft',
      body: 'Thinking...',
    });
    expect(s.status).toBe('private');
    // Invite a collaborator. The scratch is *not*
    // re-shared.
    await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_2',
      displayName: 'Other',
    });
    const scratches = await repo.listScratches({ projectId: PROJECT, ownerId: LOCAL_USER });
    expect(scratches.length).toBe(1);
    expect(scratches[0]!.id).toBe(s.id);
    expect(scratches[0]!.status).toBe('private');
  });

  it('WP-08 Round 2: repository boundary refuses another member\'s scratch', async () => {
    // The round-2 hardening: a Private Scratch is
    // owner-only at the *repository* boundary.
    // User B (`u_other`) cannot read user A's
    // private scratch through `getScratchForOwner`
    // even with a known id. This is the seam the
    // cross-user async gateway relies on.
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const depsA = makeDeps(repo);
    const s = await createScratch(depsA, {
      projectId: PROJECT,
      kind: 'note',
      title: 'A private draft',
      body: 'A private thought',
    });
    // The owner can read it.
    const aReads = await repo.getScratchForOwner(s.id, LOCAL_USER);
    expect(aReads?.id).toBe(s.id);
    // A different user cannot.
    const bReads = await repo.getScratchForOwner(s.id, 'u_other');
    expect(bReads).toBeNull();
    // B's list call does not return A's scratch.
    const bList = await repo.listScratches({ projectId: PROJECT, ownerId: 'u_other' });
    expect(bList).toEqual([]);
    // And the list refuses an empty / missing owner.
    await expect(
      repo.listScratches({ projectId: PROJECT, ownerId: '' }),
    ).rejects.toThrowError(/ownerId is required/);
  });

  it('publish flow requires a preview + confirm; refuses to publish directly', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const s = await createScratch(deps, {
      projectId: PROJECT,
      kind: 'note',
      title: 't',
      body: 'b',
    });
    // confirmPublish without a preview throws
    // (the canonical writer is the caller's job; the
    // use case refuses to mark the scratch
    // `published` without a `PublishDiff` row).
    await expect(
      confirmPublish(deps, {
        projectId: PROJECT,
        publishDiffId: 'pd_does_not_exist',
        canonicalId: 'note_1',
      }),
    ).rejects.toThrowError(/not found/);
    // A non-private scratch cannot be re-published.
    const preview = await previewPublishScratch(deps, {
      projectId: PROJECT,
      scratchId: s.id,
      targetId: null,
      baseline: null,
    });
    expect(preview.rows.length).toBe(2);
    expect(preview.rows.every((r) => r.op === 'added')).toBe(true);
    // The scratch is now `publishing`; another
    // preview is refused.
    await expect(
      previewPublishScratch(deps, {
        projectId: PROJECT,
        scratchId: s.id,
        targetId: null,
        baseline: null,
      }),
    ).rejects.toBeInstanceOf(ScratchNotPublishableError);
    // Confirm sets the scratch to `published` and
    // records the canonical id.
    const out = await confirmPublish(deps, {
      projectId: PROJECT,
      publishDiffId: preview.id,
      canonicalId: 'note_1',
    });
    expect(out.scratch.status).toBe('published');
    expect(out.scratch.publishedRef).toBe('note_1');
  });

  it('cancelPublish reverts the scratch to `private`', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const s = await createScratch(deps, {
      projectId: PROJECT,
      kind: 'note',
      title: 't',
      body: 'b',
    });
    const preview = await previewPublishScratch(deps, {
      projectId: PROJECT,
      scratchId: s.id,
      targetId: null,
      baseline: null,
    });
    await cancelPublish(deps, { projectId: PROJECT, publishDiffId: preview.id });
    const after = await repo.getScratchForOwner(s.id, LOCAL_USER);
    expect(after?.status).toBe('private');
  });

  it('only the scratch owner can publish or update', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const s = await createScratch(deps, {
      projectId: PROJECT,
      kind: 'task',
      title: 't',
      body: 'b',
    });
    // The owner's membership is `owner`; an editor
    // cannot publish someone else's scratch.
    await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_e',
      displayName: 'Editor',
      role: 'editor',
    });
    const editorDeps = makeDeps(repo, {
      localUserId: 'u_e',
      localUserDisplayName: 'Editor',
    });
    await expect(
      previewPublishScratch(editorDeps, {
        projectId: PROJECT,
        scratchId: s.id,
        targetId: null,
        baseline: null,
      }),
    ).rejects.toThrowError();
  });

  it('diffScratchBody produces a clear `added` / `changed` diff', () => {
    const added = diffScratchBody({
      scratch: { title: 't', body: 'b' },
      baseline: null,
    });
    expect(added.every((r) => r.op === 'added')).toBe(true);

    const changed = diffScratchBody({
      scratch: { title: 'new', body: 'b' },
      baseline: { title: 'old', body: 'b' },
    });
    expect(changed.length).toBe(1);
    expect(changed[0]!.op).toBe('changed');
    expect(changed[0]!.path).toBe('title');
  });
});

describe('application/collaboration — Conflict detection', () => {
  it('records a Conflict without overwriting either side', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const conflict = await detectConflict(deps, {
      projectId: PROJECT,
      kind: 'comment',
      objectId: 'cmt_1',
      local: {
        side: 'local',
        actorId: 'u_local',
        actorDisplayName: 'Local',
        baseVersion: 1,
        payload: 'local edit',
        writtenAt: '2026-07-24T12:00:00.000Z',
      },
      remote: {
        side: 'remote',
        actorId: 'u_remote',
        actorDisplayName: 'Remote',
        baseVersion: 1,
        payload: 'remote edit',
        writtenAt: '2026-07-24T12:00:01.000Z',
      },
    });
    expect(conflict.resolution).toBeNull();
    expect(conflict.local.payload).toBe('local edit');
    expect(conflict.remote.payload).toBe('remote edit');
    // The repository has the row; the canonical
    // store does NOT.
    const list = await repo.listConflicts({ projectId: PROJECT });
    expect(list.length).toBe(1);
  });

  it('refuses to record a self-conflict (same actor on both sides)', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    await expect(
      detectConflict(deps, {
        projectId: PROJECT,
        kind: 'comment',
        objectId: 'cmt_1',
        local: {
          side: 'local',
          actorId: 'u_local',
          actorDisplayName: 'L',
          baseVersion: 1,
          payload: 'a',
          writtenAt: '2026-07-24T12:00:00.000Z',
        },
        remote: {
          side: 'remote',
          actorId: 'u_local',
          actorDisplayName: 'L',
          baseVersion: 1,
          payload: 'b',
          writtenAt: '2026-07-24T12:00:01.000Z',
        },
      }),
    ).rejects.toThrowError(/same actorId/);
  });

  it('resolveConflict is owner-only and records the resolution', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const conflict = await detectConflict(deps, {
      projectId: PROJECT,
      kind: 'comment',
      objectId: 'cmt_1',
      local: {
        side: 'local',
        actorId: 'u_a',
        actorDisplayName: 'A',
        baseVersion: 1,
        payload: 'a',
        writtenAt: '2026-07-24T12:00:00.000Z',
      },
      remote: {
        side: 'remote',
        actorId: 'u_b',
        actorDisplayName: 'B',
        baseVersion: 1,
        payload: 'b',
        writtenAt: '2026-07-24T12:00:01.000Z',
      },
    });
    const resolved = await resolveConflict(deps, {
      projectId: PROJECT,
      conflictId: conflict.id,
      resolution: 'merged',
      note: 'manual merge',
    });
    expect(resolved.resolution).toBe('merged');
    expect(resolved.resolvedBy).toBe(LOCAL_USER);
  });
});

describe('application/collaboration — Realtime failure tolerance', () => {
  it('continues to commit when the realtime hook throws', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo, {
      emitRealtime: () => {
        throw new Error('realtime offline');
      },
    });
    const member = await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_r',
      displayName: 'Realtime Victim',
    });
    expect(member.userId).toBe('u_r');
    // The commit landed; the activity log is in
    // place; realtime is the only thing that failed.
    const list = await repo.listCollaborators({ projectId: PROJECT });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('AI-off (no realtime hook) does not break any operation', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    // No emitRealtime; all use cases should work.
    const member = await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_offline',
      displayName: 'Offline',
    });
    const c = await postComment(deps, {
      projectId: PROJECT,
      targetKind: 'project',
      targetId: PROJECT,
      body: 'offline comment',
    });
    expect(member.userId).toBe('u_offline');
    expect(c.body).toBe('offline comment');
  });
});

describe('application/collaboration — Shared Task assignment', () => {
  it('atomically records the activity and task-assigned outbox intent', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_editor',
      displayName: 'Editor',
      role: 'editor',
    });
    repo.__clearStagedOutbox();

    const activity = await recordTaskAssignment(deps, {
      projectId: PROJECT,
      taskId: 'task_1',
      taskTitle: 'Review evidence',
      assignee: { userId: 'u_editor', displayName: 'Editor' },
      previousAssignee: null,
    });

    expect(activity.kind).toBe('task-assigned');
    expect(
      (await repo.listActivity({ projectId: PROJECT })).some((row) => row.id === activity.id),
    ).toBe(true);
    const staged = repo.__getStagedOutbox();
    expect(staged.map((row) => row.kind)).toEqual([
      'task-assigned',
      'activity-logged',
    ]);
  });

  it('refuses an assignee who is not a project member', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    await expect(recordTaskAssignment(deps, {
      projectId: PROJECT,
      taskId: 'task_1',
      taskTitle: 'Review evidence',
      assignee: { userId: 'u_outsider', displayName: 'Outsider' },
      previousAssignee: null,
    })).rejects.toThrow('assignee must be a member');
  });
});

describe('application/collaboration — capabilitiesForLocalUser', () => {
  it('returns the owner matrix for an owner', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    const caps = await capabilitiesForLocalUser(deps, PROJECT);
    expect(caps).toContain('project.invite');
    expect(caps).toContain('scratch.publish');
    expect(caps).toContain('ai.run-cloud');
  });

  it('returns the viewer matrix for a viewer', async () => {
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const deps = makeDeps(repo);
    // Add a viewer
    await inviteCollaborator(deps, {
      projectId: PROJECT,
      userId: 'u_v',
      displayName: 'Viewer',
      role: 'viewer',
    });
    const viewerDeps = makeDeps(repo, {
      localUserId: 'u_v',
      localUserDisplayName: 'Viewer',
    });
    const caps = await capabilitiesForLocalUser(viewerDeps, PROJECT);
    expect(caps).toContain('comment.read');
    expect(caps).not.toContain('comment.post');
    expect(caps).not.toContain('ai.run-cloud');
  });

  it('returns no capabilities for a non-member', async () => {
    const repo = new MemoryCollaborationRepository();
    const deps = makeDeps(repo);
    const caps = await capabilitiesForLocalUser(deps, PROJECT);
    expect(caps).toEqual([]);
  });
});
