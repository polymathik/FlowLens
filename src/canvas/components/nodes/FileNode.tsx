/**
 * File card. Compact (name, size, quality) in big views; in small views the
 * card has room for its symbols and lists them (up to 8 rows + "+N") once
 * the zoom is close enough to read them.
 */
import React from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { FileNodeData } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { showsSymbolRows } from '../../utils/lod';
import { EntityIcon } from '../shared/EntityIcon';
import { MetricsBadge } from '../shared/MetricsBadge';
import { useZoneActions } from './zone-actions';
import { NodeShell } from './NodeShell';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function SymbolRows({ data }: { data: FileNodeData }) {
  if (!data.symbols?.length) return null;
  return (
    <ul data-testid="symbol-rows" style={{ margin: '5px 0 0', padding: 0, listStyle: 'none', fontSize: 11, lineHeight: '15px' }}>
      {data.symbols.map((s, i) => (
        <li key={`${s.name}:${i}`} style={{ display: 'flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <EntityIcon kind={s.kind} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
        </li>
      ))}
      {(data.moreSymbols ?? 0) > 0 && <li style={{ color: 'var(--fl-faint)', paddingLeft: 21 }}>+{data.moreSymbols} more</li>}
    </ul>
  );
}

export const FileNode = React.memo(({ id, data, selected }: NodeProps<Node<FileNodeData, 'file'>>) => {
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const { openMenu } = useZoneActions();
  const rows = data.rich && showsSymbolRows(tier);
  return (
    <div
      data-testid="file-card"
      data-parent={data.zoneId ?? ''}
      data-focus={data.focus ? 'true' : ''}
      className={data.focus ? 'fl-file-focus' : undefined}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onContextMenu={(e) => { e.preventDefault(); openMenu(id, e.clientX, e.clientY); }}>
      <NodeShell
        level="file"
        selected={selected}
        overlay={data.overlay}
        top={!!data.rich}
        icon={<span aria-hidden style={{ fontSize: 11, color: '#94a3b8' }}>▤</span>}
        title={data.label}
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {data.symbolCount > 0 ? plural(data.symbolCount, 'symbol') : data.role && data.role !== 'source' ? data.role : 'no symbols'}
            {tier !== 'system' && <MetricsBadge score={data.qualityScore} />}
          </span>
        }
        tooltip={`${data.filePath} — double-click to see its contents, right-click to move it to another zone`}
      >
        {rows && <SymbolRows data={data} />}
      </NodeShell>
      {!!data.beyond && (
        <span className="fl-beyond" data-testid="beyond-badge" title={`${data.beyond} more relation${data.beyond === 1 ? '' : 's'} lead outside this neighbourhood (beyond the depth). Increase the depth to follow them.`}>
          +{data.beyond}
        </span>
      )}
    </div>
  );
});
