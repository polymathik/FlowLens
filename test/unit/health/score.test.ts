import { describe, it, expect } from 'vitest';
import { buildHealthReport } from '../../../src/health/engine.js';
import { categoryScore, gradeFor, sizeFactor } from '../../../src/health/score.js';
import { GraphBuilder } from './graph-builder.js';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGraph(seed: number): GraphBuilder {
  const r = rng(seed);
  const n = 6 + Math.floor(r() * 25);
  const g = new GraphBuilder();
  for (let i = 0; i < n; i++) {
    g.file(`src/f${i}.ts`, { lines: Math.floor(r() * 700) });
    const fns = Math.floor(r() * 4);
    for (let j = 0; j < fns; j++) g.fn(`src/f${i}.ts`, `fn${j}`, { cc: Math.floor(r() * 40) });
  }
  // DAG edges only (i -> j with j > i) so the base graph starts acyclic.
  for (let k = 0; k < n * 2; k++) {
    const a = Math.floor(r() * (n - 1));
    const b = a + 1 + Math.floor(r() * (n - a - 1));
    g.dep(`src/f${a}.ts`, `src/f${b}.ts`, { line: k + 1 });
  }
  if (r() < 0.5) for (let i = 0; i < n; i++) if (r() < 0.4) g.changes(`src/f${i}.ts`, Math.floor(r() * 12));
  return g;
}

const score = async (g: GraphBuilder) => (await buildHealthReport(g.input(), { now: 'x' })).score;

describe('health scoring', () => {
  it('maps scores to grade bands', () => {
    expect([95, 90, 89, 80, 79, 70, 60, 59, 0].map(gradeFor)).toEqual(['A', 'A', 'B', 'B', 'C', 'C', 'D', 'F', 'F']);
  });

  it('category score decays with penalty and gives large projects slack', () => {
    expect(categoryScore(0, 1)).toBe(100);
    expect(categoryScore(30, 1)).toBe(37);
    expect(categoryScore(30, sizeFactor(320))).toBeGreaterThan(categoryScore(30, 1));
    expect(sizeFactor(5)).toBe(1);
  });

  it('a clean project gets an A with nothing lowering it', async () => {
    const g = new GraphBuilder().dep('src/index.ts', 'src/a.ts').fn('src/a.ts', 'ok', { cc: 3 }).withGit();
    const r = await buildHealthReport(g.input());
    expect(r.grade).toBe('A');
    expect(r.score).toBe(100);
    expect(r.breakdown.sub_scores.every((s) => s.lowered_by.length === 0)).toBe(true);
  });

  it('every sub-score explains what lowered it', async () => {
    const g = new GraphBuilder().dep('a.ts', 'b.ts').dep('b.ts', 'a.ts').fn('a.ts', 'messy', { cc: 40 });
    const r = await buildHealthReport(g.input());
    const tangles = r.breakdown.sub_scores.find((s) => s.category === 'tangles')!;
    expect(tangles.score).toBeLessThan(100);
    expect(tangles.lowered_by[0].title).toMatch(/^Tangle/);
    expect(tangles.explanation).toMatch(/Lowered by 1 problem/);
  });

  it('change risk is n/a without git and its weight is redistributed', async () => {
    const r = await buildHealthReport(new GraphBuilder().file('a.ts').input());
    const change = r.breakdown.sub_scores.find((s) => s.category === 'change_risk')!;
    expect(change.score).toBeNull();
    expect(change.weight).toBe(0);
    const total = r.breakdown.sub_scores.reduce((s, c) => s + c.weight, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it('monotonic: adding a cycle never improves the score (50 random graphs)', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = randomGraph(seed);
      const before = await score(g);
      const n = new Set(g.entities.map((e) => e.file)).size;
      const a = seed % (n - 1);
      g.dep(`src/f${n - 1}.ts`, `src/f${a}.ts`, { line: 999 }); // back-edge closes a loop
      const after = await score(g);
      expect(after, `seed ${seed}`).toBeLessThanOrEqual(before);
    }
  });

  it('monotonic: adding a dependency or a complex function never improves the score', async () => {
    for (let seed = 100; seed < 130; seed++) {
      const g = randomGraph(seed);
      const s0 = await score(g);
      g.dep('src/f0.ts', 'src/f1.ts', { line: 500 }).dep('src/f2.ts', 'src/f0.ts', { line: 501 });
      const s1 = await score(g);
      g.fn('src/f0.ts', 'monster', { cc: 80 });
      const s2 = await score(g);
      expect(s1, `seed ${seed} dep`).toBeLessThanOrEqual(s0);
      expect(s2, `seed ${seed} fn`).toBeLessThanOrEqual(s1);
    }
  });

  it('a more relied-on problem costs more', async () => {
    const lonely = new GraphBuilder().dep('a.ts', 'b.ts').dep('b.ts', 'a.ts');
    for (let i = 0; i < 6; i++) lonely.file(`u${i}.ts`);
    const relied = new GraphBuilder().dep('a.ts', 'b.ts').dep('b.ts', 'a.ts');
    for (let i = 0; i < 6; i++) relied.dep(`u${i}.ts`, 'a.ts');
    expect(await score(relied)).toBeLessThan(await score(lonely));
  });
});
