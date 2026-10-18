/**
 * "How the score is made": each area's score as a bar, in plain words,
 * with the findings that lowered it the most.
 */
import React from 'react';
import type { HealthBreakdown } from '../../../contracts/health.js';

const barColor = (score: number | null) =>
  score === null ? 'var(--fl-faint)' : score >= 90 ? 'var(--fl-grade-a)' : score >= 70 ? 'var(--fl-grade-c)' : 'var(--fl-grade-f)';

export function ScoreBreakdown({ breakdown }: { breakdown: HealthBreakdown }) {
  return (
    <section className="fl-panel" aria-labelledby="fl-breakdown-title" data-testid="score-breakdown">
      <h3 id="fl-breakdown-title">How the score is made</h3>
      <p style={{ marginBottom: 12 }}>
        Each area starts at 100 and loses points for the problems found in it. The overall score is a weighted average of these areas.
      </p>
      <ul className="fl-bars">
        {breakdown.sub_scores.map((s) => (
          <li key={s.category} className="fl-bar-row">
            <span>{s.label}</span>
            <b>{s.score === null ? 'not measured' : s.score}</b>
            <span
              className="fl-bar"
              role="img"
              aria-label={`${s.label}: ${s.score === null ? 'not measured' : `${s.score} out of 100`}`}
              style={{ ['--bar' as string]: barColor(s.score) }}
            >
              <i style={{ width: `${s.score ?? 0}%` }} />
            </span>
            <small>
              {s.explanation}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
