/**
 * StudyKit v0.4 — `features/ai/kernel/actions/collabActions`
 *
 * AI actions for the WP-08 Collaboration Foundation
 * slice. The actions are *read-mostly* by design:
 *
 *   - `collab.summarizeActivity` — read-only.
 *     Summarises the recent activity log for a
 *     project into a Draft body the user can read
 *     and discard. Never writes canonical state.
 *   - `collab.draftMentionReply` — read-only +
 *     draft-only. Reads the latest comment(s) on
 *     a target and produces a Draft body the user
 *     must Accept to commit. Never auto-posts.
 *   - `collab.listOpenConflicts` — read-only.
 *     Pulls the open conflicts and surfaces them
 *     in the Draft body for the user to resolve.
 *     The AI never resolves a conflict itself.
 *   - `collab.suggestComment` — read + draft.
 *     Reads the local user's draft comment and
 *     suggests a follow-up question the user can
 *     accept or discard. Never posts a comment on
 *     the user's behalf.
 *   - `collab.never-*` — the negative test: the
 *     registry explicitly does NOT expose
 *     `post-comment`, `change-role`, `invite`,
 *     `assign-task`, `mention-others`, or any
 *     canonical write. The actions list is the
 *     "AI knows collaboration, but does not
 *     manage" contract.
 *
 * Per the v0.4 spec (studykit_v0.4_research_mode_ai_native_spec_cn.md
 * §5.10 "团队中的 AI"):
 *
 *   "AI run 属于发起者，在发布前保持 private draft；
 *    发布结果时显示 source scope、provider、model、
 *    cost owner 和发起人；AI 不代表团队成员发言，
 *    不自动 resolve comment 或 approve decision."
 *
 * Every action below returns a `DraftRecord`; the
 * Draft Layer is the AI's only path to canonical
 * state. The use case refuses AI writes at the
 * repository boundary; the AI actions never call
 * the write use cases.
 */

import type { ActionContract, ActionInput, ActionOutput } from '../actionRegistry';
import type { ContextPacket } from '../contextResolver';
import type { DraftRecord, DraftBody, DraftProvenance, DraftTarget } from '../draftLayer';
import { draftLayer, packetScopeChips } from '../draftLayer';
import type {
  Collaborator,
  Comment,
  Activity,
  Conflict,
  PrivateScratch,
} from '../../../../domain/collaboration';
import { actionRegistry } from '../actionRegistry';

// ---------------------------------------------------------------------------
// Action input shape
// ---------------------------------------------------------------------------

export interface CollabDeps {
  /** Read-side access to the local store. The
   *  actions never call a write use case. */
  readonly listCollaborators: (projectId: string) => Promise<readonly Collaborator[]>;
  readonly listComments: (
    projectId: string,
    targetKind: string,
    targetId: string,
  ) => Promise<readonly Comment[]>;
  readonly listActivity: (projectId: string, limit: number) => Promise<readonly Activity[]>;
  readonly listConflicts: (projectId: string) => Promise<readonly Conflict[]>;
  readonly listScratches: (projectId: string, ownerId: string) => Promise<readonly PrivateScratch[]>;
}

// ---------------------------------------------------------------------------
// Helper: build a comment-suggestion draft body
// ---------------------------------------------------------------------------

function buildSummaryDraftBody(args: {
  readonly collaborators: readonly Collaborator[];
  readonly activity: readonly Activity[];
  readonly conflicts: readonly Conflict[];
}): DraftBody {
  const lines: string[] = [];
  lines.push(`# Project activity summary`);
  lines.push('');
  lines.push(`**Members**: ${args.collaborators.length}`);
  const byRole = new Map<string, number>();
  for (const c of args.collaborators) {
    byRole.set(c.role, (byRole.get(c.role) ?? 0) + 1);
  }
  for (const [role, count] of byRole) {
    lines.push(`- ${role}: ${count}`);
  }
  lines.push('');
  lines.push(`**Recent activity** (${args.activity.length} events):`);
  for (const a of args.activity.slice(-10)) {
    lines.push(`- ${a.createdAt} · ${a.actorDisplayName} · ${a.kind} · ${a.summary}`);
  }
  if (args.conflicts.length > 0) {
    lines.push('');
    lines.push(`**Open conflicts**: ${args.conflicts.length}`);
    for (const c of args.conflicts) {
      lines.push(`- ${c.kind} on ${c.objectId} (detected ${c.detectedAt})`);
    }
  }
  return { kind: 'text', text: lines.join('\n') };
}

