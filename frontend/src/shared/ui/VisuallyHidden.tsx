// VisuallyHidden — content is available to screen readers but not visible.
// One component, one purpose. Do not extend this with display tweaks; that
// would defeat the point.

import React from 'react';

type IntrinsicTag = keyof React.JSX.IntrinsicElements;

export interface VisuallyHiddenProps {
  children: React.ReactNode;
  /** Render as a different element. Defaults to span. */
  as?: IntrinsicTag;
  className?: string;
}

export function VisuallyHidden({ children, as = 'span', className }: VisuallyHiddenProps) {
  const Tag = as as React.ElementType;
  return (
    <Tag className={['sk-visually-hidden', className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  );
}
