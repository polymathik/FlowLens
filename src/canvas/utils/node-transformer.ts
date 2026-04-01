/**
 * Transforms Entity[] from the graph API into React Flow Node[].
 *
 * Flat node strategy (no compound nesting) with 4 hierarchy levels:
 *   1. System nodes — top-level directories (src, test) and root files
 *   2. Module nodes — subdirectories within a system (src/parser, src/graph, etc.)
 *   3. File nodes — individual files within a module
 *   4. Entity nodes — classes/functions within a file
 *
 * Each zoom/drill level shows a flat set of appropriately-sized nodes.
 * Drill-down filtering in Canvas.tsx uses parent references stored in node data:
 *   data.parentSystem (module/file nodes) and data.parentModule (file nodes)
 *   and data.parentFile (entity nodes).
 *
 * Skips parameter, enum_member, and decorator entities (too granular).
 */
import type { Node } from '@xyflow/react';
import type { Entity, EntityKind } from '../api/graph-client';
import type { SystemNodeData } from '../components/nodes/SystemNode';
import type { ModuleNodeData } from '../components/nodes/ModuleNode';
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

/** Extract the top-level directory from a file path, or 'root' for bare files. */
function topDir(filePath: string): string {
  return filePath.split('/')[0] || 'root';
}

/** Extract just the filename from a path. */
function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Derive the module path (first two directory segments) from a file path.
 * Returns null if the file is directly inside the top-level dir (no subdirectory).
 *
 * Examples:
 *   'src/parser/ast-grep-parser.ts'      → 'src/parser'
 *   'src/parser/extractors/foo.ts'        → 'src/parser'
 *   'src/index.ts'                        → null  (no subdirectory)
 *   'package.json'                        → null  (root file)
 */
function getModulePath(filePath: string): string | null {
  const parts = filePath.split('/');
  // Need at least dir/subdir/file.ts for a module level
  if (parts.length < 3) return null;
  // Module = first two segments: src/parser, src/graph, test/unit, etc.
  return parts.slice(0, 2).join('/');
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

/** Build the annotation lookup map from raw API annotation data. */
function buildAnnotationMap(annotations?: unknown[]): AnnotationMap {
  const annMap: AnnotationMap = new Map();
  if (!annotations) return annMap;
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
  return annMap;
}

/** Create system-level nodes from grouped entities. */
function createSystemNodes(
  dirs: Map<string, Entity[]>,
): Node[] {
  const nodes: Node[] = [];
  for (const [dir, dirEntities] of dirs) {
    const systemData: SystemNodeData = {
      label: dir,
      entityCount: dirEntities.length,
      qualityScore: avgQuality(dirEntities),
    };
    nodes.push({
      id: `system:${dir}`,
      type: 'system',
      position: ORIGIN,
      data: systemData,
      style: { width: 180, height: 60 },
    });
  }
  return nodes;
}

/** Create module-level nodes by grouping entities by subdirectory. */
function createModuleNodes(
  dirs: Map<string, Entity[]>,
): { nodes: Node[]; moduleEntities: Map<string, Entity[]> } {
  const nodes: Node[] = [];
  const moduleEntities = new Map<string, Entity[]>();

  for (const [dir, dirEntities] of dirs) {
    const systemId = `system:${dir}`;
    // Group non-file entities by their module path
    const modules = new Map<string, Entity[]>();
    for (const e of dirEntities) {
      if (e.kind === 'file') continue;
      const modulePath = getModulePath(e.file);
      if (!modulePath) continue;
      if (!modules.has(modulePath)) modules.set(modulePath, []);
      modules.get(modulePath)!.push(e);
    }

    for (const [modPath, modEntities] of modules) {
      const moduleLabel = modPath.split('/').pop() || modPath;
      const moduleData: ModuleNodeData = {
        label: moduleLabel,
        entityCount: modEntities.length,
        qualityScore: avgQuality(modEntities),
        parentSystem: systemId,
      };
      const moduleId = `module:${modPath}`;
      nodes.push({
        id: moduleId,
        type: 'module',
        position: ORIGIN,
        data: moduleData,
        style: { width: 180, height: 60 },
      });
      moduleEntities.set(modPath, modEntities);
    }
  }
  return { nodes, moduleEntities };
}

/** Create file-level and entity-level nodes. */
function createFileAndEntityNodes(
  dirs: Map<string, Entity[]>,
  annMap: AnnotationMap,
): Node[] {
  const nodes: Node[] = [];

  for (const [dir, dirEntities] of dirs) {
    const systemId = `system:${dir}`;

    // Group non-file entities by their file path
    const files = new Map<string, Entity[]>();
    for (const e of dirEntities) {
      if (e.kind === 'file') continue;
      if (!files.has(e.file)) files.set(e.file, []);
      files.get(e.file)!.push(e);
    }

    for (const [filePath, fileEntities] of files) {
      const fileId = `file:${filePath}`;
      const modulePath = getModulePath(filePath);
      const parentModule = modulePath ? `module:${modulePath}` : undefined;

      const fileData: FileNodeData = {
        label: fileName(filePath),
        entityCount: fileEntities.length,
        filePath,
        qualityScore: avgQuality(fileEntities),
        parentSystem: systemId,
        parentModule,
      };
      nodes.push({
        id: fileId,
        type: 'file',
        position: ORIGIN,
        data: fileData,
        style: { width: 160, height: 50 },
      });

      // Entity-level nodes
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

export function transformEntitiesToNodes(
  entities: Entity[],
  annotations?: unknown[],
): Node[] {
  const annMap = buildAnnotationMap(annotations);

  // Group entities by top-level directory, filtering out noisy kinds.
  const dirs = new Map<string, Entity[]>();
  for (const e of entities) {
    if (SKIP_KINDS.has(e.kind)) continue;
    const dir = topDir(e.file);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(e);
  }

  // Build all four levels of nodes
  const systemNodes = createSystemNodes(dirs);
  const { nodes: moduleNodes } = createModuleNodes(dirs);
  const fileAndEntityNodes = createFileAndEntityNodes(dirs, annMap);

  return [...systemNodes, ...moduleNodes, ...fileAndEntityNodes];
}
