/**
 * Displays annotation notes on symbol nodes.
 * Colour-coded by category: convention, decision, warning, todo.
 */
import React from 'react';
import type { CanvasAnnotation } from '../../../contracts/canvas/index.js';

const CATEGORY_COLORS: Record<string, string> = {
  convention: '#3b82f6',
  decision: '#8b5cf6',
  warning: '#f59e0b',
  todo: '#22c55e',
};

export function AnnotationTooltip({ annotations }: { annotations: CanvasAnnotation[] }) {
  if (!annotations || annotations.length === 0) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {annotations.map((ann) => {
        const color = CATEGORY_COLORS[ann.category] ?? '#94a3b8';
        return (
          <div
            key={ann.id || ann.text}
            style={{
              padding: '3px 6px',
              marginTop: 2,
              borderRadius: 4,
              fontSize: 10,
              backgroundColor: `${color}15`,
              borderLeft: `3px solid ${color}`,
            }}
          >
            <div style={{ fontWeight: 500 }}>{ann.text}</div>
            {ann.author && <div style={{ color: '#94a3b8', fontSize: 9 }}>— {ann.author}</div>}
          </div>
        );
      })}
    </div>
  );
}
