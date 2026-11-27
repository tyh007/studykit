/**
 * StudyKit v0.5 P5b — keeps brainstorms and disagreements in step with
 * project members. After local changes (debounced), sends whatever
 * changed; see `application/research/thinkingSync.ts` for the rules.
 * Without other members there is no port and nothing leaves the device.
 */

import React from 'react';
import { useResearchDeps } from '../../features/research/researchContext';
import { pushThinking, storedMarks, type ThinkingAccess, type ThinkingSyncPort } from '../../application/research/thinkingSync';

const DEBOUNCE_MS = 400;

export function useThinkingSync(input: {
  readonly projectId: string;
  readonly userId: string;
  readonly access: ThinkingAccess;
  readonly port?: ThinkingSyncPort;
}): void {
  const { repository } = useResearchDeps();
  const { projectId, userId, access, port } = input;
  React.useEffect(() => {
    if (!port || access === 'read') return;
    const marks = storedMarks(projectId);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let again = false;
    const run = async (): Promise<void> => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await pushThinking(repository, port, marks, { projectId, userId, access });
        } while (again);
      } catch {
        // Retried on the next change; the outbox handles delivery.
      } finally {
        running = false;
      }
    };
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), DEBOUNCE_MS);
    };
    void run();
    const off = repository.subscribe(schedule);
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [repository, projectId, userId, access, port]);
}
