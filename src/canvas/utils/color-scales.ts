/**
 * Colour scale utilities for overlays and metric badges.
 *
 * - qualityColor: 0-100 quality score → traffic-light colour
 * - churnColor:   churn rate relative to the max → blue-to-red gradient (hex)
 * - hotspotSize:  hotspot score relative to the max → node scale factor
 * - withAlpha:    hex colour + alpha → 8-digit hex (for soft fills)
 */

export const QUALITY_BANDS = [
  { min: 80, color: '#16a34a', label: '80–100 · healthy' },
  { min: 50, color: '#ca8a04', label: '50–79 · fair' },
  { min: 25, color: '#ea580c', label: '25–49 · needs care' },
  { min: 0, color: '#dc2626', label: '0–24 · hard to change' },
] as const;

/** Traffic-light colour for quality scores (green = good, red = critical). */
export function qualityColor(score: number): string {
  for (const band of QUALITY_BANDS) {
    if (score >= band.min) return band.color;
  }
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].color;
}

const LOW = [59, 130, 246]; // blue-500
const HIGH = [220, 38, 38]; // red-600

function hex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

/** Blue-to-red gradient based on `rate / maxRate`. */
export function churnColor(rate: number, maxRate: number): string {
  const ratio = maxRate > 0 ? Math.min(Math.max(rate / maxRate, 0), 1) : 0;
  const c = LOW.map((lo, i) => lo + (HIGH[i] - lo) * ratio);
  return `#${c.map(hex).join('')}`;
}

/** Scale factor for hotspot node sizing (1.0x to 1.6x). */
export function hotspotSize(score: number, maxScore: number): number {
  if (maxScore <= 0 || score <= 0) return 1;
  return 1 + Math.min(score / maxScore, 1) * 0.6;
}

/** Append an alpha channel (0–1) to a #rrggbb colour. */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `${color}${hex(Math.min(Math.max(alpha, 0), 1) * 255)}`;
}
