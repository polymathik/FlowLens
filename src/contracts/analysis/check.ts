/**
 * Contract for `flowlens check` reports (text and `--format json`).
 */

import type { CycleSeverity } from './cycles.js';

export type CheckCycleReport = {
  severity: CycleSeverity;
  granularity: string;
  /** Ordered closed path of human-readable labels (file paths / qualified names). */
  path: string[];
  members: number;
  severity_reasons: string[];
};

export type CheckViolationReport = {
  rule: string;
  rule_text: string;
  layer_from: string;
  layer_to: string;
  /** Qualified names (or file paths) — not opaque ids. */
  from: string;
  to: string;
  relation_type: string;
  location: string;
  suggestion?: string;
};

export type CheckReport = {
  timestamp: string;
  scope?: string;
  severity_threshold: CycleSeverity;
  architecture: 'checked' | 'skipped' | 'missing' | 'invalid';
  cycles: CheckCycleReport[];
  architecture_violations: CheckViolationReport[];
  summary: {
    cycles_found: number;
    violations_found: number;
    severity_breakdown: Record<CycleSeverity, number>;
  };
};

/** Exit codes: 0 clean, 1 issues found, 2 usage/config error. */
export const CHECK_EXIT = { clean: 0, issues: 1, error: 2 } as const;
