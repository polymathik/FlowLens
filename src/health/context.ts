/**
 * HealthContext — precomputed, read-only indexes over one graph that every
 * rule shares (file dependency graph, dependents, blast radius, change
 * counts, complexity). Built once per report; pure and deterministic.
 */
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { HealthInput } from '../contracts/health.js';
import { HEALTH_THRESHOLDS, SCORING, type HealthThresholds } from './config.js';
import { MemoryGraphStore } from './memory-store.js';

const FUNCTION_KINDS = new Set(['function', 'method']);

export interface Complexity {
  value: number;
  metric: 'cognitive' | 'cyclomatic';
  warn: number;
  high: number;
  critical: number;
}

export interface DepSite {
  line: number;
  type: Relation['type'];
}

export interface HealthContext {
  input: HealthInput;
  thresholds: HealthThresholds;
  store: MemoryGraphStore;
  canvasBaseUrl?: string;
  /** All indexed files, sorted. */
  files: string[];
  entityById: Map<string, Entity>;
  entitiesByFile: Map<string, Entity[]>;
  /** file → files it depends on (cross-file, resolved, non-containment). */
  fileDeps: Map<string, Set<string>>;
  /** file → files that depend on it directly. */
  fileDependents: Map<string, Set<string>>;
  /** `${from}->${to}` → first place the dependency appears. */
  depSites: Map<string, DepSite>;
  hasGit: boolean;
  /** Relations whose target entity is not in the graph. */
  danglingRelations: Relation[];
  lineCount(file: string): number;
  /** Files relying on `file` directly or indirectly. */
  blast(file: string): number;
  /** Penalty multiplier in [1, 2], grows with blast radius. */
  impact(file: string): number;
  /** Times the file changed in the history window (0 without git). */
  changes(file: string): number;
  functionsIn(file: string): Entity[];
  complexity(entity: Entity): Complexity | null;
}

export function buildHealthContext(
  input: HealthInput,
  opts: { canvasBaseUrl?: string; thresholds?: HealthThresholds } = {},
): HealthContext {
  const thresholds = opts.thresholds ?? HEALTH_THRESHOLDS;
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  const entitiesByFile = new Map<string, Entity[]>();
  for (const e of [...input.entities].sort(byLocation)) {
    if (e.kind === 'module') continue; // directory nodes, not files
    (entitiesByFile.get(e.file) ?? entitiesByFile.set(e.file, []).get(e.file)!).push(e);
  }
  const files = [...entitiesByFile.keys()].sort();

  const fileDeps = new Map<string, Set<string>>(files.map((f) => [f, new Set()]));
  const fileDependents = new Map<string, Set<string>>(files.map((f) => [f, new Set()]));
  const depSites = new Map<string, DepSite>();
  const danglingRelations: Relation[] = [];

  for (const r of [...input.relations].sort((a, b) => a.id.localeCompare(b.id))) {
    const target = entityById.get(r.to);
    const source = entityById.get(r.from);
    if (!target) {
      danglingRelations.push(r);
      continue;
    }
    if (!source || r.type === 'contain' || source.file === target.file) continue;
    if (!fileDeps.has(source.file) || !fileDeps.has(target.file)) continue;
    fileDeps.get(source.file)!.add(target.file);
    fileDependents.get(target.file)!.add(source.file);
    const key = `${source.file}->${target.file}`;
    const site = { line: r.location.line, type: r.type };
    const prev = depSites.get(key);
    if (!prev || site.line < prev.line) depSites.set(key, site);
  }

  const blastMemo = new Map<string, number>();
  const blast = (file: string): number => {
    const memo = blastMemo.get(file);
    if (memo !== undefined) return memo;
    const seen = new Set<string>([file]);
    const queue = [file];
    while (queue.length > 0) {
      for (const dep of fileDependents.get(queue.pop()!) ?? []) {
        if (!seen.has(dep)) {
          seen.add(dep);
          queue.push(dep);
        }
      }
    }
    blastMemo.set(file, seen.size - 1);
    return seen.size - 1;
  };
  const saturation = Math.max(SCORING.impact_min_saturation, SCORING.impact_share * files.length);

  const churn = input.churn;
  const lineCount = (file: string): number => {
    const ents = entitiesByFile.get(file) ?? [];
    const fileEnt = ents.find((e) => e.kind === 'file');
    if (fileEnt) return fileEnt.metrics?.line_count ?? fileEnt.location.line_end;
    return ents.reduce((m, e) => Math.max(m, e.location.line_end), 0);
  };

  return {
    input,
    thresholds,
    store: new MemoryGraphStore(input.entities, input.relations),
    canvasBaseUrl: opts.canvasBaseUrl,
    files,
    entityById,
    entitiesByFile,
    fileDeps,
    fileDependents,
    depSites,
    hasGit: churn !== null,
    danglingRelations,
    lineCount,
    blast,
    impact: (file) => 1 + Math.min(1, blast(file) / saturation),
    changes: (file) => churn?.get(file)?.change_count ?? 0,
    functionsIn: (file) => (entitiesByFile.get(file) ?? []).filter((e) => FUNCTION_KINDS.has(e.kind)),
    complexity: (entity) => complexityOf(entity, thresholds),
  };
}

/**
 * Cognitive complexity when the parser computed it; otherwise fall back to
 * cyclomatic (several non-TS extractors leave cognitive at 0).
 */
export function complexityOf(entity: Entity, t: HealthThresholds = HEALTH_THRESHOLDS): Complexity | null {
  if (!FUNCTION_KINDS.has(entity.kind)) return null;
  const m = entity.metrics;
  if (m?.cognitive_complexity && m.cognitive_complexity > 0) {
    const c = t.complexity;
    return { value: m.cognitive_complexity, metric: 'cognitive', warn: c.cognitive_warn, high: c.cognitive_high, critical: c.cognitive_critical };
  }
  if (m?.cyclomatic_complexity && m.cyclomatic_complexity > 1) {
    const c = t.complexity;
    return { value: m.cyclomatic_complexity, metric: 'cyclomatic', warn: c.cyclomatic_warn, high: c.cyclomatic_high, critical: c.cyclomatic_critical };
  }
  return null;
}

function byLocation(a: Entity, b: Entity): number {
  return a.file.localeCompare(b.file) || a.location.line_start - b.location.line_start || a.id.localeCompare(b.id);
}
