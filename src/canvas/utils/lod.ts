/**
 * Level of detail by zoom (Map v2 M2), pure helpers:
 *
 *   zoom < 0.22  zone summaries only: labels, counts, quality; no cards, no card edges
 *   0.22 – 0.7   file cards (name, size, quality)
 *   (small views: the cards also list their symbols, up to 8 rows + "+N")
 *
 * Labels are counter-scaled so a zone name stays readable when the map is
 * zoomed far out, as far as the room in the frame allows.
 */
import type { ZoomLevel } from '../../contracts/canvas/index.js';

export const ZOOM_QUANTUM = 0.05;

/** Zoom rounded to the quantum, so selectors re-render only when the picture really changes. */
export const quantizeZoom = (zoom: number): number => Math.max(ZOOM_QUANTUM, Math.round(zoom / ZOOM_QUANTUM) * ZOOM_QUANTUM);

/** Only zone summaries are drawn. */
export const isSummaryTier = (tier: ZoomLevel): boolean => tier === 'system';

/** Symbol rows are drawn inside rich cards whenever cards are drawn at all. */
export const showsSymbolRows = (tier: ZoomLevel): boolean => !isSummaryTier(tier);

/**
 * Scale for a label chip so it keeps about `targetPx` on screen: at least 1,
 * at most `max` (room available: header height at normal zoom, the whole
 * frame when only summaries are drawn) and never wider than `roomWidth`.
 */
export function labelScale(zoom: number, opts: { contentWidth: number; roomWidth: number; max: number; targetPx?: number }): number {
  const want = (opts.targetPx ?? 13) / 13 / Math.max(zoom, ZOOM_QUANTUM);
  const fit = opts.contentWidth > 0 ? opts.roomWidth / opts.contentWidth : opts.max;
  return Math.max(1, Math.min(want, opts.max, fit));
}
