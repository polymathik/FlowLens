/**
 * Shared result-limit helpers. Per-tool defaults and caps live in the tool
 * contracts (`LIMITS`, `ANALYSIS_LIMITS`); this is the one place that applies them.
 */

export interface LimitSpec {
  default: number;
  cap: number;
}

/** Effective limit: the requested value (or default), clamped to [1, cap]. */
export function clampLimit(requested: number | undefined, spec: LimitSpec): number {
  const v = requested === undefined || !Number.isFinite(requested) ? spec.default : Math.floor(requested);
  return Math.max(1, Math.min(v, spec.cap));
}
