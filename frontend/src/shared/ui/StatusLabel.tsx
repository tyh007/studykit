// StatusLabel — inline text label that pairs an OPTIONAL icon with
// text under a semantic tone. Distinct from <Pill /> in that it is
// meant to live inside content (paragraph, header) rather than sit
// standalone.
//
// The TONE is the only required piece — the `<VisuallyHidden>`
// description ("success: " / "warning: " / …) guarantees the meaning
// reaches assistive tech even when no icon is present, so the
// component never depends on color alone (WCAG 1.4.1). Callers that
// want a visible glyph can pass an `icon` ReactNode; callers that
// just want a tagged run of text can omit it.
//
// ARCHITECTURE NOTE: this component lives in `shared/ui/`, the
// innermost UI layer. It MUST NOT import from `components/ui/Icons`.
// Instead, callers pass an `icon` ReactNode (a small SVG, an emoji,
// or a legacy icon component from a higher layer) so the shared
// layer stays free of business / legacy UI dependencies.

import React from 'react';
import { VisuallyHidden } from './VisuallyHidden';

export type StatusLabelTone = 'success' | 'warning' | 'error' | 'info' | 'pending';

/** Human-readable tone string used for the visually hidden description. */
const TONE_DESCRIPTOR: Record<StatusLabelTone, string> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  pending: 'pending',
};

const TONE_CLASS: Record<StatusLabelTone, string> = {
  success: 'sk-status-success',
  warning: 'sk-status-warning',
  error: 'sk-status-error',
  info: 'sk-status-info',
  pending: 'sk-status-pending',
};

export interface StatusLabelProps {
  tone: StatusLabelTone;
  children: React.ReactNode;
  /**
   * Optional icon. Pass any small visual (a span with text, an SVG,
   * or a higher-layer icon component). The shared layer does not
   * ship a default — consumers in `app/` / `features/` can wrap the
   * legacy `Icon` from `components/ui/Icons` and pass it here.
   */
  icon?: React.ReactNode;
  className?: string;
}

export function StatusLabel({ tone, children, icon, className }: StatusLabelProps) {
  return (
    <span
      role="status"
      className={['sk-status', TONE_CLASS[tone], className].filter(Boolean).join(' ')}
      data-tone={tone}
    >
      <VisuallyHidden>{TONE_DESCRIPTOR[tone]}: </VisuallyHidden>
      {icon != null && <span className="sk-status-icon" aria-hidden>{icon}</span>}
      <span className="sk-status-text">{children}</span>
    </span>
  );
}
