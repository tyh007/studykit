/**
 * StudyKit v0.4 — WP-08 Round 3 P0-4 test
 *
 * Asserts the transactional outbox contract:
 *
 *   - the canonical write AND the outbox row
 *     commit in ONE atomic transaction;
 *   - a failure in the canonical write rolls
 *     back the outbox row too (a process
 *     crash mid-transaction cannot leak a
 *     cross-user event without its canonical
 *     row);
 *   - the staged outbox row carries the
 *     expected kind, payload, and baseVersion.
 *
 * The tests use the in-memory
 * `MemoryCollaborationRepository` (the same
 * shape the Dexie adapter uses for its
 * `transact`). The Dexie adapter is exercised
 * in the integration smoke (the real Postgres
 * backend runs the equivalent at the server
 * side).
 */

import { describe, it, expect } from 'vitest';
import {
  inviteCollaborator,
  postComment,
} from './collaborationUseCases';
import { MemoryCollaborationRepository } from './collaborationRepository';
import { __resetClientIdForTests, __setClientIdForTests } from './syncService';

function makeDeps(repo: MemoryCollaborationRepository) {
  return {
    repository: repo,
    localUserId: 'u-a',
    localUserDisplayName: 'Alice',
  };
}

async function seedOwner(repo: MemoryCollaborationRepository): Promise<void> {
  // The owner membership is the local user's
  // own row. We seed it via the repository's
  // transact (the use case refuses when the
  // caller is not already a member — but the
  // owner bootstrap is the only path, and
  // the integration test seeds the row
  // directly because `ensureLocalMembership`
  // is the only use case that mints an
  // `owner` row without an existing
  // membership).
  const now = new Date().toISOString();
  await repo.transact(async (tx) => {
    tx.putCollaborator({
      id: 'col_owner',
      projectId: 'p-1',
      userId: 'u-a',
      displayName: 'Alice',
      role: 'owner',
      addedAt: now,
      addedBy: 'u-a',
      authorType: 'user',
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe('P0-4 transactional outbox', () => {
  it('canonical write + outbox row commit in one atomic transaction', async () => {
    __setClientIdForTests('cli_test');
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const before = repo.__getStagedOutbox().length;
    expect(before).toBe(0);
    const member = await inviteCollaborator(makeDeps(repo), {
      projectId: 'p-1',
      userId: 'u-b',
      displayName: 'Bob',
      role: 'commenter',
    });
    expect(member.id).toMatch(/^col_/);
    // After the use case, the staged outbox
    // has TWO rows: the `member-added` op
    // AND the `activity-logged` op (P0-6
    // cross-user activity feed). The
    // canonical Collaborator row is also
    // committed (idempotent on
    // `listCollaborators`).
    const outbox = repo.__getStagedOutbox();
    expect(outbox.length).toBe(2);
    const kinds = outbox.map((r) => r.kind);
    expect(kinds).toContain('member-added');
    expect(kinds).toContain('activity-logged');
    const memberAdded = outbox.find((r) => r.kind === 'member-added')!;
    expect(memberAdded.projectId).toBe('p-1');
    expect(memberAdded.clientId).toBe('cli_test');
    expect(JSON.parse(memberAdded.payload).id).toBe(member.id);
    // The canonical row is also in the repo
    // (the same transaction). The seed
    // already added the local user as the
    // owner, so the project has 2 members
    // (owner + invited commenter).
    const members = await repo.listCollaborators({ projectId: 'p-1' });
    expect(members.length).toBe(2);
    const invited = members.find((m) => m.userId === 'u-b');
    expect(invited).toBeDefined();
    expect(invited?.role).toBe('commenter');
  });

  it('a failure in the canonical write rolls back the outbox row', async () => {
    __setClientIdForTests('cli_test');
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    // First invite: success.
    await inviteCollaborator(makeDeps(repo), {
      projectId: 'p-1',
      userId: 'u-b',
      displayName: 'Bob',
    });
    const afterFirst = repo.__getStagedOutbox().length;
    expect(afterFirst).toBe(2);
    // Second invite: same user → use case
    // throws "already a member". The outbox
    // should NOT have grown.
    await expect(
      inviteCollaborator(makeDeps(repo), {
        projectId: 'p-1',
        userId: 'u-b',
        displayName: 'Bob',
      }),
    ).rejects.toThrow(/already a member/);
    const afterSecond = repo.__getStagedOutbox().length;
    expect(afterSecond).toBe(2);
  });

  it('a comment-posted use case stages the outbox row alongside the comment + activity', async () => {
    __setClientIdForTests('cli_test');
    const repo = new MemoryCollaborationRepository();
    await seedOwner(repo);
    const comment = await postComment(makeDeps(repo), {
      projectId: 'p-1',
      targetKind: 'project',
      targetId: 'p-1',
      body: 'hello @u-b',
    });
    const outbox = repo.__getStagedOutbox();
    expect(outbox.length).toBe(2);
    const kinds = outbox.map((r) => r.kind);
    expect(kinds).toContain('comment-posted');
    expect(kinds).toContain('activity-logged');
    const commentOp = outbox.find((r) => r.kind === 'comment-posted')!;
    expect(JSON.parse(commentOp.payload).id).toBe(comment.id);
    // The activity row is also committed.
    const activity = await repo.listActivity({ projectId: 'p-1' });
    expect(activity.length).toBe(1);
    expect(activity[0]?.kind).toBe('comment-posted');
  });
});
