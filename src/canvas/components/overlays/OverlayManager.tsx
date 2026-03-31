/**
 * Overlay logic — modifies node styles based on the active overlay type.
 *
 * This is a pure function (not a React component). It takes the current
 * node array and overlay mode and returns nodes with adjusted styles.
 */
import type { Node } from '@xyflow/react';
import { qualityColor, churnColor } from '../../utils/color-scales';

export interface OverlayExtraData {
  cycles?: Array<{ entities?: string[] }>;
  violations?: Array<{ entity_from?: string; entity_to?: string }>;
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

    case 'cycles':
      return applyCyclesOverlay(nodes, extraData?.cycles ?? []);

    case 'architecture-violations':
      return applyViolationsOverlay(nodes, extraData?.violations ?? []);

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
