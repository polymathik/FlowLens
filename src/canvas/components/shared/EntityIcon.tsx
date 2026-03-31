/**
 * Icon component that maps entity kinds to visual emoji indicators.
 * Used in EntityNode and other components that display entity information.
 */
import React from 'react';

const ICONS: Record<string, string> = {
  file: '\u{1F4C4}',
  module: '\u{1F4E6}',
  namespace: '\u{1F3F7}\uFE0F',
  class: '\u{1F537}',
  interface: '\u{1F536}',
  function: '\u26A1',
  method: '\u{1F527}',
  variable: '\u{1F4CC}',
  field: '\u{1F517}',
  type: '\u{1F170}\uFE0F',
  enum: '\u{1F4CA}',
  default: '\u25CF',
};

export function EntityIcon({ kind }: { kind: string }) {
  return <span style={{ marginRight: 4 }}>{ICONS[kind] ?? ICONS.default}</span>;
}
