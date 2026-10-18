import { describe, it, expect } from 'vitest';
import { buildHealthContext } from '../../../src/health/context.js';
import { cycleRule, orderedLoop, tangleSeverity } from '../../../src/health/rules/cycles.js';
import { boundaryRule } from '../../../src/health/rules/boundary.js';
import { fragileHubRule, hubBar } from '../../../src/health/rules/fragile-hub.js';
import { GraphBuilder, fanIn } from './graph-builder.js';

const run = async (rule: { run: (c: any) => any }, g: GraphBuilder) => rule.run(buildHealthContext(g.input()));

describe('health rule: cycles (tangles)', () => {
  it('reports a two-file tangle with an ordered loop and line evidence', async () => {
    const g = new GraphBuilder().dep('src/a.ts', 'src/b.ts', { line: 3 }).dep('src/b.ts', 'src/a.ts', { line: 7 });
    const [f, ...rest] = await run(cycleRule, g);
    expect(rest).toHaveLength(0);
    expect(f.kind).toBe('cycle');
    expect(f.category).toBe('tangles');
    expect(f.severity).toBe('medium');
    expect(f.effort).toBe('S');
    expect(f.evidence.map((e: any) => `${e.file}:${e.line}`)).toEqual(['src/a.ts:3', 'src/b.ts:7']);
    expect(f.focus.overlay).toBe('cycles');
    expect(f.focus.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(f.fix_prompt).toContain('src/a.ts → src/b.ts → src/a.ts');
  });

  it('orders a three-file loop along real edges', async () => {
    const g = new GraphBuilder().dep('a.ts', 'b.ts').dep('b.ts', 'c.ts').dep('c.ts', 'a.ts');
    const ctx = buildHealthContext(g.input());
    expect(orderedLoop(ctx, ['a.ts', 'b.ts', 'c.ts'])).toEqual(['a.ts', 'b.ts', 'c.ts', 'a.ts']);
    const [f] = await cycleRule.run(ctx);
    expect(f.severity).toBe('high');
    expect(f.title).toMatch(/3 files depend on each other in a loop/);
  });

  it('reports nothing for an acyclic graph', async () => {
    const g = new GraphBuilder().dep('a.ts', 'b.ts').dep('b.ts', 'c.ts');
    expect(await run(cycleRule, g)).toEqual([]);
  });

  it('severity grows with size and reach', () => {
    expect(tangleSeverity(2, 0, 10)).toBe('medium');
    expect(tangleSeverity(2, 5, 100)).toBe('high');
    expect(tangleSeverity(6, 0, 100)).toBe('critical');
    expect(tangleSeverity(2, 6, 10)).toBe('critical');
    expect(tangleSeverity(2, 1, 2)).toBe('medium');
  });

  it('penalty never drops when two tangles merge into one', async () => {
    const g = new GraphBuilder()
      .dep('a.ts', 'b.ts').dep('b.ts', 'a.ts')
      .dep('c.ts', 'd.ts').dep('d.ts', 'c.ts');
    const before = (await run(cycleRule, g)).reduce((s: number, f: any) => s + f.penalty, 0);
    g.dep('b.ts', 'c.ts').dep('d.ts', 'a.ts');
    const after = await run(cycleRule, g);
    expect(after).toHaveLength(1);
    expect(after[0].penalty).toBeGreaterThanOrEqual(before);
  });
});

describe('health rule: boundary violations', () => {
  const arch = {
    version: 2 as const,
    inferred_by: 'manual' as const,
    inferred_at: '2026-10-18T00:00:00Z',
    layers: [
      { name: 'ui', include: { patterns: ['src/ui/**'] }, must_not_access: ['data'] },
      { name: 'data', include: { patterns: ['src/data/**'] } },
    ],
  };

  it('reports one finding per offending file pair, naming the rule', async () => {
    const g = new GraphBuilder().dep('src/ui/Page.ts', 'src/data/db.ts', { line: 4 });
    g.architecture = arch;
    const [f] = await run(boundaryRule, g);
    expect(f.kind).toBe('boundary_violation');
    expect(f.severity).toBe('high');
    expect(f.why_it_matters).toContain('"ui" must not use "data"');
    expect(f.evidence[0]).toMatchObject({ file: 'src/ui/Page.ts', line: 4 });
    expect(f.fix_prompt).toContain('src/ui/Page.ts');
    expect(f.fix_prompt).toContain('src/data/db.ts');
  });

  it('does nothing without architecture rules', async () => {
    const g = new GraphBuilder().dep('src/ui/Page.ts', 'src/data/db.ts');
    expect(await run(boundaryRule, g)).toEqual([]);
  });
});

describe('health rule: fragile hubs', () => {
  it('flags a file many rely on that also depends on many files', async () => {
    const g = fanIn(new GraphBuilder(), 'src/core.ts', 8);
    for (let i = 0; i < 6; i++) g.dep('src/core.ts', `src/lib${i}.ts`);
    const [f] = await run(fragileHubRule, g);
    expect(f.kind).toBe('fragile_hub');
    expect(f.title).toMatch(/^8 files rely on src\/core\.ts/);
    expect(f.why_it_matters).toContain('depends on 6 other files');
  });

  it('flags a hub that contains hard-to-follow code', async () => {
    const g = fanIn(new GraphBuilder(), 'src/core.ts', 8).fn('src/core.ts', 'big', { cc: 20 });
    expect(await run(fragileHubRule, g)).toHaveLength(1);
  });

  it('ignores a simple, stable hub and a file below the bar', async () => {
    expect(await run(fragileHubRule, fanIn(new GraphBuilder(), 'src/core.ts', 12))).toEqual([]);
    const g = fanIn(new GraphBuilder(), 'src/core.ts', 7).fn('src/core.ts', 'big', { cc: 20 });
    expect(await run(fragileHubRule, g)).toEqual([]);
  });

  it('raises the bar to 20% of files in big projects', () => {
    const g = new GraphBuilder();
    for (let i = 0; i < 100; i++) g.file(`f${i}.ts`);
    expect(hubBar(buildHealthContext(g.input()))).toBe(20);
  });
});