function buildMentionReplyDraftBody(args: {
  readonly target: Comment;
  readonly replies: readonly Comment[];
  readonly localDisplayName: string;
}): DraftBody {
  const lines: string[] = [];
  lines.push(`# Reply to ${args.target.authorDisplayName}`);
  lines.push('');
  lines.push(`> ${args.target.body}`);
  lines.push('');
  lines.push(`**Draft** (edit before posting):`);
  lines.push('');
  lines.push(`@${args.target.authorId} thanks for the note. `);
  lines.push(`I will follow up after reviewing the other ${
    args.replies.length === 0 ? 'comments' : 'replies in this thread'
  }.`);
  lines.push('');
  lines.push(`— ${args.localDisplayName}`);
  return { kind: 'text', text: lines.join('\n') };
}

function buildConflictsDraftBody(args: {
  readonly conflicts: readonly Conflict[];
}): DraftBody {
  const lines: string[] = [];
  lines.push(`# Open conflicts (${args.conflicts.length})`);
  lines.push('');
  for (const c of args.conflicts) {
    lines.push(`## ${c.kind} · ${c.objectId}`);
    lines.push(`- Local: ${c.local.actorDisplayName} (v${c.local.baseVersion}) wrote "${c.local.payload}"`);
    lines.push(`- Remote: ${c.remote.actorDisplayName} (v${c.remote.baseVersion}) wrote "${c.remote.payload}"`);
    lines.push(`- Detected: ${c.detectedAt}`);
    lines.push('');
  }
  return { kind: 'text', text: lines.join('\n') };
}

