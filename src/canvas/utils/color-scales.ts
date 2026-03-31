/**
 * Color scale utilities for overlay visualizations.
 *
 * - qualityColor: maps a 0-100 quality score to a traffic-light color
 * - churnColor:   maps a churn rate (relative to max) to a blue-to-red gradient
 * - hotspotSize:  maps a hotspot score to a node size multiplier
 */

/** Traffic-light color for quality scores (green = good, red = critical). */
export function qualityColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#eab308';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

/** Blue-to-red gradient based on churn rate relative to the maximum. */
export function churnColor(rate: number, maxRate: number): string {
  if (maxRate === 0) return '#93c5fd';
  const ratio = Math.min(rate / maxRate, 1);
  const r = Math.round(59 + ratio * 196); // 59 -> 255
  const g = Math.round(130 - ratio * 60); // 130 -> 70
  const b = Math.round(253 - ratio * 185); // 253 -> 68
  return `rgb(${r}, ${g}, ${b})`;
}

/** Scale factor for hotspot node sizing (0.8x to 2.3x). */
export function hotspotSize(score: number, maxScore: number): number {
  if (maxScore === 0) return 1;
  return 0.8 + (score / maxScore) * 1.5;
}
