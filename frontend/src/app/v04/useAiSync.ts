/**
 * StudyKit v0.5 P4b — connects project AI threads to the collaboration
 * outbox (ADR-003 §5). Outside a collaborating project (no
 * collaboration wiring, or nobody else in the project) there is no
 * port, and shared threads stay on this device.
 */

import React from 'react';
import { useCollaborationDepsOptional } from '../../features/collaboration/collaborationContext';
import type { AiSyncPort } from '../../application/research/aiSync';
import type { ThinkingSyncPort } from '../../application/research/thinkingSync';
import type { Collaborator } from '../../domain/collaboration';

export interface AiSyncState {
  readonly sync?: AiSyncPort;
  /** The user's role in the project, or null when not collaborating. */
  readonly role: Collaborator['role'] | null;
  /** userId → display name, for messages written by other members. */
  readonly memberNames: Readonly<Record<string, string>>;
  /** v0.5 P5b: the outbox for brainstorms and disagreements, while the
   *  project has other members. */
  readonly thinking?: ThinkingSyncPort;
  /** True while the project has members other than this user. */
  readonly hasMembers: boolean;
}

const NONE: AiSyncState = { role: null, memberNames: {}, hasMembers: false };

export function useAiSync(projectId: string, userId: string): AiSyncState {
  const collab = useCollaborationDepsOptional();
  const [members, setMembers] = React.useState<readonly Collaborator[]>([]);

  React.useEffect(() => {
    if (!collab) return;
    let cancelled = false;
    const refresh = (): void => {
      void collab.repository
        .listCollaborators({ projectId })
        .then((rows) => !cancelled && setMembers(rows))
        .catch(() => undefined);
    };
    refresh();
    const off = collab.repository.subscribe(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [collab, projectId]);

  return React.useMemo(() => {
    if (!collab) return NONE;
    const me = collab.localUserId || userId;
    const others = members.filter((m) => m.userId !== me);
    const role = members.find((m) => m.userId === me)?.role ?? null;
    const memberNames = Object.fromEntries(members.map((m) => [m.userId, m.displayName]));
    const record = collab.recordCollabOp;
    const sync: AiSyncPort | undefined =
      record && others.length > 0
        ? {
            hasMembers: true,
            record: (op) => {
              try {
                record({ kind: op.kind, payload: op.payload });
              } catch {
                // Best effort: the local write is the durable record.
              }
            },
          }
        : undefined;
    const thinking: ThinkingSyncPort | undefined =
      record && others.length > 0
        ? {
            record: (op) => {
              try {
                record({ kind: op.kind, payload: op.payload });
              } catch {
                // Best effort: the local write is the durable record.
              }
            },
          }
        : undefined;
    return { ...(sync ? { sync } : {}), ...(thinking ? { thinking } : {}), role, memberNames, hasMembers: others.length > 0 };
  }, [collab, members, userId]);
}
