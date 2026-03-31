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

const SKIP_KINDS: Set<EntityKind> = new Set(['parameter', 'enum_member', 'decorator']);

function topDir(filePath: string): string {
  return filePath.split('/')[0] || 'root';
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
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
    nodes.push({
      id: `system:${dir}`,
      type: 'default',
      position: { x: xOffset, y: 0 },
      data: { label: dir, entityCount: dirEntities.length },
      style: { width: 200, height: 60 },
    });

    // Group non-file entities by their file path.
    const files = new Map<string, Entity[]>();
    for (const e of dirEntities) {
      if (e.kind === 'file') continue; // skip file entities — we use the path itself
      if (!files.has(e.file)) files.set(e.file, []);
      files.get(e.file)!.push(e);
    }

    let yOffset = 100;
    for (const [filePath, fileEntities] of files) {
      nodes.push({
        id: `file:${filePath}`,
        type: 'default',
        position: { x: xOffset, y: yOffset },
        data: {
          label: fileName(filePath),
          entityCount: fileEntities.length,
          filePath,
        },
        style: { width: 180, height: 50, fontSize: 11 },
      });
      yOffset += 80;
    }

    xOffset += 300;
  }

  return nodes;
}
