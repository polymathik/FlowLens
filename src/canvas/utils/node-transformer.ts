/**
 * Transforms Entity[] from the graph API into React Flow Node[].
 *
 * Hierarchy strategy (compound nodes):
 *   1. System nodes (top-level directories) — no parentId
 *   2. File nodes — parentId points to system node
 *   3. Entity nodes — parentId points to file node
 *
 * Parent nodes are always emitted BEFORE their children (React Flow requirement).
 * Child positions are RELATIVE to parent. Parent nodes are sized dynamically.
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

/** Container padding for compound nodes. */
const CONTAINER_PAD = 40;
/** Spacing between child nodes inside a container. */
const CHILD_GAP_X = 200;
const CHILD_GAP_Y = 60;
/** Min container dimensions. */
const MIN_CONTAINER_W = 300;
const MIN_CONTAINER_H = 200;

/** Size a parent node to fit its children count. */
function containerSize(childCount: number): { width: number; height: number } {
  return {
    width: Math.max(MIN_CONTAINER_W, childCount * 80),
    height: Math.max(MIN_CONTAINER_H, childCount * 60),
  };
}

/** Map of entity-id to annotations, built from API data. */
type AnnotationMap = Map<string, NodeAnnotation[]>;

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

  let systemX = 0;

  for (const [dir, dirEntities] of dirs) {
    const systemId = `system:${dir}`;

    // Group non-file entities by their file path.
    const files = new Map<string, Entity[]>();
    for (const e of dirEntities) {
      if (e.kind === 'file') continue;
      if (!files.has(e.file)) files.set(e.file, []);
      files.get(e.file)!.push(e);
    }

    // Pre-calculate system container size based on file children count.
    const fileCount = files.size;
    const systemSize = containerSize(fileCount);

    // --- System-level node (container) ---
    const systemData: SystemNodeData = {
      label: dir,
      entityCount: dirEntities.length,
      qualityScore: avgQuality(dirEntities),
    };
    nodes.push({
      id: systemId,
      type: 'system',
      position: { x: systemX, y: 0 },
      data: systemData,
      style: {
        width: systemSize.width,
        height: systemSize.height,
        padding: CONTAINER_PAD,
      },
    });

    // --- File-level nodes (children of system) ---
    let fileX = 20;
    let fileY = 50;
    for (const [filePath, fileEntities] of files) {
      const fileId = `file:${filePath}`;
      const entityCount = fileEntities.length;
      const fileSize = containerSize(entityCount);

      const fileData: FileNodeData = {
        label: fileName(filePath),
        entityCount,
        filePath,
        qualityScore: avgQuality(fileEntities),
      };
      nodes.push({
        id: fileId,
        type: 'file',
        parentId: systemId,
        extent: 'parent' as const,
        position: { x: fileX, y: fileY },
        data: fileData,
        style: {
          width: fileSize.width,
          height: fileSize.height,
          padding: CONTAINER_PAD,
        },
      });

      // --- Entity-level nodes (children of file) ---
      let entX = 10;
      let entY = 30;
      for (const entity of fileEntities) {
        const entityData: EntityNodeData = {
          label: entity.name,
          kind: entity.kind,
          qualityScore: entity.metrics?.quality_score,
          cognitiveComplexity: entity.metrics?.cognitive_complexity,
          visibility: entity.visibility,
          annotations: annMap.get(entity.id),
        };
        nodes.push({
          id: entity.id,
          type: 'entity',
          parentId: fileId,
          extent: 'parent' as const,
          position: { x: entX, y: entY },
          data: entityData,
          style: { width: 160, height: 40 },
        });
        entY += CHILD_GAP_Y;
      }

      fileY += fileSize.height + 20;
    }

    systemX += systemSize.width + CHILD_GAP_X;
  }

  return nodes;
}
