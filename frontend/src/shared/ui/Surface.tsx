// Surface — a 5-layer v0.4 surface primitive (base / sunken / surface /
// floating / deep). This is the *naming* half of the visual contract;
// the actual paint comes from the v0.4 CSS layer so light/dark switching
// is token-driven, not className-driven.

import React from 'react';

export type SurfaceLevel = 'base' | 'sunken' | 'surface' | 'floating' | 'deep';

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: SurfaceLevel;
  /** Add the warm-cognitive-glass "glass" treatment on top of the level. */
  glass?: boolean;
  className?: string;
  children: React.ReactNode;
}

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
  base: 'sk-surface-base',
  sunken: 'sk-surface-sunken',
  surface: 'sk-surface-surface',
  floating: 'sk-surface-floating',
  deep: 'sk-surface-deep',
};

export function Surface({ level = 'surface', glass, className, children, ...rest }: SurfaceProps) {
  return (
    <div
      className={['sk-surface', LEVEL_CLASS[level], glass ? 'sk-surface-glass' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
