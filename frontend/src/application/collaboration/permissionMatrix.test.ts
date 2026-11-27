/**
 * StudyKit v0.4 — `application/collaboration/permissionMatrix.test.ts`
 *
 * Pure tests for the WP-08 permission matrix. The
 * matrix is the single source of truth for "can this
 * actor do X in this project?" — the test enumerates
 * every (role, capability) cell and asserts the
 * expected answer.
 */

import { describe, it, expect } from 'vitest';
import {
  canPerform,
  requirePermission,
  capabilitiesForRole,
  isOwnershipGuarded,
  actorFromCollaborator,
  canEditComment,
  canDeleteComment,
  canMutateScratch,
  canPublishScratch,
  PermissionDeniedError,
  type Actor,
} from './permissionMatrix';
import { COLLABORATOR_ROLES, CAPABILITIES } from '../../domain/collaboration';

const owner: Actor = { userId: 'u_owner', displayName: 'O', role: 'owner' };
const editor: Actor = { userId: 'u_editor', displayName: 'E', role: 'editor' };
const commenter: Actor = { userId: 'u_com', displayName: 'C', role: 'commenter' };
const viewer: Actor = { userId: 'u_v', displayName: 'V', role: 'viewer' };

// Per-role expected capability set. The matrix below
// is the contract. The test reads it and asserts
// `canPerform` matches.

const EXPECTED: Readonly<Record<typeof COLLABORATOR_ROLES[number], ReadonlySet<string>>> = {
  owner: new Set([
    'project.read',
    'project.invite',
    'project.remove-member',
    'project.change-role',
    'project.delete',
    'comment.read',
    'comment.post',
    'comment.update-own',
    'comment.update-any',
    'comment.resolve',
    'comment.delete-own',
    'comment.delete-any',
    'mention.use',
    'task.read',
    'task.create',
    'task.assign',
    'task.complete',
    'scratch.read-own',
    'scratch.create',
    'scratch.update-own',
    'scratch.delete-own',
    'scratch.publish',
    'evidence.read',
    'evidence.create',
    'evidence.verify',
    'claim.read',
    'claim.create',
    'claim.update',
    'design.read',
    'design.create',
    'design.update',
    'design.decide',
    'output.read',
    'output.create',
    'ai.read-context',
    'ai.run-local',
    'ai.run-cloud',
    'ai-thread.read',
    'ai-thread.post',
    'thinking.contribute',
    'thinking.manage',
  ]),
  editor: new Set([
    'project.read',
    'comment.read',
    'comment.post',
    'comment.update-own',
    'comment.update-any',
    'comment.resolve',
    'comment.delete-own',
    'mention.use',
    'task.read',
    'task.create',
    'task.assign',
    'task.complete',
    'scratch.read-own',
    'scratch.create',
    'scratch.update-own',
    'scratch.delete-own',
    'scratch.publish',
    'evidence.read',
    'evidence.create',
    'evidence.verify',
    'claim.read',
    'claim.create',
    'claim.update',
    'design.read',
    'design.create',
    'design.update',
    'design.decide',
    'output.read',
    'output.create',
    'ai.read-context',
    'ai.run-local',
    'ai.run-cloud',
    'ai-thread.read',
    'ai-thread.post',
    'thinking.contribute',
    'thinking.manage',
  ]),
  commenter: new Set([
    'project.read',
    'comment.read',
    'comment.post',
    'comment.update-own',
    'comment.delete-own',
    'mention.use',
    'task.read',
    'scratch.read-own',
    'scratch.create',
    'scratch.update-own',
    'scratch.delete-own',
    'evidence.read',
    'claim.read',
    'design.read',
    'output.read',
    'ai.read-context',
    'ai-thread.read',
    'thinking.contribute',
  ]),
  viewer: new Set([
    'project.read',
    'comment.read',
    'task.read',
    'evidence.read',
    'claim.read',
    'design.read',
    'output.read',
    'ai-thread.read',
  ]),
};

describe('application/collaboration/permissionMatrix — full matrix', () => {
  for (const role of COLLABORATOR_ROLES) {
    const actor: Actor = { userId: 'u', displayName: 'u', role };
    describe(`role=${role}`, () => {
      for (const cap of CAPABILITIES) {
        const want = EXPECTED[role].has(cap);
        it(`${want ? 'grants' : 'denies'} ${cap}`, () => {
          // Ownership-guarded capabilities need a
          // matching `resourceOwnerId`; we pass
          // the actor's own userId so the
          // ownership check is satisfied.
          const args: Parameters<typeof canPerform>[0] = isOwnershipGuarded(cap)
            ? { actor, capability: cap, resourceOwnerId: actor.userId }
            : { actor, capability: cap };
          expect(canPerform(args)).toBe(want);
        });
      }
    });
  }
});

describe('application/collaboration/permissionMatrix — requirePermission', () => {
  it('throws PermissionDeniedError when the role denies', () => {
    expect(() =>
      requirePermission({
        actor: viewer,
        capability: 'project.invite',
        context: 'test',
      }),
    ).toThrowError(PermissionDeniedError);
  });

  it('does not throw when the role grants', () => {
    expect(() =>
      requirePermission({
        actor: owner,
        capability: 'project.invite',
        context: 'test',
      }),
    ).not.toThrow();
  });

  it('returns false for ownership-guarded capability without owner', () => {
    expect(
      canPerform({ actor: owner, capability: 'comment.update-own' }),
    ).toBe(false);
  });
});

