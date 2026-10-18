/**
 * Presentation helpers shared by the Markdown and HTML renderers so both
 * say exactly the same thing in the same words.
 */
import type { HealthEvidence, HealthGrade, HealthReport, HealthSeverity } from '../../contracts/health.js';
import { CATEGORY_LABELS } from '../config.js';

export const VERDICT: Record<HealthGrade, string> = {
  A: 'Looks healthy. Keep it that way by re-checking after big changes.',
  B: 'In good shape, with a few things worth tidying.',
  C: 'Some risky spots worth fixing soon.',
  D: 'Several risky areas. Fix the top items before adding big features.',
  F: 'Fragile. Fix the top items before building more on top.',
};

export const CONFIDENCE_TEXT = {
  high: 'Confidence: high.',
  medium: 'Confidence: medium (see "Things to know").',
  low: 'Confidence: low — the map looks incomplete, so treat this grade as a rough guide (see "Things to know").',
} as const;

export const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'FYI',
};

export const EFFORT_LABEL = { S: 'Small (minutes)', M: 'Medium (an hour or so)', L: 'Large (a session or more)' } as const;

export function categoryLabel(c: keyof typeof CATEGORY_LABELS): string {
  return CATEGORY_LABELS[c];
}

export function evidenceText(e: HealthEvidence): { where: string; detail: string } {
  const where = e.line ? `${e.file}:${e.line}` : e.file;
  const nums = e.numbers
    ? Object.entries(e.numbers)
        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
        .join(', ')
    : '';
  const detail = [e.name ? `${e.name}` : '', e.note ?? '', nums].filter(Boolean).join(' — ');
  return { where, detail };
}

export function languagesText(report: HealthReport): string {
  const entries = Object.entries(report.stats.languages);
  if (entries.length === 0) return 'no languages detected';
  return entries.map(([l, n]) => `${l} (${n})`).join(', ');
}

export function metaLine(report: HealthReport): string {
  const g = report.graph;
  const parts = [
    `${report.stats.files} files`,
    `${report.stats.symbols} symbols`,
    languagesText(report),
    g.last_indexed ? `indexed ${g.last_indexed}` : 'index time unknown',
  ];
  if (g.completion !== 'unknown') parts.push(`map ${g.completion}`);
  if (g.stale) parts.push('map is out of date');
  return parts.join(' · ');
}

export function shownText(report: HealthReport): string {
  return report.findings.length < report.total_findings
    ? `top ${report.findings.length} of ${report.total_findings}`
    : `${report.total_findings}`;
}

export const FOOTER = 'Generated locally by FlowLens; nothing left your machine.';

export function reliedText(n: number): string {
  return n === 1 ? 'relied on by 1 file' : `relied on by ${n} files`;
}
