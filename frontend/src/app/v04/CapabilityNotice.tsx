/**
 * StudyKit v0.4 — `CapabilityNotice`
 *
 * The single, reusable UI gate for sync-only capabilities in
 * a local workspace. Centralised so the "需要 Sync" copy and
 * the disabled-button pattern live in one place — UI components
 * never `if (local)` themselves, they just declare the
 * `capability` they need and let this component decide.
 *
 * Two modes:
 *   - `mode="gate"`    — renders children only when the
 *                        capability is supported, otherwise
 *                        renders the "需要 Sync" notice. Use
 *                        for buttons / panels that should
 *                        disappear entirely in local mode.
 *   - `mode="disable"` — always renders children, but flips
 *                        the `disabled` prop and shows the
 *                        notice below. Use for always-visible
 *                        surfaces that need to explain why
 *                        the action is greyed out.
 *
 * The gate does NOT call the dataApi. The capability decision
 * comes from `useSupports(capability)`, which reads the
 * workspace flavour from the gateway. Components still go
 * through the gateway for the actual call, so a stale UI
 * cannot accidentally fire a network request.
 */

import React from 'react';
import { useSupports, type Capability } from '../../application/dataApi';

export type CapabilityNoticeMode = 'gate' | 'disable';

export interface CapabilityNoticeProps {
  capability: Capability;
  mode?: CapabilityNoticeMode;
  /** Optional label for the missing workspace. Defaults to 'Sync workspace'. */
  workspaceLabel?: string;
  /** Optional extra copy shown after the headline. */
  hint?: string;
  children: React.ReactNode;
}

export function CapabilityNotice(props: CapabilityNoticeProps): React.ReactElement {
  const supported = useSupports(props.capability);
  const mode = props.mode ?? 'gate';
  const workspaceLabel = props.workspaceLabel ?? 'Sync workspace';
  if (supported) {
    return <>{props.children}</>;
  }
  if (mode === 'disable') {
    return (
      <div data-testid={`capability-notice-${props.capability}`} data-capability={props.capability} data-supported="false">
        <fieldset
          disabled
          aria-disabled="true"
          style={{ border: 'none', padding: 0, margin: 0, opacity: 0.55 }}
        >
          {props.children}
        </fieldset>
        <p
          className="text-sm text-muted"
          style={{ margin: '0.25rem 0 0 0', fontStyle: 'italic' }}
          data-testid={`capability-notice-message-${props.capability}`}
        >
          {props.hint ?? `此项需要 ${workspaceLabel}。`}
        </p>
      </div>
    );
  }
  // mode === 'gate': render only the notice.
  return (
    <div
      data-testid={`capability-notice-${props.capability}`}
      data-capability={props.capability}
      data-supported="false"
      className="capability-notice"
      style={{
        padding: '0.5rem 0.75rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface, transparent)',
        color: 'var(--color-text-secondary)',
        fontSize: '0.85rem',
        lineHeight: 1.4,
      }}
    >
      {props.hint ?? `此项需要 ${workspaceLabel}。`}
    </div>
  );
}

/**
 * In-place capability gate for single toolbar buttons / icons.
 * Unlike `<CapabilityNotice mode="disable">`, this is a hook-friendly
 * wrapper that returns the supported state and a tooltip / `disabled`
 * hint to apply to the existing button. Use when you want the button
 * to stay visible (so the user knows the feature exists) but be
 * obviously inert in a local workspace, with a short tooltip that
 * names the missing requirement.
 *
 *   const ai = useCapability('ai.chat');
 *   <button
 *     disabled={!ai.supported || loading}
 *     title={ai.tooltip}
 *     aria-disabled={!ai.supported}
 *   >Ask AI</button>
 *
 * Hooks are called unconditionally at the top of the component
 * that uses this helper, so the rules of hooks are preserved.
 */
export function useCapability(
  capability: Capability,
  hint?: string,
): { supported: boolean; tooltip: string } {
  const supported = useSupports(capability);
  return {
    supported,
    tooltip: supported
      ? ''
      : hint ?? `需要 Sync workspace 才能使用此功能。`,
  };
}
