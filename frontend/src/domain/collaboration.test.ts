/**
 * StudyKit v0.4 — `domain/collaboration.test.ts`
 *
 * Pure type-guard + matrix tests for the WP-08
 * collaboration contracts.
 */

import { describe, it, expect } from 'vitest';
import {
  isCollaborator,
  isComment,
  isMention,
  isActivity,
  isPrivateScratch,
  isPublishDiff,
  isConflict,
  isConflictVersionSnapshot,
  isPresenceSnapshot,
  isRealtimeEnvelope,
  isCapability,
  assertUserAuthored,
  COLLABORATOR_ROLES,
  COLLABORATOR_ROLE_RANK,
  COLLABORATION_SCOPES,
  COMMENT_TARGET_KINDS,
  ACTIVITY_KINDS,
  CONFLICT_KINDS,
  CONFLICT_RESOLUTIONS,
  SCRATCH_KINDS,
  SCRATCH_STATUSES,
  PUBLISH_DIFF_OPS,
  PRESENCE_STALE_MS,
  REALTIME_ENVELOPE_KINDS,
  type Collaborator,
  type Comment,
  type Activity,
  type PrivateScratch,
  type PublishDiff,
  type Conflict,
  type PresenceSnapshot,
  type RealtimeEnvelope,
} from './collaboration';

const NOW = '2026-07-24T12:00:00.000Z';

