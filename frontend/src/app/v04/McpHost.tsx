/**
 * StudyKit v0.5 P6b — answers local AI agents while the app is open
 * (desktop only). Mounted once inside the Research provider so agents
 * can reach shared projects whichever page is showing.
 */

import React from 'react';
import { useResearchDeps } from '../../features/research/researchContext';
import { isDesktopRuntime } from '../../platforms/runtime';
import { useCurrentUserId } from '../../lib/auth';

export function McpHostBridge(): null {
  const { repository } = useResearchDeps();
  const userId = useCurrentUserId();
  const userRef = React.useRef(userId);
  userRef.current = userId;

  React.useEffect(() => {
    if (!isDesktopRuntime()) return;
    let off: (() => void) | null = null;
    let cancelled = false;
    // Loaded only on desktop, so the web bundle doesn't carry it.
    void Promise.all([
      import('../../platforms/desktop/mcpClient'),
      import('../../application/research/mcp/mcpServer'),
      import('../../application/research/mcp/agentAccess'),
    ]).then(([{ mcpClient }, { McpHost }, { recordActivity, sharedProjectIds }]) => {
      const host = new McpHost({ repository, sharedProjectIds, userId: () => userRef.current, onActivity: recordActivity });
      return mcpClient
        .onRequest((event) => {
          void host
            .handle(event.body, event.sessionId)
            .then((reply) =>
              mcpClient.respond(event.id, {
                body: reply.body,
                ...(reply.sessionId ? { sessionId: reply.sessionId } : {}),
                ...(reply.status ? { status: reply.status } : {}),
              }),
            )
            .catch(() => undefined);
        })
        .then((unlisten) => {
          if (cancelled) unlisten();
          else off = unlisten;
        });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [repository]);
  return null;
}
