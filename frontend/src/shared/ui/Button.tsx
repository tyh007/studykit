// Button — the canonical v0.4 button. Thin wrapper around <button> that
// adds the v0.4 design-system contract:
//   - variants: primary, secondary, ghost, danger
//   - sizes: sm, md, lg
//   - full keyboard / focus support (inherits from <button>)
//   - accessible name forwarded from children or aria-label
//   - loading state via aria-busy (no spinner yet — kept minimal in WP-01)
//
// Components only consume semantic tokens (--primary, --text, --border-*
// etc.), so light/dark switching happens entirely in CSS — no JS branches
// for color.

import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the parent's inline axis. */
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'sk-btn-sm',
  md: 'sk-btn-md',
  lg: 'sk-btn-lg',
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'sk-btn-primary',
  secondary: 'sk-btn-secondary',
  ghost: 'sk-btn-ghost',
  danger: 'sk-btn-danger',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', fullWidth, className, type, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Buttons inside <form> default to submit; we want a neutral default.
      type={type ?? 'button'}
      className={[
        'sk-btn',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        fullWidth ? 'sk-btn-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
});
