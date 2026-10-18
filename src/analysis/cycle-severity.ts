/**
 * Severity scoring for detected cycles (Phase 10, rule-based).
 *
 * The old weighted formula keyed "cross-boundary" on the first path segment,
 * so almost every cycle in a `src/` tree scored low and "high" never fired.
 * Severity is now explained by three signals:
 *
 * - **layers**: members resolve to more than one architecture layer
 * - **modules**: members live in more than one directory module
 * - **critical**: some member is central — PageRank ≥ 2× the average on the
 *   collapsed graph, ≥ 5 distinct dependents outside the cycle, or a stored
 *   average afferent coupling ≥ 3
 *
 * | severity | rule |
 * |---|---|
 * | high   | crosses layers, or crosses modules and is critical |
 * | medium | crosses modules, or is critical |
 * | low    | everything else (a local cycle inside one module) |
 */

import type { CycleSeverity } from '../contracts/analysis/cycles.js';

export const CRITICAL_PAGERANK_RATIO = 2;
export const CRITICAL_EXTERNAL_DEPENDENTS = 5;
export const CRITICAL_AFFERENT_COUPLING = 3;

export interface CycleSeverityInput {
  /** Distinct non-null architecture layers touched by the members. */
  layers: string[];
  /** Distinct directory modules touched by the members. */
  moduleCount: number;
  /** Highest member PageRank × node count (1 = average). */
  maxPageRankRatio: number;
  /** Distinct nodes outside the cycle with an edge into it. */
  externalDependents: number;
  /** Average stored afferent coupling of member entities (0 if unknown). */
  avgAfferentCoupling: number;
}

export interface CycleSeverityResult {
  severity: CycleSeverity;
  reasons: string[];
}

export function assessCycleSeverity(input: CycleSeverityInput): CycleSeverityResult {
  const reasons: string[] = [];
  const crossesLayers = input.layers.length > 1;
  const crossesModules = input.moduleCount > 1;

  if (crossesLayers) reasons.push(`crosses architecture layers: ${input.layers.join(', ')}`);
  if (crossesModules) reasons.push(`spans ${input.moduleCount} modules`);

  const criticalBy: string[] = [];
  if (input.maxPageRankRatio >= CRITICAL_PAGERANK_RATIO) {
    criticalBy.push(`a member has ${input.maxPageRankRatio.toFixed(1)}x average PageRank`);
  }
  if (input.externalDependents >= CRITICAL_EXTERNAL_DEPENDENTS) {
    criticalBy.push(`${input.externalDependents} dependents outside the cycle`);
  }
  if (input.avgAfferentCoupling >= CRITICAL_AFFERENT_COUPLING) {
    criticalBy.push(`average afferent coupling ${input.avgAfferentCoupling.toFixed(1)}`);
  }
  const critical = criticalBy.length > 0;
  if (critical) reasons.push(`critical: ${criticalBy.join('; ')}`);

  let severity: CycleSeverity = 'low';
  if (crossesLayers || (crossesModules && critical)) severity = 'high';
  else if (crossesModules || critical) severity = 'medium';

  if (reasons.length === 0) reasons.push('local cycle within one module');
  return { severity, reasons };
}
