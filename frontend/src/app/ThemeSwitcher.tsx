// ThemeSwitcher — small three-button cycle (System → Light → Dark).
// Lives in `app/` (not in `shared/theme/`) because it composes the
// shared theme runtime with the legacy `components/ui/Icons` set.
// `shared/` is the innermost UI/utility layer and must not reach
// outward into `components/`, so the switcher is the composition
// root's job, not the theme primitive's job.
//
// Behavior contract is unchanged from WP-01: every click advances
// the preference one step in [system, light, dark], and the
// accessible name always reflects the *current* preference so screen
// readers can announce "Theme: Light — click to switch".

import React from 'react';
import { useTheme } from '../shared/theme';
import { IconButton } from '../shared/ui/IconButton';
import { Icon } from '../components/ui/Icons';
import type { ThemePreference } from '../shared/theme';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

const LABELS: Record<ThemePreference, { label: string; icon: 'system' | 'sun' | 'moon' }> = {
  system: { label: 'Theme: System (follow OS)', icon: 'system' },
  light: { label: 'Theme: Light', icon: 'sun' },
  dark: { label: 'Theme: Dark', icon: 'moon' },
};

export interface ThemeSwitcherProps {
  size?: 'compact' | 'default';
  className?: string;
}

export function ThemeSwitcher({ size = 'default', className }: ThemeSwitcherProps) {
  const { preference, setPreference } = useTheme();
  const meta = LABELS[preference];

  const cycle = () => {
    const idx = ORDER.indexOf(preference);
    const next = ORDER[(idx + 1) % ORDER.length];
    setPreference(next);
  };

  return (
    <IconButton
      type="button"
      size={size}
      variant="ghost"
      onClick={cycle}
      aria-label={`${meta.label} — click to switch`}
      title={meta.label}
      data-theme-switcher="true"
      data-theme-preference={preference}
      className={className}
    >
      <Icon name={meta.icon} size={size === 'compact' ? 'sm' : 'md'} />
    </IconButton>
  );
}
