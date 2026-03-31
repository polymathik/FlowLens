/**
 * Transforms Entity[] from the graph API into React Flow Node[].
 *
 * Hierarchy strategy:
 *   1. Group by top-level directory -> system nodes
 *   2. Group by file path -> file nodes
 *   3. Individual entities -> entity nodes (children of file nodes)
 *
 * Skips parameter, enum_member, and decorator entities (too granular for the initial view).
 */
import type { Node } from '@xyflow/react';
import type { Entity, EntityKind } from '../api/graph-client';
import type { SystemNodeData } from '../components/nodes/SystemNode';
import type { FileNodeData } from '../components/nodes/FileNode';
import type { EntityNodeData } from '../components/nodes/EntityNode';

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

export function transformEntitiesToNodes(entities: Entity[]): Node[] {
  const nodes: Node[] = [];

  // Group entities by top-level directory, filtering out noisy kinds.
  const dirs = new Map<string, Entity[]>();
  for (const e of entities) {
    if (SKIP_KINDS.has(e.kind)) continue;
    const dir = topDir(e.file);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(e);
  }

  let xOffset = 0;

  for (const [dir, dirEntities] of dirs) {
    // --- System-level node ---
    const systemData: SystemNodeData = {
      label: dir,
      entityCount: dirEntities.length,
      qualityScore: avgQuality(dirEntities),
    };
    nodes.push({
      id: `system:${dir}`,
      type: 'system',
      position: { x: xOffset, y: 0 },
      data: systemData,
      style: { width: 200, height: 60 },
    });

    // Group non-file entities by their file path.
    const files = new Map<string, Entity[]>();
    for (const e of dirEntities) {
      if (e.kind === 'file') continue;
      if (!files.has(e.file)) files.set(e.file, []);
      files.get(e.file)!.push(e);
    }

    let yOffset = 100;
    for (const [filePath, fileEntities] of files) {
      const fileData: FileNodeData = {
        label: fileName(filePath),
        entityCount: fileEntities.length,
        filePath,
        qualityScore: avgQuality(fileEntities),
      };
      nodes.push({
        id: `file:${filePath}`,
        type: 'file',
        position: { x: xOffset, y: yOffset },
        data: fileData,
        style: { width: 180, height: 50 },
      });

      // --- Entity-level nodes ---
      let entityY = yOffset + 70;
      for (const entity of fileEntities) {
        const entityData: EntityNodeData = {
          label: entity.name,
          kind: entity.kind,
          qualityScore: entity.metrics?.quality_score,
          cognitiveComplexity: entity.metrics?.cognitive_complexity,
          visibility: entity.visibility,
        };
        nodes.push({
          id: entity.id,
          type: 'entity',
          position: { x: xOffset, y: entityY },
          data: entityData,
          style: { width: 160, height: 40 },
        });
        entityY += 55;
      }

      yOffset = entityY + 20;
    }

    xOffset += 300;
  }

  return nodes;
}
