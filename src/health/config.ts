/**
 * Health thresholds and scoring constants — the ONE place to tune them.
 *
 * Sources (see _docs/specs/PHASE-11-HEALTH.md §3 for the full rationale):
 * - Function complexity: SonarSource rule S3776 flags functions with
 *   cognitive complexity > 15 (25 for C-family); McCabe's classic limit for
 *   cyclomatic complexity is 10.
 * - God file: Lanza & Marinescu "Object-Oriented Metrics in Practice"
 *   (God Class: WMC ≥ 47, ATFD > 5, TCC < 1/3). We approximate WMC with the
 *   sum of function complexity in a file and ATFD with outgoing file deps.
 * - Hotspots / change risk: CodeScene's hotspot model (change frequency ×
 *   code health) — complex code that changes often is the best refactor
 *   target.
 */
import type { HealthCategory, HealthSeverity } from '../contracts/health.js';

export const HEALTH_THRESHOLDS = {
  complexity: {
    /** Cognitive complexity above this is "hard to follow" (Sonar S3776). */
    cognitive_warn: 15,
    /** …above this it is "very hard to follow". */
    cognitive_high: 25,
    /** …above this it is critical. */
    cognitive_critical: 50,
    /** Fallback when cognitive is not computed for a language (McCabe). */
    cyclomatic_warn: 10,
    cyclomatic_high: 20,
    cyclomatic_critical: 40,
    /** More than this many complex functions in one file are grouped. */
    group_per_file: 3,
  },
  size: {
    /** A file longer than this is "very long". */
    large_file_lines: 500,
    /** God file: at least this long… */
    god_file_lines: 400,
    /** …and summed function complexity ≥ this (Lanza–Marinescu WMC ≥ 47)… */
    god_file_total_complexity: 47,
    /** …or at least this many functions/methods. */
    god_file_functions: 25,
  },
  coupling: {
    /** Fragile hub: at least this many files depend on it directly… */
    hub_min_dependents: 8,
    /** …or this share of all files (whichever is larger is used as the bar). */
    hub_min_dependents_share: 0.2,
    /** …AND it depends on at least this many files itself (ATFD > 5)… */
    hub_min_outgoing: 6,
    /** …OR contains a function more complex than this. */
    hub_complexity: 15,
  },
  change: {
    /** Git history window. */
    period_days: 90,
    /** Hotspot: changed at least this many times in the window… */
    hotspot_min_changes: 3,
    /** …and its most complex function is above this. */
    hotspot_min_complexity: 10,
    /** Changes at which the ranking change factor saturates at 2×. */
    change_saturation: 10,
  },
  graph: {
    /** Below this share of resolved imports, warn that the map may be wrong. */
    unresolved_import_warn_ratio: 0.1,
    /** Overall dangling-relation share that triggers a caveat. */
    dangling_relation_warn_ratio: 0.2,
    /** Orphan detection is skipped below this many files. */
    orphan_min_files: 5,
    /** "Map looks disconnected" needs at least this many code files… */
    disconnected_min_files: 10,
    /** …with fewer than this share linked to any other file. */
    disconnected_share: 0.5,
  },
} as const;

export type HealthThresholds = typeof HEALTH_THRESHOLDS;

/** Base points by severity; a finding's penalty = points × impact. */
export const SEVERITY_POINTS: Record<HealthSeverity, number> = {
  critical: 12,
  high: 6,
  medium: 3,
  low: 1,
  info: 0,
};

/** Points per file that sits inside a tangle (penalty is per file, so it is monotonic). */
export const TANGLE_POINTS_PER_FILE = 3;

/** Points per forbidden cross-layer dependency (capped per file pair). */
export const BOUNDARY_POINTS_PER_EDGE = 2;
export const BOUNDARY_MAX_EDGES_PER_PAIR = 5;

export const SCORING = {
  /** Category score = 100 × exp(−penalty / (K × size_factor)). */
  k: 30,
  /** size_factor = max(1, sqrt(files / size_files)). */
  size_files: 20,
  /** Impact multiplier = 1 + min(1, blast / max(min_saturation, share × files)). */
  impact_min_saturation: 5,
  impact_share: 0.25,
} as const;

export const CATEGORY_WEIGHTS: Record<HealthCategory, number> = {
  tangles: 0.25,
  complexity: 0.2,
  coupling: 0.15,
  structure: 0.15,
  change_risk: 0.15,
  size: 0.1,
};

export const CATEGORY_LABELS: Record<HealthCategory, string> = {
  tangles: 'Tangles',
  structure: 'Structure & boundaries',
  complexity: 'Hard-to-follow code',
  change_risk: 'Change risk',
  size: 'Oversized files',
  coupling: 'Fragile hubs',
};

export const GRADE_BANDS: Array<{ min: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' }> = [
  { min: 90, grade: 'A' },
  { min: 80, grade: 'B' },
  { min: 70, grade: 'C' },
  { min: 60, grade: 'D' },
  { min: 0, grade: 'F' },
];

/** File name patterns that are legitimately "unused" by other files (entry points etc.). */
export const ENTRY_POINT_PATTERNS: RegExp[] = [
  /(^|\/)(index|main|app|server|cli|entry|bootstrap|setup)\.[cm]?[jt]sx?$/i,
  /(^|\/)(page|layout|route|loading|error|middleware|not-found)\.[cm]?[jt]sx?$/i,
  /(^|\/)(pages|app|routes|api|bin|scripts|migrations|public)\//i,
  /\.(test|spec|stories|story|config|setup|d)\.[cm]?[jt]sx?$/i,
  /(^|\/)(__tests__|tests?|e2e|fixtures?|mocks?|__mocks__)\//i,
  /(^|\/)[^/]*config[^/]*$/i,
  /(^|\/)(__init__|__main__|manage|wsgi|asgi|conftest)\.py$/i,
  /\.(json|ya?ml|toml|md|sh)$/i,
];
