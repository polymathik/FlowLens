/**
 * Shared node body for all four levels: base palette per level, selection
 * ring, overlay decoration (fill / stroke / scale / badge from
 * `data.overlay`) and the hidden connection handles.
 *
 * Overlay styling is applied to this inner body — never to React Flow's
 * wrapper, whose `transform` carries the node position.
 */
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { CanvasNodeType, NodeOverlayStyle } from '../../../contracts/canvas/index.js';

export const LEVEL_PALETTE: Record<CanvasNodeType, { fill: string; stroke: string; text: string; muted: string }> = {
  system: { fill: '#eef2ff', stroke: '#818cf8', text: '#312e81', muted: '#6366f1' },
  module: { fill: '#f0fdfa', stroke: '#5eead4', text: '#134e4a', muted: '#0f766e' },
  file: { fill: '#ffffff', stroke: '#bfdbfe', text: '#1e3a8a', muted: '#64748b' },
  entity: { fill: '#ffffff', stroke: '#e2e8f0', text: '#0f172a', muted: '#64748b' },
};

const hidden: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };

export interface NodeShellProps {
  level: CanvasNodeType;
  selected?: boolean;
  overlay?: NodeOverlayStyle;
  /** Left accent colour (symbol kind). */
  accent?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  tooltip?: string;
}

export function NodeShell({ level, selected, overlay, accent, title, subtitle, icon, children, tooltip }: NodeShellProps) {
  const p = LEVEL_PALETTE[level];
  const stroke = overlay?.stroke ?? p.stroke;
  const strokeWidth = overlay?.strokeWidth ?? (level === 'system' ? 2 : 1.5);
  const body: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: level === 'entity' ? '6px 10px' : '8px 12px',
    borderRadius: level === 'entity' ? 6 : 10,
    border: `${strokeWidth}px ${overlay?.strokeStyle ?? 'solid'} ${stroke}`,
    borderLeft: accent ? `4px solid ${accent}` : undefined,
    background: overlay?.fill ?? p.fill,
    color: p.text,
    opacity: overlay?.muted ? 0.7 : 1,
    boxShadow: selected
      ? '0 0 0 3px rgba(99,102,241,0.45), 0 4px 12px rgba(15,23,42,0.12)'
      : '0 1px 2px rgba(15,23,42,0.06)',
    transform: overlay?.scale && overlay.scale !== 1 ? `scale(${overlay.scale})` : undefined,
    transformOrigin: 'center',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  return (
    <div
      className="flowlens-node"
      data-level={level}
      data-overlay={overlay ? `${overlay.tag}${overlay.muted ? ':muted' : ''}` : ''}
      data-selected={selected ? 'true' : 'false'}
      title={tooltip}
      style={body}
    >
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {icon}
        <span
          style={{
            fontWeight: level === 'entity' ? 500 : 650,
            fontSize: level === 'system' ? 14 : level === 'entity' ? 12 : 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </div>
      {subtitle && (
        <div style={{ fontSize: 10.5, color: p.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </div>
      )}
      {children}
      {overlay?.badge && (
        <span
          className="flowlens-node-badge"
          style={{
            position: 'absolute',
            top: 3,
            right: 4,
            fontSize: 9,
            fontWeight: 600,
            padding: '1px 5px',
            borderRadius: 8,
            background: overlay.stroke ?? '#64748b',
            color: '#fff',
          }}
        >
          {overlay.badge}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
    </div>
  );
}
