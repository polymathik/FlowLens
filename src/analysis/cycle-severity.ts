/**
 * Severity scoring for detected cycles.
 *
 * Weighted formula:
 * - Length factor (0.3): shorter cycles = higher score
 * - Criticality factor (0.3): based on avg afferent coupling
 * - Cross-boundary factor (0.4): entities spanning multiple directories
 */

import type { Entity } from '../contracts/entities.js';
import type { CycleSeverity } from '../contracts/analysis/cycles.js';

/**
 * Compute severity for a cycle given its entity details.
 */
export function computeCycleSeverity(
  cycleEntities: Entity[],
  cycleLength: number,
): CycleSeverity {
  const score =
    0.3 * lengthFactor(cycleLength) +
    0.3 * criticalityFactor(cycleEntities) +
    0.4 * crossBoundaryFactor(cycleEntities);

  if (score > 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Shorter cycles are more problematic.
 * Score = 1 - (length - 2) / 10, clamped to [0, 1].
 */
function lengthFactor(cycleLength: number): number {
  return Math.max(0, Math.min(1, 1 - (cycleLength - 2) / 10));
}

/**
 * Higher average afferent coupling = more critical.
 * Normalized: avg_ca / (avg_ca + 1) to map to [0, 1).
 */
function criticalityFactor(entities: Entity[]): number {
  if (entities.length === 0) return 0;

  const totalCa = entities.reduce(
    (sum, e) => sum + (e.metrics?.afferent_coupling ?? 0),
    0,
  );
  const avgCa = totalCa / entities.length;

  return avgCa / (avgCa + 1);
}

/**
 * 1.0 if cycle entities span multiple top-level directories,
 * 0.0 if all in the same directory.
 */
function crossBoundaryFactor(entities: Entity[]): number {
  if (entities.length === 0) return 0;

  const dirs = new Set(
    entities.map((e) => {
      const parts = e.file.split('/');
      return parts.length > 1 ? parts[0] : '';
    }),
  );

  return dirs.size > 1 ? 1.0 : 0.0;
}
