/**
 * StudyKit v0.5 P5b — who else is in the project, for the brainstorm and
 * disagreement editors. Outside a collaborating project: the user's own
 * project, full access, no members.
 */

import React from 'react';
import type { ThinkingAccess } from '../../application/research/thinkingSync';

export interface ThinkingCollab {
  readonly access: ThinkingAccess;
  /** True while the project has members other than this user. */
  readonly hasMembers: boolean;
  /** userId → display name. */
  readonly memberNames: Readonly<Record<string, string>>;
}

const SOLO: ThinkingCollab = { access: 'manage', hasMembers: false, memberNames: {} };

const Context = React.createContext<ThinkingCollab>(SOLO);

export const ThinkingCollabProvider = Context.Provider;

export function useThinkingCollab(): ThinkingCollab {
  return React.useContext(Context);
}

/** A member's name, or a neutral fallback for someone who left. */
export function memberName(collab: ThinkingCollab, userId: string): string {
  return collab.memberNames[userId] || 'A member';
}
