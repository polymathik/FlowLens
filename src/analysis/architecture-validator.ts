import { Minimatch } from 'minimatch';
import type { GraphStore } from '../contracts/graph.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type {
  ArchitectureConfig,
  ArchitectureLayer,
} from '../contracts/architecture.js';
import type { ArchitectureViolation } from '../contracts/analysis/architecture.js';
import { hashContent } from '../utils/hash.js';

/**
 * Resolve which architecture layer an entity belongs to.
 * First match wins across patterns, files, then entities.
 * Returns null for unassigned entities.
 */
export function resolveLayer(
  entity: Entity,
  config: ArchitectureConfig,
): string | null {
  for (const layer of config.layers) {
    if (matchesLayer(entity, layer)) return layer.name;
  }
  return null;
}

/** Compiled glob cache: compiling a Minimatch per entity dominated layer resolution time. */
const patternCache = new Map<string, Minimatch>();
function compiledPattern(pattern: string): Minimatch {
  let mm = patternCache.get(pattern);
  if (!mm) {
    mm = new Minimatch(pattern);
    patternCache.set(pattern, mm);
  }
  return mm;
}

function matchesFile(file: string, layer: ArchitectureLayer): boolean {
  if (layer.include.patterns) {
    for (const pattern of layer.include.patterns) {
      if (compiledPattern(pattern).match(file)) return true;
    }
  }
  return layer.include.files?.includes(file) ?? false;
}

function matchesEntityRule(entity: Entity, layer: ArchitectureLayer): boolean {
  return layer.include.entities?.some((n) => entity.name === n || entity.qualified_name === n) ?? false;
}

function matchesLayer(entity: Entity, layer: ArchitectureLayer): boolean {
  return matchesFile(entity.file, layer) || matchesEntityRule(entity, layer);
}

/**
 * Build a lookup table: entity id -> layer name (or null for unassigned).
 *
 * Glob matching is done once per distinct file path (not per entity); only
 * layers with explicit `include.entities` rules are checked per entity, and
 * only those ordered before the file's first matching layer (first match wins).
 */
export function buildLayerMap(
  entities: Entity[],
  config: ArchitectureConfig,
): Map<string, string | null> {
  const layers = config.layers;
  const entityRuleIdx = layers.flatMap((l, i) => (l.include.entities?.length ? [i] : []));
  const firstFileLayer = new Map<string, number>(); // file -> index, or layers.length if none
  const map = new Map<string, string | null>();
  for (const entity of entities) {
    let fi = firstFileLayer.get(entity.file);
    if (fi === undefined) {
      fi = layers.findIndex((l) => matchesFile(entity.file, l));
      if (fi < 0) fi = layers.length;
      firstFileLayer.set(entity.file, fi);
    }
    let idx = fi;
    for (const i of entityRuleIdx) {
      if (i >= idx) break;
      if (matchesEntityRule(entity, layers[i])) { idx = i; break; }
    }
    map.set(entity.id, idx < layers.length ? layers[idx].name : null);
  }
  return map;
}

/**
 * Find the layer definition by name.
 */
function findLayerDef(
  config: ArchitectureConfig,
  layerName: string,
): ArchitectureLayer | undefined {
  return config.layers.find((l) => l.name === layerName);
}

/**
 * Generate an auto-fix suggestion based on the violation type.
 */
function generateAutoFix(
  rule: 'may_only_access' | 'must_not_access',
  sourceLayer: ArchitectureLayer,
  targetLayerName: string,
): string {
  if (rule === 'may_only_access') {
    const allowed = sourceLayer.may_only_access ?? [];
    const allowedList = allowed.length > 0 ? allowed.join(', ') : 'none';
    return `Route dependency through [${allowedList}] instead of accessing ${targetLayerName} directly`;
  }
  return 'Move shared code to a common layer, or create an interface in an intermediate layer';
}

/**
 * Generate a deterministic violation ID from its key properties.
 */
function violationId(
  entityFrom: string,
  entityTo: string,
  rule: string,
): string {
  return hashContent(`violation:${entityFrom}:${entityTo}:${rule}`);
}

/**
 * Validate the graph against architecture layer rules.
 * Returns a list of violations where edges cross layer boundaries
 * in ways prohibited by may_only_access / must_not_access rules.
 */
export async function validateArchitecture(
  graph: GraphStore,
  config: ArchitectureConfig,
): Promise<ArchitectureViolation[]> {
  const [entities, edges] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  return validateArchitectureData(entities, edges, config);
}

/**
 * Pure variant over already-loaded data (used with the MCP graph cache).
 * `layerMap` may be supplied to reuse a precomputed entity -> layer assignment.
 */
export function validateArchitectureData(
  entities: Entity[],
  edges: Relation[],
  config: ArchitectureConfig,
  layerMap: Map<string, string | null> = buildLayerMap(entities, config),
): ArchitectureViolation[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const violations: ArchitectureViolation[] = [];

  for (const edge of edges) {
    const sourceLayer = layerMap.get(edge.from);
    const targetLayer = layerMap.get(edge.to);

    // Skip if either entity is unassigned, or the edge stays within a layer
    if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) continue;

    const sourceDef = findLayerDef(config, sourceLayer);
    if (!sourceDef) continue;

    const broken: Array<'may_only_access' | 'must_not_access'> = [];
    if (sourceDef.may_only_access && !sourceDef.may_only_access.includes(targetLayer)) {
      broken.push('may_only_access');
    }
    if (sourceDef.must_not_access?.includes(targetLayer)) broken.push('must_not_access');

    for (const rule of broken) {
      violations.push({
        id: violationId(edge.from, edge.to, rule),
        rule,
        layer_from: sourceLayer,
        layer_to: targetLayer,
        entity_from: edge.from,
        entity_to: edge.to,
        relation_type: edge.type,
        location: edge.location,
        auto_fix_suggestion: generateAutoFix(rule, sourceDef, targetLayer),
        rule_text: ruleText(rule, sourceDef, targetLayer),
        entity_from_name: byId.get(edge.from)?.qualified_name ?? edge.from,
        entity_to_name: byId.get(edge.to)?.qualified_name ?? edge.to,
      });
    }
  }

  return violations;
}

/** Full human-readable statement of the broken rule. */
function ruleText(
  rule: 'may_only_access' | 'must_not_access',
  sourceLayer: ArchitectureLayer,
  targetLayerName: string,
): string {
  if (rule === 'may_only_access') {
    const allowed = sourceLayer.may_only_access ?? [];
    const list = allowed.length > 0 ? allowed.map((l) => `'${l}'`).join(', ') : 'no other layer';
    return `Layer '${sourceLayer.name}' may only access ${list}, but accesses '${targetLayerName}'`;
  }
  return `Layer '${sourceLayer.name}' must not access '${targetLayerName}'`;
}
