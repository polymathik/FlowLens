/**
 * Small typographic glyph per symbol kind (no emoji: renders identically in
 * every OS font and in image exports), plus the shared kind accent colours.
 */
import React from 'react';

export const KIND_COLORS: Record<string, string> = {
  class: '#6366f1',
  interface: '#d97706',
  function: '#16a34a',
  method: '#0891b2',
  variable: '#94a3b8',
  field: '#94a3b8',
  enum: '#db2777',
  type: '#7c3aed',
  module: '#0d9488',
  namespace: '#0d9488',
};

const GLYPHS: Record<string, string> = {
  file: 'F',
  module: 'M',
  namespace: 'N',
  class: 'C',
  interface: 'I',
  function: 'ƒ',
  method: 'm',
  variable: 'v',
  field: 'f',
  type: 'T',
  enum: 'E',
};

export function EntityIcon({ kind }: { kind: string }) {
  const color = KIND_COLORS[kind] ?? '#64748b';
  return (
    <span
      aria-label={kind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        width: 16,
        height: 16,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: `${color}1f`,
      }}
    >
      {GLYPHS[kind] ?? '•'}
    </span>
  );
}
