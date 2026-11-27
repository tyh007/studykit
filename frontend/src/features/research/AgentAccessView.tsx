/**
 * StudyKit v0.5 P6b — let AI agents on this computer (Claude Desktop,
 * Claude Code, …) use a project, under StudyKit's rules.
 *
 * Two switches: agent access for this computer (starts the local
 * endpoint), and sharing this project. Then how to connect, what agents
 * can and can't do, proposals waiting for review, and recent requests.
 */

import React from 'react';
import './provenance.css';
import { useResearchDeps } from './researchContext';
import { isProjectShared, recentActivity, setProjectShared, subscribeAgentAccess } from '../../application/research/mcp/agentAccess';
import { pendingProposals } from '../../application/research/mcp/agentTools';
import type { McpStatus } from '../../platforms/desktop/mcpClient';
import { Button } from '../../shared/ui/Button';

export interface AgentAccessClient {
  status(): Promise<McpStatus>;
  setEnabled(enabled: boolean): Promise<McpStatus>;
}

export interface AgentAccessViewProps {
  readonly projectId: string;
  readonly onOpenAi: () => void;
  readonly onOpenExcerpts: () => void;
  /** Injected in tests; the desktop client otherwise. */
  readonly client?: AgentAccessClient;
}

const desktopClient: AgentAccessClient = {
  status: () => import('../../platforms/desktop/mcpClient').then((m) => m.mcpClient.status()),
  setEnabled: (enabled) => import('../../platforms/desktop/mcpClient').then((m) => m.mcpClient.setEnabled(enabled)),
};

function quoteArg(path: string): string {
  return /[\s"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function useAccessVersion(): number {
  const [v, setV] = React.useState(0);
  React.useEffect(() => subscribeAgentAccess(() => setV((x) => x + 1)), []);
  return v;
}

export function AgentAccessView(props: AgentAccessViewProps): React.ReactElement {
  const client = props.client ?? desktopClient;
  const { repository } = useResearchDeps();
  const [status, setStatus] = React.useState<McpStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState({ excerpts: 0, points: 0 });
  const [copied, setCopied] = React.useState<string | null>(null);
  useAccessVersion();
  const shared = isProjectShared(props.projectId);
  const activity = recentActivity(props.projectId).slice(0, 10);

  React.useEffect(() => {
    void client.status().then(setStatus).catch(() => setStatus(null));
  }, [client]);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void pendingProposals(repository, props.projectId).then((p) => !cancelled && setPending(p));
    };
    refresh();
    const off = repository.subscribe(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [repository, props.projectId]);

  const toggle = (enabled: boolean): void => {
    setBusy(true);
    void client
      .setEnabled(enabled)
      .then(setStatus)
      .finally(() => setBusy(false));
  };

  const copy = (label: string, text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(label))
      .catch(() => setCopied(null));
  };

  const command = status?.command ?? null;
  const desktopConfig = command
    ? JSON.stringify({ mcpServers: { studykit: { command, args: ['--mcp-stdio'] } } }, null, 2)
    : '';
  const codeCommand = command ? `claude mcp add studykit -- ${quoteArg(command)} --mcp-stdio` : '';
  const on = Boolean(status?.enabled);

  return (
    <div className="provenance agents" data-testid="agent-access">
      <header className="provenance-header">
        <p className="provenance-kicker">AI agents</p>
        <h1>Let AI agents on this computer use this project</h1>
        <p className="provenance-muted">
          Agents such as Claude Desktop or Claude Code can read your argument and checked excerpts, and propose excerpts or points. They can’t
          change anything: you check every proposal, and the provenance report records it.
        </p>
      </header>

      <section className="provenance-section" aria-label="Access">
        <label className="agents-switch">
          <input type="checkbox" checked={on} disabled={busy || status === null} onChange={(e) => toggle(e.target.checked)} data-testid="agents-enabled" />
          Allow AI agents on this computer to connect to StudyKit
        </label>
        <p className="provenance-muted" data-testid="agents-status">
          {status === null
            ? 'Available in the StudyKit desktop app.'
            : status.error
              ? `Not running: ${status.error}`
              : status.running
                ? 'On. Agents connect only from this computer, with a key only your user account can read.'
                : 'Off. Nothing is listening.'}
        </p>
        <label className="agents-switch">
          <input type="checkbox" checked={shared} onChange={(e) => setProjectShared(props.projectId, e.target.checked)} data-testid="agents-project-shared" />
          Share this project with them
        </label>
        <p className="provenance-muted">Projects you don’t share stay invisible to agents.</p>
      </section>

      {on && command ? (
        <section className="provenance-section" aria-label="Connect">
          <h2>Connect an agent</h2>
          <p>Claude Desktop: add this to its MCP settings (claude_desktop_config.json), then restart it.</p>
          <pre className="agents-code" data-testid="agents-desktop-config">{desktopConfig}</pre>
          <button type="button" className="provenance-link" onClick={() => copy('desktop', desktopConfig)}>
            {copied === 'desktop' ? 'Copied' : 'Copy'}
          </button>
          <p>Claude Code: run this once in a terminal.</p>
          <pre className="agents-code" data-testid="agents-code-command">{codeCommand}</pre>
          <button type="button" className="provenance-link" onClick={() => copy('code', codeCommand)}>
            {copied === 'code' ? 'Copied' : 'Copy'}
          </button>
          <p className="provenance-muted">StudyKit has to be open for agents to reach it.</p>
        </section>
      ) : null}

      <section className="provenance-section" aria-label="Rules">
        <h2>What agents can do</h2>
        <ul className="agents-rules">
          <li>Read the question, your points and their status, sources, and excerpts — each marked whether you checked it.</li>
          <li>Propose an excerpt: it arrives unchecked, and backs nothing until you verify it at the page.</li>
          <li>Propose a point: it waits in the AI panel under “From …” until you add or reject it.</li>
          <li>Nothing else: no edits, no deletions, no writing in your text. At most 20 proposals wait at once.</li>
        </ul>
      </section>

      <section className="provenance-section" aria-label="Waiting for you">
        <h2>Waiting for you</h2>
        {pending.excerpts + pending.points === 0 ? (
          <p className="provenance-muted" data-testid="agents-pending">Nothing proposed yet.</p>
        ) : (
          <div className="agents-pending" data-testid="agents-pending">
            {pending.points > 0 ? (
              <Button variant="secondary" size="sm" onClick={props.onOpenAi}>
                Review {pending.points} {pending.points === 1 ? 'point' : 'points'} in the AI panel
              </Button>
            ) : null}
            {pending.excerpts > 0 ? (
              <Button variant="secondary" size="sm" onClick={props.onOpenExcerpts}>
                Check {pending.excerpts} {pending.excerpts === 1 ? 'excerpt' : 'excerpts'}
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {activity.length > 0 ? (
        <section className="provenance-section" aria-label="Recent requests">
          <h2>Recent requests</h2>
          <ul className="agents-activity" data-testid="agents-activity">
            {activity.map((a, i) => (
              <li key={`${a.at}-${i}`}>
                <span>{new Date(a.at).toLocaleTimeString()}</span> {a.agent}: {a.tool.replace(/_/g, ' ')}
                {a.ok ? '' : ` — refused${a.detail ? `: ${a.detail}` : ''}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
