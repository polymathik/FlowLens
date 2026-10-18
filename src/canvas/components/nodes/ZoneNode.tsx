/**
 * A zone: an expanded FRAME (border-only, label chip, cards inside) or a
 * collapsed CARD (one box for every file in it). The chip — colour square,
 * name, file count, caret — is the collapse toggle in both forms. Zoomed far
 * out the chip grows (counter-scaled) and shows the zone summary, so the
 * structure stays readable when the cards are not drawn.
 */
import React, { useEffect, useRef } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import type { ZoneNodeData } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { isSummaryTier, labelScale, quantizeZoom } from '../../utils/lod';
import { chipWidth } from '../../layout/cut-layout';
import { MetricsBadge } from '../shared/MetricsBadge';
import { useZoneActions } from './zone-actions';

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const hidden: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };

interface ZoneBoxProps extends NodeProps<Node<ZoneNodeData, 'zone'>> {}

export const ZoneNode = React.memo(({ id, data, selected, width, height }: ZoneBoxProps) => {
  const zoom = useStore((s) => quantizeZoom(s.transform[2]));
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const { toggle, openMenu } = useZoneActions();
  const summary = isSummaryTier(tier);
  const w = Number(width ?? 244);
  const h = Number(height ?? 112);
  const chipW = chipWidth(data.label) + 54;
  // Zoomed far out the chip becomes a centred, enlarged summary (name, counts, quality); otherwise a small header chip.
  const scale = summary
    ? labelScale(zoom, { contentWidth: Math.max(data.label.length * 8.6 + 36, 140), roomWidth: w - 20, max: Math.max(1, Math.min(8, (h - 16) / 64)) })
    : labelScale(zoom, { contentWidth: chipW, roomWidth: w - 24, max: 1.5 });
  // A double-click opens the zone; its two clicks must not toggle it, so the toggle waits briefly.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const chipLabel = `${data.label}, ${plural(data.fileCount, 'file')}${data.expanded ? ', expanded' : ', collapsed'}`;

  return (
    <div
      className="fl-zone"
      data-testid="zone"
      data-zone-id={data.zoneId}
      data-hue={data.colorIndex}
      data-source={data.source}
      data-collapsed={data.expanded ? 'false' : 'true'}
      data-selected={selected ? 'true' : 'false'}
      data-overlay={data.overlay ? `${data.overlay.tag}${data.overlay.muted ? ':muted' : ''}` : ''}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(id, e.clientX, e.clientY);
      }}
      style={data.overlay ? { borderColor: data.overlay.stroke, background: data.overlay.fill, borderStyle: data.overlay.strokeStyle } : undefined}
    >
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <button
        type="button"
        className={`fl-zone-chip nodrag${summary ? ' is-summary' : ''}`}
        data-testid="zone-chip"
        aria-label={chipLabel}
        aria-expanded={data.expanded}
        title={`${data.label}${data.customized ? ' (customised)' : ''} — click to ${data.expanded ? 'collapse' : 'expand'}, double-click to open, right-click for options`}
        style={{ transform: summary ? `translate(-50%, -50%) scale(${scale})` : `scale(${scale})` }}
        onClick={(e) => {
          e.stopPropagation();
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => toggle(id, !data.expanded), 220);
        }}
        onDoubleClick={() => timer.current && clearTimeout(timer.current)}
      >
        <span className="fl-zone-head">
          <span className="fl-zone-swatch" aria-hidden />
          <span className="fl-zone-name">{data.label}</span>
          {!summary && <span className="fl-zone-count">{data.fileCount}</span>}
          <span className="fl-zone-caret" aria-hidden>
            {data.expanded ? '▾' : '▸'}
          </span>
        </span>
        {summary && (
          <span className="fl-zone-count fl-zone-sub" data-testid="zone-summary">
            {plural(data.fileCount, 'file')} · {plural(data.symbolCount, 'symbol')}
            <MetricsBadge score={data.qualityScore} />
          </span>
        )}
      </button>
      {!data.expanded && !summary && (
        <div className="fl-zone-card-body" style={{ paddingTop: 34 * Math.min(scale, 1.25) }}>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {plural(data.fileCount, 'file')} · {plural(data.symbolCount, 'symbol')}
            {tier !== 'module' && <MetricsBadge score={data.qualityScore} />}
          </span>
          {data.topFiles.length > 0 && (
            <ul data-testid="top-files">
              {data.topFiles.map((f) => (
                <li key={f}>▤ {f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
    </div>
  );
});