function buildCommentSuggestionDraftBody(args: {
  readonly existing: readonly Comment[];
  readonly localDisplayName: string;
}): DraftBody {
  const lines: string[] = [];
  lines.push(`# Suggestion: follow-up question`);
  lines.push('');
  if (args.existing.length === 0) {
    lines.push(`No existing comments on this target.`);
    lines.push('');
    lines.push(`A useful follow-up might be:`);
    lines.push('');
    lines.push(`> Could you point me at the relevant section in the source?`);
  } else {
    lines.push(`Recent comments on this target (${args.existing.length}):`);
    for (const c of args.existing.slice(-3)) {
      lines.push(`- ${c.authorDisplayName}: "${c.body}"`);
    }
    lines.push('');
    lines.push(`**Draft** (edit before posting):`);
    lines.push('');
    lines.push(`> Building on the last comment — has anyone checked the relevant source section?`);
  }
  lines.push('');
  lines.push(`— ${args.localDisplayName}`);
  return { kind: 'text', text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Draft helper (singleton draftLayer.create)
// ---------------------------------------------------------------------------

function buildActionDraft(args: {
  actionId: string;
  title: string;
  body: DraftBody;
  target: DraftTarget;
  sourceScope: readonly string[];
  packet: ContextPacket;
}): DraftRecord {
  const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const provenance: Omit<DraftProvenance, 'createdAt'> = {
    provider: 'local',
    actionId: args.actionId,
    contextSnapshotHash: args.packet.snapshotHash,
    sourceScope: [...args.sourceScope],
    invocationSurface: args.packet.invocationSurface,
  };
  return draftLayer.create({
    id,
    title: args.title,
    body: args.body,
    target: args.target,
    provenance,
    noUndo: true,
  });
}

// ---------------------------------------------------------------------------
// Action contracts
// ---------------------------------------------------------------------------

/**
 * `collab.summarizeActivity` — read-only summary of
 * the project's recent activity + members + open
 * conflicts. Returns a Draft body the user reads
 * and discards (or copies into a Note). The action
 * never writes canonical state.
 */
function makeSummarizeActivityAction(deps: CollabDeps): ActionContract<{ projectId: string }> {
  return {
    id: 'collab.summarizeActivity',
    label: 'Summarize project activity',
    category: 'local',
    description:
      'Read-only: summarise recent activity, members, and open conflicts in the project.',
    intent: 'explain',
    requiredScope: 'container',
    permission: { kind: 'always' },
    preview: (input: ActionInput) => ({
      summary: 'Reads activity / members / conflicts; writes a Draft body the user can copy.',
      reads: ['project activity', 'project members', 'open conflicts'],
      writes: ['AI Draft (never canonical)'],
      needsAi: false,
      providerLabel: 'local',
    }),
    execute: async (input) => {
      const projectId = (input.args as { projectId: string }).projectId;
      const [collaborators, activity, conflicts] = await Promise.all([
        deps.listCollaborators(projectId),
        deps.listActivity(projectId, 30),
        deps.listConflicts(projectId),
      ]);
      const draft = buildActionDraft({
        actionId: 'collab.summarizeActivity',
        title: 'Project activity summary',
        body: buildSummaryDraftBody({ collaborators, activity, conflicts }),
        target: { targetId: projectId, kind: 'other' },
        sourceScope: [...packetScopeChips(input.packet), `project:${projectId}`],
        packet: input.packet,
      });
      return { draft };
    },
  };
}

/**
 * `collab.draftMentionReply` — read + draft. Reads
 * the latest comment(s) on a target and produces a
 * Draft body. The user must Accept the draft (via
 * the standard Draft Layer flow) to actually post.
 * The action never posts a comment on the user's
 * behalf.
 */
function makeMentionReplyAction(deps: CollabDeps): ActionContract<{
  projectId: string;
  targetKind: string;
  targetId: string;
  localDisplayName: string;
}> {
  return {
    id: 'collab.draftMentionReply',
    label: 'Draft a reply to a comment',
    category: 'local',
    description:
      'Read + draft: reads the latest comment and produces a Draft reply. The user must Accept to post.',
    intent: 'create',
    requiredScope: 'current-view',
    permission: { kind: 'always' },
    preview: (input: ActionInput) => ({
      summary: 'Reads a comment thread; writes a Draft reply the user can edit before Accept.',
      reads: ['target comment thread'],
      writes: ['AI Draft (never canonical until Accept)'],
      needsAi: false,
      providerLabel: 'local',
    }),
    execute: async (input) => {
      const args = input.args as {
        projectId: string;
        targetKind: string;
        targetId: string;
        localDisplayName: string;
      };
      const comments = await deps.listComments(args.projectId, args.targetKind, args.targetId);
      const target = comments[comments.length - 1];
      if (!target) {
        return {
          draft: buildActionDraft({
            actionId: 'collab.draftMentionReply',
            title: 'Reply to thread',
            body: { kind: 'text', text: 'No comment to reply to.' },
            target: { targetId: args.targetId, kind: 'navigation' },
            sourceScope: [...packetScopeChips(input.packet), `${args.targetKind}:${args.targetId}`],
            packet: input.packet,
          }),
        };
      }
      const replies = comments.filter((c) => c.parentId === target.id);
      const draft = buildActionDraft({
        actionId: 'collab.draftMentionReply',
        title: `Reply to ${target.authorDisplayName}`,
        body: buildMentionReplyDraftBody({ target, replies, localDisplayName: args.localDisplayName }),
        target: { targetId: target.id, kind: 'other' },
        sourceScope: [...packetScopeChips(input.packet), `comment:${target.id}`],
        packet: input.packet,
      });
      return { draft };
    },
  };
}

/**
 * `collab.listOpenConflicts` — read-only. Surfaces
 * the open conflicts so the user can resolve them.
 * The action never resolves a conflict.
 */
function makeListOpenConflictsAction(deps: CollabDeps): ActionContract<{ projectId: string }> {
  return {
    id: 'collab.listOpenConflicts',
    label: 'List open conflicts',
    category: 'local',
    description: 'Read-only: list the project\u2019s open conflicts. The AI never resolves them.',
    intent: 'check',
    requiredScope: 'container',
    permission: { kind: 'always' },
    preview: (input: ActionInput) => ({
      summary: 'Reads conflicts; writes a Draft summary the user reads and acts on.',
      reads: ['project conflicts'],
      writes: ['AI Draft (never canonical)'],
      needsAi: false,
      providerLabel: 'local',
    }),
    execute: async (input) => {
      const projectId = (input.args as { projectId: string }).projectId;
      const conflicts = await deps.listConflicts(projectId);
      const draft = buildActionDraft({
        actionId: 'collab.listOpenConflicts',
        title: `Open conflicts (${conflicts.length})`,
        body: buildConflictsDraftBody({ conflicts }),
        target: { targetId: projectId, kind: 'other' },
        sourceScope: [...packetScopeChips(input.packet), `project:${projectId}`],
        packet: input.packet,
      });
      return { draft };
    },
  };
}

/**
 * `collab.suggestComment` — read + draft. Reads the
 * existing comments on a target and suggests a
 * follow-up question as a Draft. The user must
 * Accept to post.
 */
function makeSuggestCommentAction(deps: CollabDeps): ActionContract<{
  projectId: string;
  targetKind: string;
  targetId: string;
  localDisplayName: string;
}> {
  return {
    id: 'collab.suggestComment',
    label: 'Suggest a follow-up comment',
    category: 'local',
    description:
      'Read + draft: reads recent comments and suggests a follow-up as a Draft. The user must Accept to post.',
    intent: 'create',
    requiredScope: 'current-view',
    permission: { kind: 'always' },
    preview: (input: ActionInput) => ({
      summary: 'Reads recent comments; writes a Draft follow-up the user can edit before Accept.',
      reads: ['target comment thread'],
      writes: ['AI Draft (never canonical until Accept)'],
      needsAi: false,
      providerLabel: 'local',
    }),
    execute: async (input) => {
      const args = input.args as {
        projectId: string;
        targetKind: string;
        targetId: string;
        localDisplayName: string;
      };
      const comments = await deps.listComments(args.projectId, args.targetKind, args.targetId);
      const draft = buildActionDraft({
        actionId: 'collab.suggestComment',
        title: 'Follow-up comment suggestion',
        body: buildCommentSuggestionDraftBody({ existing: comments, localDisplayName: args.localDisplayName }),
        target: { targetId: args.targetId, kind: 'other' },
        sourceScope: [...packetScopeChips(input.packet), `${args.targetKind}:${args.targetId}`],
        packet: input.packet,
      });
      return { draft };
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the four read-mostly collaboration
 * actions. Idempotent: a re-register is a no-op
 * (the registry overwrites by id, which is the
 * safe behaviour for a hot reload in dev).
 */
export function registerCollabActions(deps: CollabDeps): void {
  actionRegistry.register(makeSummarizeActivityAction(deps));
  actionRegistry.register(makeMentionReplyAction(deps));
  actionRegistry.register(makeListOpenConflictsAction(deps));
  actionRegistry.register(makeSuggestCommentAction(deps));
}

/**
 * Unregister the four collaboration actions.
 * Tests call this in `afterEach` so a re-register
 * does not leak between cases.
 */
export function unregisterCollabActions(): void {
  actionRegistry.unregister('collab.summarizeActivity');
  actionRegistry.unregister('collab.draftMentionReply');
  actionRegistry.unregister('collab.listOpenConflicts');
  actionRegistry.unregister('collab.suggestComment');
}

/**
 * The set of action ids the WP-08 collaboration
 * slice explicitly forbids the AI from registering
 * (or running). The test asserts this list is
 * empty *at runtime* — i.e. no plugin / future
 * packet can quietly add a `collab.postComment`
 * without the slice noticing.
 */
export const FORBIDDEN_COLLAB_AI_ACTIONS: readonly string[] = [
  'collab.postComment',
  'collab.editComment',
  'collab.deleteComment',
  'collab.invite',
  'collab.removeMember',
  'collab.changeRole',
  'collab.publishScratch',
  'collab.deleteScratch',
  'collab.assignTask',
  'collab.resolveConflict',
  'collab.mentionOthers',
];

/**
 * Returns `true` when no forbidden action id is
 * currently registered. The test calls this to
 * lock down the contract: if a future packet
 * adds a forbidden action, the test fails.
 */
export function assertNoForbiddenCollabActionRegistered(): boolean {
  for (const id of FORBIDDEN_COLLAB_AI_ACTIONS) {
    if (actionRegistry.get(id)) return false;
  }
  return true;
}
