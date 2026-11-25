/**
 * StudyKit v0.4 — `app/v04/researchWiring` (composition root)
 *
 * The single, production-side wiring of the Research
 * Evidence Slice (WP-05). Like `<StudyWiring>` and
 * `<AiKernelWiring>`, this is a side-effect component
 * that builds the Research deps in a `useRef` and
 * mounts a `<ResearchProvider>` whose children are the
 * whole v04 main body.
 *
 * The wiring is gated on the `v04Research` feature flag.
 * When the flag is off:
 *
 *   - the children render as-is (no `<ResearchProvider>`
 *     is mounted);
 *   - no Dexie reads / writes to the research tables
 *     happen;
 *   - the v0.3 / WP-02 / WP-04 surface tree is
 *     byte-for-byte unchanged.
 *
 * When the flag is on:
 *
 *   - the children are wrapped in a `<ResearchProvider>`
 *     whose value is the real `DexieResearchRepository`
 *     + a fresh `OpenAlexSearchProvider` instance;
 *   - the AI provider router is the *shared* one the
 *     AI Kernel built (or `undefined` when the AI
 *     kernel hasn't wired yet). The wiring subscribes
 *     to the shared router so a late mount (e.g. the
 *     AI Kernel's effect ran after this one) still
 *     reaches the Research slice.
 */

import React from 'react';
import { createDexieResearchRepository } from '../../platforms/web';
import { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import { isFeatureEnabled } from '../feature-flags';
import { getSharedProviderRouter, subscribeSharedProviderRouter } from './aiKernelWiring';
import { ResearchProvider, type ResearchContextValue } from '../../features/research/researchContext';
import { useDesktopWorkspace } from './desktopWorkspaceContext';
import { CrossrefOpenAlexCitationVerifier } from '../../application/output/citationVerification';

export interface ResearchWiringProps {
  readonly children?: React.ReactNode;
}

export function ResearchWiring(props: ResearchWiringProps): React.ReactElement {
  const flagOn = isFeatureEnabled('v04Research');
  const desktop = useDesktopWorkspace();
  const desktopRepository =
    desktop.state.kind === 'ready'
      ? desktop.state.repositories.research
      : undefined;
  // Version bumps whenever the shared router changes.
  // We rely on this counter to invalidate the
  // `Provider value` and force a re-render of the
  // children.
  const [, setVersion] = React.useState(0);
  const depsRef = React.useRef<ResearchContextValue | null>(null);
  if (flagOn && depsRef.current === null) {
    const repository =
      desktopRepository ?? createDexieResearchRepository();
    // Dev-only dependency seam: the browser smoke
    // test injects deterministic fixtures via
    // `globalThis.__studykitDevSmoke`. The default
    // is `undefined` (production), so the production
    // surface tree is byte-for-byte unchanged. When
    // the smoke test sets the global (via Playwright
    // `addInitScript`), the wiring uses the fixture
    // OpenAlex + provider router instead of building
    // a real one. The fixture shape mirrors the
    // production `OpenAlexSearchProvider` /
    // `ProviderRouter` contracts. The presence of
    // the dev-seam flag is cached below so the
    // shared-router subscription cannot silently
    // overwrite the test's router with the
    // production one.
    const devSmoke = (globalThis as { __studykitDevSmoke?: { openAlex?: typeof OpenAlexSearchProvider.prototype; providerRouter?: unknown } })
      .__studykitDevSmoke;
    const devSeamActive = devSmoke !== undefined;
    const openAlex = (devSmoke?.openAlex as OpenAlexSearchProvider | undefined) ?? new OpenAlexSearchProvider();
    const devSeamRouter = devSmoke?.providerRouter as ReturnType<typeof getSharedProviderRouter> | undefined;
    const providerRouter = devSeamRouter ?? getSharedProviderRouter();
    depsRef.current = {
      repository,
      ...(desktop.state.kind === 'ready' ? { sourceAssets: desktop.state.sourceAssets } : {}),
      openAlex,
      citationVerifier: new CrossrefOpenAlexCitationVerifier(),
      ...(providerRouter ? { providerRouter } : {}),
      devSeamActive,
    };
  }
  if (!flagOn && depsRef.current !== null) {
    depsRef.current = null;
  }
  const deps = depsRef.current;

  // Re-read the shared router on every change so the
  // Research Provider's `value` carries the latest
  // router. The repository + openAlex are stable; only
  // the router mutates. We bump a `setVersion` counter
  // to invalidate the Provider's value identity.
  //
  // Dev-seam exception: when the smoke test injected
  // `globalThis.__studykitDevSmoke`, the fixture router
  // is the source of truth. The shared router's
  // subscription replay would otherwise overwrite the
  // fixture with the production router on the first
  // commit, which is why the AI Suggest card silently
  // disappeared in Round 4. We skip the overwrite
  // whenever `devSeamActive` is set.
  React.useEffect(() => {
    if (!flagOn) return;
    return subscribeSharedProviderRouter((router) => {
      if (!depsRef.current) return;
      if (depsRef.current.devSeamActive) {
        // The fixture wins. Bump the version so the
        // Provider's value is re-evaluated (e.g. when
        // the smoke replaces the dev-seam router via
        // a reload), but do not overwrite
        // `providerRouter` from the shared bus.
        setVersion((v) => v + 1);
        return;
      }
      if (router) {
        depsRef.current = { ...depsRef.current, providerRouter: router };
      } else {
        const next = { ...depsRef.current };
        delete next.providerRouter;
        depsRef.current = next;
      }
      setVersion((v) => v + 1);
    });
  }, [flagOn]);

  if (!flagOn || !deps) {
    return <>{props.children}</>;
  }
  return <ResearchProvider value={deps}>{props.children}</ResearchProvider>;
}
