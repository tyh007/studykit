/**
 * StudyKit v0.4 — `OpenIntentCapsuleButton`
 *
 * A tiny button that opens the Intent Capsule from any
 * surface. Surfaces that want a non-global way to open
 * the capsule drop this button next to their existing
 * AI entry; the global `⌘K` shortcut still works in
 * parallel.
 *
 * The button is a *no-op* when the `v04Assistant` flag
 * is off — the existing AI surfaces are unchanged. This
 * is the additive seam that the gate requires.
 */

import React from 'react';
import { isFeatureEnabled } from '../../../app/feature-flags';
import { openCapsule, type OpenCapsuleInput } from './openCapsule';
import type { SelectionObject } from '../kernel';
import type { ContainerRef } from '../../../domain/workspace';

export interface OpenIntentCapsuleButtonProps {
  readonly surface: 'selection' | 'object' | 'intent-capsule' | 'transition' | 'workspace' | 'desktop-quick-access';
  /** Optional selected text the surface knows about. */
  readonly selectedText?: string | null;
  /** Optional pre-selected objects. */
  readonly selectedObjects?: readonly SelectionObject[];
  /** Optional container override (e.g. a course for NoteEditor). */
  readonly container?: ContainerRef | null;
  /** Button label. Defaults to "Open AI". */
  readonly label?: string;
  /** Optional className for the surface to style the button. */
  readonly className?: string;
  /** Variant — `primary` (blue) or `ghost`. */
  readonly variant?: 'primary' | 'ghost';
  /** id used for the focus-restore on close. */
  readonly id?: string;
}

export function OpenIntentCapsuleButton(props: OpenIntentCapsuleButtonProps): React.ReactElement | null {
  if (!isFeatureEnabled('v04Assistant')) {
    // Flag off: render nothing. The legacy AI surfaces
    // continue to be the only entry, byte-for-byte
    // unchanged.
    return null;
  }
  const handleClick = (): void => {
    const input: OpenCapsuleInput = {
      surface: props.surface,
      ...(props.selectedText !== undefined ? { selectedText: props.selectedText } : {}),
      ...(props.selectedObjects
        ? { selectedObjectIds: props.selectedObjects.map((o) => o.id) }
        : {}),
      ...(props.container !== undefined ? { container: props.container } : {}),
    };
    openCapsule(input);
  };
  const label = props.label ?? 'Open AI';
  return (
    <button
      type="button"
      id={props.id ?? 'v04-open-intent-capsule'}
      className={['v04-open-intent-capsule', props.className].filter(Boolean).join(' ')}
      onClick={handleClick}
      data-testid="v04-open-intent-capsule"
      data-surface={props.surface}
    >
      {label}
    </button>
  );
}
