/**
 * Shared inline styles for canvas chrome (toolbar, panels, inputs) so every
 * panel uses the same calm palette and spacing. Colours are CSS custom
 * properties (`styles/tokens.css`) so light and dark themes share one set
 * of components.
 */
import type React from 'react';

export const COLORS = {
  text: 'var(--fl-text)',
  muted: 'var(--fl-muted)',
  faint: 'var(--fl-faint)',
  border: 'var(--fl-border)',
  borderStrong: 'var(--fl-border-strong)',
  surface: 'var(--fl-surface)',
  canvas: 'var(--fl-canvas)',
  accent: 'var(--fl-accent)',
  danger: 'var(--fl-danger)',
  ok: 'var(--fl-ok)',
  accentSoft: 'var(--fl-accent-soft)',
  subtle: 'var(--fl-subtle)',
} as const;

export const button: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: `1px solid ${COLORS.borderStrong}`,
  background: COLORS.surface,
  color: COLORS.text,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: '18px',
};

export const buttonActive: React.CSSProperties = {
  ...button,
  borderColor: COLORS.accent,
  color: COLORS.accent,
  background: COLORS.accentSoft,
};

export const linkButton: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: '2px 4px',
  cursor: 'pointer',
  fontSize: 12,
  color: COLORS.accent,
};

export const input: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 6,
  fontSize: 12,
  boxSizing: 'border-box',
  outline: 'none',
};

export const floatingPanel: React.CSSProperties = {
  position: 'absolute',
  zIndex: 20,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  boxShadow: '0 6px 24px rgba(15,23,42,0.10)',
  fontSize: 12,
  color: COLORS.text,
};

export const sectionTitle: React.CSSProperties = {
  fontWeight: 650,
  fontSize: 12,
  marginBottom: 6,
  color: COLORS.text,
};
