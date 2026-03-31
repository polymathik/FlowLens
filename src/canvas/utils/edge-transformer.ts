/**
 * Transforms Relation[] from the graph API into React Flow Edge[].
 *
 * Creates edges at three granularity levels:
 *   1. Entity-level: direct edges when both entity nodes are visible.
 *   2. File-level: aggregated edges between file nodes (deduped).
 *   3. System-level: aggregated edges between directory nodes (deduped).
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

export function transformRelationsToEdges(
  relations: Relation[],
  nodeIds: Set<string>,
  entities: Entity[],
): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>(); // dedup aggregated edges

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
        type: 'relation',
        style: { stroke: RELATION_COLORS[rel.type] ?? DEFAULT_COLOR },
        data: { relation: rel },
      });
      continue;
    }

    // File-level aggregated edge
    const sourceFileId = `file:${sourceFile}`;
    const targetFileId = targetFile ? `file:${targetFile}` : null;
    if (
      targetFileId &&
      nodeIds.has(sourceFileId) &&
      nodeIds.has(targetFileId) &&
      sourceFileId !== targetFileId
    ) {
      const key = `${sourceFileId}->${targetFileId}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          id: `agg-file:${key}`,
          source: sourceFileId,
          target: targetFileId,
          type: 'relation',
          style: {
            stroke: RELATION_COLORS[rel.type] ?? DEFAULT_COLOR,
            strokeWidth: 2,
          },
          data: { relation: rel, aggregated: true },
        });
      }
      continue;
    }

    // System-level aggregated edge
    const sourceDir = fileToDir.get(sourceFile);
    const targetDir = targetFile ? fileToDir.get(targetFile) : null;
    if (sourceDir && targetDir && sourceDir !== targetDir) {
      const sourceSystemId = `system:${sourceDir}`;
      const targetSystemId = `system:${targetDir}`;
      if (nodeIds.has(sourceSystemId) && nodeIds.has(targetSystemId)) {
        const key = `${sourceSystemId}->${targetSystemId}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({
            id: `agg-sys:${key}`,
            source: sourceSystemId,
            target: targetSystemId,
            type: 'relation',
            style: {
              stroke: RELATION_COLORS[rel.type] ?? DEFAULT_COLOR,
              strokeWidth: 2.5,
            },
            label: rel.type,
            data: { relation: rel, aggregated: true },
          });
        }
      }
    }
  }

  return edges;
}
