/* ==========================================================================
   StudyKit — Logo (v3.1 "Ink & Prism", warm pastel)
   A single ink-stroke "S" formed by a folded bookmark, refracting into
   a 4-color warm pastel prism at the central bend. Colors come from CSS
   custom properties so dark mode swaps automatically.
   ========================================================================== */

import React, { useId } from 'react';

type LogoSize = 'sm' | 'md' | 'lg' | 'xl' | number;

type LogoMarkProps = {
  size?: LogoSize;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** When true, adds an 8s shimmer sweep across the prism line. */
  animated?: boolean;
  /** Show the "StudyKit" wordmark to the right of the mark. */
  showWordmark?: boolean;
};

const sizeMap: Record<Exclude<LogoSize, number>, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 56,
};

function toPx(size: LogoSize | undefined): number {
  if (size === undefined) return sizeMap.md;
  if (typeof size === 'number') return size;
  return sizeMap[size];
}

function safeId(raw: string): string {
  // React's useId returns strings like ":r0:". SVG IDs can't contain ":".
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

/* --------------------------------------------------------------------------
   The actual SVG geometry — exported as LogoMark so it can be reused
   inside LogoMarkWithWordmark without re-wrapping.
   -------------------------------------------------------------------------- */
function LogoMarkSVG({
  uid,
  animated,
}: {
  uid: string;
  animated: boolean;
}) {
  const prismId = `prism-${uid}`;
  const shimmerId = `shimmer-${uid}`;
  const clipId = `clip-${uid}`;

  return (
    <>
      <defs>
        {/* 4-stop warm pastel prism — colors come from CSS custom properties
            so light/dark mode switches automatically. */}
        <linearGradient id={prismId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent-butter, #F5E5BE)" />
          <stop offset="0.33" stopColor="var(--accent-blush, #F2D5D2)" />
          <stop offset="0.66" stopColor="var(--accent-rose, #E5B8B0)" />
          <stop offset="1" stopColor="var(--accent-lilac, #DCC8DC)" />
        </linearGradient>

        {/* Shimmer gradient used by the animated variant. */}
        <linearGradient id={shimmerId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.5" stopColor="white" stopOpacity="0.75" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>

        <clipPath id={clipId}>
          <rect x="11" y="13" width="10" height="6" />
        </clipPath>
      </defs>

      {/* The "S" — single ink stroke in currentColor, stroke 3, round caps. */}
      <path
        d="M 23 6 H 11 a 5 5 0 0 0 0 10 H 21 a 5 5 0 0 1 0 10 H 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Prism highlight overlay at the central bend. Slightly wider than
          the S stroke so it reads as a refractive band, not a stroke. */}
      <line
        x1="13"
        y1="16"
        x2="19"
        y2="16"
        stroke={`url(#${prismId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Animated shimmer — a white sweep clipped to the prism area. */}
      {animated && (
        <g clipPath={`url(#${clipId})`}>
          <rect
            className="prism-shimmer-rect"
            x="-10"
            y="13"
            width="10"
            height="6"
            fill={`url(#${shimmerId})`}
          />
        </g>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   LogoMark — just the S mark.
   -------------------------------------------------------------------------- */
export function LogoMark({
  size = 'md',
  className,
  style,
  title = 'StudyKit',
  animated = false,
}: LogoMarkProps) {
  const rawId = useId();
  const uid = safeId(rawId);
  const px = toPx(size);

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      aria-label={title}
    >
      <LogoMarkSVG uid={uid} animated={animated} />
    </svg>
  );
}

/* --------------------------------------------------------------------------
   LogoMarkWithWordmark — mark + "StudyKit" wordmark with warm gradient.
   -------------------------------------------------------------------------- */
export function LogoMarkWithWordmark({
  size = 'md',
  className,
  style,
  title = 'StudyKit',
  animated = false,
}: LogoMarkProps) {
  const rawId = useId();
  const uid = safeId(rawId);
  const px = toPx(size);
  // Wordmark text size scales with the mark.
  const fontSize = Math.max(11, Math.round(px * 0.55));

  return (
    <span
      className={`logo-brand ${className || ''}`}
      style={style}
      role="img"
      aria-label={title}
    >
      <LogoMark size={size} animated={animated} />
      <span
        className="logo-wordmark"
        style={{ fontSize: `${fontSize}px` }}
      >
        StudyKit
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
   LogoMarkAnimated — convenience for the always-shimmering variant.
   -------------------------------------------------------------------------- */
export function LogoMarkAnimated(props: LogoMarkProps) {
  return <LogoMark {...props} animated showWordmark={props.showWordmark ?? false} />;
}

export default LogoMark;
