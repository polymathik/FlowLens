/**
 * Portal stub: every link between the open container and ONE outside
 * container, drawn at the frame edge (incoming on the left, outgoing on the
 * right). Shows the exact relation count with a per-type breakdown; a click
 * navigates to the container it stands for.
 */
import React from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { PortalNodeData } from '../../../contracts/canvas/index.js';
import { describeCounts } from '../../utils/relation-labels';
import { NodeShell } from './NodeShell';

/** Keep the start and the end of a long path: `packages/…/adapters/codex.ts`. */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.6);
  return `${text.slice(0, keep - tail)}…${text.slice(text.length - tail)}`;
}

export const PortalNode = React.memo(({ data, selected }: NodeProps<Node<PortalNodeData, 'portal'>>) => {
  const arrow = data.direction === 'in' ? '←' : '→';
  const breakdown = describeCounts(data.typeCounts);
  const hidden = data.hiddenByFilter ? ` · +${data.hiddenByFilter} hidden by filter` : '';
  const verb = data.direction === 'in' ? 'depends on this' : 'is used by this';
  return (
    <div data-testid="portal" data-direction={data.direction} data-target={data.targetId} data-count={data.count} style={{ width: '100%', height: '100%' }}>
      <NodeShell
        level="portal"
        selected={selected}
        overlay={data.overlay}
        icon={<span aria-hidden>{arrow}</span>}
        title={
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{middleEllipsis(data.label, 32)}</span>
            <strong data-testid="portal-count">×{data.count}</strong>
          </span>
        }
        subtitle={`${breakdown}${hidden}`}
        tooltip={`${data.label} ${verb}: ${breakdown}. Click to go there.`}
      />
    </div>
  );
});
