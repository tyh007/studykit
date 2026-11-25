/**
 * StudyKit v0.4 — `features/collaboration/index`
 *
 * Barrel for the Collaboration Foundation surface.
 * The shell imports `CollaborationProvider` /
 * `CollaborationPanel` from here; the use cases
 * and the domain types are exposed under their
 * canonical paths (`application/collaboration/*`
 * and `domain/collaboration`).
 */

export { CollaborationProvider, useCollaborationDeps, useCollaborationDepsOptional, type CollaborationDeps } from './collaborationContext';
export { CollaborationPanel, type CollaborationPanelProps } from './CollaborationPanel';
export { PublishScratchDialog, type PublishScratchDialogProps } from './PublishScratchDialog';
