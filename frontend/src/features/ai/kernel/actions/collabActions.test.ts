/**
 * StudyKit v0.4 — `features/ai/kernel/actions/collabActions.test.ts`
 *
 * Tests for the four read-mostly collaboration AI
 * actions + the forbidden-actions lockdown.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  registerCollabActions,
  unregisterCollabActions,
  assertNoForbiddenCollabActionRegistered,
  FORBIDDEN_COLLAB_AI_ACTIONS,
  type CollabDeps,
} from './collabActions';
import { actionRegistry } from '../actionRegistry';
import { draftLayer } from '../draftLayer';
import type {
  Collaborator,
  Comment,
  Activity,
  Conflict,
  PrivateScratch,
} from '../../../../domain/collaboration';
import type { ContextPacket } from '../contextResolver';

const NOW = '2026-07-24T12:00:00.000Z';
const PROJECT = 'p_1';

function member(over: Partial<Collaborator> = {}): Collaborator {
  return {
    id: 'c1', projectId: PROJECT, userId: 'u_1', displayName: 'U',
    role: 'commenter', addedAt: NOW, addedBy: 'u_owner',
    authorType: 'user', createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'cmt_1', projectId: PROJECT, targetKind: 'project' as const, targetId: PROJECT,
    threadId: 'cmt_1', parentId: null,
    authorId: 'u_1', authorDisplayName: 'U',
    authorType: 'user' as const, body: 'hello', mentions: [],
    resolvedAt: null, resolvedBy: null, version: 1,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'act_1', projectId: PROJECT,
    actorId: 'u_1', actorDisplayName: 'U', actorType: 'user' as const,
    kind: 'comment-posted' as const,
    targetKind: 'project' as const, targetId: PROJECT,
    summary: 's', body: '', scope: 'project' as const, ephemeral: false,
    createdAt: NOW,
    ...over,
  };
}

function conflict(over: Partial<Conflict> = {}): Conflict {
  return {
    id: 'cfl_1', projectId: PROJECT,
    kind: 'comment' as const, objectId: 'cmt_1',
    local: { side: 'local', actorId: 'u_a', actorDisplayName: 'A', baseVersion: 1, payload: 'a', writtenAt: NOW },
    remote: { side: 'remote', actorId: 'u_b', actorDisplayName: 'B', baseVersion: 1, payload: 'b', writtenAt: NOW },
    resolution: null, resolvedBy: null, resolvedAt: null, resolutionNote: '',
    detectedAt: NOW,
    ...over,
  };
}

function scratch(over: Partial<PrivateScratch> = {}): PrivateScratch {
  return {
    id: 'scr_1', projectId: PROJECT, ownerId: 'u_1', kind: 'note' as const,
    title: 't', body: 'b', status: 'private' as const,
    publishedRef: null, publishedAt: null, revertedAt: null,
    createdAt: NOW, updatedAt: NOW, authorType: 'user' as const,
    ...over,
  };
}

function makeDeps(): CollabDeps {
  return {
    listCollaborators: async () => [
      member({ id: 'c1', role: 'owner' }),
      member({ id: 'c2', userId: 'u_2', displayName: 'U2', role: 'commenter' }),
    ],
    listComments: async () => [
      comment({ id: 'cmt_1', body: 'first comment' }),
      comment({ id: 'cmt_2', body: 'second comment', parentId: 'cmt_1', threadId: 'cmt_1' }),
    ],
    listActivity: async () => [
      activity({ id: 'a1', summary: 'added member' }),
      activity({ id: 'a2', kind: 'comment-posted', summary: 'posted comment' }),
    ],
    listConflicts: async () => [conflict({ id: 'cfl_1' })],
    listScratches: async () => [scratch({ id: 's1' })],
  };
}

function makePacket(): ContextPacket {
  return {
    mode: 'research',
    route: `/research/p/${PROJECT}`,
    container: { workspaceId: null, mode: 'research', kind: 'project', id: PROJECT },
    focus: null,
    selectedText: null,
    selectedObjectIds: [],
    selectionPreview: [],
    pinnedContextIds: [],
    scopePolicy: 'container',
    provider: 'none',
    visibility: 'private',
    invocationSurface: 'intent-capsule',
    snapshotHash: 'h_test',
  };
}

afterEach(() => {
  unregisterCollabActions();
  draftLayer.__resetForTests();
});

describe('features/ai/kernel/actions/collabActions — registration', () => {
  it('registers the four read-mostly actions and no forbidden ones', () => {
    expect(assertNoForbiddenCollabActionRegistered()).toBe(true);
    registerCollabActions(makeDeps());
    expect(actionRegistry.get('collab.summarizeActivity')).toBeDefined();
    expect(actionRegistry.get('collab.draftMentionReply')).toBeDefined();
    expect(actionRegistry.get('collab.listOpenConflicts')).toBeDefined();
    expect(actionRegistry.get('collab.suggestComment')).toBeDefined();
    // The forbidden list still empty.
    expect(assertNoForbiddenCollabActionRegistered()).toBe(true);
  });

  it('FORBIDDEN_COLLAB_AI_ACTIONS is locked down (no canonical write)', () => {
    for (const id of FORBIDDEN_COLLAB_AI_ACTIONS) {
      expect(actionRegistry.get(id)).toBeUndefined();
    }
  });
});

describe('features/ai/kernel/actions/collabActions — collab.summarizeActivity', () => {
  it('produces a Draft that lists members, activity, and conflicts', async () => {
    registerCollabActions(makeDeps());
    const action = actionRegistry.get('collab.summarizeActivity')!;
    const out = await action.execute({
      packet: makePacket(),
      prompt: 'summarize',
      args: { projectId: PROJECT },
    } as never);
    expect(out.draft).toBeDefined();
    const text = (out.draft.body as { text: string }).text;
    expect(text).toContain('Project activity summary');
    expect(text).toContain('**Members**: 2');
    expect(text).toContain('owner: 1');
    expect(text).toContain('commenter: 1');
    expect(text).toContain('**Open conflicts**: 1');
  });
});

describe('features/ai/kernel/actions/collabActions — collab.draftMentionReply', () => {
  it('produces a Draft that quotes the latest comment and suggests a reply', async () => {
    registerCollabActions(makeDeps());
    const action = actionRegistry.get('collab.draftMentionReply')!;
    const out = await action.execute({
      packet: makePacket(),
      prompt: 'reply',
      args: {
        projectId: PROJECT,
        targetKind: 'project',
        targetId: PROJECT,
        localDisplayName: 'Local User',
      },
    } as never);
    const text = (out.draft.body as { text: string }).text;
    expect(text).toContain('second comment');
    expect(text).toContain('Local User');
  });
});

describe('features/ai/kernel/actions/collabActions — collab.listOpenConflicts', () => {
  it('produces a Draft that lists each open conflict with both sides', async () => {
    registerCollabActions(makeDeps());
    const action = actionRegistry.get('collab.listOpenConflicts')!;
    const out = await action.execute({
      packet: makePacket(),
      prompt: 'list',
      args: { projectId: PROJECT },
    } as never);
    const text = (out.draft.body as { text: string }).text;
    expect(text).toContain('Open conflicts (1)');
    expect(text).toContain('comment · cmt_1');
    expect(text).toContain('Local: A');
    expect(text).toContain('Remote: B');
  });
});

describe('features/ai/kernel/actions/collabActions — collab.suggestComment', () => {
  it('produces a Draft that suggests a follow-up question', async () => {
    registerCollabActions(makeDeps());
    const action = actionRegistry.get('collab.suggestComment')!;
    const out = await action.execute({
      packet: makePacket(),
      prompt: 'suggest',
      args: {
        projectId: PROJECT,
        targetKind: 'project',
        targetId: PROJECT,
        localDisplayName: 'Local User',
      },
    } as never);
    const text = (out.draft.body as { text: string }).text;
    expect(text).toContain('Recent comments on this target');
    expect(text).toContain('Local User');
  });

  it('produces a helpful Draft when no comments exist', async () => {
    registerCollabActions({
      ...makeDeps(),
      listComments: async () => [],
    });
    const action = actionRegistry.get('collab.suggestComment')!;
    const out = await action.execute({
      packet: makePacket(),
      prompt: 'suggest',
      args: {
        projectId: PROJECT,
        targetKind: 'project',
        targetId: PROJECT,
        localDisplayName: 'Local User',
      },
    } as never);
    const text = (out.draft.body as { text: string }).text;
    expect(text).toContain('No existing comments on this target');
  });
});
