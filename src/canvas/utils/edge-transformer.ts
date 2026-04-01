/**
 * Transforms Relation[] from the graph API into React Flow Edge[].
 *
 * Creates edges at four granularity levels:
 *   1. Entity-level: direct edges when both entity nodes are visible.
 *   2. File-level: aggregated edges between file nodes (deduped).
 *   3. Module-level: aggregated edges between module/subdirectory nodes (deduped).
 *   4. System-level: aggregated edges between directory nodes (deduped).
 *
 * Only edges whose both endpoints exist in the visible node set are created.
 */
import type { Edge } from '@xyflow/react';
import type { Entity, Relation } from '../api/graph-client';

const RELATION_COLORS: Record<string, string> = {
  import: '#6366f1',
  call: '#22c55e',
  extend: '#f59e0b',
  implement: '#3b82f6',
  override: '#a855f7',
  contain: '#94a3b8',
  create: '#ec4899',
  use: '#64748b',
};

const DEFAULT_COLOR = '#94a3b8';

type PairInfo = { count: number; types: Map<string, number> };

/** Increment count for an aggregated edge pair, tracking relation types. */
function accumulatePairCount(
  map: Map<string, PairInfo>,
  key: string,
  relType: string,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.types.set(relType, (existing.types.get(relType) ?? 0) + 1);
  } else {
    const types = new Map<string, number>();
    types.set(relType, 1);
    map.set(key, { count: 1, types });
  }
}

/** Return the relation type with the highest count in the pair. */
function getDominantType(types: Map<string, number>): string {
  let best = '';
  let bestCount = 0;
  for (const [t, c] of types) {
    if (c > bestCount) {
      best = t;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Derive the module path (first two directory segments) from a file path.
 * Returns null if the file is directly inside the top-level dir (no subdirectory).
 */
function getModulePath(filePath: string): string | null {
  const parts = filePath.split('/');
  if (parts.length < 3) return null;
  return parts.slice(0, 2).join('/');
}

/** Emit aggregated edges from a pair-count map. */
function emitAggregatedEdges(
  pairCounts: Map<string, PairInfo>,
  prefix: string,
  strokeWidth: number,
): Edge[] {
  const edges: Edge[] = [];
  for (const [key, info] of pairCounts) {
    const [source, target] = key.split('->');
    const dominantType = getDominantType(info.types);
    edges.push({
      id: `agg-${prefix}:${key}`,
      source,
      target,
      type: 'smoothstep',
      label: info.count > 1 ? `${info.count}` : undefined,
      style: {
        stroke: RELATION_COLORS[dominantType] ?? DEFAULT_COLOR,
        strokeWidth,
      },
      data: { aggregated: true, count: info.count, types: [...info.types.keys()] },
    });
  }
  return edges;
}

export function transformRelationsToEdges(
  relations: Relation[],
  nodeIds: Set<string>,
  entities: Entity[],
): Edge[] {
  const edges: Edge[] = [];
  const filePairCounts = new Map<string, PairInfo>();
  const modulePairCounts = new Map<string, PairInfo>();
  const systemPairCounts = new Map<string, PairInfo>();

  // Build entity -> file and file -> dir lookups
  const entityToFile = new Map<string, string>();
  const fileToDir = new Map<string, string>();
  for (const e of entities) {
    entityToFile.set(e.id, e.file);
    const dir = e.file.split('/')[0] || 'root';
    fileToDir.set(e.file, dir);
  }

  for (const rel of relations) {
    const sourceFile = entityToFile.get(rel.from) ?? rel.location.file;
    const targetFile = entityToFile.get(rel.to);

    // Direct entity-level edge (when both endpoints are visible nodes)
    if (nodeIds.has(rel.from) && nodeIds.has(rel.to)) {
      edges.push({
        id: rel.id,
        source: rel.from,
        target: rel.to,
        type: 'smoothstep',
        label: rel.type,
        style: { stroke: RELATION_COLORS[rel.type] ?? DEFAULT_COLOR },
        data: { relation: rel },
      });
      continue;
    }

    // File-level aggregated edge — collect counts per pair
    const sourceFileId = `file:${sourceFile}`;
    const targetFileId = targetFile ? `file:${targetFile}` : null;
    if (
      targetFileId &&
      nodeIds.has(sourceFileId) &&
      nodeIds.has(targetFileId) &&
      sourceFileId !== targetFileId
    ) {
      const key = `${sourceFileId}->${targetFileId}`;
      accumulatePairCount(filePairCounts, key, rel.type);
      continue;
    }

    // Module-level aggregated edge — collect counts per pair
    const sourceModule = getModulePath(sourceFile);
    const targetModule = targetFile ? getModulePath(targetFile) : null;
    if (sourceModule && targetModule && sourceModule !== targetModule) {
      const sourceModuleId = `module:${sourceModule}`;
      const targetModuleId = `module:${targetModule}`;
      if (nodeIds.has(sourceModuleId) && nodeIds.has(targetModuleId)) {
        const key = `${sourceModuleId}->${targetModuleId}`;
        accumulatePairCount(modulePairCounts, key, rel.type);
        continue;
      }
    }

    // System-level aggregated edge — collect counts per pair
    const sourceDir = fileToDir.get(sourceFile);
    const targetDir = targetFile ? fileToDir.get(targetFile) : null;
    if (sourceDir && targetDir && sourceDir !== targetDir) {
      const sourceSystemId = `system:${sourceDir}`;
      const targetSystemId = `system:${targetDir}`;
      if (nodeIds.has(sourceSystemId) && nodeIds.has(targetSystemId)) {
        const key = `${sourceSystemId}->${targetSystemId}`;
        accumulatePairCount(systemPairCounts, key, rel.type);
      }
    }
  }

  // Emit aggregated edges at each level
  edges.push(...emitAggregatedEdges(filePairCounts, 'file', 2));
  edges.push(...emitAggregatedEdges(modulePairCounts, 'mod', 2.25));
  edges.push(...emitAggregatedEdges(systemPairCounts, 'sys', 2.5));

  return edges;
}
