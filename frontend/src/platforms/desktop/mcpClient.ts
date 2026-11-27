/**
 * StudyKit v0.5 P6b — the WebView side of local MCP access (desktop).
 *
 * Rust owns the localhost endpoint and the stdio bridge; it forwards
 * each JSON-RPC message here as an event and waits for the answer.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface McpStatus {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly port: number | null;
  readonly error: string | null;
  /** The program agents launch, with `--mcp-stdio`. */
  readonly command: string | null;
  readonly configFile: string | null;
}

export interface McpRequestEvent {
  readonly id: string;
  readonly body: string;
  readonly sessionId: string | null;
}

export interface McpReplyOut {
  readonly body: string | null;
  readonly sessionId?: string;
  readonly status?: number;
}

export const mcpClient = {
  status: (): Promise<McpStatus> => invoke<McpStatus>('mcp_status_v1'),
  setEnabled: (enabled: boolean): Promise<McpStatus> => invoke<McpStatus>('mcp_set_enabled_v1', { enabled }),
  respond: (id: string, reply: McpReplyOut): Promise<void> => invoke('mcp_respond_v1', { id, reply }),
  onRequest: (handler: (event: McpRequestEvent) => void): Promise<() => void> =>
    listen<McpRequestEvent>('studykit://mcp-request', (e) => handler(e.payload)),
};
