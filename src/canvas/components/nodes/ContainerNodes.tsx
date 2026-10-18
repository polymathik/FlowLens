/**
 * Package, folder, Config and file-scope nodes (file cards: FileNode.tsx). Containers list what
 * they hold (folder / file / symbol counts) and their largest files; the
 * quality badge appears from the "module" detail tier up.
 */
import React from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { ConfigNodeData, FolderNodeData, ScopeNodeData } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { MetricsBadge } from '../shared/MetricsBadge';
import { NodeShell } from './NodeShell';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Counts({ data }: { data: { folderCount: number; fileCount: number; symbolCount: number; qualityScore?: number } }) {
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const parts = [data.folderCount > 0 ? plural(data.folderCount, 'folder') : null, data.fileCount > 0 ? plural(data.fileCount, 'file') : null, plural(data.symbolCount, 'symbol')];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {parts.filter(Boolean).join(' · ')}
      {tier !== 'system' && <MetricsBadge score={data.qualityScore} />}
    </span>
  );
}

function TopFiles({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <ul data-testid="top-files" style={{ margin: '5px 0 0', padding: 0, listStyle: 'none', fontSize: 10.5, lineHeight: '14px', opacity: 0.85 }}>
      {names.map((n) => (
        <li key={n} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          ▤ {n}
        </li>
      ))}
    </ul>
  );
}

export const FolderNode = React.memo(({ data, selected }: NodeProps<Node<FolderNodeData, 'folder' | 'package'>>) => (
  <NodeShell
    level={data.level}
    selected={selected}
    overlay={data.overlay}
    icon={<span aria-hidden>{data.level === 'package' ? '◈' : '▸'}</span>}
    title={data.level === 'package' ? data.label : `${data.label}/`}
    subtitle={<Counts data={data} />}
    tooltip={`${data.packageName ? `${data.packageName} — ` : ''}${data.path || '.'} — double-click to open`}
  >
    <TopFiles names={data.topFiles} />
  </NodeShell>
));

export const ConfigNode = React.memo(({ data, selected }: NodeProps<Node<ConfigNodeData, 'config'>>) => (
  <NodeShell
    level="config"
    selected={selected}
    overlay={data.overlay}
    icon={<span aria-hidden>⚙</span>}
    title="Config"
    subtitle={plural(data.fileCount, 'file')}
    tooltip={`Configuration files${data.path ? ` in ${data.path}` : ''} — double-click to open`}
  />
));

export const ScopeNode = React.memo(({ data, selected }: NodeProps<Node<ScopeNodeData, 'scope'>>) => (
  <NodeShell
    level="scope"
    selected={selected}
    overlay={data.overlay}
    title={data.label}
    tooltip={`${data.filePath}: imports and exports of the file itself`}
  />
));
