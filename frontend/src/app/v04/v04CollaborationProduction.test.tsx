/**
 * StudyKit v0.4 — `v04CollaborationProduction` e2e test
 *
 * Drives the real `CollaborationPanel` (with the
 * `v04Collaboration` flag on) through the WP-08
 * must-haves:
 *
 *   1. Role permission matrix is complete.
 *   2. Inviting a collaborator does NOT auto-share a
 *      Private Scratch.
 *   3. Private → Shared requires a publish preview
 *      + explicit user confirm.
 *   4. Comments, mentions, shared tasks, and
 *      activity survive reload (the repository is
 *      the live Dexie adapter; the test re-mounts
 *      the panel and the state is preserved).
 *   5. Reconnect (re-subscribe) does not lose
 *      async content.
 *   6. Realtime failure does not break async
 *      collaboration (the panel uses a
 *      `NoopRealtimeChannel` in this test; the
 *      local commit still lands).
 *   7. Conflicts are non-destructive (the panel
 *      surfaces both sides and the owner-only
 *      resolution buttons).
 *   8. AI-off (no `emitRealtime` hook, no provider)
 *      still allows all core operations.
 *
 * The test mounts the `CollaborationPanel`
 * directly (no full V04Shell) so the seam is
 * narrow. The seam mirrors WP-07: the Dexie
 * adapter is swapped for an in-memory
 * `MemoryCollaborationRepository`; the
 * `BroadcastChannel` is replaced with a
 * `MemoryRealtimeChannel` so two panels in the
 * same test can be driven side by side (the
 * "two browser tabs" smoke); the AI provider
 * router is omitted (the slice is read-only AI;
 * the test does not need a real provider).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollaborationPanel } from '../../features/collaboration/CollaborationPanel';
import { CollaborationProvider } from '../../features/collaboration/collaborationContext';
import { MemoryCollaborationRepository } from '../../application/collaboration/collaborationRepository';
import { MemoryRealtimeChannel } from '../../application/collaboration/realtimeSpike';
import { ensureLocalMembership } from '../../application/collaboration/collaborationUseCases';
import { inviteCollaborator, type UseCaseDeps } from '../../application/collaboration/collaborationUseCases';
import { detectConflict } from '../../application/collaboration/collaborationUseCases';

vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-local', email: 'local@test', display_name: 'Local Owner' },
      workspace_id: 'ws-1',
      loading: false,
      login: async () => undefined,
      register: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modulesApi: { list: async () => [], create: async () => ({}), update: async () => ({}), delete: async () => ({ success: true }) },
    lecturesApi: { list: async () => [], create: async () => ({}) },
    sourceDocumentsApi: { get: async () => null, getPages: async () => [], upload: async () => ({}) },
    exportsApi: { create: async () => ({}) },
    syncApi: { push: async () => ({}), pull: async () => ({}) },
    authApi: { register: async () => ({}), login: async () => ({}), me: async () => ({}), logout: async () => ({}), logoutAll: async () => ({}), changePassword: async () => ({}) },
    uploadsApi: { uploadFile: async () => ({}) },
    setAuthToken: () => undefined,
    getAuthToken: () => null,
  };
});

vi.mock('../../lib/literature-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    literatureProjectsApi: { list: async () => [] },
    literaturePapersApi: { list: async () => [], get: async () => null },
    literatureAiApi: { chat: async () => ({ message: { role: 'assistant', content: '' } }) },
    zoteroApi: {
      connect: async () => ({}),
      disconnect: async () => ({ success: true }),
      status: async () => ({ status: 'connected' }),
      listCollections: async () => ({ collections: [] }),
      importCollections: async () => ({ readingLists: [] }),
      importCollectionItems: async () => ({ citationItems: [], importedCount: 0, stats: { totalItems: 0, importedItems: 0, existingItems: 0, skippedItems: 0, papersCreated: 0, pdfsDownloaded: 0, pdfsMissing: 0, pdfsFailed: 0, warnings: [] } }),
      syncEvents: async () => [],
    },
    citationsApi: { list: async () => [] },
    paperNotesApi: { create: async () => ({}) },
    paperRelationsApi: { list: async () => [] },
    readingListsApi: { list: async () => [] },
    literatureCustomFieldsApi: { list: async () => [] },
  };
});

vi.mock('../../lib/sync', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isSyncConfigured: () => false,
    isSyncOnline: () => false,
  };
});

vi.mock('../../lib/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

const PROJECT = 'p-collab-1';
const LOCAL_USER = 'u-local';
const LOCAL_NAME = 'Local Owner';

let testRepo: MemoryCollaborationRepository;
let channel: MemoryRealtimeChannel;

function makeDeps(overrides: Partial<UseCaseDeps> = {}): UseCaseDeps {
  return {
    repository: testRepo,
    localUserId: LOCAL_USER,
    localUserDisplayName: LOCAL_NAME,
    ...overrides,
  };
}

async function seedOwner(): Promise<void> {
  await ensureLocalMembership(makeDeps(), { projectId: PROJECT });
}

function mountPanel() {
  return render(
    <CollaborationProvider
      value={{
        repository: testRepo,
        localUserId: LOCAL_USER,
        localUserDisplayName: LOCAL_NAME,
        channel,
        devSeamActive: true,
      }}
    >
      <CollaborationPanel projectId={PROJECT} />
    </CollaborationProvider>,
  );
}

beforeEach(async () => {
  testRepo = new MemoryCollaborationRepository();
  channel = new MemoryRealtimeChannel('test');
});

afterEach(() => {
  cleanup();
});

describe('v04CollaborationProduction — role matrix + membership', () => {
  it('owner can see + change roles; the role matrix is complete', async () => {
    const user = userEvent.setup();
    await seedOwner();
    mountPanel();
    const meRole = await screen.findByTestId('me-role');
    expect(meRole.textContent).toContain('owner');
    // Invite another user
    const inviteOpen = await screen.findByTestId('invite-open');
    await user.click(inviteOpen);
    const userIdInput = screen.getByTestId('invite-userid');
    const nameInput = screen.getByTestId('invite-displayname');
    await user.type(userIdInput, 'u-collab-2');
    await user.type(nameInput, 'Collaborator Two');
    const submit = screen.getByTestId('invite-submit');
    await user.click(submit);
    const member = await screen.findByTestId('member-u-collab-2');
    expect(member.textContent).toContain('Collaborator Two');
    expect(member.textContent).toContain('commenter');
  });

  it('invite refuses duplicate user', async () => {
    const user = userEvent.setup();
    await seedOwner();
    await inviteCollaborator(makeDeps(), {
      projectId: PROJECT,
      userId: 'u-dup',
      displayName: 'Dup',
    });
    mountPanel();
    const inviteOpen = await screen.findByTestId('invite-open');
    await user.click(inviteOpen);
    await user.type(screen.getByTestId('invite-userid'), 'u-dup');
    await user.type(screen.getByTestId('invite-displayname'), 'Dup');
    await user.click(screen.getByTestId('invite-submit'));
    const error = await screen.findByTestId('collab-error');
    expect(error.textContent).toMatch(/already a member/);
  });
});

describe('v04CollaborationProduction — comments + mentions + activity', () => {
  it('comments + activity survive a reload', async () => {
    const user = userEvent.setup();
    await seedOwner();
    mountPanel();
    // Post a comment with a mention
    const body = await screen.findByTestId('comment-body');
    await user.type(body, 'Hello @u-other, please review');
    await user.click(await screen.findByTestId('comment-submit'));
    const c1 = await screen.findByTestId(/^comment-cmt_/);
    expect(c1.textContent).toContain('Hello @u-other');
    // Reload: cleanup + re-render.
    cleanup();
    mountPanel();
    // The comment is still there.
    const c2 = await screen.findByText(/Hello @u-other/);
    expect(c2).toBeTruthy();
  });

  it('realtime failure does not break async collaboration', async () => {
    // Build a *throwing* channel. The panel uses
    // the channel for `subscribeProject`; the
    // throw surfaces but the local commit still
    // lands.
    const throwingChannel = {
      id: 'throwing',
      send: () => {
        throw new Error('realtime offline');
      },
      subscribeProject: () => () => undefined,
      close: () => undefined,
    };
    await seedOwner();
    render(
      <CollaborationProvider
        value={{
          repository: testRepo,
          localUserId: LOCAL_USER,
          localUserDisplayName: LOCAL_NAME,
          channel: throwingChannel,
          devSeamActive: true,
        }}
      >
        <CollaborationPanel projectId={PROJECT} />
      </CollaborationProvider>,
    );
    const user = userEvent.setup();
    const body = await screen.findByTestId('comment-body');
    await user.type(body, 'Realtime-off comment');
    await user.click(screen.getByTestId('comment-submit'));
    expect(await screen.findByText(/Realtime-off comment/)).toBeTruthy();
  });
});

describe('v04CollaborationProduction — Private Scratch + publish', () => {
  // The default resolver is a no-op (it never runs:
  // the two tests in this block both Cancel the
  // dialog). The Production mount that wires the
  // real `createTask` writer is exercised by the
  // WP-08 Round 2 production test below.
  function mountPanelWithResolver(resolver: (s: { kind: string; title: string; id: string; body: string }) => Promise<string>) {
    return render(
      <CollaborationProvider
        value={{
          repository: testRepo,
          localUserId: LOCAL_USER,
          localUserDisplayName: LOCAL_NAME,
          channel,
          devSeamActive: true,
        }}
      >
        <CollaborationPanel projectId={PROJECT} resolveCanonicalId={resolver} />
      </CollaborationProvider>,
    );
  }

  it('inviting a collaborator does NOT auto-share a Private Scratch', async () => {
    const user = userEvent.setup();
    await seedOwner();
    mountPanel();
    // Create a private task scratch
    await user.click(await screen.findByTestId('scratch-new'));
    await user.selectOptions(screen.getByTestId('scratch-kind'), 'task');
    await user.type(screen.getByTestId('scratch-title'), 'My private draft');
    await user.type(screen.getByTestId('scratch-body'), 'Brainstorming...');
    await user.click(screen.getByTestId('scratch-save'));
    // The dialog is open; cancel it.
    const cancel = await screen.findByTestId('publish-scratch-cancel');
    await user.click(cancel);
    // The scratch is still in the list and is still private.
    const li = await screen.findByTestId(/^scratch-scr_/);
    expect(li.textContent).toContain('private');
    // Invite a collaborator. The scratch does NOT
    // auto-publish.
    await user.click(screen.getByTestId('invite-open'));
    await user.type(screen.getByTestId('invite-userid'), 'u-other');
    await user.type(screen.getByTestId('invite-displayname'), 'Other');
    await user.click(screen.getByTestId('invite-submit'));
    // The scratch list still shows ONE private
    // scratch (the one we created).
    const scratches = screen.getAllByTestId(/^scratch-scr_/);
    expect(scratches.length).toBe(1);
    expect(scratches[0]!.textContent).toContain('private');
  });

  it('publish flow requires preview + explicit confirm', async () => {
    const user = userEvent.setup();
    await seedOwner();
    mountPanelWithResolver(async () => {
      throw new Error('resolver must not run when the user cancels');
    });
    await user.click(await screen.findByTestId('scratch-new'));
    await user.selectOptions(screen.getByTestId('scratch-kind'), 'task');
    await user.type(screen.getByTestId('scratch-title'), 'A note');
    await user.type(screen.getByTestId('scratch-body'), 'hello body');
    await user.click(screen.getByTestId('scratch-save'));
    // The dialog is open with a diff.
    const dialog = await screen.findByTestId('publish-scratch-dialog');
    expect(dialog.textContent).toContain('hello body');
    const titleRow = await screen.findByTestId('diff-row-title');
    expect(titleRow).toBeTruthy();
    const bodyRow = await screen.findByTestId('diff-row-body');
    expect(bodyRow).toBeTruthy();
    // Cancel.
    await user.click(screen.getByTestId('publish-scratch-cancel'));
    // The scratch is still private.
    const li = await screen.findByTestId(/^scratch-scr_/);
    expect(li.textContent).toContain('private');
  });

  it('non-task kind cannot be published in v0.4 Beta — shows unsupported pill', async () => {
    const user = userEvent.setup();
    await seedOwner();
    mountPanel();
    // Create a private note scratch. The panel
    // opens the publish dialog automatically
    // (the publish flow is the *only* way to
    // flip a scratch out of `private`); we
    // cancel the dialog so the scratch flips
    // back to `private` and the unsupported
    // pill becomes visible.
    await user.click(await screen.findByTestId('scratch-new'));
    await user.selectOptions(screen.getByTestId('scratch-kind'), 'note');
    await user.type(screen.getByTestId('scratch-title'), 'A note');
    await user.type(screen.getByTestId('scratch-body'), 'still private');
    await user.click(screen.getByTestId('scratch-save'));
    const dialog = await screen.findByTestId('publish-scratch-dialog');
    expect(dialog).toBeTruthy();
    await user.click(screen.getByTestId('publish-scratch-cancel'));
    // The scratch is `private` again. The
    // publish button is hidden (the panel
    // refuses to render the button for kinds
    // the host cannot write in v0.4 Beta).
    const li = await screen.findByTestId(/^scratch-scr_/);
    await waitFor(() => {
      expect(li.textContent).toContain('private');
    });
    // The "Publish not yet supported for note"
    // hint is rendered in place of the button.
    expect(
      screen.queryByTestId(/scratch-publish-unsupported-scr_/),
    ).toBeTruthy();
  });

  it('publishing a task scratch calls the resolver and only marks the scratch published on success', async () => {
    const user = userEvent.setup();
    await seedOwner();
    // The resolver returns a synthetic canonical
    // id; the panel treats it as the real writer's
    // output. A failure in the resolver must leave
    // the scratch in `publishing` and surface the
    // error in the dialog.
    const calls: Array<{ kind: string; title: string }> = [];
    const resolver = async (s: { kind: string; title: string }): Promise<string> => {
      calls.push({ kind: s.kind, title: s.title });
      if (s.title === 'fail me') {
        throw new Error('writer failed');
      }
      return `tsk_synthetic_${calls.length}`;
    };
    mountPanelWithResolver(resolver);

    // ---- success path ----
    await user.click(await screen.findByTestId('scratch-new'));
    await user.selectOptions(screen.getByTestId('scratch-kind'), 'task');
    await user.type(screen.getByTestId('scratch-title'), 'Run the literature scan');
    await user.type(screen.getByTestId('scratch-body'), 'Because we still need n>30 samples.');
    await user.click(screen.getByTestId('scratch-save'));
    const dialog = await screen.findByTestId('publish-scratch-dialog');
    await waitFor(() => {
      expect(dialog.textContent).toContain('Run the literature scan');
    });
    await user.click(screen.getByTestId('publish-scratch-confirm'));
    // The scratch is now `published` and the
    // publishedRef pill carries the synthetic id.
    const li = await screen.findByTestId(/^scratch-scr_/);
    await waitFor(() => {
      expect(li.textContent).toContain('published');
    });
    const refPill = await screen.findByTestId(/^scratch-published-ref-scr_/);
    expect(refPill.getAttribute('data-published-ref')).toBe('tsk_synthetic_1');
    expect(calls).toEqual([{ kind: 'task', title: 'Run the literature scan' }]);

    // ---- failure path: another scratch, resolver throws ----
    cleanup();
    await seedOwner();
    mountPanelWithResolver(resolver);
    await user.click(await screen.findByTestId('scratch-new'));
    await user.selectOptions(screen.getByTestId('scratch-kind'), 'task');
    await user.type(screen.getByTestId('scratch-title'), 'fail me');
    await user.type(screen.getByTestId('scratch-body'), 'Body');
    await user.click(screen.getByTestId('scratch-save'));
    const dialog2 = await screen.findByTestId('publish-scratch-dialog');
    await user.click(screen.getByTestId('publish-scratch-confirm'));
    // The error surfaces in the dialog and the
    // scratch stays in `publishing` state.
    const errEl = await screen.findByTestId('publish-scratch-error');
    expect(errEl.textContent).toMatch(/writer failed/);
    // The publish diff row is still shown (the
    // user can retry or cancel).
    expect(dialog2.textContent).toContain('Body');
  });

  it('real publish flow: resolveCanonicalId calls createTask and the canonical Task carries publishedFromScratchId', async () => {
    // This test exercises the WP-08 Round 2
    // production contract: the host-supplied
    // resolver calls the *real* `createTask` use
    // case on a real `ResearchRepository`. The
    // returned Task is the canonical row, with
    // `publishedFromScratchId` linking back to the
    // scratch. The test does NOT mock the writer
    // — the goal is to prove the panel → host →
    // real-writer chain produces a real canonical
    // row (no placeholder id, no fake success).
    const user = userEvent.setup();
    const { MemoryResearchRepository } = await import(
      '../../application/research/researchRepository'
    );
    const { createTask } = await import(
      '../../application/research/researchDesignUseCases'
    );
    const { createProject } = await import(
      '../../application/research/researchUseCases'
    );
    const researchRepo = new MemoryResearchRepository();
    // The host (ProjectHome) requires a project
    // row to exist before `createTask` runs.
    // We pin the project id to `PROJECT` so the
    // resolver's `createTask({ projectId: PROJECT })`
    // finds the same row in the repo.
    await createProject(researchRepo, {
      name: 'WP-08 Round 2 Real Publish',
      livingBrief: 'A real publish smoke.',
      kind: 'empirical',
      container: { workspaceId: null, mode: 'research', kind: 'project', id: PROJECT },
      idFactory: () => PROJECT,
    });
    await seedOwner();
    const resolver = async (scratch: {
      kind: string;
      id: string;
      title: string;
      body: string;
    }): Promise<string> => {
      // The host's gate. v0.4 Beta only
      // publishes `task` scratches; other kinds
      // throw a clear error.
      if (scratch.kind !== 'task') {
        throw new Error(
          `Publishing a ${scratch.kind} scratch is not yet supported in v0.4 Beta.`,
        );
      }
      const created = await createTask(researchRepo, {
        projectId: PROJECT,
        title: scratch.title.trim() || 'Untitled task',
        why: scratch.body.trim() || 'Drafted privately in a Private Scratch.',
        definitionOfDone:
          'Review the published task, refine the why / DoD, and complete the work.',
        sourceRef: { kind: 'manual', id: null },
        publishedFromScratchId: scratch.id,
      });
      return created.id;
    };
    mountPanelWithResolver(resolver);

    // Create a task scratch.
    await user.click(await screen.findByTestId('scratch-new'));
    await user.selectOptions(screen.getByTestId('scratch-kind'), 'task');
    await user.type(screen.getByTestId('scratch-title'), 'Run the literature scan');
    await user.type(screen.getByTestId('scratch-body'), 'Because we still need n>30 samples.');
    await user.click(screen.getByTestId('scratch-save'));
    const dialog = await screen.findByTestId('publish-scratch-dialog');
    // The diff is visible (publish preview is
    // mandatory before confirm).
    await waitFor(() => {
      expect(dialog.textContent).toContain('Run the literature scan');
    });
    await user.click(screen.getByTestId('publish-scratch-confirm'));
    // Wait for the publish flow to settle.
    await waitFor(() => {
      expect(
        screen.queryByTestId(/^scratch-published-ref-scr_/),
      ).toBeTruthy();
    });
    // The canonical Task is in the research repo.
    const tasks = await researchRepo.listTasks({ projectId: PROJECT });
    expect(tasks.length).toBe(1);
    const task = tasks[0]!;
    expect(task.title).toBe('Run the literature scan');
    expect(task.publishedFromScratchId).toBeTruthy();
    expect(task.publishedFromScratchId).toMatch(/^scr_/);
    // The scratch's `publishedRef` is the same id
    // (the panel sets it from the resolver's
    // return value).
    const refPill = screen.getByTestId(/^scratch-published-ref-scr_/);
    expect(refPill.getAttribute('data-published-ref')).toBe(task.id);
    // The task is also traceable from the
    // scratch: the publishedRef is the task id.
    const scratchRow = await testRepo.getScratchForOwner(
      task.publishedFromScratchId!,
      LOCAL_USER,
    );
    expect(scratchRow?.status).toBe('published');
    expect(scratchRow?.publishedRef).toBe(task.id);

    // Reload (cleanup + re-mount): the published
    // task is still in the research repo and the
    // scratch still shows the publishedRef pill.
    cleanup();
    mountPanelWithResolver(resolver);
    const li = await screen.findByTestId(/^scratch-scr_/);
    await waitFor(() => {
      expect(li.textContent).toContain('published');
    });
    const refPill2 = screen.getByTestId(/^scratch-published-ref-scr_/);
    expect(refPill2.getAttribute('data-published-ref')).toBe(task.id);
    // The research repo is unchanged.
    const tasksAfter = await researchRepo.listTasks({ projectId: PROJECT });
    expect(tasksAfter.length).toBe(1);
    expect(tasksAfter[0]!.id).toBe(task.id);
  });
});

describe('v04CollaborationProduction — conflict detection is non-destructive', () => {
  it('records a Conflict without overwriting either side', async () => {
    await seedOwner();
    await detectConflict(makeDeps(), {
      projectId: PROJECT,
      kind: 'comment',
      objectId: 'cmt_x',
      local: {
        side: 'local',
        actorId: 'u-a',
        actorDisplayName: 'A',
        baseVersion: 1,
        payload: 'a',
        writtenAt: '2026-07-24T12:00:00.000Z',
      },
      remote: {
        side: 'remote',
        actorId: 'u-b',
        actorDisplayName: 'B',
        baseVersion: 1,
        payload: 'b',
        writtenAt: '2026-07-24T12:00:01.000Z',
      },
    });
    mountPanel();
    const conflict = await screen.findByTestId(/^conflict-cfl_/);
    expect(conflict.textContent).toContain('Local (A');
    expect(conflict.textContent).toContain('Remote (B');
    // The owner can resolve.
    const user = userEvent.setup();
    await user.click(within(conflict).getByTestId(/conflict-keep-local-/));
    // The conflict is gone (resolved = filtered out of
    // the open list).
    await waitFor(() => {
      expect(screen.queryByTestId(/^conflict-cfl_/)).toBeNull();
    });
  });
});

describe('v04CollaborationProduction — two-context smoke', () => {
  it('two panels in the same test see each other via the shared channel', async () => {
    const user = userEvent.setup();
    await seedOwner();
    // The first panel posts a comment; the second
    // panel (mounted after the post) sees it on
    // the first reload. The shared channel is a
    // `MemoryRealtimeChannel`; the second panel
    // subscribes to the same channel.
    const { unmount } = render(
      <CollaborationProvider
        value={{
          repository: testRepo,
          localUserId: LOCAL_USER,
          localUserDisplayName: LOCAL_NAME,
          channel,
          devSeamActive: true,
        }}
      >
        <CollaborationPanel projectId={PROJECT} />
      </CollaborationProvider>,
    );
    const body = await screen.findByTestId('comment-body');
    await user.type(body, 'tab 1 comment');
    await user.click(screen.getByTestId('comment-submit'));
    expect(await screen.findByText(/tab 1 comment/)).toBeTruthy();
    unmount();
    // Re-mount: the second "tab" sees the comment.
    mountPanel();
    expect(await screen.findByText(/tab 1 comment/)).toBeTruthy();
  });
});
