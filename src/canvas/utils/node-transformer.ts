/**
 * Turns a `MapView` (the open container's children, scope node and portals)
 * into React Flow nodes. Only the visible level is ever materialised — the
 * hierarchy itself carries the rest — so a repository of any size renders
 * one container at a time.
 *
 * Every node gets explicit `width`/`height` (React Flow v12 treats them as
 * the node's dimensions before measurement), which is what makes layout and
 * fit-to-view deterministic.
 */
import type { Node } from '@xyflow/react';
import type { Entity } from '../../contracts/entities.js';
import type { Hierarchy, HierarchyNode } from '../../contracts/hierarchy.js';
import type {
  CanvasAnnotation,
  CanvasNodeType,
  ConfigNodeData,
  EntityNodeData,
  FileNodeData,
  FolderNodeData,
  MapView,
  PortalNodeData,
  PortalSpec,
  ScopeNodeData,
} from '../../contracts/canvas/index.js';

/** Node box sizes (px). Cards that list top files are taller. */
export const NODE_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  package: { width: 244, height: 112 },
  folder: { width: 244, height: 112 },
  config: { width: 204, height: 58 },
  file: { width: 214, height: 60 },
  entity: { width: 200, height: 52 },
  scope: { width: 200, height: 46 },
  portal: { width: 256, height: 62 },
};

const ORIGIN = { x: 0, y: 0 };
type AnnotationMap = Map<string, CanvasAnnotation[]>;

/** Build the annotation lookup map from raw API annotation data. */
export function buildAnnotationMap(annotations?: unknown[]): AnnotationMap {
  const annMap: AnnotationMap = new Map();
  for (const ann of annotations ?? []) {
    const a = ann as Record<string, unknown>;
    const entityId = a.entity_id as string | undefined;
    if (!entityId) continue;
    const list = annMap.get(entityId) ?? [];
    list.push({ id: (a.id as string) ?? '', text: (a.text as string) ?? '', category: (a.category as string) ?? '', author: (a.author as string) ?? '' });
    annMap.set(entityId, list);
  }
  return annMap;
}

function node(id: string, type: CanvasNodeType, data: Node['data']): Node {
  const size = NODE_SIZES[type];
  return { id, type, position: ORIGIN, data, width: size.width, height: size.height, style: { ...size } };
}

function metrics(n: HierarchyNode) {
  return { qualityScore: n.stats.quality, churnRate: n.stats.churn, hotspotScore: n.stats.hotspot };
}

function containerFacts(h: Hierarchy, n: HierarchyNode) {
  const kids = n.childIds.map((c) => h.nodes.get(c)!);
  return {
    hierarchyId: n.id,
    path: n.path,
    folderCount: kids.filter((k) => k.kind === 'folder' || k.kind === 'package').length,
    fileCount: kids.filter((k) => k.kind === 'file').length,
    symbolCount: n.stats.symbols,
    topFiles: (n.topFiles ?? []).map((id) => h.nodes.get(id)?.name ?? id),
  };
}

export interface NodeContext {
  hierarchy: Hierarchy;
  entityById: Map<string, Entity>;
  annotations: AnnotationMap;
}

export function hierarchyNodeToFlow(ctx: NodeContext, n: HierarchyNode): Node | null {
  const { hierarchy: h } = ctx;
  switch (n.kind) {
    case 'package':
    case 'folder': {
      const data: FolderNodeData = {
        level: n.kind,
        label: n.name,
        ...containerFacts(h, n),
        packageName: n.kind === 'package' && n.name !== n.path.split('/').pop() ? n.name : undefined,
        ...metrics(n),
      };
      return node(n.id, n.kind, data);
    }
    case 'config': {
      const data: ConfigNodeData = { level: 'config', label: 'Config', ...containerFacts(h, n) };
      return node(n.id, 'config', data);
    }
    case 'file': {
      const data: FileNodeData = {
        level: 'file',
        label: n.name,
        hierarchyId: n.id,
        filePath: n.path,
        symbolCount: n.stats.symbols,
        role: n.role,
        language: n.language,
        lines: n.stats.lines || undefined,
        ...metrics(n),
      };
      return node(n.id, 'file', data);
    }
    case 'symbol': {
      const e = ctx.entityById.get(n.id);
      const m = e?.metrics;
      const data: EntityNodeData = {
        level: 'entity',
        label: n.name,
        hierarchyId: n.id,
        entityKind: n.symbolKind!,
        visibility: e?.visibility ?? 'public',
        filePath: n.path,
        memberCount: n.childIds.length,
        qualityScore: m?.quality_score,
        cognitiveComplexity: m?.cognitive_complexity,
        churnRate: m?.churn_rate,
        hotspotScore: m?.hotspot_score,
        annotations: ctx.annotations.get(n.id),
      };
      return node(n.id, 'entity', data);
    }
    default:
      return null;
  }
}

function portalNode(p: PortalSpec): Node {
  const data: PortalNodeData = {
    level: 'portal',
    label: p.label,
    direction: p.direction,
    targetId: p.targetId,
    targetKind: p.targetKind,
    count: p.count,
    typeCounts: p.typeCounts,
  };
  return node(p.id, 'portal', data);
}

/** Flow nodes of a view: children (or the leaf itself), the scope node, then portals. */
export function buildViewNodes(ctx: NodeContext, view: MapView): Node[] {
  const out: Node[] = [];
  for (const id of view.nodeIds) {
    if (view.scopeId && id === view.scopeId) {
      const container = ctx.hierarchy.nodes.get(view.containerId)!;
      const data: ScopeNodeData = { level: 'scope', label: `${container.name} (file scope)`, hierarchyId: container.id, filePath: container.path };
      out.push(node(id, 'scope', data));
      continue;
    }
    const h = ctx.hierarchy.nodes.get(id);
    const flow = h && hierarchyNodeToFlow(ctx, h);
    if (flow) out.push(flow);
  }
  for (const p of view.portals) out.push(portalNode(p));
  return out;
}
