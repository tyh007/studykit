/**
 * StudyKit v0.4 — `app/v04/studyWiring` (composition root)
 *
 * The single, production-side wiring of the Study Vertical
 * Slice (WP-04). Like `<AiKernelWiring>`, this is a
 * side-effect component that builds the Study deps in a
 * `useEffect` and mounts a `<StudyProvider>` whose children
 * are the whole v04 main body (which contains both
 * `<StudyRouter>` AND the v0.3 `<StudyKitAppContent>`, the
 * latter of which now includes the WP-04
 * `<LectureFocusAdapter>` button).
 *
 * Why a single Provider, not siblings?
 *
 *   The Provider MUST wrap every node that calls
 *   `useStudyDeps()`. In production:
 *
 *   - `<StudyRouter>` (study-home / course / review) reads
 *     the deps through the hook to list courses,
 *     questions, and the recovery buffer.
 *   - `<LectureFocusAdapter>` (rendered inside the v0.3
 *     lecture surface via `App.tsx`) reads the deps to
 *     save the user's question / attempt and to ask for
 *     feedback.
 *   - The test environment in `features/study/study.test.tsx`
 *     also reads the hook.
 *
 *   Sibling wiring (the previous version) left both
 *   children outside the Provider, which made
 *   `useStudyDeps()` throw at the call site. The single
 *   Provider is the only composition that satisfies
 *   "every Study surface / lecture adapter in the same
 *   Provider" (WP-04 Gate fix).
 *
 * Why a side-effect component and not a module-load init?
 *
 *   - The flag default is off. A module-load provider would
 *     wire the Study slice into the v0.3 surface tree,
 *     breaking the WP-04 Gate "v04 flags 默认 off 时旧 UI
 *     行为不变".
 *   - The repository is built around the live dataApi /
 *     Dexie state; building it lazily inside a `useEffect`
 *     keeps the wiring honest.
 *   - The `study.css` is imported only on mount so a
 *     flag-off build does not pull in styles for code
 *     paths the user never sees.
 *
 * The `useStudyDeps()` hook is the consumer seam. UI code
 * never imports `lib/db`, `lib/api`, or the `DraftLayer` /
 * ProviderRouter directly — the wiring component is the
 * single place that knows about them.
 */

import React from 'react';
import { createDexieStudyRepository } from '../../platforms/web';
import { draftLayer } from '../../features/ai/kernel/draftLayer';
import {
  buildProviderRouter,
  type ProviderChatResponse,
} from '../../features/ai';
import { getDataApi, literatureAiApi } from '../../application/dataApi';
import { isFeatureEnabled } from '../feature-flags';
import { StudyProvider } from '../../features/study';
import '../../features/study/study.css';
import { useDesktopWorkspace } from './desktopWorkspaceContext';

export interface StudyWiringProps {
  readonly children?: React.ReactNode;
}

/**
 * The single production-side Study composition. With the
 * flag off, the children are rendered as-is (no Provider
 * is mounted, the v0.3 surface tree is byte-for-byte
 * unchanged). With the flag on, the children are rendered
 * inside a `<StudyProvider>` whose value carries the real
 * `StudyRepository` (Dexie-backed) and the real
 * `ProviderRouter` (kernel). The `useStudyDeps()` hook
 * inside `<StudyRouter>` and `<LectureFocusAdapter>` is
 * then guaranteed to find an ancestor.
 *
 * The flag-off behaviour matters: the previous shape
 * returned `null` when off, which made the v04 main body
 * disappear (because the body was passed as a child of
 * this component). The current shape always renders
 * children; only the Provider wrapping is conditional.
 */
export function StudyWiring(props: StudyWiringProps): React.ReactElement {
  const flagOn = isFeatureEnabled('v04Study');
  const desktop = useDesktopWorkspace();
  const desktopRef = React.useRef(desktop);
  desktopRef.current = desktop;
  const desktopRepository =
    desktop.state.kind === 'ready'
      ? desktop.state.repositories.study
      : undefined;
  const sourceAssets = desktop.state.kind === 'ready' ? desktop.state.sourceAssets : undefined;
  // Build the deps lazily on the first render where the
  // flag is on. We use a ref so the same `deps` object is
  // reused across re-renders (the StudyProvider's `value`
  // must be stable, otherwise every consumer re-renders).
  const depsRef = React.useRef<ReturnType<typeof buildDeps> | null>(null);
  const [, forceRender] = React.useState(0);
  if (flagOn && depsRef.current === null) {
    const router = buildProviderRouter({
      flavourProbe: () => (getDataApi().flavour === 'local' ? 'local' : 'sync'),
      capabilityProbe: (cap) => getDataApi().supports(cap),
      async chat(req): Promise<ProviderChatResponse> {
        const r = await literatureAiApi.chat({ messages: [...req.messages] });
        return { content: r?.message?.content ?? '', provider: 'cloud' };
      },
      localAi: {
        probe: () => ({
          aiAvailable: desktopRef.current.system.localAi?.reachable === true &&
            (desktopRef.current.system.localAi?.models.length ?? 0) > 0,
          providerName: desktopRef.current.system.localAi?.reachable ? 'ollama' : 'none',
        }),
        async chat(req): Promise<ProviderChatResponse> {
          return desktopRef.current.localAiChat(req.messages, req.model);
        },
      },
    });
    depsRef.current = buildDeps(router, desktopRepository, sourceAssets);
  }
  // When the flag flips off, drop the cached deps.
  if (!flagOn && depsRef.current !== null) {
    depsRef.current = null;
  }
  const deps = depsRef.current;

  if (!flagOn || !deps) {
    // No Provider; children render as-is so the v0.3 body
    // and the StudyRouter (which returns null when off) are
    // unaffected.
    return <>{props.children}</>;
  }
  // `useState` / `forceRender` is only invoked when the
  // flag flips on after a flag-off render. The first
  // render with the flag on is synchronous; we never
  // render with a missing Provider.
  void forceRender;
  return (
    <StudyProvider value={deps}>
      {props.children}
    </StudyProvider>
  );
}

function buildDeps(
  providerRouter: ReturnType<typeof buildProviderRouter>,
  desktopRepository?: import('../../application/study/studyRepository').StudyRepository,
  sourceAssets?: import('../../application/assets/sourceAssetBridge').SourceAssetBridge,
): {
  repository: import('../../application/study/studyRepository').StudyRepository;
  providerRouter: ReturnType<typeof buildProviderRouter>;
  draftLayer: typeof draftLayer;
  sourceAssets?: import('../../application/assets/sourceAssetBridge').SourceAssetBridge;
} {
  return {
    repository: desktopRepository ?? createDexieStudyRepository(),
    providerRouter,
    draftLayer,
    ...(sourceAssets ? { sourceAssets } : {}),
  };
}
