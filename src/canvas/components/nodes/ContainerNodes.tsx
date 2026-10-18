/**
 * System, module and file nodes — containers the user can double-click to
 * open. Detail grows with the semantic zoom tier: the quality badge appears
 * from the "module" tier up.
 */
import React from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { FileNodeData, ModuleNodeData, SystemNodeData } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { MetricsBadge } from '../shared/MetricsBadge';
import { NodeShell } from './NodeShell';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function Subtitle({ count, quality }: { count: number; quality?: number }) {
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {plural(count, 'symbol')}
      {tier !== 'system' && <MetricsBadge score={quality} />}
    </span>
  );
}

export const SystemNode = React.memo(({ data, selected }: NodeProps<Node<SystemNodeData, 'system'>>) => (
  <NodeShell
    level="system"
    selected={selected}
    overlay={data.overlay}
    title={`${data.label}${data.path.includes('.') ? '' : '/'}`}
    subtitle={<Subtitle count={data.entityCount} quality={data.qualityScore} />}
    tooltip={`${data.path} — double-click to open`}
  />
));

export const ModuleNode = React.memo(({ data, selected }: NodeProps<Node<ModuleNodeData, 'module'>>) => (
  <NodeShell
    level="module"
    selected={selected}
    overlay={data.overlay}
    title={`${data.label}/`}
    subtitle={<Subtitle count={data.entityCount} quality={data.qualityScore} />}
    tooltip={`${data.path} — double-click to open`}
  />
));

export const FileNode = React.memo(({ data, selected }: NodeProps<Node<FileNodeData, 'file'>>) => (
  <NodeShell
    level="file"
    selected={selected}
    overlay={data.overlay}
    icon={<span aria-hidden style={{ fontSize: 11, color: '#94a3b8' }}>▤</span>}
    title={data.label}
    subtitle={<Subtitle count={data.entityCount} quality={data.qualityScore} />}
    tooltip={`${data.filePath} — double-click to see its symbols`}
  />
));
