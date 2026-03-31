/**
 * Displays annotation badges on nodes.
 * Color-coded by category: convention, decision, warning, todo.
 */
import React from 'react';

interface Annotation {
  id: string;
  text: string;
  category: string;
  author: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  convention: '#3b82f6',
  decision: '#8b5cf6',
  warning: '#f59e0b',
  todo: '#22c55e',
};

export function AnnotationTooltip({
  annotations,
}: {
  annotations: Annotation[];
}) {
  if (!annotations || annotations.length === 0) return null;

  return (
    <div style={{ marginTop: 4 }}>
      {annotations.map((ann) => (
        <div
          key={ann.id}
          style={{
            padding: '4px 6px',
            marginTop: 2,
            borderRadius: 4,
            fontSize: 10,
            backgroundColor:
              (CATEGORY_COLORS[ann.category] ?? '#94a3b8') + '15',
            borderLeft: `3px solid ${CATEGORY_COLORS[ann.category] ?? '#94a3b8'}`,
          }}
        >
          <div style={{ fontWeight: 500 }}>{ann.text}</div>
          <div style={{ color: '#94a3b8', fontSize: 9 }}>
            &mdash; {ann.author}
          </div>
        </div>
      ))}
    </div>
  );
}
