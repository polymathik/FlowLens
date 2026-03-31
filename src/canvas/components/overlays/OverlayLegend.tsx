/**
 * Overlay legend panel — displays a color key for the currently active overlay.
 * Positioned at the bottom-right of the canvas viewport.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';

interface LegendEntry {
  color: string;
  label: string;
}

const LEGENDS: Record<string, LegendEntry[]> = {
  'complexity-heatmap': [
    { color: '#22c55e', label: '80-100 (Good)' },
    { color: '#eab308', label: '50-79 (Fair)' },
    { color: '#f97316', label: '25-49 (Poor)' },
    { color: '#ef4444', label: '0-24 (Critical)' },
  ],
  'churn-heatmap': [
    { color: '#93c5fd', label: 'Low churn' },
    { color: '#ef4444', label: 'High churn' },
  ],
  hotspot: [
    { color: '#22c55e', label: 'Low hotspot' },
    { color: '#ef4444', label: 'High hotspot (scaled up)' },
  ],
  cycles: [{ color: '#ef4444', label: 'Cycle member (dashed)' }],
  'architecture-violations': [{ color: '#ef4444', label: 'Violation' }],
  'interface-diff': [
    { color: '#22c55e', label: 'Added' },
    { color: '#ef4444', label: 'Removed' },
    { color: '#eab308', label: 'Modified' },
    { color: '#f59e0b', label: 'Visibility changed' },
  ],
};

export function OverlayLegend() {
  const overlay = useCanvasStore((s) => s.activeOverlay);
  if (!overlay || !LEGENDS[overlay]) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 10,
        padding: '8px 12px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        fontSize: 11,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {overlay.replace(/-/g, ' ')}
      </div>
      {LEGENDS[overlay].map(({ color, label }) => (
        <div
          key={label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 2,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              backgroundColor: color,
            }}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
