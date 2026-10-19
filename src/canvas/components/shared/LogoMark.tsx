/**
 * The FlowLens mark: a lens bringing a graph into focus. Inline so it follows
 * the theme through tokens: the field is `--fl-accent` (indigo in light, the
 * lavender dark value in dark, which is the design system's dark mark) and the
 * faint outer graph is `--fl-logo-faint`. The lens, ink and hub never change.
 * Geometry matches assets/brand/flowlens-mark.svg on its 64-unit grid.
 * Decorative by default; pass `title` when it stands alone.
 */
import React from 'react';

export function LogoMark({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="fl-logo"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <rect className="fl-logo-field" width="64" height="64" rx="14" />
      <path className="fl-logo-faint-stroke" d="M22 41L9 55M22 41L6 35M42 22L55 9M43 42L56 56" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <g className="fl-logo-faint-fill">
        <circle cx="9" cy="55" r="3" />
        <circle cx="6" cy="35" r="3" />
        <circle cx="55" cy="9" r="3" />
        <circle cx="56" cy="56" r="3" />
      </g>
      <circle cx="32" cy="32" r="19.5" fill="#ffffff" />
      <path d="M32 32L22 41M32 32L42 22M32 32L43 42" stroke="#0f172a" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <g fill="#0f172a">
        <circle cx="22" cy="41" r="3.6" />
        <circle cx="42" cy="22" r="3.6" />
        <circle cx="43" cy="42" r="3.6" />
      </g>
      <circle cx="32" cy="32" r="5" fill="#4f46e5" />
    </svg>
  );
}
