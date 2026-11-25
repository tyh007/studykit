/**
 * StudyKit v0.4 — `features/research/project-home` barrel
 *
 * Re-exports the Project Home's private subcomponents
 * (one file each) plus the small types they share. The
 * orchestrator `ProjectHome` lives in
 * `features/research/ProjectHome.tsx`; this barrel is
 * the public surface for sibling code that needs to
 * reuse a single section.
 */

export { LivingBriefCard, type LivingBriefCardProps } from './LivingBriefCard';
export { QuickActionsRow, type QuickActionsRowProps } from './QuickActionsRow';
export { StatusGrid, StatusColumn, type StatusGridProps } from './StatusGrid';
export { OpenQuestionsSection, type OpenQuestionsSectionProps } from './OpenQuestionsSection';
export { HypothesisSection, type HypothesisSectionProps } from './HypothesisSection';
export { RisksSection, type RisksSectionProps } from './RisksSection';
export { MilestonesSection, type MilestonesSectionProps } from './MilestonesSection';
export { TasksSection, type TasksSectionProps } from './TasksSection';
export { LineageColumns, type LineageColumnsProps } from './LineageColumns';
