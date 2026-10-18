/**
 * HTML renderer — one self-contained file (inline CSS + tiny inline
 * script, no external assets) that opens in any browser and prints well.
 */
import type { HealthFinding, HealthReport } from '../../contracts/health.js';
import { CONFIDENCE_TEXT, EFFORT_LABEL, FOOTER, SEVERITY_LABEL, VERDICT, categoryLabel, evidenceText, metaLine, reliedText, shownText } from './common.js';
import { HTML_SCRIPT, HTML_STYLE } from './html-style.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

export function renderHtml(report: HealthReport): string {
  const steps = report.next_steps.map((s) => `<li>${e(s.action)}</li>`).join('');
  const rows = report.breakdown.sub_scores
    .map((s) => {
      const pct = s.score ?? 0;
      return (
        `<div class="row"><div>${e(s.label)}<div class="muted">${e(s.explanation)}</div></div>` +
        `<div class="score">${s.score === null ? 'n/a' : s.score}</div>` +
        `<div class="bar" role="img" aria-label="${e(s.label)} ${s.score ?? 'not measured'} out of 100"><i style="width:${pct}%"></i></div></div>`
      );
    })
    .join('');
  const findings =
    report.findings.length === 0
      ? '<div class="card">No problems found.</div>'
      : report.findings.map(renderFinding).join('');
  const caveats = report.caveats.map((c) => `<li>${e(c)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Code health: ${e(report.project.name)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<main>
<section class="card hero">
<div class="grade g${report.grade}" aria-label="Grade ${report.grade}">${report.grade}</div>
<div><h1>Code health: ${e(report.project.name)}</h1>
<div class="score">${report.score}/100 — ${e(VERDICT[report.grade])}</div>
<div class="muted">${e(CONFIDENCE_TEXT[report.confidence])}</div>
<div class="muted">${e(metaLine(report))}</div></div>
</section>
<h2>What to do next</h2>
<section class="card"><ol class="steps">${steps}</ol></section>
<h2>Score breakdown</h2>
<section class="card">${rows}<p class="muted">${e(report.breakdown.formula)}</p></section>
<h2>Findings (${e(shownText(report))})</h2>
${findings}
<h2>Things to know about this report</h2>
<section class="card"><ul class="caveats">${caveats}</ul></section>
<footer>${e(FOOTER)} Health schema v${report.schema_version}. Generated ${e(report.generated_at)}.</footer>
</main>
<script>${HTML_SCRIPT}</script>
</body>
</html>
`;
}

function renderFinding(f: HealthFinding): string {
  const ev = f.evidence
    .slice(0, 8)
    .map((x) => {
      const t = evidenceText(x);
      return `<li><code>${e(t.where)}</code>${t.detail ? ` — ${e(t.detail)}` : ''}</li>`;
    })
    .join('');
  const more = f.evidence.length > 8 ? `<li>…and ${f.evidence.length - 8} more</li>` : '';
  const relied = f.blast_radius > 0 ? ` · ${reliedText(f.blast_radius)}` : '';
  const pid = `prompt-${f.id}`;
  return `<article class="card" id="f-${f.id}">
<div class="head"><span class="rank">${f.rank}.</span><h3>${e(f.title)}</h3></div>
<div class="muted"><span class="pill ${f.severity}">${SEVERITY_LABEL[f.severity]}</span>${e(categoryLabel(f.category))} · effort: ${e(EFFORT_LABEL[f.effort])}${relied}</div>
<p class="why">${e(f.why_it_matters)}</p>
${ev ? `<ul class="ev">${ev}${more}</ul>` : ''}
<details><summary>Fix prompt for your AI assistant</summary><pre id="${pid}">${e(f.fix_prompt)}</pre></details>
<div class="actions"><button class="copy" type="button" data-target="${pid}">Copy fix prompt</button><a href="${e(f.focus.url)}">Show on map</a></div>
</article>`;
}
