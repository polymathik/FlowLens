/**
 * Coloured badge that displays a 0–100 quality score (bands from
 * `color-scales.ts`, shared with the complexity overlay).
 */
import React from 'react';
import { qualityColor } from '../../utils/color-scales';

export function MetricsBadge({ score }: { score?: number }) {
  if (score === undefined) return null;
  return (
    <span
      title="Quality score (0–100, higher is easier to change)"
      style={{
        display: 'inline-block',
        padding: '0 6px',
        borderRadius: 8,
        fontSize: 10,
        lineHeight: '15px',
        fontWeight: 600,
        color: 'white',
        backgroundColor: qualityColor(score),
      }}
    >
      {Math.round(score)}
    </span>
  );
}
