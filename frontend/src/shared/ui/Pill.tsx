// Pill — compact status / context chip. Per the v0.4 visual spec
// (section 4), pills are reserved for status, context chip, and
// compact toggle. They are NOT for primary actions — those use
// <Button />. Tone is semantic, not arbitrary color.

import React from 'react';

export type PillTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  className?: string;
  children: React.ReactNode;
}

const TONE_CLASS: Record<PillTone, string> = {
  neutral: 'sk-pill-neutral',
  primary: 'sk-pill-primary',
  success: 'sk-pill-success',
  warning: 'sk-pill-warning',
  error: 'sk-pill-error',
  info: 'sk-pill-info',
};

export function Pill({ tone = 'neutral', className, children, ...rest }: PillProps) {
  return (
    <span
      className={['sk-pill', TONE_CLASS[tone], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
