/**
 * Markdown renderer — for pasting into an AI chat, a PR description or an
 * issue. Plain GitHub-flavoured Markdown, no HTML.
 */
import type { HealthFinding, HealthReport } from '../../contracts/health.js';
import { CONFIDENCE_TEXT, EFFORT_LABEL, FOOTER, SEVERITY_LABEL, VERDICT, categoryLabel, evidenceText, metaLine, reliedText, shownText } from './common.js';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(report: HealthReport): string {
  const out: string[] = [];
  out.push(`# Code health report: ${report.project.name}`, '');
  out.push(`**Grade ${report.grade} · ${report.score}/100** — ${VERDICT[report.grade]} ${CONFIDENCE_TEXT[report.confidence]}`, '');
  out.push(`_${metaLine(report)}_`, '');

  out.push('## What to do next', '');
  report.next_steps.forEach((s, i) => out.push(`${i + 1}. ${s.action}`));
  out.push('');

  out.push('## Score breakdown', '');
  out.push('| Area | Score | Weight | What lowered it |', '|---|---:|---:|---|');
  for (const s of report.breakdown.sub_scores) {
    const score = s.score === null ? 'n/a' : String(s.score);
    out.push(`| ${s.label} | ${score} | ${Math.round(s.weight * 100)}% | ${cell(s.explanation)} |`);
  }
  out.push('', `_${report.breakdown.formula}_`, '');

  out.push(`## Findings (${shownText(report)})`, '');
  if (report.findings.length === 0) out.push('No problems found.', '');
  for (const f of report.findings) out.push(...renderFinding(f));

  out.push('## Things to know about this report', '');
  for (const c of report.caveats) out.push(`- ${c}`);
  out.push('', `_${FOOTER} Health schema v${report.schema_version}._`, '');
  return out.join('\n');
}

function renderFinding(f: HealthFinding): string[] {
  const out: string[] = [];
  out.push(`### ${f.rank}. ${f.title}`, '');
  const relied = f.blast_radius > 0 ? ` · **Impact:** ${reliedText(f.blast_radius)}` : '';
  out.push(
    `**Severity:** ${SEVERITY_LABEL[f.severity]} · **Effort:** ${EFFORT_LABEL[f.effort]} · **Area:** ${categoryLabel(f.category)}${relied}`,
    '',
  );
  out.push(f.why_it_matters, '');
  if (f.evidence.length > 0) {
    out.push('**Where:**', '');
    for (const e of f.evidence.slice(0, 8)) {
      const t = evidenceText(e);
      out.push(`- \`${t.where}\`${t.detail ? ` — ${t.detail}` : ''}`);
    }
    if (f.evidence.length > 8) out.push(`- …and ${f.evidence.length - 8} more`);
    out.push('');
  }
  out.push('**Fix prompt** (copy into Claude Code, Cursor, Lovable or Bolt):', '');
  out.push('```text', f.fix_prompt.replace(/```/g, "'''"), '```', '');
  out.push(`[Show on map](${f.focus.url})`, '');
  return out;
}
