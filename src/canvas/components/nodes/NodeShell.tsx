/**
 * Shared node body for all four levels: base palette per level, selection
 * ring, overlay decoration (fill / stroke / scale / badge from
 * `data.overlay`) and the hidden connection handles.
 *
 * Overlay styling is applied to this inner body — never to React Flow's
 * wrapper, whose `transform` carries the node position.
 */
import React from 'react';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { useCanvasStore } from '../../store/canvas-store';
import type { CanvasNodeType, NodeOverlayStyle } from '../../../contracts/canvas/index.js';

/** Per-level palette as CSS variables (light/dark in styles/tokens.css). */
export const LEVEL_PALETTE: Record<CanvasNodeType, { fill: string; stroke: string; text: string; muted: string }> = {
  zone: { fill: 'var(--fl-surface)', stroke: 'var(--fl-border-strong)', text: 'var(--fl-text)', muted: 'var(--fl-muted)' },
  package: { fill: 'var(--fl-node-system-fill)', stroke: 'var(--fl-node-system-stroke)', text: 'var(--fl-node-system-text)', muted: 'var(--fl-node-system-muted)' },
  folder: { fill: 'var(--fl-node-module-fill)', stroke: 'var(--fl-node-module-stroke)', text: 'var(--fl-node-module-text)', muted: 'var(--fl-node-module-muted)' },
  config: { fill: 'var(--fl-overlay-muted-fill)', stroke: 'var(--fl-overlay-muted-stroke)', text: 'var(--fl-muted)', muted: 'var(--fl-faint)' },
  file: { fill: 'var(--fl-node-file-fill)', stroke: 'var(--fl-node-file-stroke)', text: 'var(--fl-node-file-text)', muted: 'var(--fl-muted)' },
  entity: { fill: 'var(--fl-node-file-fill)', stroke: 'var(--fl-border)', text: 'var(--fl-text)', muted: 'var(--fl-muted)' },
  scope: { fill: 'var(--fl-subtle)', stroke: 'var(--fl-border)', text: 'var(--fl-muted)', muted: 'var(--fl-faint)' },
  portal: { fill: 'var(--fl-subtle)', stroke: 'var(--fl-border-strong)', text: 'var(--fl-text)', muted: 'var(--fl-muted)' },
};

/** Minimap node colours: theme tokens (React Flow sets them as inline `style.fill`, which reads CSS variables). */
export const MINIMAP_STROKE: Record<CanvasNodeType, string> = {
  zone: 'var(--fl-minimap-module)',
  package: 'var(--fl-minimap-system)',
  folder: 'var(--fl-minimap-module)',
  config: 'var(--fl-minimap-entity)',
  file: 'var(--fl-minimap-file)',
  entity: 'var(--fl-minimap-entity)',
  scope: 'var(--fl-minimap-entity)',
  portal: 'var(--fl-minimap-entity)',
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
  /** Stack the content from the top (cards that list rows) instead of centring it. */
  top?: boolean;
}

export function NodeShell({ level, selected, overlay, accent, title, subtitle, icon, children, tooltip, top }: NodeShellProps) {
  const p = LEVEL_PALETTE[level];
  const nodeId = useNodeId();
  const highlighted = useCanvasStore((s) => (nodeId ? s.highlightedIds.includes(nodeId) : false));
  const stroke = overlay?.stroke ?? p.stroke;
  const strokeWidth = overlay?.strokeWidth ?? (level === 'package' ? 2 : 1.5);
  const body: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: level === 'entity' || level === 'portal' ? '6px 10px' : '8px 12px',
    borderRadius: level === 'entity' ? 6 : 10,
    border: `${strokeWidth}px ${overlay?.strokeStyle ?? (level === 'portal' || level === 'scope' ? 'dashed' : 'solid')} ${stroke}`,
    borderLeft: accent ? `4px solid ${accent}` : undefined,
    background: overlay?.fill ?? p.fill,
    color: p.text,
    opacity: overlay?.muted ? 0.7 : 1,
    boxShadow: selected
      ? '0 0 0 3px rgba(99,102,241,0.45), 0 4px 12px rgba(15,23,42,0.12)'
      : highlighted
        ? '0 0 0 3px rgba(217,119,6,0.55), 0 4px 12px rgba(15,23,42,0.12)'
        : '0 1px 2px rgba(15,23,42,0.06)',
    transform: overlay?.scale && overlay.scale !== 1 ? `scale(${overlay.scale})` : undefined,
    transformOrigin: 'center',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: top || level === 'package' || level === 'folder' ? 'flex-start' : 'center',
    overflow: 'hidden',
    cursor: level === 'portal' ? 'pointer' : undefined,
  };

  return (
    <div
      className="flowlens-node"
      data-level={level}
      data-overlay={overlay ? `${overlay.tag}${overlay.muted ? ':muted' : ''}` : ''}
      data-selected={selected ? 'true' : 'false'}
      data-highlighted={highlighted ? 'true' : 'false'}
      title={tooltip}
      style={body}
    >
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
        {icon}
        <span
          style={{
            fontWeight: level === 'entity' ? 500 : 650,
            fontSize: level === 'package' || level === 'folder' ? 14 : level === 'entity' ? 12 : 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </div>
      {subtitle && (
        <div style={{ fontSize: 10.5, color: p.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
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
            background: overlay.stroke ?? 'var(--fl-muted)',
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
