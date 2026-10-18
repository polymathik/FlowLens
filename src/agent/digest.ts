/**
 * Graph digest: every prompt-independent fact the agent context needs
 * (summary, hotspots, cycles, violations, a compact entity index for prompt
 * matching, and baseline keys). Computed from ONE nodes scan + ONE edges scan
 * (via the memoized graph) and persisted by digest-cache.ts so hooks can answer
 * without opening LevelDB when the graph has not changed.
 */
import type { Entity } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type {
  AgentCycleReference,
  AgentEntityReference,
  AgentHealthHeadline,
  AgentViolationReference,
} from '../contracts/agent.js';
import { detectCycles } from '../analysis/cycle-detector.js';
import { validateArchitecture } from '../analysis/architecture-validator.js';
import { loadAgentArchitecture } from './architecture.js';
import { toCycleReference, toEntityReference, toViolationReference } from './reference.js';
import { compactEntity, compactRelation, type CompactEntity, type CompactRelation } from './digest-codec.js';

export type { CompactEntity, CompactRelation } from './digest-codec.js';
export { expandEntity } from './digest-codec.js';

export const DIGEST_VERSION = 3;
const MAX_DIGEST_ISSUES = 500;
const MAX_DIGEST_VIOLATIONS = 5000;
const MAX_DIGEST_HOTSPOTS = 50;

export interface AgentGraphDigest {
  version: number;
  fingerprint: string;
  computed_at: string;
  summary: { entity_count: number; relation_count: number; languages: Record<string, number> };
  hotspots: AgentEntityReference[];
  cycles: AgentCycleReference[];
  cycle_count: number;
  violations: AgentViolationReference[];
  violation_count: number;
  /** Sorted file lists of every file-level cycle (baseline identity). */
  cycle_keys: string[][];
  violation_ids: string[];
  entities: CompactEntity[];
  /** Every relation, compact — lets the guard analyse without a LevelDB scan. */
  edges: CompactRelation[];
  warnings: string[];
  /** Base-file fingerprint at compute time (see digest-cache.ts). */
  base_fingerprint?: string;
  /** Epoch ms just before the graph was read. */
  read_at?: number;
  /** Files (and `dir/`) the guard re-indexed into this digest → their mtime. */
  accounted?: Record<string, number>;
  /** Health headline computed from the full graph; carried forward by the guard. */
  health?: AgentHealthHeadline | null;
}

export interface GraphIssues {
  cycles: AgentCycleReference[];
  violations: AgentViolationReference[];
  warnings: string[];
}

export interface IssueScope {
  /** Validate layers only on this (sub)graph instead of `graph`. */
  violationsGraph?: GraphStore;
  /** Violations known from a digest for files outside `violationsGraph`. */
  keepViolations?: AgentViolationReference[];
}

/** Cycles + violations; analysis failures become warnings instead of crashing hooks. */
export async function computeGraphIssues(
  graph: GraphStore,
  flowlensDir: string,
  scope: IssueScope = {},
): Promise<GraphIssues> {
  const warnings: string[] = [];
  let cycles: AgentCycleReference[] = [];
  try {
    cycles = (await detectCycles(graph, { granularity: 'file' })).map(toCycleReference);
  } catch (err) {
    warnings.push(`Cycle detection failed (${errorMessage(err)}); cycle checks skipped.`);
  }
  let violations: AgentViolationReference[] = [];
  const { config: architecture, warning } = await loadAgentArchitecture(flowlensDir);
  if (warning) warnings.push(warning);
  if (architecture) {
    try {
      const target = scope.violationsGraph ?? graph;
      const found = (await validateArchitecture(target, architecture)).map(toViolationReference);
      violations = [...(scope.keepViolations ?? []), ...found];
    } catch (err) {
      warnings.push(`Architecture validation failed (${errorMessage(err)}); layer checks skipped.`);
    }
  }
  return { cycles, violations, warnings };
}

export async function computeGraphDigest(
  graph: GraphStore,
  flowlensDir: string,
  precomputed?: GraphIssues,
): Promise<AgentGraphDigest> {
  const [entities, relations] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  const issues = precomputed ?? await computeGraphIssues(graph, flowlensDir);
  return {
    version: DIGEST_VERSION,
    fingerprint: '',
    computed_at: new Date().toISOString(),
    summary: {
      entity_count: entities.length,
      relation_count: relations.length,
      languages: countBy(entities.map((entity) => entity.language)),
    },
    hotspots: topHotspots(entities, MAX_DIGEST_HOTSPOTS),
    cycles: issues.cycles.slice(0, MAX_DIGEST_ISSUES),
    cycle_count: issues.cycles.length,
    violations: issues.violations.slice(0, MAX_DIGEST_VIOLATIONS),
    violation_count: issues.violations.length,
    cycle_keys: issues.cycles.map((cycle) => [...cycle.entities].sort()),
    violation_ids: issues.violations.map((violation) => violation.id),
    entities: entities.map(compactEntity),
    edges: relations.map(compactRelation),
    warnings: issues.warnings,
  };
}

export function topHotspots(entities: Entity[], limit: number): AgentEntityReference[] {
  return entities
    .filter((entity) => (entity.metrics?.hotspot_score ?? 0) > 0)
    .sort((a, b) => (b.metrics?.hotspot_score ?? 0) - (a.metrics?.hotspot_score ?? 0))
    .slice(0, limit)
    .map((entity) => toEntityReference(entity, 'high hotspot score'));
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
