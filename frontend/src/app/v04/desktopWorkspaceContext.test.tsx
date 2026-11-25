import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceFlavour } from '../../application/workspaceFlavour';
import type {
  KnowledgeObjectRow,
  OpenWorkspaceSummary,
  TransactPayload,
  WorkspaceClient,
  WorkspaceHealth,
} from '../../platforms/desktop/workspaceClient';
import { WorkspaceIpcError } from '../../platforms/desktop/workspaceClient';
import {
  DesktopWorkspaceProvider,
  useDesktopWorkspace,
} from './desktopWorkspaceContext';

const summary: OpenWorkspaceSummary = {
  root: '/tmp/StudyKit',
  manifest: {
    schema: 'studykit.workspace/1',
    id: 'ws-1',
    formatVersion: 1,
    displayName: 'Thesis',
    createdAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-07-30T00:00:00Z',
  },
};

const health: WorkspaceHealth = {
  root: summary.root,
  manifest_id: summary.manifest.id,
  display_name: summary.manifest.displayName,
  format_version: 1,
  schema_version: 1,
  integrity: 'ok',
  has_knowledge_objects: false,
};

class StubClient implements WorkspaceClient {
  readonly hasTauriRuntime = true;
  readonly chooseAndCreateWorkspace = vi.fn(async () => summary);
  readonly chooseAndOpenWorkspace = vi.fn(async () => summary);
  readonly reopenLastWorkspace = vi.fn(async () => summary);
  readonly closeWorkspace = vi.fn(async () => {});
  readonly getWorkspaceHealth = vi.fn(async () => health);
  readonly readObject = vi.fn(async (_id: string): Promise<KnowledgeObjectRow | null> => null);
  readonly readAllObjects = vi.fn(async (): Promise<ReadonlyArray<KnowledgeObjectRow>> => []);
  readonly transact = vi.fn(async (_payload: TransactPayload) => {});
  readonly readDomainRecords = vi.fn(async (): Promise<readonly never[]> => []);
  readonly transactDomainRecords = vi.fn(async () => {});
}

function Harness(): React.ReactElement {
  const workspace = useDesktopWorkspace();
  return (
    <div>
      <output data-testid="state">{workspace.state.kind}</output>
      {workspace.state.kind === 'ready' ? (
        <output data-testid="name">
          {workspace.state.summary.manifest.displayName}
        </output>
      ) : null}
      {workspace.state.kind === 'error' ? (
        <output data-testid="error">{workspace.state.message}</output>
      ) : null}
      {workspace.state.kind === 'ready' && workspace.state.actionError ? (
        <output data-testid="action-error">{workspace.state.actionError}</output>
      ) : null}
      {workspace.state.kind === 'ready' ? (
        <button
          onClick={() => {
            if (workspace.state.kind !== 'ready') return;
            void workspace.state.repositories.study.transact((tx) =>
              tx.putQuestion({
                id: 'native-q',
                body: 'Stored natively',
                locator: null,
                status: 'open',
                review: 'unreviewed',
                authorType: 'user',
                createdAt: '2026-07-30T00:00:00.000Z',
                updatedAt: '2026-07-30T00:00:00.000Z',
              }),
            );
          }}
        >
          native-write
        </button>
      ) : null}
      <button onClick={() => void workspace.createWorkspace(' Thesis ')}>
        create
      </button>
      <button onClick={() => void workspace.openWorkspace()}>open</button>
      <button onClick={() => void workspace.switchWorkspace()}>switch</button>
    </div>
  );
}

