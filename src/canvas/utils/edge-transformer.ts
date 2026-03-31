/**
 * Transforms Relation[] from the graph API into React Flow Edge[].
 *
 * Only creates edges between nodes that exist in the rendered graph.
 * Colors edges by relation type and animates import edges.
 */
import type { Edge } from '@xyflow/react';
import type { Relation } from '../api/graph-client';

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
): Edge[] {
  const edges: Edge[] = [];

  for (const rel of relations) {
    // Map entity IDs to our node IDs (file-level for the initial view).
    const sourceFile = `file:${rel.location.file}`;

    // Only include edges whose endpoints exist as rendered nodes.
    if (!nodeIds.has(rel.from) && !nodeIds.has(sourceFile)) continue;

    edges.push({
      id: rel.id,
      source: rel.from,
      target: rel.to,
      label: rel.type,
      style: { stroke: RELATION_COLORS[rel.type] ?? DEFAULT_COLOR },
      animated: rel.type === 'import',
      data: { relation: rel },
    });
  }

  return edges;
}
