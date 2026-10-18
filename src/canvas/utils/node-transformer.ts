/**
 * Transforms Entity[] from the graph API into React Flow Node[].
 *
 * Flat node strategy (no compound nesting) with 4 hierarchy levels:
 *   1. System nodes — top-level directories (src, test) and root files
 *   2. Module nodes — second-level directories (src/parser, src/graph, …)
 *   3. File nodes — individual files
 *   4. Entity nodes — classes/functions within a file ("symbols" in the UI)
 *
 * Drill-down filtering (`visible-nodes.ts`) uses the parent references in
 * node data (contract: `src/contracts/canvas/data.ts`).
 *
 * Container metrics: quality = mean over contained symbols; churn and
 * hotspot = max over contained symbols (so a single hot file lights up its
 * module and system).
 */
import type { Node } from '@xyflow/react';
import type { Entity, EntityKind } from '../../contracts/entities.js';
import type {
  CanvasAnnotation,
  EntityNodeData,
  FileNodeData,
  ModuleNodeData,
  SystemNodeData,
} from '../../contracts/canvas/index.js';
import { ancestryForFile, fileName, getModulePath, topDir } from './hierarchy';

export const SKIP_KINDS: ReadonlySet<EntityKind> = new Set([
  'parameter',
  'enum_member',
  'decorator',
]);

/** Node box sizes used for layout before React Flow has measured them. */
export const NODE_SIZES = {
  system: { width: 190, height: 64 },
  module: { width: 180, height: 60 },
  file: { width: 170, height: 52 },
  entity: { width: 160, height: 44 },
} as const;

type AnnotationMap = Map<string, CanvasAnnotation[]>;

const ORIGIN = { x: 0, y: 0 };

interface Aggregate {
  qualityScore?: number;
  churnRate?: number;
  hotspotScore?: number;
}

/** Aggregate container metrics over a group of entities. */
export function aggregateMetrics(entities: Entity[]): Aggregate {
  let qSum = 0;
  let qCount = 0;
  let churn: number | undefined;
  let hotspot: number | undefined;
  for (const e of entities) {
    const m = e.metrics;
    if (!m) continue;
    if (m.quality_score !== undefined) {
      qSum += m.quality_score;
      qCount++;
    }
    if (m.churn_rate !== undefined) churn = Math.max(churn ?? 0, m.churn_rate);
    if (m.hotspot_score !== undefined) hotspot = Math.max(hotspot ?? 0, m.hotspot_score);
  }
  return {
    qualityScore: qCount > 0 ? Math.round(qSum / qCount) : undefined,
    churnRate: churn,
    hotspotScore: hotspot,
  };
}

/** Build the annotation lookup map from raw API annotation data. */
export function buildAnnotationMap(annotations?: unknown[]): AnnotationMap {
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

function groupBy<K>(items: Entity[], key: (e: Entity) => K | null): Map<K, Entity[]> {
  const map = new Map<K, Entity[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function sized(level: keyof typeof NODE_SIZES) {
  return { ...NODE_SIZES[level] };
}

export function transformEntitiesToNodes(
  entities: Entity[],
  annotations?: unknown[],
): Node[] {
  const annMap = buildAnnotationMap(annotations);
  // Symbols that become nodes (file/module pseudo-entities are containers).
  const symbols = entities.filter(
    (e) => !SKIP_KINDS.has(e.kind) && e.kind !== 'file' && e.kind !== 'module' && e.file,
  );
  const nodes: Node[] = [];

  for (const [dir, group] of groupBy(symbols, (e) => topDir(e.file))) {
    const data: SystemNodeData = {
      level: 'system',
      label: dir,
      path: dir,
      entityCount: group.length,
      ...aggregateMetrics(group),
    };
    nodes.push({ id: `system:${dir}`, type: 'system', position: ORIGIN, data, style: sized('system') });
  }

  for (const [modPath, group] of groupBy(symbols, (e) => getModulePath(e.file))) {
    const data: ModuleNodeData = {
      level: 'module',
      label: modPath.split('/').pop() || modPath,
      path: modPath,
      entityCount: group.length,
      parentSystem: `system:${topDir(modPath)}`,
      ...aggregateMetrics(group),
    };
    nodes.push({ id: `module:${modPath}`, type: 'module', position: ORIGIN, data, style: sized('module') });
  }

  for (const [filePath, group] of groupBy(symbols, (e) => e.file)) {
    const a = ancestryForFile(filePath);
    const fileData: FileNodeData = {
      level: 'file',
      label: fileName(filePath),
      filePath,
      entityCount: group.length,
      parentSystem: a.systemId,
      parentModule: a.moduleId,
      ...aggregateMetrics(group),
    };
    nodes.push({ id: a.fileId, type: 'file', position: ORIGIN, data: fileData, style: sized('file') });

    for (const entity of group) {
      const m = entity.metrics;
      const data: EntityNodeData = {
        level: 'entity',
        label: entity.name,
        entityKind: entity.kind,
        visibility: entity.visibility,
        filePath,
        qualityScore: m?.quality_score,
        cognitiveComplexity: m?.cognitive_complexity,
        churnRate: m?.churn_rate,
        hotspotScore: m?.hotspot_score,
        annotations: annMap.get(entity.id),
        parentFile: a.fileId,
        parentSystem: a.systemId,
        parentModule: a.moduleId,
      };
      nodes.push({ id: entity.id, type: 'entity', position: ORIGIN, data, style: sized('entity') });
    }
  }

  return nodes;
}
