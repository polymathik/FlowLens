/**
 * Relation-type colour map — the single source for edge strokes, arrow
 * markers and the filter panel swatches.
 */
import { MarkerType, type EdgeMarker } from '@xyflow/react';
import type { RelationType } from '../../contracts/relations.js';

export const RELATION_COLORS: Record<RelationType, string> = {
  import: '#6366f1',    // indigo
  call: '#16a34a',      // green
  extend: '#d97706',    // amber
  implement: '#2563eb', // blue
  override: '#9333ea',  // violet
  contain: '#cbd5e1',   // light grey (subdued)
  create: '#db2777',    // pink
  use: '#64748b',       // slate
  mixin: '#0d9488',     // teal
  parameter: '#0891b2', // cyan
  return: '#7c3aed',    // purple
  throw: '#dc2626',     // red
  decorate: '#ea580c',  // orange
};

/** Ordered list of every relation type (filter panel order). */
export const ALL_RELATION_TYPES = Object.keys(RELATION_COLORS) as RelationType[];

export { DEFAULT_VISIBLE_RELATION_TYPES } from './relation-defaults';

export const DEFAULT_RELATION_COLOR = '#94a3b8';

/** Colour used for cycle / rule-break edges and markers. */
export const PROBLEM_COLOR = '#dc2626';

export function relationColor(type: string | undefined): string {
  return (type && RELATION_COLORS[type as RelationType]) || DEFAULT_RELATION_COLOR;
}

/**
 * React Flow arrowhead for an edge colour. React Flow renders marker defs
 * inside its own edge SVG, so arrows survive image export.
 */
export function arrowMarker(color: string): EdgeMarker {
  return { type: MarkerType.ArrowClosed, color, width: 16, height: 16, markerUnits: 'userSpaceOnUse' };
}