describe('application/collaboration/permissionMatrix — ownership-guarded', () => {
  it('comment.update-own: owner of row only', () => {
    expect(
      canPerform({
        actor: commenter,
        capability: 'comment.update-own',
        resourceOwnerId: 'u_other',
      }),
    ).toBe(false);
    expect(
      canPerform({
        actor: commenter,
        capability: 'comment.update-own',
        resourceOwnerId: commenter.userId,
      }),
    ).toBe(true);
  });

  it('scratch.delete-own: owner of row only', () => {
    expect(
      canPerform({
        actor: editor,
        capability: 'scratch.delete-own',
        resourceOwnerId: 'u_other',
      }),
    ).toBe(false);
    expect(
      canPerform({
        actor: editor,
        capability: 'scratch.delete-own',
        resourceOwnerId: editor.userId,
      }),
    ).toBe(true);
  });
});

describe('application/collaboration/permissionMatrix — domain predicates', () => {
  it('canEditComment: owner / editor edit any; commenter edits own', () => {
    const commentByOther = {
      id: 'c1', projectId: 'p', targetKind: 'project' as const, targetId: 'p',
      threadId: 'c1', parentId: null, authorId: 'u_other',
      authorDisplayName: 'Other', authorType: 'user' as const,
      body: 'x', mentions: [], resolvedAt: null, resolvedBy: null, version: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(canEditComment(owner, commentByOther)).toBe(true);
    expect(canEditComment(editor, commentByOther)).toBe(true);
    expect(canEditComment(commenter, commentByOther)).toBe(false);
    expect(canEditComment(commenter, { ...commentByOther, authorId: commenter.userId })).toBe(true);
    expect(canEditComment(viewer, commentByOther)).toBe(false);
  });

  it('canDeleteComment mirrors canEditComment (delete-any is owner-only)', () => {
    const commentByOther = {
      id: 'c1', projectId: 'p', targetKind: 'project' as const, targetId: 'p',
      threadId: 'c1', parentId: null, authorId: 'u_other',
      authorDisplayName: 'Other', authorType: 'user' as const,
      body: 'x', mentions: [], resolvedAt: null, resolvedBy: null, version: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(canDeleteComment(owner, commentByOther)).toBe(true);
    // Editors can only delete their own comments.
    expect(canDeleteComment(editor, commentByOther)).toBe(false);
    expect(canDeleteComment(editor, { ...commentByOther, authorId: editor.userId })).toBe(true);
    expect(canDeleteComment(commenter, commentByOther)).toBe(false);
  });

  it('canMutateScratch: only the owner can update', () => {
    const scratchByOther = {
      id: 's1', projectId: 'p', ownerId: 'u_other', kind: 'note' as const,
      title: 't', body: 'b', status: 'private' as const,
      publishedRef: null, publishedAt: null, revertedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      authorType: 'user' as const,
    };
    expect(canMutateScratch(owner, scratchByOther)).toBe(false);
    expect(canMutateScratch(commenter, { ...scratchByOther, ownerId: commenter.userId })).toBe(true);
    expect(canMutateScratch(viewer, { ...scratchByOther, ownerId: viewer.userId })).toBe(false);
  });

  it('canPublishScratch: only the owner with role can publish', () => {
    const scratchByOther = {
      id: 's1', projectId: 'p', ownerId: 'u_other', kind: 'note' as const,
      title: 't', body: 'b', status: 'private' as const,
      publishedRef: null, publishedAt: null, revertedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      authorType: 'user' as const,
    };
    expect(canPublishScratch(editor, scratchByOther)).toBe(false);
    expect(canPublishScratch(commenter, scratchByOther)).toBe(false);
    expect(canPublishScratch(viewer, scratchByOther)).toBe(false);
  });
});

describe('application/collaboration/permissionMatrix — helpers', () => {
  it('capabilitiesForRole returns the expected set', () => {
    for (const role of COLLABORATOR_ROLES) {
      const caps = capabilitiesForRole(role);
      expect(new Set(caps)).toEqual(EXPECTED[role]);
    }
  });

  it('isOwnershipGuarded is correct for every capability', () => {
    for (const cap of CAPABILITIES) {
      const want = [
        'comment.update-own',
        'comment.delete-own',
        'scratch.read-own',
        'scratch.update-own',
        'scratch.delete-own',
      ].includes(cap);
      expect(isOwnershipGuarded(cap)).toBe(want);
    }
  });

  it('actorFromCollaborator round-trips a Collaborator row', () => {
    const actor = actorFromCollaborator({
      id: 'c', projectId: 'p', userId: 'u_x', displayName: 'X',
      role: 'editor', addedAt: 't', addedBy: 'u', authorType: 'user',
      createdAt: 't', updatedAt: 't',
    });
    expect(actor.userId).toBe('u_x');
    expect(actor.displayName).toBe('X');
    expect(actor.role).toBe('editor');
  });
});