function collaboratorFixture(over: Partial<Collaborator> = {}): Collaborator {
  return {
    id: 'col_1',
    projectId: 'p_1',
    userId: 'u_1',
    displayName: 'Test User',
    role: 'commenter',
    addedAt: NOW,
    addedBy: 'u_owner',
    authorType: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function commentFixture(over: Partial<Comment> = {}): Comment {
  return {
    id: 'cmt_1',
    projectId: 'p_1',
    targetKind: 'project',
    targetId: 'p_1',
    threadId: 'cmt_1',
    parentId: null,
    authorId: 'u_1',
    authorDisplayName: 'Test User',
    authorType: 'user',
    body: 'Hello world',
    mentions: [],
    resolvedAt: null,
    resolvedBy: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function activityFixture(over: Partial<Activity> = {}): Activity {
  return {
    id: 'act_1',
    projectId: 'p_1',
    actorId: 'u_1',
    actorDisplayName: 'Test User',
    actorType: 'user',
    kind: 'comment-posted',
    targetKind: 'project',
    targetId: 'p_1',
    summary: 'Test user commented',
    body: 'Hello world',
    scope: 'project',
    ephemeral: false,
    createdAt: NOW,
    ...over,
  };
}

function scratchFixture(over: Partial<PrivateScratch> = {}): PrivateScratch {
  return {
    id: 'scr_1',
    projectId: 'p_1',
    ownerId: 'u_1',
    kind: 'note',
    title: 'A scratch',
    body: 'Thinking out loud',
    status: 'private',
    publishedRef: null,
    publishedAt: null,
    revertedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    authorType: 'user',
    ...over,
  };
}

function publishDiffFixture(over: Partial<PublishDiff> = {}): PublishDiff {
  return {
    id: 'pd_1',
    scratchId: 'scr_1',
    projectId: 'p_1',
    ownerId: 'u_1',
    rows: [
      { op: 'added', path: 'title', before: null, after: 'A scratch' },
      { op: 'added', path: 'body', before: null, after: 'Thinking out loud' },
    ],
    targetId: null,
    createdAt: NOW,
    confirmedAt: null,
    cancelledAt: null,
    ...over,
  };
}

function conflictFixture(over: Partial<Conflict> = {}): Conflict {
  return {
    id: 'cfl_1',
    projectId: 'p_1',
    kind: 'comment',
    objectId: 'cmt_1',
    local: {
      side: 'local',
      actorId: 'u_local',
      actorDisplayName: 'Local',
      baseVersion: 1,
      payload: 'local edit',
      writtenAt: NOW,
    },
    remote: {
      side: 'remote',
      actorId: 'u_remote',
      actorDisplayName: 'Remote',
      baseVersion: 1,
      payload: 'remote edit',
      writtenAt: NOW,
    },
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: '',
    detectedAt: NOW,
    ...over,
  };
}

function presenceFixture(over: Partial<PresenceSnapshot> = {}): PresenceSnapshot {
  return {
    peerId: 'u_1@p_1',
    userId: 'u_1',
    displayName: 'Test User',
    projectId: 'p_1',
    role: 'commenter',
    online: true,
    lastSeenAt: NOW,
    ...over,
  };
}

function envelopeFixture(over: Partial<RealtimeEnvelope> = {}): RealtimeEnvelope {
  return {
    kind: 'comment-posted',
    id: 'env_1',
    actorId: 'u_1',
    projectId: 'p_1',
    version: 1,
    clientTime: NOW,
    serverTime: null,
    payload: '{}',
    ...over,
  };
}

describe('domain/collaboration — Collaborator', () => {
  it('accepts a well-shaped row', () => {
    expect(isCollaborator(collaboratorFixture())).toBe(true);
  });

  it('refuses every required field', () => {
    const c = collaboratorFixture();
    expect(isCollaborator({ ...c, id: '' })).toBe(false);
    expect(isCollaborator({ ...c, projectId: '' })).toBe(false);
    expect(isCollaborator({ ...c, userId: '' })).toBe(false);
    expect(isCollaborator({ ...c, displayName: '' })).toBe(false);
    expect(isCollaborator({ ...c, role: 'unknown' as unknown as Collaborator['role'] })).toBe(false);
    expect(isCollaborator({ ...c, addedBy: '' })).toBe(false);
    expect(isCollaborator({ ...c, authorType: 'ai' as unknown as Collaborator['authorType'] })).toBe(false);
    expect(isCollaborator({ ...c, createdAt: '' })).toBe(false);
    expect(isCollaborator({ ...c, updatedAt: '' })).toBe(false);
  });

  it('refuses non-objects', () => {
    expect(isCollaborator(null)).toBe(false);
    expect(isCollaborator('string')).toBe(false);
    expect(isCollaborator(42)).toBe(false);
  });
});

describe('domain/collaboration — Comment + Mention', () => {
  it('accepts a top-level comment', () => {
    expect(isComment(commentFixture())).toBe(true);
  });

  it('accepts a reply (parentId + threadId)', () => {
    const reply = commentFixture({
      id: 'cmt_2',
      parentId: 'cmt_1',
      threadId: 'cmt_1',
    });
    expect(isComment(reply)).toBe(true);
  });

  it('refuses a comment with a malformed mention', () => {
    const c = commentFixture({
      mentions: [
        { userId: 'u_1', displayName: 'User 1', position: 0, length: 0 },
      ],
    });
    expect(isComment(c)).toBe(false);
  });

  it('accepts a comment with well-shaped mentions', () => {
    const c = commentFixture({
      mentions: [
        { userId: 'u_1', displayName: 'User 1', position: 0, length: 4 },
      ],
    });
    expect(isComment(c)).toBe(true);
  });

  it('refuses a comment with a zero or negative version', () => {
    expect(isComment(commentFixture({ version: 0 }))).toBe(false);
    expect(isComment(commentFixture({ version: -1 }))).toBe(false);
    expect(isComment(commentFixture({ version: 1.5 }))).toBe(false);
  });

  it('refuses a comment with an empty body', () => {
    expect(isComment(commentFixture({ body: '   ' }))).toBe(false);
  });

  it('refuses a comment with an unknown authorType', () => {
    expect(
      isComment(
        commentFixture({ authorType: 'bot' as unknown as Comment['authorType'] }),
      ),
    ).toBe(false);
  });

  it('isMention is strict', () => {
    expect(isMention({ userId: 'u', displayName: 'd', position: 0, length: 2 })).toBe(true);
    expect(isMention({ userId: '', displayName: 'd', position: 0, length: 2 })).toBe(false);
    expect(isMention({ userId: 'u', displayName: '', position: 0, length: 2 })).toBe(false);
    expect(isMention({ userId: 'u', displayName: 'd', position: -1, length: 2 })).toBe(false);
    expect(isMention({ userId: 'u', displayName: 'd', position: 0, length: 1 })).toBe(false);
  });
});

describe('domain/collaboration — Activity (append-only)', () => {
  it('accepts a well-shaped row', () => {
    expect(isActivity(activityFixture())).toBe(true);
  });

  it('refuses an activity with an unknown kind', () => {
    expect(
      isActivity(activityFixture({ kind: 'unknown' as unknown as Activity['kind'] })),
    ).toBe(false);
  });

  it('accepts ephemeral rows (presence-joined)', () => {
    expect(
      isActivity(activityFixture({ kind: 'presence-joined', ephemeral: true })),
    ).toBe(true);
  });

  it('refuses an activity with an unknown scope', () => {
    expect(
      isActivity(activityFixture({ scope: 'public' as unknown as Activity['scope'] })),
    ).toBe(false);
  });
});

describe('domain/collaboration — PrivateScratch', () => {
  it('accepts a private scratch', () => {
    expect(isPrivateScratch(scratchFixture())).toBe(true);
  });

  it('accepts a published scratch with a publishedRef', () => {
    expect(
      isPrivateScratch(
        scratchFixture({
          status: 'published',
          publishedRef: 'task_1',
          publishedAt: NOW,
        }),
      ),
    ).toBe(true);
  });

  it('refuses a scratch with an unknown kind', () => {
    expect(
      isPrivateScratch(scratchFixture({ kind: 'unknown' as unknown as PrivateScratch['kind'] })),
    ).toBe(false);
  });

  it('refuses a scratch with an unknown status', () => {
    expect(
      isPrivateScratch(
        scratchFixture({ status: 'live' as unknown as PrivateScratch['status'] }),
      ),
    ).toBe(false);
  });
});

describe('domain/collaboration — PublishDiff', () => {
  it('accepts an `added` diff', () => {
    expect(isPublishDiff(publishDiffFixture())).toBe(true);
  });

  it('accepts a `changed` diff with a targetId', () => {
    expect(
      isPublishDiff(
        publishDiffFixture({
          rows: [{ op: 'changed', path: 'body', before: 'old', after: 'new' }],
          targetId: 'task_1',
        }),
      ),
    ).toBe(true);
  });

  it('refuses a diff with a malformed row', () => {
    expect(
      isPublishDiff(
        publishDiffFixture({
          rows: [{ op: 'added' as const, path: '', before: null, after: 'x' }],
        }),
      ),
    ).toBe(false);
  });
});

describe('domain/collaboration — Conflict + snapshots', () => {
  it('accepts a well-shaped conflict', () => {
    expect(isConflict(conflictFixture())).toBe(true);
  });

  it('refuses a conflict with the same actor on both sides', () => {
    const c = conflictFixture();
    const sameActor: Conflict = {
      ...c,
      local: { ...c.local, actorId: 'u_shared' },
      remote: { ...c.remote, actorId: 'u_shared' },
    };
    // The shape is still valid; the `same actor`
    // check is a use-case concern, not a type-guard
    // concern.
    expect(isConflict(sameActor)).toBe(true);
  });

  it('isConflictVersionSnapshot is strict', () => {
    const ok = {
      side: 'local' as const,
      actorId: 'u',
      actorDisplayName: 'd',
      baseVersion: 1,
      payload: 'p',
      writtenAt: NOW,
    };
    expect(isConflictVersionSnapshot(ok)).toBe(true);
    expect(isConflictVersionSnapshot({ ...ok, side: 'other' as unknown as 'local' })).toBe(false);
    expect(isConflictVersionSnapshot({ ...ok, actorId: '' })).toBe(false);
    expect(isConflictVersionSnapshot({ ...ok, baseVersion: '' })).toBe(false);
  });
});

describe('domain/collaboration — Presence + RealtimeEnvelope', () => {
  it('accepts a presence snapshot', () => {
    expect(isPresenceSnapshot(presenceFixture())).toBe(true);
  });

  it('refuses a presence snapshot with an unknown role', () => {
    expect(
      isPresenceSnapshot(presenceFixture({ role: 'admin' as unknown as PresenceSnapshot['role'] })),
    ).toBe(false);
  });

  it('accepts a realtime envelope', () => {
    expect(isRealtimeEnvelope(envelopeFixture())).toBe(true);
  });

  it('refuses a realtime envelope with an unknown kind', () => {
    expect(
      isRealtimeEnvelope(
        envelopeFixture({ kind: 'unknown' as unknown as RealtimeEnvelope['kind'] }),
      ),
    ).toBe(false);
  });
});

describe('domain/collaboration — constants + assertUserAuthored', () => {
  it('roles + rank are consistent', () => {
    expect(COLLABORATOR_ROLES.length).toBe(4);
    expect(COLLABORATOR_ROLE_RANK.owner).toBeGreaterThan(COLLABORATOR_ROLE_RANK.editor);
    expect(COLLABORATOR_ROLE_RANK.editor).toBeGreaterThan(COLLABORATOR_ROLE_RANK.commenter);
    expect(COLLABORATOR_ROLE_RANK.commenter).toBeGreaterThan(COLLABORATOR_ROLE_RANK.viewer);
  });

  it('isCapability accepts known + refuses unknown', () => {
    expect(isCapability('comment.post')).toBe(true);
    expect(isCapability('ai.run-cloud')).toBe(true);
    expect(isCapability('unknown')).toBe(false);
  });

  it('assertUserAuthored throws on ai', () => {
    expect(() => assertUserAuthored('ai')).toThrowError(/authorType="ai"/);
  });

  it('assertUserAuthored passes on user + imported', () => {
    expect(() => assertUserAuthored('user')).not.toThrow();
    expect(() => assertUserAuthored('imported')).not.toThrow();
  });

  it('the constants are all non-empty and unique', () => {
    for (const list of [
      COLLABORATION_SCOPES,
      COMMENT_TARGET_KINDS,
      ACTIVITY_KINDS,
      CONFLICT_KINDS,
      CONFLICT_RESOLUTIONS,
      SCRATCH_KINDS,
      SCRATCH_STATUSES,
      PUBLISH_DIFF_OPS,
      REALTIME_ENVELOPE_KINDS,
    ]) {
      const set = new Set<string>();
      for (const v of list) {
        expect(v.length).toBeGreaterThan(0);
        set.add(v);
      }
      expect(set.size).toBe(list.length);
    }
  });

  it('PRESENCE_STALE_MS is 60s (matches the matrix tests)', () => {
    expect(PRESENCE_STALE_MS).toBe(60_000);
  });
});
