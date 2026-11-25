/**
 * StudyKit v0.4 — `app/v04` barrel
 *
 * The single production shell. `V04Shell` + `V04Entry` + the
 * `ModeSwitch` + the auth bridge + the React glue for the
 * location/workspace stores.
 *
 * The pure-JS stores (`workspaceFlavour`, `locationStore`) and
 * the data gateway live in `application/`. The hook
 * `useWorkspaceFlavour` is re-exported here for convenience.
 */

export { V04Shell, V04Entry, type V04ShellProps, type V04EntryProps } from './V04Shell';
export { ModeSwitch } from './ModeSwitch';
export { WorkspaceAuthBridge } from './workspaceStore';
export { useLocation, locationStore, encodeLocationToHash, decodeLocationFromHash, DEFAULT_LOCATION } from './locationStore';
export { useWorkspaceFlavour } from '../../application/workspaceFlavour';
export { AiKernelWiring } from './aiKernelWiring';
export { StudyWiring } from './studyWiring';
export { StudyRouter } from './studyRouter';
export { ResearchWiring } from './researchWiring';
export { ResearchRouter } from './researchRouter';
export { CollaborationWiring } from './collaborationWiring';
export {
  DesktopWorkspaceProvider,
  useDesktopWorkspace,
  type DesktopWorkspaceState,
} from './desktopWorkspaceContext';
