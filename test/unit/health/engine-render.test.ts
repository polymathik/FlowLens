import { describe, it, expect } from 'vitest';
import { buildHealthReport, summarizeHealth } from '../../../src/health/engine.js';
import { findJargon, renderHealth } from '../../../src/health/index.js';
import { HEALTH_SCHEMA_VERSION } from '../../../src/contracts/health.js';
import { GraphBuilder, completeManifest, fanIn } from './graph-builder.js';

function messyProject(): GraphBuilder {
  const g = new GraphBuilder()
    .dep('src/a.ts', 'src/b.ts', { line: 2 })
    .dep('src/b.ts', 'src/a.ts', { line: 5 })
    .fn('src/a.ts', 'computeTotals', { cc: 34, line: 10, lines: 60 })
    .fn('src/c.ts', 'parse', { cc: 18 })
    .file('src/big.ts', { lines: 800 });
  fanIn(g, 'src/c.ts', 9);
  g.changes('src/a.ts', 7);
  g.manifest = completeManifest({ git_head: 'abc' });
  return g;
}

describe('health engine', () => {
  it('is deterministic for the same input', async () => {
    const a = await buildHealthReport(messyProject().input(), { now: '2026-10-18T00:00:00Z' });
    const b = await buildHealthReport(messyProject().input(), { now: '2026-10-18T00:00:00Z' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.schema_version).toBe(HEALTH_SCHEMA_VERSION);
  });

  it('ranks by penalty × change factor and links related findings', async () => {
    const r = await buildHealthReport(messyProject().input());
    expect(r.findings.map((f) => f.rank)).toEqual(r.findings.map((_, i) => i + 1));
    for (let i = 1; i < r.findings.length; i++) {
      expect(r.findings[i - 1].rank_score).toBeGreaterThanOrEqual(r.findings[i].rank_score);
    }
    const hub = r.findings.find((f) => f.kind === 'fragile_hub')!;
    const fn = r.findings.find((f) => f.kind === 'complex_function' && f.focus.files[0] === 'src/c.ts')!;
    expect(hub.related_ids).toContain(fn.id);
    expect(r.next_steps).toHaveLength(3);
    expect(r.next_steps[0].finding_id).toBe(r.findings[0].id);
  });

  it('keeps ids stable across runs and independent of rank', async () => {
    const r1 = await buildHealthReport(messyProject().input());
    const g = messyProject().fn('src/z.ts', 'worse', { cc: 90 });
    const r2 = await buildHealthReport(g.input());
    const ids1 = new Set(r1.findings.map((f) => f.id));
    expect(r2.findings.filter((f) => ids1.has(f.id))).toHaveLength(r1.findings.length);
  });

  it('writes plain English: short titles and no banned jargon', async () => {
    const r = await buildHealthReport(messyProject().input());
    for (const f of r.findings) {
      expect(f.title.length).toBeLessThanOrEqual(80);
      expect(findJargon(f.title), f.title).toEqual([]);
      expect(findJargon(f.why_it_matters), f.why_it_matters).toEqual([]);
      expect(f.why_it_matters.split(/(?<=[.!?])\s+(?=[A-Z])/).length).toBeLessThanOrEqual(3);
    }
    for (const c of [...r.caveats, ...r.next_steps.map((s) => s.action)]) expect(findJargon(c), c).toEqual([]);
  });

  it('applies --top but keeps totals and counts', async () => {
    const r = await buildHealthReport(messyProject().input(), { top: 2 });
    expect(r.findings).toHaveLength(2);
    expect(r.total_findings).toBeGreaterThan(2);
    expect(Object.values(r.counts).reduce((s, n) => s + (n ?? 0), 0)).toBe(r.total_findings);
    const s = summarizeHealth(r);
    expect(s).toMatchObject({ grade: r.grade, score: r.score, top_finding: r.findings[0].title, stale: false });
    expect(s.counts.findings).toBe(r.total_findings);
    expect(s.counts.cycles).toBe(1);
  });

  it('adds caveats and lowers confidence for a poor or stale map', async () => {
    const g = messyProject();
    g.manifest = completeManifest({ completion: 'partial', git_head: 'old', errors: { parse_failures: 2, unresolved_relations: 0, ambiguous_relations: 0, failed_files: ['src/x.ts'] } });
    const r = await buildHealthReport(g.input({ current_git_head: 'new' }));
    expect(r.confidence).toBe('low');
    expect(r.graph.stale).toBe(true);
    expect(r.caveats.join('\n')).toMatch(/2 files could not be read \(for example src\/x\.ts\)/);
    expect(r.caveats.join('\n')).toMatch(/changed since the map was last built/);
    const none = await buildHealthReport(new GraphBuilder().file('a.ts').input());
    expect(none.confidence).toBe('medium');
    expect(none.caveats.join('\n')).toMatch(/No git history/);
    expect(none.caveats.join('\n')).toMatch(/No architecture rules/);
  });

  it('flags a disconnected map instead of trusting it', async () => {
    const g = new GraphBuilder();
    for (let i = 0; i < 12; i++) g.fn(`src/f${i}.ts`, 'x');
    g.dep('src/f0.ts', 'src/f1.ts');
    const r = await buildHealthReport(g.input());
    expect(r.confidence).toBe('low');
    expect(r.caveats.join('\n')).toMatch(/Only 17% of code files are linked/);
    expect(r.findings.some((f) => f.kind === 'orphan_module')).toBe(false);
  });
});

describe('health renderers', () => {
  it('Markdown has the expected sections in order and fenced fix prompts', async () => {
    const r = await buildHealthReport(messyProject().input(), { now: 'T' });
    const md = renderHealth(r, 'md');
    const headings = md.split('\n').filter((l) => /^#{1,3} /.test(l));
    expect(headings[0]).toBe('# Code health report: demo');
    expect(headings.slice(1, 4)).toEqual(['## What to do next', '## Score breakdown', `## Findings (${r.total_findings})`]);
    expect(headings.at(-1)).toBe('## Things to know about this report');
    expect(headings.filter((h) => h.startsWith('### '))).toHaveLength(r.findings.length);
    expect(md).toMatch(/\*\*Grade [A-F] · \d+\/100\*\*/);
    expect((md.match(/^```text$/gm) ?? []).length).toBe(r.findings.length);
    expect(md).toContain('| Tangles |');
    expect(md).not.toMatch(/<[a-z]+[ >]/i);
  });

  it('HTML is self-contained, escaped and theme/print aware', async () => {
    const g = messyProject().fn('src/<evil>.ts', '<script>alert(1)</script>', { cc: 40 });
    const html = renderHealth(await buildHealthReport(g.input()), 'html');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<link\b|<script[^>]+src=|<img\b|@import|url\(/i);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('@media print');
    expect(html).toContain('Copy fix prompt');
  });

  it('JSON round-trips the report', async () => {
    const r = await buildHealthReport(messyProject().input(), { now: 'T' });
    expect(JSON.parse(renderHealth(r, 'json'))).toEqual(JSON.parse(JSON.stringify(r)));
  });
});
