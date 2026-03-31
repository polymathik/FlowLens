/**
 * Overlay logic — modifies node styles based on the active overlay type.
 *
 * This is a pure function (not a React component). It takes the current
 * node array and overlay mode and returns nodes with adjusted styles.
 *
 * Supported overlays:
 * - complexity-heatmap: quality-score traffic light
 * - churn-heatmap: blue-to-red churn gradient
 * - hotspot: node scaling by hotspot score
 * - cycles: dashed red border for cycle members
 * - architecture-violations: red border for violating entities
 * - interface-diff: colored border by change type
 */
import type { Node } from '@xyflow/react';
import { qualityColor, churnColor, hotspotSize } from '../../utils/color-scales';

export interface DiffChange {
  entity_id: string;
  change_type: string;
}

export interface OverlayExtraData {
  cycles?: Array<{ entities?: string[] }>;
  violations?: Array<{ entity_from?: string; entity_to?: string }>;
  diffChanges?: DiffChange[];
}

export function applyOverlay(
  nodes: Node[],
  overlay: string | null,
  extraData?: OverlayExtraData,
): Node[] {
  if (!overlay) return nodes;

  switch (overlay) {
    case 'complexity-heatmap':
      return applyComplexityHeatmap(nodes);

    case 'churn-heatmap':
      return applyChurnHeatmap(nodes);

    case 'hotspot':
      return applyHotspotOverlay(nodes);

    case 'cycles':
      return applyCyclesOverlay(nodes, extraData?.cycles ?? []);

    case 'architecture-violations':
      return applyViolationsOverlay(nodes, extraData?.violations ?? []);

    case 'interface-diff':
      return applyInterfaceDiffOverlay(nodes, extraData?.diffChanges ?? []);

    default:
      return nodes;
  }
}

function applyComplexityHeatmap(nodes: Node[]): Node[] {
  return nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      backgroundColor:
        n.data?.qualityScore != null
          ? qualityColor(n.data.qualityScore as number) + '30'
          : n.style?.backgroundColor,
      borderColor:
        n.data?.qualityScore != null
          ? qualityColor(n.data.qualityScore as number)
          : (n.style?.borderColor as string | undefined),
    },
  }));
}

function applyChurnHeatmap(nodes: Node[]): Node[] {
  const maxChurn = Math.max(
    ...nodes.map((n) => (n.data?.churnRate as number) ?? 0),
    0.001,
  );
  return nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      borderColor:
        n.data?.churnRate != null
          ? churnColor(n.data.churnRate as number, maxChurn)
          : (n.style?.borderColor as string | undefined),
      borderWidth: n.data?.churnRate ? 3 : n.style?.borderWidth,
    },
  }));
}

function applyCyclesOverlay(
  nodes: Node[],
  cycles: Array<{ entities?: string[] }>,
): Node[] {
  const cycleEntityIds = new Set(
    cycles.flatMap((c) => c.entities ?? []),
  );
  return nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      ...(cycleEntityIds.has(n.id) ||
      cycleEntityIds.has(n.data?.filePath as string)
        ? { borderColor: '#ef4444', borderWidth: 3, borderStyle: 'dashed' as const }
        : {}),
    },
  }));
}

function applyViolationsOverlay(
  nodes: Node[],
  violations: Array<{ entity_from?: string; entity_to?: string }>,
): Node[] {
  const violationEntities = new Set(
    violations.flatMap((v) => [v.entity_from, v.entity_to].filter(Boolean)),
  );
  return nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      ...(violationEntities.has(n.id)
        ? { borderColor: '#ef4444', borderWidth: 2 }
        : {}),
    },
  }));
}

function applyHotspotOverlay(nodes: Node[]): Node[] {
  const maxScore = Math.max(
    ...nodes.map((n) => (n.data?.hotspotScore as number) ?? 0),
    0.001,
  );
  return nodes.map((n) => {
    const score = (n.data?.hotspotScore as number) ?? 0;
    if (score === 0) return n;
    const scale = hotspotSize(score, maxScore);
    return {
      ...n,
      style: {
        ...n.style,
        transform: `scale(${scale})`,
        borderColor: qualityColor(100 - Math.min(score * 50, 100)),
        borderWidth: 3,
      },
    };
  });
}

const DIFF_COLORS: Record<string, string> = {
  added: '#22c55e',
  removed: '#ef4444',
  modified: '#eab308',
  visibility: '#f59e0b',
  parameter_added: '#ef4444',
  parameter_removed: '#ef4444',
  type_changed: '#ef4444',
  return_changed: '#ef4444',
};

function applyInterfaceDiffOverlay(
  nodes: Node[],
  diffChanges: DiffChange[],
): Node[] {
  const diffEntities = new Map(
    diffChanges.map((c) => [c.entity_id, c]),
  );
  return nodes.map((n) => {
    const change = diffEntities.get(n.id);
    if (!change) return n;
    return {
      ...n,
      style: {
        ...n.style,
        borderColor: DIFF_COLORS[change.change_type] ?? '#94a3b8',
        borderWidth: 3,
      },
    };
  });
}
