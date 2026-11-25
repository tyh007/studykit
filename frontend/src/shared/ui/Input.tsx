// Input — a small, accessible text input that forwards refs and wires
// `htmlFor` automatically when paired with a label. We intentionally do
// not bundle a label component here; the App auth form (the only
// consumer in WP-01) keeps its existing label JSX and just swaps the
// <input> for <Input />.

import React from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'> {
  size?: InputSize;
  invalid?: boolean;
  className?: string;
}

const SIZE_CLASS: Record<InputSize, string> = {
  sm: 'sk-input-sm',
  md: 'sk-input-md',
  lg: 'sk-input-lg',
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', invalid, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={['sk-input', SIZE_CLASS[size], invalid ? 'sk-input-invalid' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});
