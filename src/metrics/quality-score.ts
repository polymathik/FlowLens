import type { EntityMetrics } from '../contracts/entities.js';

/**
 * Computes a composite quality score (0–100) for an entity based on:
 * - Cognitive complexity (highest weight)
 * - Line count
 * - Efferent coupling (optional, if pre-computed)
 * - Afferent coupling (optional, if pre-computed)
 *
 * Coupling fields are optional because this function is also called without
 * them during indexing, before query-time coupling is available.
 */
export function computeQualityScore(metrics: EntityMetrics): number {
  let score = 100;

  // Cognitive complexity penalty (biggest weight)
  if (metrics.cognitive_complexity !== undefined) {
    if (metrics.cognitive_complexity > 25) score -= 40;
    else if (metrics.cognitive_complexity > 15) score -= 25;
    else if (metrics.cognitive_complexity > 10) score -= 15;
    else if (metrics.cognitive_complexity > 5) score -= 5;
  }

  // Line count penalty
  if (metrics.line_count > 200) score -= 20;
  else if (metrics.line_count > 100) score -= 10;
  else if (metrics.line_count > 50) score -= 5;

  // Coupling penalty (if available)
  if (metrics.efferent_coupling !== undefined && metrics.efferent_coupling > 15) {
    score -= 15;
  }
  if (metrics.afferent_coupling !== undefined && metrics.afferent_coupling > 20) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}
