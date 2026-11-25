/**
 * StudyKit v0.4 — `features/study` barrel
 *
 * Public surface of the Study Vertical Slice (WP-04). The
 * shell imports from here; individual files stay private.
 *
 * What is exported:
 *
 *   - The four Study surfaces (`StudyHome`, `CourseHome`,
 *     `ReviewWorkspace`, `LectureFocusAdapter`).
 *   - The `StudyProvider` / `useStudyDeps()` glue.
 *
 * What is NOT exported:
 *
 *   - The use cases / repository / domain types — those
 *     live under `application/study` and `domain/study`
 *     respectively, and are imported by the wiring
 *     component (`app/v04/studyWiring.tsx`).
 */

export { StudyHome, type StudyHomeProps } from './StudyHome';
export { CourseHome, type CourseHomeProps } from './CourseHome';
export { ReviewWorkspace, type ReviewWorkspaceProps } from './ReviewWorkspace';
export { LectureFocusAdapter, type LectureFocusAdapterProps } from './LectureFocusAdapter';
export { UnderstandDrawer, type UnderstandDrawerProps } from './UnderstandDrawer';
export { StudyProvider, useStudyDeps, useStudyDepsOptional, type StudyContextValue, type StudyProviderProps } from './studyContext';
