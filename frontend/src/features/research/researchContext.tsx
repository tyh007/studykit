/**
 * StudyKit v0.4 — `features/research/researchContext`
 *
 * The single React context that hands a `ResearchDeps`
 * (the live `ResearchRepository` + the OpenAlex provider)
 * to every Research surface. The context value is
 * built once by the wiring component and never changes
 * identity (the repository and the provider are stable
 * across the session).
 *
 * The default value is a `null` so a misuse (no
 * `<ResearchProvider>` ancestor) fails fast at the
 * call site instead of silently returning
 * `undefined`. The `useResearchDeps()` hook throws
 * with a helpful message.
 */

import React from 'react';
import type { ResearchRepository } from '../../application/research/researchRepository';
import type { OpenAlexSearchProvider } from '../../application/research/openAlexProvider';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import type { CitationMetadataVerifier } from '../../application/output/citationVerification';
import type { SourceAssetBridge } from '../../application/assets/sourceAssetBridge';

export interface ResearchContextValue {
  readonly repository: ResearchRepository;
  readonly sourceAssets?: SourceAssetBridge;
  readonly openAlex: OpenAlexSearchProvider;
  /** Optional, user-triggered registry verification. Core local flows do not depend on it. */
  readonly citationVerifier?: CitationMetadataVerifier;
  /**
   * The AI ProviderRouter. When the AI is off or no
   * provider is registered, the router is omitted
   * and AI-driven actions surface a real
   * `Continue without AI` path.
   */
  readonly providerRouter?: ProviderRouter;
  /**
   * Dev-only flag. When the browser smoke injected
   * `globalThis.__studykitDevSmoke`, the wiring sets
   * `devSeamActive: true` so the shared-router
   * subscription cannot overwrite the test's
   * fixture router with the production one. Default
   * `false` in production so the byte-for-byte
   * surface tree is unchanged.
   */
  readonly devSeamActive?: boolean;
}

const ResearchContext = React.createContext<ResearchContextValue | null>(null);

export interface ResearchProviderProps {
  readonly value: ResearchContextValue;
  readonly children: React.ReactNode;
}

export function ResearchProvider(props: ResearchProviderProps): React.ReactElement {
  return (
    <ResearchContext.Provider value={props.value}>
      {props.children}
    </ResearchContext.Provider>
  );
}

export function useResearchDeps(): ResearchContextValue {
  const value = React.useContext(ResearchContext);
  if (!value) {
    throw new Error(
      'useResearchDeps: no <ResearchProvider> ancestor. The Research slice is opt-in; ' +
        'mount <ResearchProvider> in the v04 composition root when the v04Research flag is on.',
    );
  }
  return value;
}

/**
 * Optional variant. Returns `null` when no
 * `<ResearchProvider>` ancestor is mounted. Used
 * inside the production composition root only when
 * the research wiring is guaranteed to be present;
 * tests can call this when they need to render a
 * subtree without the research wiring (and skip the
 * throw). Never reaches for the throw path.
 */
export function useResearchDepsOptional(): ResearchContextValue | null {
  return React.useContext(ResearchContext);
}
