/**
 * StudyKit v0.4 — `features/research` barrel
 *
 * Re-exports the public surface of the Research
 * Evidence Slice. The slice is a pure consumer of
 * `domain`, `application` and `shared`; it never
 * imports from `lib/db`, `lib/literature-api`, or
 * any AI client. The data gateway + `application/
 * research` adapters are the only seams.
 *
 * The CSS import is a side effect of the barrel so
 * the Research styles ship when the slice ships, and
 * the styles are loaded exactly once even when
 * multiple surfaces mount.
 */

import './research.css';

export { useResearchDeps, useResearchDepsOptional, ResearchProvider, type ResearchContextValue } from './researchContext';
export { ResearchHome, type ResearchHomeProps } from './ResearchHome';
export { ProjectHome, type ProjectHomeProps } from './ProjectHome';
export { DesignWorkspace, type DesignWorkspaceProps } from './DesignWorkspace';
export { TaskDetail, type TaskDetailProps } from './TaskDetail';
export { Discovery, type DiscoveryProps } from './Discovery';
export { Library, type LibraryProps } from './Library';
export { Sources, type SourcesProps, type SourcesView } from './Sources';
export { EvidenceWorkspace, type EvidenceWorkspaceProps } from './EvidenceWorkspace';
export { ResearchReader, type ResearchReaderProps } from './ResearchReader';
export { OutputWorkspace, type OutputWorkspaceProps } from './OutputWorkspace';
