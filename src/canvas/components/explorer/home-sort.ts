/** Home card order: lowest score first; unscored next; missing projects last. */
import type { ProjectDetail } from '../../../contracts/service.js';
import type { ExplorerHealthSummary } from '../../../contracts/canvas/index.js';

export type SummaryState = Record<string, ExplorerHealthSummary | { error: string } | undefined>;

export function sortWorstFirst(projects: ProjectDetail[], summaries: SummaryState): ProjectDetail[] {
  const score = (p: ProjectDetail) => {
    const s = summaries[p.id];
    if (p.status === 'missing') return 1000;
    if (!s) return 500;
    return 'error' in s ? 600 : s.score;
  };
  return [...projects].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

