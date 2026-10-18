/**
 * Plain-language labels and colours for the Home and Health screens. The
 * wording comes from the health engine's renderers so the report, the CLI
 * and the UI say the same thing.
 */
import type { HealthGrade, HealthSeverity } from '../../../contracts/health.js';
export { VERDICT, SEVERITY_LABEL, EFFORT_LABEL, reliedText, evidenceText } from '../../../health/render/common.js';

export const gradeColor = (g: HealthGrade | null): string => (g ? `var(--fl-grade-${g.toLowerCase()})` : 'var(--fl-faint)');

export const SEVERITY_COLOR: Record<HealthSeverity, string> = {
  critical: 'var(--fl-grade-f)',
  high: 'var(--fl-grade-d)',
  medium: 'var(--fl-grade-c)',
  low: 'var(--fl-faint)',
  info: 'var(--fl-faint)',
};

export const CONFIDENCE_LABEL = {
  high: 'The map looks complete.',
  medium: 'The map may be missing a few things.',
  low: 'The map looks incomplete, so treat this grade as a rough guide.',
} as const;

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
