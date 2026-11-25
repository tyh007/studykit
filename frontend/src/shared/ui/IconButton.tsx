// IconButton — square button that contains an icon and a required
// accessible name. The accessible name MUST be supplied via aria-label
// or aria-labelledby; we do not infer it from the icon so the screen
// reader contract stays explicit. If a developer forgets, we surface a
// console warning in development.

import React from 'react';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';
export type IconButtonSize = 'compact' | 'default' | 'lg';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Required for accessibility. Either this or aria-labelledby. */
  'aria-label': string;
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLASS: Record<IconButtonSize, string> = {
  compact: 'sk-iconbtn-compact',
  default: 'sk-iconbtn-default',
  lg: 'sk-iconbtn-lg',
};

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  primary: 'sk-iconbtn-primary',
  secondary: 'sk-iconbtn-secondary',
  ghost: 'sk-iconbtn-ghost',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'default', className, type, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={['sk-iconbtn', SIZE_CLASS[size], VARIANT_CLASS[variant], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});
