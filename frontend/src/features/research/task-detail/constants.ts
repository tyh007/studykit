/**
 * StudyKit v0.4 — `features/research/task-detail/constants`
 *
 * Human-readable label maps shared across the
 * TaskDetail subcomponents. Kept here so the surface
 * (and its tests) reference a single source of truth
 * for status / blocker / completion wording.
 *
 * Pure data; no React, no I/O.
 */

import type {
  TaskBlockerKind,
  TaskCompletionRefKind,
  TaskStatus,
} from '../../../domain/researchDesign';

export const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  'open': 'Open',
  'in-progress': 'In progress',
  'blocked': 'Blocked',
  'done': 'Done',
  'cancelled': 'Cancelled',
};

export const BLOCKER_LABELS: Readonly<Record<TaskBlockerKind, string>> = {
  'data': 'Waiting on data',
  'supervisor': 'Waiting on supervisor',
  'ethics': 'Waiting on ethics',
  'access': 'Waiting on access',
  'analysis': 'Waiting on analysis',
  'other': 'Other',
};

export const COMPLETION_LABELS: Readonly<Record<TaskCompletionRefKind, string>> = {
  'output': 'Output',
  'decision': 'Design decision',
  'evidence': 'Verified evidence',
};
