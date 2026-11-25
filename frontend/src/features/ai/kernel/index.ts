/**
 * StudyKit v0.4 — `features/ai/kernel` barrel
 *
 * Re-exports every public symbol of the AI Interaction
 * Kernel. The UI layer imports from here; it never reaches
 * into the individual files. The barrel also wires the
 * test-only `__reset*` helpers so a test can reset the
 * whole kernel in a single call.
 */

export {
  // Context resolver
  resolveContext,
  packetIsCloudEligible,
  isInvocationSurface,
  INVOCATION_SURFACES,
  SCOPE_POLICIES,
  type ContextPacket,
  type ContextResolverInput,
  type InvocationSurface,
  type ProviderHint,
  type ScopePolicy,
  type SelectionObject,
  type PinnedContext,
  type Visibility,
} from './contextResolver';

export {
  // Action registry
  actionRegistry,
  scopeMeets,
  type ActionContract,
  type ActionCategory,
  type ActionInput,
  type ActionOutput,
  type ActionPermission,
  type ActionPreview,
  type RequiredScope,
} from './actionRegistry';

export {
  // Permission gate
  checkPermission,
  availabilityFromHint,
  type PermissionResult,
  type PermissionDenialReason,
  type ProviderAvailability,
  type PermissionGateInput,
} from './permissionGate';

export {
  // Provider router
  buildProviderRouter,
  normaliseProviderError,
  type ProviderRouter,
  type ProviderChatRequest,
  type ProviderChatResponse,
} from './providerRouter';

export {
  // Draft layer
  draftLayer,
  packetScopeChips,
  DRAFT_LIVE_STATUSES,
  DRAFT_TERMINAL_STATUSES,
  isDraftStatus,
  isTerminalStatus,
  toLegacyStatus,
  type DraftRecord,
  type DraftStatus,
  type DraftLiveStatus,
  type DraftTerminalStatus,
  type DraftBody,
  type DraftProvenance,
  type DraftTarget,
  type DraftTargetKind,
} from './draftLayer';

export {
  // Session store
  assistantSession,
  useAssistantSession,
  type AssistantSessionState,
  type SessionStatus,
} from './sessionStore';

export {
  // Safe actions
  registerSafeActions,
  unregisterSafeActions,
  acceptNoteDraft,
  acceptDesignTaskSuggestion,
  setDesignTaskWriter,
  ACTION_NAVIGATE,
  ACTION_SEARCH_LOCAL,
  ACTION_CREATE_FREE_NOTE,
  ACTION_EXPLAIN_SELECTED,
  ACTION_CANVAS_SUGGEST_RELATIONS,
  ACTION_CANVAS_SUGGEST_CLUSTER,
  ACTION_CANVAS_SUGGEST_LAYOUT,
  ACTION_RESEARCH_SUGGEST_DESIGN_TASKS,
  SAFE_ACTION_IDS,
  type SafeActionDeps,
  type NavigateArgs,
  type SearchLocalArgs,
  type CreateFreeNoteArgs,
  type ExplainSelectedArgs,
  type CanvasSuggestRelationsArgs,
  type CanvasSuggestClusterArgs,
  type CanvasSuggestLayoutArgs,
  type ResearchSuggestDesignTasksArgs,
  type DesignTaskAcceptInput,
  type DesignTaskWriterDeps,
} from './actions/safeActions';

import { actionRegistry as _ar } from './actionRegistry';
import { draftLayer as _dl } from './draftLayer';
import { assistantSession as _as } from './sessionStore';
import { unregisterSafeActions } from './actions/safeActions';

/**
 * Test-only: wipe every piece of kernel state. Tests call
 * this in `beforeEach` so actions, drafts, and the session
 * store are guaranteed fresh.
 */
export function __resetAiKernelForTests(): void {
  unregisterSafeActions();
  _ar.reset();
  _dl.__resetForTests();
  _as.__resetForTests();
}
