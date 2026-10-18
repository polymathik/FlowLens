/**
 * Health report contract — the single source of truth for FlowLens's
 * "codebase health check-up".
 *
 * One deterministic, local generator (`src/health/`) produces a
 * `HealthReport`. Every human-facing surface reads it:
 *   - `flowlens report` (Markdown / HTML / JSON)
 *   - the canvas per-project Health screen (wave 2)
 *   - the Home tab's cross-project cards via `HealthSummary` (wave 2)
 *   - the MCP resource `flowlens://health` (wave 2)
 *
 * All text fields are plain English written for people who did not
 * hand-write their code. Static analysis never proves runtime behaviour,
 * so findings are phrased as "looks like" and graph-quality problems are
 * surfaced in `caveats`.
 *
 * Owner: Lane D2 / Phase 11. Additive changes only; bump
 * HEALTH_SCHEMA_VERSION on any breaking change.
 */
import type { CanvasLinkKind, CanvasOverlay } from './canvas-links.js';
import type { GraphManifest, IndexCompletion } from './manifest.js';
import type { Entity } from './entities.js';
import type { Relation } from './relations.js';
import type { ArchitectureConfig } from './architecture.js';
import type { FileChurnData } from './analysis/churn.js';

/** Bump when the HealthReport shape changes incompatibly. */
export const HEALTH_SCHEMA_VERSION = 1;

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type HealthSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type HealthEffort = 'S' | 'M' | 'L';

/** How far the grade can be trusted, given graph quality. */
export type HealthConfidence = 'high' | 'medium' | 'low';

export type HealthFindingKind =
  /** Files that depend on each other in a loop ("tangle"). */
  | 'cycle'
  /**
   * Phase 12: files that form a loop only through type-only imports or type
   * annotations. No runtime effect; reported as `info` design notes with no
   * score penalty.
   */
  | 'type_cycle'
  /** One file doing far too many jobs. */
  | 'god_file'
  /** Many files rely on this one, and it is itself hard to change safely. */
  | 'fragile_hub'
  /** A function that is hard to follow. */
  | 'complex_function'
  /** Hard-to-follow code that also changes often. */
  | 'hotspot'
  /** Code reaching into a layer the architecture rules forbid. */
  | 'boundary_violation'
  /** A very long file (but not doing many jobs). */
  | 'large_file'
  /** A file nothing uses and that uses nothing (maybe leftover). */
  | 'orphan_module'
  /** Imports FlowLens could not connect to a file. */
  | 'unresolved_imports';

/** The six sub-scores that make up the overall score. */
export type HealthCategory =
  | 'tangles'
  | 'structure'
  | 'complexity'
  | 'change_risk'
  | 'size'
  | 'coupling';

export interface HealthEvidence {
  /** Project-relative file path. */
  file: string;
  /** 1-based line, when the evidence points at a specific place. */
  line?: number;
  /** Graph entity id, when the evidence is a specific symbol. */
  entity_id?: string;
  /** Human-readable symbol name (e.g. `computePrice`). */
  name?: string;
  /** Plain-English note, e.g. "imports billing.ts on line 3". */
  note?: string;
  /** Raw numbers behind the finding (e.g. { complexity: 31 }). */
  numbers?: Record<string, number>;
}

/** Where the canvas should take the user for "Show on map". */
export interface HealthFocus {
  kind: CanvasLinkKind;
  /** Entity qualified name / id, or file / module path (see canvas-links). */
  identifier: string;
  overlay?: CanvasOverlay;
  /** All entities to highlight. */
  entity_ids: string[];
  /** All files to highlight. */
  files: string[];
  /** Project the link belongs to (for `#/p/:projectId/...` routing in wave 2). */
  project_id: string | null;
  /** Deep link built with `buildCanvasUrl` (single-project form). */
  url: string;
}

export interface HealthFinding {
  /** Stable hash of kind + target; survives re-indexing. */
  id: string;
  kind: HealthFindingKind;
  category: HealthCategory;
  severity: HealthSeverity;
  /** Plain English, ≤ 80 characters. */
  title: string;
  /** Plain English, no jargon, 1–2 sentences. */
  why_it_matters: string;
  evidence: HealthEvidence[];
  focus: HealthFocus;
  /** Ready-to-paste prompt for an AI coding assistant. */
  fix_prompt: string;
  effort: HealthEffort;
  /** 1 = fix first. */
  rank: number;
  /** Ranking score = penalty × change factor (higher = more urgent). */
  rank_score: number;
  /** Points this finding removes from its category (before size slack). */
  penalty: number;
  /** Files that rely on the target directly or indirectly. */
  blast_radius: number;
  /** Ids of findings about the same place (e.g. god file + fragile hub). */
  related_ids?: string[];
}

