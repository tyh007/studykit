/**
 * StudyKit v0.4 — `features/research/design-workspace` barrel
 *
 * Re-exports the design workspace's private
 * subcomponents. The orchestrator `DesignWorkspace`
 * lives in `features/research/DesignWorkspace.tsx`;
 * this barrel is the public surface for sibling
 * code that needs to reuse a single section.
 */

export {
  DesignSectionCard,
  type DesignSectionCardProps,
} from './DesignSectionCard';
export {
  DecisionsRail,
  type DecisionsRailProps,
} from './DecisionsRail';
export {
  DecisionEditor,
  type DecisionEditorProps,
  type DecisionEditorValue,
} from './DecisionEditor';
export {
  TaskFromDecisionForm,
  type TaskFromDecisionFormProps,
} from './TaskFromDecisionForm';
