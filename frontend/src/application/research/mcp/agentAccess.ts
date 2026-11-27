/**
 * StudyKit v0.5 P6b — which projects AI agents may use, and what they
 * did recently. Kept on this device: sharing a project with agents on
 * this computer is a local choice, not a project setting members see.
 */

import type { McpActivity } from './mcpServer';

const KEY = 'studykit.agents.projects.v1';
const MAX_ACTIVITY = 50;

type Listener = () => void;
const listeners = new Set<Listener>();
let activity: McpActivity[] = [];

function read(): Set<string> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function sharedProjectIds(): ReadonlySet<string> {
  return read();
}

export function isProjectShared(projectId: string): boolean {
  return read().has(projectId);
}

export function setProjectShared(projectId: string, shared: boolean): void {
  const ids = read();
  if (shared) ids.add(projectId);
  else ids.delete(projectId);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  for (const l of listeners) l();
}

export function recordActivity(entry: McpActivity): void {
  activity = [entry, ...activity].slice(0, MAX_ACTIVITY);
  for (const l of listeners) l();
}

/** Most recent first. */
export function recentActivity(projectId?: string): readonly McpActivity[] {
  return projectId ? activity.filter((a) => !a.projectId || a.projectId === projectId) : activity;
}

export function subscribeAgentAccess(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function __resetAgentAccessForTests(): void {
  activity = [];
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
