/**
 * Transforms Entity[] from the graph API into React Flow Node[].
 *
 * Flat node strategy (no compound nesting):
 *   1. System nodes — compact boxes, one per top-level directory
 *   2. File nodes — store parentSystem in data (not parentId)
 *   3. Entity nodes — store parentFile in data (not parentId)
 *
 * Each zoom/drill level shows a flat set of appropriately-sized nodes.
 * Drill-down filtering in Canvas.tsx uses data.parentSystem / data.parentFile.
 *
 * Skips parameter, enum_member, and decorator entities (too granular).
 */
import type { Node } from '@xyflow/react';
import type { Entity, EntityKind } from '../api/graph-client';
import type { SystemNodeData } from '../components/nodes/SystemNode';
import type { FileNodeData } from '../components/nodes/FileNode';
import type { EntityNodeData } from '../components/nodes/EntityNode';

/** Annotation shape expected from the API. */
export interface NodeAnnotation {
  id: string;
  text: string;
  category: string;
  author: string;
}

const SKIP_KINDS: Set<EntityKind> = new Set([
  'parameter',
  'enum_member',
  'decorator',
]);

function topDir(filePath: string): string {
  return filePath.split('/')[0] || 'root';
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/** Compute average quality score for a group of entities. */
function avgQuality(entities: Entity[]): number | undefined {
  const scores = entities
    .map((e) => e.metrics?.quality_score)
    .filter((s): s is number => s !== undefined);
  if (scores.length === 0) return undefined;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** Map of entity-id to annotations, built from API data. */
type AnnotationMap = Map<string, NodeAnnotation[]>;

/** All initial positions are (0,0); ELK computes the real layout. */
const ORIGIN = { x: 0, y: 0 };

export function transformEntitiesToNodes(
  entities: Entity[],
  annotations?: unknown[],
): Node[] {
  const nodes: Node[] = [];

  // Build annotation lookup keyed by entity id.
  const annMap: AnnotationMap = new Map();
  if (annotations) {
    for (const ann of annotations) {
      const a = ann as Record<string, unknown>;
      const entityId = a.entity_id as string | undefined;
      if (!entityId) continue;
      if (!annMap.has(entityId)) annMap.set(entityId, []);
      annMap.get(entityId)!.push({
        id: (a.id as string) ?? '',
        text: (a.text as string) ?? '',
        category: (a.category as string) ?? '',
        author: (a.author as string) ?? '',
      });
    }
  }

  // Group entities by top-level directory, filtering out noisy kinds.
  const dirs = new Map<string, Entity[]>();
  for (const e of entities) {
    if (SKIP_KINDS.has(e.kind)) continue;
    const dir = topDir(e.file);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(e);
  }

  // --- System-level nodes (flat, compact) ---
  for (const [dir, dirEntities] of dirs) {
    const systemId = `system:${dir}`;

    const systemData: SystemNodeData = {
      label: dir,
      entityCount: dirEntities.length,
      qualityScore: avgQuality(dirEntities),
    };
    nodes.push({
      id: systemId,
      type: 'system',
      position: ORIGIN,
      data: systemData,
      style: { width: 180, height: 60 },
    });

    // Group non-file entities by their file path.
    const files = new Map<string, Entity[]>();
    for (const e of dirEntities) {
      if (e.kind === 'file') continue;
      if (!files.has(e.file)) files.set(e.file, []);
      files.get(e.file)!.push(e);
    }

    // --- File-level nodes (flat, parent ref in data) ---
    for (const [filePath, fileEntities] of files) {
      const fileId = `file:${filePath}`;

      const fileData: FileNodeData = {
        label: fileName(filePath),
        entityCount: fileEntities.length,
        filePath,
        qualityScore: avgQuality(fileEntities),
        parentSystem: systemId,
      };
      nodes.push({
        id: fileId,
        type: 'file',
        position: ORIGIN,
        data: fileData,
        style: { width: 160, height: 50 },
      });

      // --- Entity-level nodes (flat, parent ref in data) ---
      for (const entity of fileEntities) {

        const entityData: EntityNodeData = {
          label: entity.name,
          kind: entity.kind,
          qualityScore: entity.metrics?.quality_score,
          cognitiveComplexity: entity.metrics?.cognitive_complexity,
          visibility: entity.visibility,
          annotations: annMap.get(entity.id),
          parentFile: fileId,
        };
        nodes.push({
          id: entity.id,
          type: 'entity',
          position: ORIGIN,
          data: entityData,
          style: { width: 150, height: 40 },
        });
      }
    }
  }

  return nodes;
}
