/**
 * Colored badge that displays a quality score.
 * Color ranges: green (80+), yellow (50+), orange (25+), red (<25).
 */
import React from 'react';

function getColor(score: number): string {
  if (score >= 80) return '#22c55e'; // green
  if (score >= 50) return '#eab308'; // yellow
  if (score >= 25) return '#f97316'; // orange
  return '#ef4444'; // red
}

export function MetricsBadge({ score }: { score?: number }) {
  if (score === undefined) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 8,
        fontSize: 10,
        fontWeight: 600,
        color: 'white',
        backgroundColor: getColor(score),
      }}
    >
      {Math.round(score)}
    </span>
  );
}
