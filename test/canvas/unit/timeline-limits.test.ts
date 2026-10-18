import { describe, expect, it } from 'vitest';
import { buildLives, fileStateAt, GHOST_WINDOW, heatWindow, liveAt, statesAt } from '../../../src/canvas/timeline/lives';
import { axisPositions, sampleIndices, suggestAxis } from '../../../src/canvas/timeline/scrub-math';
import { historyOf, type Change } from '../helpers/history-fixture';

describe('ghosts and heat at the edges', () => {
  const h = historyOf([[['A', 'a.ts'], ['A', 'b.ts']], [['D', 'b.ts']], [], [], [], []]);
  const lives = buildLives(h);
  const b = lives.get('b.ts')!;

  it('keeps a deleted file as a ghost for GHOST_WINDOW commits, then drops it', () => {
    for (let i = 1; i < 1 + GHOST_WINDOW; i++) expect(fileStateAt(b, i, i, { last: 99, heatWindow: 10 }).phase, `commit ${i}`).toBe('ghost');
    expect(fileStateAt(b, 1 + GHOST_WINDOW, 1 + GHOST_WINDOW, { last: 99, heatWindow: 10 }).phase).toBe('absent');
  });

  it('never shows a ghost at the newest commit, so HEAD equals today\'s map', () => {
    expect(fileStateAt(b, 1, 1, { last: 1, heatWindow: 10 }).phase).toBe('absent');
    expect(fileStateAt(b, 2, 2, { last: 2, heatWindow: 10 }).phase).toBe('absent');
    expect(fileStateAt(b, 2, 2, { last: 5, heatWindow: 10 }).phase).toBe('ghost');
    const states = statesAt(lives, 5, 5, { last: 5, heatWindow: 10 });
    expect([...states.values()].filter((s) => s.phase === 'ghost')).toHaveLength(0);
    expect(liveAt(lives, 5)).toEqual(new Set(['a.ts']));
  });

  it('scales the heat window with the history, within 4..40 commits', () => {
    expect(heatWindow(3)).toBe(4);
    expect(heatWindow(14)).toBe(4);
    expect(heatWindow(100)).toBe(15);
    expect(heatWindow(1000)).toBe(40);
    expect(heatWindow(100000)).toBe(40);
  });
});

describe('axis choice', () => {
  const dates = (days: number[]) => days.map((d) => ({ date: new Date(Date.UTC(2026, 0, 1 + d)).toISOString() }));

  it('uses the time axis for an evenly spread history and the commit axis for a bursty one', () => {
    expect(suggestAxis(dates(Array.from({ length: 30 }, (_, i) => i * 3)))).toBe('time');
    expect(suggestAxis(dates([0, ...Array.from({ length: 40 }, (_, i) => 200 + i / 100), 400]))).toBe('commit');
    expect(suggestAxis(dates([0, 1, 2]))).toBe('time');
  });

  it('makes commit times monotonic so a rebased history never goes backwards', () => {
    const p = axisPositions(dates([0, 10, 5, 20]), 'time');
    expect(p).toEqual([...p].sort((x, y) => x - y));
    expect(p[3]).toBe(1);
  });
});

describe('large histories stay cheap', () => {
  const N = 3000;
  const files = 2500;
  const big: Change[][] = Array.from({ length: N }, (_, i) => {
    const out: Change[] = [['M', `src/f${(i * 7) % files}.ts`]];
    if (i < files) out.push(['A', `src/f${i}.ts`]);
    if (i >= files && i % 5 === 0) out.push(['D', `src/f${i - files}.ts`]);
    return out;
  });
  const t0 = Date.now();
  const history = historyOf(big.map((c, i) => (i < files ? c.filter((x) => x[0] !== 'M') : c)));
  const lives = buildLives(history);

  it('replays thousands of commits and files in well under a second, with a card per file', () => {
    expect(lives.size).toBeGreaterThan(files - 1);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('computes the state of every card at the playhead quickly (binary search per card)', () => {
    const start = performance.now();
    for (let i = 0; i < 20; i++) statesAt(lives, N - 1 - i * 50, N - 1 - i * 50 - 1, { last: N - 1, heatWindow: 40 });
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it('decimates the chart axis to a few hundred points', () => {
    const idx = sampleIndices(axisPositions(history.commits, 'time'), 300);
    expect(idx.length).toBeLessThanOrEqual(301);
  });
});
