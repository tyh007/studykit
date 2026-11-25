/**
 * StudyKit v0.4 — `HeaderAskButton`
 *
 * The shell-level **Ask** affordance. WP-11R2 unifies the
 * system-level AI entry into a single button that:
 *
 *   - Is visible on every v0.4 surface (Study Home,
 *     Course, Project, Reader, Evidence, Design, Output,
 *     Canvas, Review, …) without each surface having to
 *     mount its own copy.
 *   - Opens the *same* IntentCapsule session
 *     (`openCapsule` → `assistantSession`) — the
 *     existing `IntentCapsuleProvider` mounted in
 *     `V04Shell` renders the panel.
 *   - Carries the current `AppLocation`'s `Mode` and
 *     `Container` as the capsule's `container`, so the
 *     resulting `ContextPacket` shows the right
 *     `Course · …` / `Project · …` chip without any new
 *     AI plumbing.
 *   - Surfaces AI capability as a title-only hint when
 *     the `v04Assistant` flag is off (the surface is
 *     still a usable button — opening it just shows
 *     "Local/Cloud/Off" inside the panel; the local
 *     Capture and the rest of the shell stay live).
 *   - Has an accessible name (`aria-label`) and a
 *     tooltip; the keyboard shortcut is the existing
 *     `Cmd/Ctrl+K` listener in `IntentCapsuleProvider`.
 *
 * The button does NOT call any repository or write to
 * canonical state. It only writes to the assistant
 * session — the *one* AI entry point — exactly as the
 * WP-11R2 spec requires.
 */
import React from 'react';
import { openCapsule, type OpenCapsuleInput } from '../../features/ai/ui/openCapsule';
import { isFeatureEnabled } from '../feature-flags';
import { useLocation } from './locationStore';
import { getSharedProviderRouter } from './aiKernelWiring';
import type { ContainerRef } from '../../domain/workspace';
import { SparkIcon } from '../../components/ui/Icons';

export interface HeaderAskButtonProps {
  /**
   * The invocation surface the button should pass to
   * `openCapsule`. Defaults to `'intent-capsule'`
   * (the system-level surface). Surfaces that already
   * know they have a selection (Canvas, Reader, Output)
   * pass `'selection'` so the chip-set starts with the
   * `selection` scope highlighted.
   */
  readonly surface?: OpenCapsuleInput['surface'];
  /**
   * Optional container override. When omitted, the
   * button reads the current `AppLocation.container`
   * (so the same component works in every context
   * without a per-surface wrapper).
   */
  readonly container?: ContainerRef | null;
  /**
   * Optional id (the Intent Capsule uses it to restore
   * focus on close). Defaults to `v04-header-ask`.
   */
  readonly id?: string;
  /**
   * Optional label override (default "Ask").
   */
  readonly label?: string;
}

export function HeaderAskButton(props: HeaderAskButtonProps): React.ReactElement {
  const location = useLocation();
  const assistantOn = isFeatureEnabled('v04Assistant');
  const container = props.container ?? location.container ?? null;
  const label = props.label ?? 'Ask';
  const id = props.id ?? 'v04-header-ask';

  const handleClick = (): void => {
    const input: OpenCapsuleInput = {
      surface: props.surface ?? 'intent-capsule',
      container,
    };
    openCapsule(input);
  };

  // Build a one-line status hint for the title. We do
  // NOT show the status as visible text — the existing
  // `sync-indicator` already carries the local/cloud
  // pill. The title is the only place we hint at the
  // AI capability.
  let title = 'Ask the AI assistant about this context';
  if (!assistantOn) {
    title = 'Open the assistant (Local/Cloud/Off is shown inside)';
  } else {
    const router = getSharedProviderRouter();
    if (!router) {
      title = 'Ask the AI assistant (preparing…)';
    }
  }

  return (
    <button
      type="button"
      id={id}
      className="btn btn-primary btn-sm v04-header-ask"
      onClick={handleClick}
      aria-label={`${label} — opens the AI assistant with the current ${location.mode} context`}
      title={title}
      data-testid="v04-header-ask"
      data-mode={location.mode}
      data-container-kind={container?.kind ?? 'none'}
      data-container-id={container?.id ?? ''}
      data-surface={props.surface ?? 'intent-capsule'}
    >
      <SparkIcon size="sm" className="v04-header-ask-spark" />
      <span>{label}</span>
      <kbd className="v04-header-ask-shortcut" aria-hidden="true">⌘K</kbd>
    </button>
  );
}
