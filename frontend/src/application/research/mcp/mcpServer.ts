/**
 * StudyKit v0.5 P6b — the Model Context Protocol endpoint, transport-free.
 *
 * The desktop app receives MCP JSON-RPC messages from local agents (over
 * a localhost connection the Rust side owns) and hands each one here.
 * This module answers `initialize`, `ping`, `tools/list` and
 * `tools/call`, and keeps one session per agent so proposals carry the
 * agent's own name. It never throws: every failure is a JSON-RPC error
 * or a tool result with `isError`.
 */

import { AGENT_TOOLS, AgentToolError, type AgentContext } from './agentTools';
import type { ResearchRepository } from '../researchRepository';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export const SERVER_INSTRUCTIONS = [
  'StudyKit is the researcher’s record of what they read, what they checked, and what they argue.',
  'Excerpts marked checked were verified by the researcher at the source page; treat anything else as unconfirmed.',
  'You cannot change the project directly. propose_excerpt and propose_point create proposals the researcher reviews; nothing counts until they accept it.',
  'Quote sources word for word and give page numbers. Do not invent sources.',
].join(' ');

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface McpHostDeps {
  readonly repository: ResearchRepository;
  readonly sharedProjectIds: () => ReadonlySet<string>;
  readonly userId: () => string;
  readonly now?: () => string;
  readonly newSessionId?: () => string;
  /** Called after each tool call, for the user's activity list. */
  readonly onActivity?: (entry: McpActivity) => void;
}

export interface McpActivity {
  readonly at: string;
  readonly agent: string;
  readonly tool: string;
  readonly projectId?: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface McpReply {
  /** JSON to return, or null for notifications (HTTP 202). */
  readonly body: string | null;
  /** Set on `initialize`: the session id the agent sends from then on. */
  readonly sessionId?: string;
  /** HTTP status when not 200 (404: unknown session, initialize again). */
  readonly status?: number;
}

const MAX_SESSIONS = 32;

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim() : '';
  return (s || 'An AI agent').slice(0, 60);
}

export class McpHost {
  private readonly sessions = new Map<string, { agent: string; createdAt: string }>();

  constructor(private readonly deps: McpHostDeps) {}

  /** Handle one raw message. `sessionId` is the Mcp-Session-Id header, if any. */
  async handle(raw: string, sessionId: string | null): Promise<McpReply> {
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(raw) as JsonRpcRequest;
    } catch {
      return { body: error(null, -32700, 'Parse error') };
    }
    if (Array.isArray(msg)) return { body: error(null, -32600, 'Batches are not supported.') };
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return { body: error(null, -32600, 'Invalid request') };
    }
    const isNotification = msg.id === undefined;
    if (isNotification) return { body: null };
    const id = msg.id ?? null;

    if (msg.method === 'initialize') return this.initialize(id, msg.params ?? {});
    if (msg.method === 'ping') return { body: result(id, {}) };

    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) return { status: 404, body: error(id, -32001, 'Unknown or expired session. Initialize again.') };

    switch (msg.method) {
      case 'tools/list':
        return {
          body: result(id, {
            tools: AGENT_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
            })),
          }),
        };
      case 'tools/call':
        return { body: result(id, await this.callTool(session.agent, msg.params ?? {})) };
      case 'resources/list':
        return { body: result(id, { resources: [] }) };
      case 'prompts/list':
        return { body: result(id, { prompts: [] }) };
      default:
        return { body: error(id, -32601, `Method not found: ${msg.method}`) };
    }
  }

  private initialize(id: JsonRpcRequest['id'], params: Record<string, unknown>): McpReply {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
    const agent = cleanName((params.clientInfo as { name?: unknown } | undefined)?.name);
    const sessionId = this.deps.newSessionId?.() ?? crypto.randomUUID();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    this.sessions.set(sessionId, { agent, createdAt: this.now() });
    return {
      sessionId,
      body: result(id ?? null, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'StudyKit', version: '0.5' },
        instructions: SERVER_INSTRUCTIONS,
      }),
    };
  }

  private async callTool(agent: string, params: Record<string, unknown>): Promise<unknown> {
    const name = typeof params.name === 'string' ? params.name : '';
    const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
    const tool = AGENT_TOOLS.find((t) => t.name === name);
    const projectId = typeof args.projectId === 'string' ? args.projectId : undefined;
    const log = (ok: boolean, detail?: string): void =>
      this.deps.onActivity?.({ at: this.now(), agent, tool: name || '(none)', ...(projectId ? { projectId } : {}), ok, ...(detail ? { detail } : {}) });
    if (!tool) {
      log(false, 'unknown tool');
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    const ctx: AgentContext = {
      repository: this.deps.repository,
      sharedProjectIds: this.deps.sharedProjectIds(),
      agentName: agent,
      userId: this.deps.userId(),
    };
    try {
      const out = await tool.run(ctx, args);
      log(true);
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
    } catch (e) {
      const message = e instanceof AgentToolError ? e.message : 'StudyKit could not do that. Try again, or ask the researcher.';
      log(false, message);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}

function result(id: JsonRpcRequest['id'], value: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result: value });
}

function error(id: JsonRpcRequest['id'], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}
