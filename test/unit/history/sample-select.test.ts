import { describe, it, expect } from 'vitest';
import { pickSamples, planSamples } from '../../../src/history/sample-select.js';

describe('planSamples', () => {
  it('samples every commit while the history is short; always first and last', () => {
    expect(planSamples(0)).toEqual({ indices: [], every: 1, capped: false });
    expect(planSamples(1).indices).toEqual([0]);
    expect(planSamples(2).indices).toEqual([0, 1]);
    const p = planSamples(10);
    expect(p.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.every).toBe(1);
  });

  it('never exceeds max (default 25), anchors the stride at the first commit and ends at HEAD', () => {
    for (const n of [26, 40, 100, 183, 1999, 20_000]) {
      const p = planSamples(n);
      expect(p.indices.length).toBeLessThanOrEqual(25);
      expect(p.indices[0]).toBe(0);
      expect(p.indices[p.indices.length - 1]).toBe(n - 1);
      p.indices.slice(0, -2).forEach((v, i) => expect(v).toBe(i * p.every));
      expect(p.capped).toBe(false); // the default plan is not a capped request
    }
  });

  it('honours every / max and reports when a request was thinned', () => {
    expect(planSamples(40, { every: 10 }).indices).toEqual([0, 10, 20, 30, 39]);
    const thin = planSamples(1000, { every: 1, max: 10 });
    expect(thin.indices.length).toBeLessThanOrEqual(10);
    expect(thin.capped).toBe(true);
    expect(planSamples(1000, { max: 500 }).indices.length).toBeLessThanOrEqual(60); // hard cap
  });

  it('is stable while history grows: new commits only add samples at the end until the stride changes', () => {
    const a = planSamples(100, { max: 10 });
    const b = planSamples(a.every * 3 + 1 + 100, { max: 10 });
    if (a.every === b.every) a.indices.slice(0, -1).forEach((i) => expect(b.indices).toContain(i));
    const c = planSamples(105, { max: 10 });
    expect(c.every).toBe(a.every);
    a.indices.slice(0, -1).forEach((i) => expect(c.indices).toContain(i));
  });
});

describe('pickSamples', () => {
  const plan = planSamples(100, { max: 10 }); // every 12 (half a stride = 6): 0, 12, …, 96, 99
  const none = new Set<number>();

  it('parses every planned commit when nothing is stored', () => {
    expect(pickSamples(plan, none)).toEqual(plan.indices.map((index) => ({ index, reuse: false })));
  });

  it('reuses stored samples that slid by one commit; only the first slot and HEAD are parsed', () => {
    const stored = new Set(plan.indices.filter((i) => i > 0 && i < 99).map((i) => i - 1));
    const picks = pickSamples(plan, stored);
    expect(picks.filter((p) => p.reuse).map((p) => p.index)).toEqual([...stored].sort((a, b) => a - b));
    expect(picks.filter((p) => !p.reuse).map((p) => p.index)).toEqual([0, 99]);
    expect(picks.map((p) => p.index)).toEqual([...picks.map((p) => p.index)].sort((a, b) => a - b));
  });

  it('takes a stored sample at most half a stride from a slot, and each stored sample once', () => {
    expect(pickSamples(plan, new Set([20])).map((p) => p.index)).toContain(20); // 4 from slot 24
    expect(pickSamples(plan, new Set([20])).map((p) => p.index)).not.toContain(24);
    expect(pickSamples(plan, new Set([5]))[0]).toEqual({ index: 5, reuse: true }); // 5 from slot 0
    expect(pickSamples(plan, new Set([7])).map((p) => p.index)).toEqual(plan.indices.map((i) => (i === 12 ? 7 : i))); // 7 from slot 0 is too far, 5 from slot 12 is fine
    const tie = pickSamples(plan, new Set([6])); // 6 from slot 0 and from slot 12: the earlier slot gets it
    expect(tie.filter((p) => p.index === 6)).toEqual([{ index: 6, reuse: true }]);
    expect(tie.find((p) => p.index === 12)).toEqual({ index: 12, reuse: false });
  });

  it('is exact for HEAD and when every commit is sampled', () => {
    expect(pickSamples(plan, new Set([98]))[pickSamples(plan, new Set([98])).length - 1]).toEqual({ index: 99, reuse: false });
    expect(pickSamples(planSamples(10), new Set([3])).find((p) => p.index === 3)).toEqual({ index: 3, reuse: true });
    expect(pickSamples(planSamples(10), new Set([3])).filter((p) => p.reuse)).toHaveLength(1);
  });
});
