/**
 * StudyKit v0.4 — `features/study/studyContext`
 *
 * A single React context that hands a `StudyUseCaseDeps`
 * (plus the live `StudyRepository` instance) to every Study
 * surface. The context value is built once by the wiring
 * component and never changes identity (the repository and
 * router are stable across the session).
 *
 * Why a context, not a Zustand store?
 *
 *   - The Study surfaces are small, not many, and the deps
 *     they need are stable. A context is the minimum
 *     surface that lets `useStudyDeps()` return the
 *     already-constructed repository and router without
 *     adding another global.
 *   - The repository / router are *not* user-visible state.
 *     A Zustand store would be the wrong abstraction.
 *   - The intent is also to keep Study completely out of
 *     the `useStore` Zustand store. A new context is the
 *     "vertical slice" pattern the v0.4 architecture
 *     commits to.
 *
 * The default value is a `null` so a misuse (no
 * `<StudyProvider>` ancestor) fails fast at the call site
 * instead of silently returning `undefined`. The
 * `useStudyDeps()` hook throws with a helpful message.
 */

import React from 'react';
import type { StudyRepository } from '../../application/study/studyRepository';
import type { UseCaseDeps } from '../../application/study/studyUseCases';
import type { SourceAssetBridge } from '../../application/assets/sourceAssetBridge';

export interface StudyContextValue extends UseCaseDeps {
  readonly repository: StudyRepository;
  readonly sourceAssets?: SourceAssetBridge;
}

const StudyContext = React.createContext<StudyContextValue | null>(null);

export interface StudyProviderProps {
  readonly value: StudyContextValue;
  readonly children: React.ReactNode;
}

export function StudyProvider(props: StudyProviderProps): React.ReactElement {
  return (
    <StudyContext.Provider value={props.value}>
      {props.children}
    </StudyContext.Provider>
  );
}

/**
 * Read the Study context. Throws a helpful error when used
 * outside a `<StudyProvider>` — there is no fallback
 * repository, the Study slice is a feature opt-in and the
 * UI must be inside the provider to do anything meaningful.
 */
export function useStudyDeps(): StudyContextValue {
  const value = React.useContext(StudyContext);
  if (!value) {
    throw new Error(
      'useStudyDeps: no <StudyProvider> ancestor. The Study slice is opt-in; ' +
        'mount <StudyProvider> in the v04 composition root when the v04Study flag is on.',
    );
  }
  return value;
}

/**
 * Optional variant. Returns `null` when no
 * `<StudyProvider>` ancestor is mounted. Used inside
 * the production composition root only when the
 * study wiring is guaranteed to be present; tests
 * can call this when they need to render a subtree
 * without the study wiring (and skip the throw).
 */
export function useStudyDepsOptional(): StudyContextValue | null {
  return React.useContext(StudyContext);
}
