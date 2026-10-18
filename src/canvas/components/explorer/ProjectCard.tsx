/** One Home card: grade, score, the top thing to fix, counts, freshness. */
import React from 'react';
import type { ProjectDetail } from '../../../contracts/service.js';
import type { ExplorerHealthSummary } from '../../../contracts/canvas/index.js';
import { formatRelativeTime } from '../../utils/format';
import { gradeColor, plural } from './labels';

interface Props {
  project: ProjectDetail;
  summary: ExplorerHealthSummary | { error: string } | undefined;
  onOpen: () => void;
}

export function ProjectCard({ project, summary, onOpen }: Props) {
  const missing = project.status === 'missing';
  const s = summary && !('error' in summary) ? summary : null;
  const failed = summary && 'error' in summary ? summary.error : null;
  const grade = s?.grade ?? null;
  const counts = s?.counts;

  return (
    <button
      type="button"
      className={`fl-card ${missing ? 'fl-card-missing' : ''}`}
      onClick={onOpen}
      data-testid={`card-${project.id}`}
      data-grade={grade ?? ''}
      data-score={s?.score ?? ''}
      style={{ ['--grade' as string]: gradeColor(grade) }}
      aria-label={`${project.name}: ${missing ? 'missing' : grade ? `grade ${grade}, ${s?.score} out of 100` : 'loading'}`}
    >
      <div className="fl-card-grade" aria-hidden>
        <b>{missing ? '?' : (grade ?? '…')}</b>
        {s && <span>{s.score}/100</span>}
      </div>
      <div className="fl-card-body">
        <div className="fl-card-name">
          <span>{project.name}</span>
          {missing && <span className="fl-badge fl-badge-danger">Missing</span>}
          {s?.stale && <span className="fl-badge fl-badge-warn">Out of date</span>}
          {s?.confidence === 'low' && <span className="fl-badge">Rough guide</span>}
        </div>
        <div className="fl-card-top" data-testid="card-top">
          {missing
            ? `FlowLens can't find this folder any more: ${project.root}`
            : failed
              ? `Could not check this project: ${failed}`
              : s
                ? (s.top_finding ?? 'Nothing urgent to fix.')
                : 'Checking…'}
        </div>
        <div className="fl-card-meta">
          {counts && <span>{plural(counts.cycles, 'tangle')}</span>}
          {counts && <span>{plural(counts.boundary_violations, 'rule break')}</span>}
          {counts && counts.critical_or_high > 0 && <span>{plural(counts.critical_or_high, 'serious issue')}</span>}
          <span>Indexed {formatRelativeTime(s?.last_indexed ?? project.last_indexed)}</span>
        </div>
      </div>
    </button>
  );
}
