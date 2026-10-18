/**
 * Shared inline styles for canvas chrome (toolbar, panels, inputs) so every
 * panel uses the same calm palette and spacing.
 */
import type React from 'react';

export const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  surface: '#ffffff',
  canvas: '#f8fafc',
  accent: '#4f46e5',
  danger: '#dc2626',
  ok: '#16a34a',
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
  background: '#eef2ff',
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
  background: 'rgba(255,255,255,0.97)',
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
