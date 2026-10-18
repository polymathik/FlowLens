import { describe, it, expect } from 'vitest';
import { buildHealthContext } from '../../../src/health/context.js';
import { complexFunctionRule } from '../../../src/health/rules/complex-function.js';
import { sizeRule } from '../../../src/health/rules/size.js';
import { hotspotRule } from '../../../src/health/rules/hotspot.js';
import { orphanRule, unresolvedImportsRule } from '../../../src/health/rules/graph-gaps.js';
import { GraphBuilder } from './graph-builder.js';

const run = async (rule: { run: (c: any) => any }, g: GraphBuilder) => rule.run(buildHealthContext(g.input()));

describe('health rule: complex functions', () => {
  it('uses the Sonar bar (>15) and bands severity', async () => {
    const g = new GraphBuilder()
      .fn('a.ts', 'ok', { cc: 15 })
      .fn('b.ts', 'medium', { cc: 16 })
      .fn('c.ts', 'high', { cc: 30 })
      .fn('d.ts', 'critical', { cc: 60 });
    const out = await run(complexFunctionRule, g);
    expect(out.map((f: any) => [f.evidence[0].name, f.severity, f.effort])).toEqual([
      ['medium', 'medium', 'S'],
      ['high', 'high', 'M'],
      ['critical', 'critical', 'L'],
    ]);
    expect(out[1].title).toBe('high() in c.ts is very hard to follow');
    expect(out[1].focus).toMatchObject({ kind: 'entity', identifier: 'c.ts/high', overlay: 'complexity' });
    expect(out[1].fix_prompt).toContain('c.ts');
  });

  it('falls back to cyclomatic complexity when cognitive is missing', async () => {
    const g = new GraphBuilder().fn('a.py', 'branchy', { cc: 0, cyclo: 12 });
    const [f] = await run(complexFunctionRule, g);
    expect(f.why_it_matters).toContain('separate paths');
    expect(f.evidence[0].numbers.complexity).toBe(12);
  });

  it('groups more than three complex functions in one file', async () => {
    const g = new GraphBuilder();
    for (let i = 0; i < 4; i++) g.fn('busy.ts', `f${i}`, { cc: 20 + i });
    const out = await run(complexFunctionRule, g);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('4 functions in busy.ts are hard to follow');
    expect(out[0].evidence[0].name).toBe('f3');
    expect(out[0].penalty).toBe(12); // 4 × medium (3)
  });
});

describe('health rule: god files and large files', () => {
  it('flags a long file with lots of logic as a god file (not also large)', async () => {
    const g = new GraphBuilder().file('big.ts', { lines: 600 });
    for (let i = 0; i < 5; i++) g.fn('big.ts', `f${i}`, { cc: 10 });
    const out = await run(sizeRule, g);
    expect(out.map((f: any) => f.kind)).toEqual(['god_file']);
    expect(out[0].evidence[0].numbers).toMatchObject({ lines: 600, functions: 5, total_complexity: 50 });
  });

  it('flags a long but simple file as large_file only', async () => {
    const g = new GraphBuilder().file('data.ts', { lines: 700 }).fn('data.ts', 'one', { cc: 1 });
    const out = await run(sizeRule, g);
    expect(out.map((f: any) => [f.kind, f.severity])).toEqual([['large_file', 'medium']]);
  });

  it('a god file always costs at least as much as the large-file finding it replaces', async () => {
    const big = new GraphBuilder().file('x.ts', { lines: 1200 });
    const [large] = await run(sizeRule, big);
    for (let i = 0; i < 25; i++) big.fn('x.ts', `f${i}`);
    const [god] = await run(sizeRule, big);
    expect(large.kind).toBe('large_file');
    expect(god.kind).toBe('god_file');
    expect(god.penalty).toBeGreaterThanOrEqual(large.penalty);
  });
});

describe('health rule: hotspots', () => {
  it('needs both frequent change and hard-to-follow code', async () => {
    const g = new GraphBuilder().fn('hot.ts', 'tangled', { cc: 20 }).fn('calm.ts', 'tangled2', { cc: 20 }).fn('busy.ts', 'simple', { cc: 3 });
    g.changes('hot.ts', 5).changes('calm.ts', 1).changes('busy.ts', 30);
    const out = await run(hotspotRule, g);
    expect(out.map((f: any) => f.focus.files[0])).toEqual(['hot.ts']);
    expect(out[0].why_it_matters).toContain('changed 5 times in the last 90 days');
    expect(out[0].category).toBe('change_risk');
  });

  it('reports nothing without git history', async () => {
    const g = new GraphBuilder().fn('hot.ts', 'tangled', { cc: 20 });
    expect(await run(hotspotRule, g)).toEqual([]);
  });
});

describe('health rules: orphans and unresolved imports (info only)', () => {
  it('lists files nothing uses, skipping entry points', async () => {
    const g = new GraphBuilder()
      .dep('src/index.ts', 'src/a.ts').dep('src/a.ts', 'src/b.ts').dep('src/b.ts', 'src/c.ts')
      .file('src/old.ts').file('src/page.tsx');
    const [f] = await run(orphanRule, g);
    expect(f.severity).toBe('info');
    expect(f.penalty).toBe(0);
    expect(f.evidence.map((e: any) => e.file)).toEqual(['src/old.ts']);
    expect(f.fix_prompt).toContain('Do not edit or delete any files yet');
  });

  it('skips orphan claims when imports look broken', async () => {
    const g = new GraphBuilder().dep('src/index.ts', 'src/a.ts').file('src/b.ts').file('src/c.ts').file('src/old.ts');
    g.dangling('src/a.ts', 2).dangling('src/a.ts', 3);
    expect(await run(orphanRule, g)).toEqual([]);
  });

  it('reports unresolved imports when more than 10% dangle', async () => {
    const g = new GraphBuilder().dep('a.ts', 'b.ts');
    g.dangling('a.ts', 2).dangling('a.ts', 3).dangling('c.ts', 1);
    const [f] = await run(unresolvedImportsRule, g);
    expect(f.kind).toBe('unresolved_imports');
    expect(f.title).toBe('3 imports could not be connected to a file');
    expect(f.evidence[0]).toMatchObject({ file: 'a.ts', line: 2, numbers: { unresolved: 2 } });
  });
});
