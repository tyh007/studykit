/**
 * StudyKit v0.4 — `features/research/task-detail` barrel
 *
 * Re-exports the TaskDetail surface's private
 * subcomponents (one file each) plus the small
 * types they share. The orchestrator `TaskDetail`
 * lives in `features/research/TaskDetail.tsx`; this
 * barrel is the public surface for sibling code
 * that needs to reuse a single section.
 */

export {
  STATUS_LABELS,
  BLOCKER_LABELS,
  COMPLETION_LABELS,
} from './constants';
export { TaskHeader, type TaskHeaderProps } from './TaskHeader';
export { TaskWhyCard, type TaskWhyCardProps } from './TaskWhyCard';
export {
  TaskSourceRefCard,
  type TaskSourceRefCardProps,
} from './TaskSourceRefCard';
export {
  TaskDependencyList,
  type TaskDependencyCandidate,
  type TaskDependencyListProps,
} from './TaskDependencyList';
export { TaskBlockerCard, type TaskBlockerCardProps } from './TaskBlockerCard';
export { TaskBlockerForm, type TaskBlockerFormProps } from './TaskBlockerForm';
export {
  TaskCompletionCard,
  type TaskCompletionCardProps,
} from './TaskCompletionCard';
export {
  TaskCompletionForm,
  type TaskCompletionCandidate,
  type TaskCompletionFormProps,
} from './TaskCompletionForm';
export {
  TaskStatusActions,
  type TaskStatusActionsProps,
} from './TaskStatusActions';