function renderWorkspace(
  client: WorkspaceClient,
  runtime: 'web' | 'desktop' = 'desktop',
  strict = false,
): void {
  const tree = (
    <DesktopWorkspaceProvider runtime={runtime} client={client}>
      <Harness />
    </DesktopWorkspaceProvider>
  );
  render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

afterEach(() => {
  workspaceFlavour.signOut();
});

describe('DesktopWorkspaceProvider', () => {
  it('does not touch the native client on web', async () => {
    const client = new StubClient();
    renderWorkspace(client, 'web');
    expect(screen.getByTestId('state')).toHaveTextContent('web');
    expect(client.reopenLastWorkspace).not.toHaveBeenCalled();
  });

  it('restores once and enters the local ready state', async () => {
    const client = new StubClient();
    renderWorkspace(client);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'));
    expect(screen.getByTestId('name')).toHaveTextContent('Thesis');
    expect(client.reopenLastWorkspace).toHaveBeenCalledTimes(1);
    expect(client.getWorkspaceHealth).toHaveBeenCalledTimes(1);
    expect(workspaceFlavour.getSnapshot()).toBe('local');
  });

  it('binds v0.4 domain repositories to the same native client', async () => {
    const client = new StubClient();
    renderWorkspace(client);
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('ready'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'native-write' }));
    await waitFor(() =>
      expect(client.transactDomainRecords).toHaveBeenCalledTimes(1),
    );
    expect(client.readDomainRecords).toHaveBeenCalledWith('study');
  });

  it('remains single-shot under React StrictMode', async () => {
    const client = new StubClient();
    renderWorkspace(client, 'desktop', true);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'));
    expect(client.reopenLastWorkspace).toHaveBeenCalledTimes(1);
  });

  it('shows the chooser when no last workspace exists', async () => {
    const client = new StubClient();
    client.reopenLastWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_NO_LAST_WORKSPACE',
        message: 'no last workspace recorded',
      }),
    );
    renderWorkspace(client);
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('needs_workspace'),
    );
  });

  it('creates a native workspace once and trims its name', async () => {
    const client = new StubClient();
    client.reopenLastWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_NO_LAST_WORKSPACE',
        message: 'no last workspace recorded',
      }),
    );
    renderWorkspace(client);
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('needs_workspace'),
    );
    fireEvent.click(screen.getByText('create'));
    fireEvent.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'));
    expect(client.chooseAndCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(client.chooseAndCreateWorkspace).toHaveBeenCalledWith('Thesis');
  });

  it('opens an existing workspace from the chooser', async () => {
    const client = new StubClient();
    client.reopenLastWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_NO_LAST_WORKSPACE',
        message: 'no last workspace recorded',
      }),
    );
    renderWorkspace(client);
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('needs_workspace'),
    );
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'));
    expect(client.chooseAndOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it('treats picker cancellation as a neutral chooser state', async () => {
    const client = new StubClient();
    client.reopenLastWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_NO_LAST_WORKSPACE',
        message: 'no last workspace recorded',
      }),
    );
    client.chooseAndOpenWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_PATH_REJECTED',
        message: 'user cancelled the folder picker',
      }),
    );
    renderWorkspace(client);
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('needs_workspace'),
    );
    fireEvent.click(screen.getByText('open'));
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('needs_workspace'),
    );
    expect(screen.queryByTestId('error')).not.toBeInTheDocument();
  });

  it('surfaces a corrupt manifest without entering the shell', async () => {
    const client = new StubClient();
    client.reopenLastWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_MANIFEST_CORRUPT',
        message: 'bad json',
      }),
    );
    renderWorkspace(client);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('damaged');
    expect(workspaceFlavour.getSnapshot()).not.toBe('local');
  });

  it('closes before returning to the chooser', async () => {
    const client = new StubClient();
    renderWorkspace(client);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'));
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('needs_workspace'),
    );
    expect(client.closeWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceFlavour.getSnapshot()).toBe('sync');
  });

  it('keeps the ready workspace visible when close fails', async () => {
    const client = new StubClient();
    client.closeWorkspace.mockRejectedValueOnce(
      new WorkspaceIpcError({
        kind: 'STUDYKIT_DB_UNUSABLE',
        message: 'locked',
      }),
    );
    renderWorkspace(client);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'));
    await act(async () => {
      fireEvent.click(screen.getByText('switch'));
    });
    await waitFor(() => expect(screen.getByTestId('action-error')).toBeInTheDocument());
    expect(screen.getByTestId('state')).toHaveTextContent('ready');
    expect(workspaceFlavour.getSnapshot()).toBe('local');
  });
});