export interface HealthScoreContribution {
  finding_id: string;
  title: string;
  points: number;
}

export interface HealthSubScore {
  category: HealthCategory;
  /** Plain-English label, e.g. "Tangles". */
  label: string;
  /** 0–100, or null when it cannot be measured (e.g. no git history). */
  score: number | null;
  /** Weight in the overall score (after renormalising unknown categories). */
  weight: number;
  /** Sum of finding penalties in this category. */
  penalty: number;
  /** Biggest contributors, largest first. */
  lowered_by: HealthScoreContribution[];
  /** One-line plain-English explanation. */
  explanation: string;
}

export interface HealthBreakdown {
  /** Size slack applied to every category: max(1, sqrt(files / 20)). */
  size_factor: number;
  sub_scores: HealthSubScore[];
  /** How the overall score was computed, in one sentence. */
  formula: string;
}

export interface HealthStats {
  files: number;
  symbols: number;
  relations: number;
  /** language → file count */
  languages: Record<string, number>;
}

export interface HealthNextStep {
  finding_id: string | null;
  /** Imperative, plain English. */
  action: string;
}

export interface HealthProjectInfo {
  /** From `.flowlens/project.json` / manifest; null when not yet assigned. */
  id: string | null;
  name: string;
  root: string;
}

export interface HealthGraphInfo {
  /** True when `.flowlens/manifest.json` was found. */
  has_manifest: boolean;
  git_head: string | null;
  completion: IndexCompletion | 'unknown';
  last_indexed: string | null;
  /** True when the graph is known to be older than the working tree. */
  stale: boolean;
}

export interface HealthReport {
  schema_version: number;
  /** ISO-8601; excluded from determinism checks. */
  generated_at: string;
  project: HealthProjectInfo;
  graph: HealthGraphInfo;
  grade: HealthGrade;
  score: number;
  /** 'low' when the map looks incomplete or disconnected; reasons are in `caveats`. */
  confidence: HealthConfidence;
  breakdown: HealthBreakdown;
  stats: HealthStats;
  /** Ranked, deduplicated (1 = first). */
  findings: HealthFinding[];
  /** Total before any `top` cut. */
  total_findings: number;
  /** finding count by kind (before any `top` cut). */
  counts: Partial<Record<HealthFindingKind, number>>;
  /** finding count by severity (before any `top` cut). */
  severity_counts: Partial<Record<HealthSeverity, number>>;
  next_steps: HealthNextStep[];
  caveats: string[];
}

/** Compact view for the Home tab's per-project card. */
export interface HealthSummary {
  schema_version: number;
  project: HealthProjectInfo;
  grade: HealthGrade;
  score: number;
  confidence: HealthConfidence;
  top_finding: string | null;
  counts: {
    findings: number;
    cycles: number;
    boundary_violations: number;
    hotspots: number;
    critical_or_high: number;
  };
  last_indexed: string | null;
  stale: boolean;
}

/** Tunables passed to the generator. All optional. */
export interface HealthOptions {
  /** Keep only the first N ranked findings in `findings` (default: all). */
  top?: number;
  /** Canvas base URL for focus links (default: env / localhost). */
  canvas_base_url?: string;
  /** Fixed timestamp for reproducible output (tests, snapshots). */
  now?: string;
}

/**
 * Everything the generator needs, already loaded. The generator itself is
 * pure (no I/O); `src/health/load.ts` builds this from `.flowlens/`, and the
 * graph service / canvas server can build it from their own caches.
 */
export interface HealthInput {
  entities: Entity[];
  relations: Relation[];
  project: HealthProjectInfo;
  /** `.flowlens/manifest.json`, or null when absent (pre-Phase-8 graphs). */
  manifest: GraphManifest | null;
  /** Per-file change history keyed by project-relative path; null = no git. */
  churn: Map<string, FileChurnData> | null;
  /** `.flowlens/architecture.json`, or null when no rules are defined. */
  architecture: ArchitectureConfig | null;
  /** Current `git rev-parse HEAD`, used for the stale flag. */
  current_git_head?: string | null;
  /** ISO time of the newest file-index entry (fallback for last_indexed). */
  last_indexed_fallback?: string | null;
}

/** MCP resource serving the Markdown health report (wave 2). */
export const HEALTH_RESOURCE_URI = 'flowlens://health';

/** Output formats of `renderHealth` / `flowlens report` (moved from src/health/index.ts, Phase 12 L6). */
export type HealthFormat = 'md' | 'html' | 'json';
