import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { AgentAccessView, type AgentAccessClient } from './AgentAccessView';
import { ResearchProvider } from './researchContext';
import { MemoryResearchRepository } from '../../application/research/researchRepository';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { __resetAgentAccessForTests, isProjectShared } from '../../application/research/mcp/agentAccess';
import { McpHost } from '../../application/research/mcp/mcpServer';
import { recordActivity, sharedProjectIds } from '../../application/research/mcp/agentAccess';
import type { McpStatus } from '../../platforms/desktop/mcpClient';
import { makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
afterEach(cleanup);
beforeEach(() => __resetAgentAccessForTests());

function fakeClient(): AgentAccessClient & { setEnabled: ReturnType<typeof vi.fn> } {
  let enabled = false;
  const status = (): McpStatus => ({
    enabled,
    running: enabled,
    port: enabled ? 47821 : null,
    error: null,
    command: '/Applications/StudyKit.app/Contents/MacOS/StudyKit',
    configFile: '/x/mcp.json',
  });
  return {
    status: async () => status(),
    setEnabled: vi.fn(async (on: boolean) => {
      enabled = on;
      return status();
    }),
  };
}

describe('AgentAccessView', () => {
  it('turns access on, shares the project, shows how to connect, and lists what agents asked and proposed', async () => {
    const repo = new MemoryResearchRepository();
    await repo.transact(async (tx) => {
      tx.putProject(makeResearchProject({ id: P }));
      tx.putWork(makeWork({ id: 'w-1', projectIds: [P] }));
    });
    const client = fakeClient();
    const onOpenAi = vi.fn();
    render(
      <ResearchProvider value={{ repository: repo, openAlex: new OpenAlexSearchProvider({ fetchImpl: async () => new Response('{}') }) }}>
        <AgentAccessView projectId={P} client={client} onOpenAi={onOpenAi} onOpenExcerpts={() => undefined} />
      </ResearchProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('agents-status')).toHaveTextContent('Off. Nothing is listening.'));
    expect(screen.queryByTestId('agents-desktop-config')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agents-enabled'));
    await waitFor(() => expect(screen.getByTestId('agents-status')).toHaveTextContent('On.'));
    expect(client.setEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('agents-desktop-config')).toHaveTextContent('"args": [ "--mcp-stdio" ]');
    expect(screen.getByTestId('agents-code-command')).toHaveTextContent('claude mcp add studykit -- /Applications/StudyKit.app/Contents/MacOS/StudyKit --mcp-stdio');

    fireEvent.click(screen.getByTestId('agents-project-shared'));
    expect(isProjectShared(P)).toBe(true);

    // An agent proposes a point: it shows up as waiting, with the request logged.
    const host = new McpHost({ repository: repo, sharedProjectIds, userId: () => 'u-1', onActivity: recordActivity });
    const init = await host.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'Claude Desktop' } } }), null);
    await host.handle(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'propose_point', arguments: { projectId: P, title: 'T', why: 'W' } } }),
      init.sessionId!,
    );
    fireEvent.click(await screen.findByText('Review 1 point in the AI panel'));
    expect(onOpenAi).toHaveBeenCalled();
    expect(screen.getByTestId('agents-activity')).toHaveTextContent('Claude Desktop: propose point');
  });
});
