/**
 * Colour scale utilities for overlays and metric badges.
 *
 * - qualityColor: 0-100 quality score → traffic-light colour
 * - churnColor:   churn rate relative to the max → blue-to-red gradient
 * - hotspotSize:  hotspot score relative to the max → node scale factor
 * - withAlpha:    colour + alpha → soft fill
 *
 * Phase 12: colours are theme tokens (`var(--fl-heat-*)` in tokens.css), so
 * overlays follow light/dark mode; gradients and soft fills use CSS
 * `color-mix()` because a `var()` cannot be blended in JS.
 */

export const QUALITY_BANDS = [
  { min: 80, color: 'var(--fl-heat-good)', label: '80–100 · healthy' },
  { min: 50, color: 'var(--fl-heat-fair)', label: '50–79 · fair' },
  { min: 25, color: 'var(--fl-heat-poor)', label: '25–49 · needs care' },
  { min: 0, color: 'var(--fl-heat-bad)', label: '0–24 · hard to change' },
] as const;

/** Traffic-light colour for quality scores (green = good, red = critical). */
export function qualityColor(score: number): string {
  for (const band of QUALITY_BANDS) {
    if (score >= band.min) return band.color;
  }
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].color;
}

function hex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

/** Blue-to-red gradient (theme tokens) based on `rate / maxRate`. */
export function churnColor(rate: number, maxRate: number): string {
  const ratio = maxRate > 0 ? Math.min(Math.max(rate / maxRate, 0), 1) : 0;
  const pct = Math.round(ratio * 100);
  if (pct === 0) return 'var(--fl-heat-churn-low)';
  if (pct === 100) return 'var(--fl-heat-churn-high)';
  return `color-mix(in srgb, var(--fl-heat-churn-high) ${pct}%, var(--fl-heat-churn-low))`;
}

/** Scale factor for hotspot node sizing (1.0x to 1.6x). */
export function hotspotSize(score: number, maxScore: number): number {
  if (maxScore <= 0 || score <= 0) return 1;
  return 1 + Math.min(score / maxScore, 1) * 0.6;
}

/** Colour at `alpha` (0–1): 8-digit hex for #rrggbb, else a `color-mix()` with transparent. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.min(Math.max(alpha, 0), 1);
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${hex(a * 255)}`;
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}
