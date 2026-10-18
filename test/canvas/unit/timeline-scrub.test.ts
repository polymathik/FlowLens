import { describe, expect, it } from 'vitest';
import { axisPositions, dateTicks, density, formatDate, fractionOf, indexAtFraction, sampleIndices } from '../../../src/canvas/timeline/scrub-math';
import { BASE_RATE, clampIndex, MAX_FRAME_MS, playStart, SPEEDS, tick } from '../../../src/canvas/timeline/playback';

const at = (...iso: string[]) => iso.map((date) => ({ date }));

describe('scrubber math', () => {
  it('places commits by time, or evenly by commit', () => {
    const commits = at('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-11T00:00:00Z');
    expect(axisPositions(commits, 'time')).toEqual([0, 0.1, 1]);
    expect(axisPositions(commits, 'commit')).toEqual([0, 0.5, 1]);
  });
  it('falls back to even steps when every commit has the same time, and survives one or none', () => {
    expect(axisPositions(at('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), 'time')).toEqual([0, 0.5, 1]);
    expect(axisPositions(at('2026-01-01T00:00:00Z'), 'time')).toEqual([0]);
    expect(axisPositions([], 'time')).toEqual([]);
  });
  it('keeps positions non-decreasing when committer dates go backwards', () => {
    const p = axisPositions(at('2026-01-03T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'), 'time');
    expect(p).toEqual([0, 0, 1]);
  });
  it('maps a pointer fraction to the nearest commit, clamped', () => {
    const p = [0, 0.1, 1];
    expect(indexAtFraction(p, 0)).toBe(0);
    expect(indexAtFraction(p, 0.04)).toBe(0);
    expect(indexAtFraction(p, 0.06)).toBe(1);
    expect(indexAtFraction(p, 0.5)).toBe(1);
    expect(indexAtFraction(p, 0.56)).toBe(2);
    expect(indexAtFraction(p, 9)).toBe(2);
    expect(indexAtFraction(p, -3)).toBe(0);
    expect(indexAtFraction([], 0.5)).toBe(0);
  });
  it('round-trips: the position of commit i selects commit i', () => {
    const commits = Array.from({ length: 200 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1, 0, i * i)).toISOString() }));
    for (const mode of ['time', 'commit'] as const) {
      const p = axisPositions(commits, mode);
      const bad = p.map((f, i) => (indexAtFraction(p, f) === i ? -1 : i)).filter((i) => i >= 0 && p[i] !== p[i - 1] && p[i] !== p[i + 1]);
      expect(bad).toEqual([]);
    }
  });
  it('converts a pointer x to a fraction inside the box', () => {
    expect(fractionOf(150, 100, 200)).toBe(0.25);
    expect(fractionOf(50, 100, 200)).toBe(0);
    expect(fractionOf(500, 100, 200)).toBe(1);
    expect(fractionOf(10, 0, 0)).toBe(0);
  });
  it('counts commits per bucket for the sparkline', () => {
    expect(density([0, 0.01, 0.02, 0.5, 1], 4)).toEqual([3, 0, 1, 1]);
  });
  it('decimates a long series to one point per column, keeping the first and last commit', () => {
    const n = 5000;
    const p = Array.from({ length: n }, (_, i) => i / (n - 1));
    const idx = sampleIndices(p, 300);
    expect(idx.length).toBeLessThanOrEqual(301);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(sampleIndices([0, 0.5, 1], 300)).toEqual([0, 1, 2]);
  });
  it('puts a tick on every month start with readable labels', () => {
    const commits = at('2026-01-15T00:00:00Z', '2026-04-20T00:00:00Z');
    const p = axisPositions(commits, 'time');
    const ticks = dateTicks(commits, p, 10);
    expect(ticks.map((t) => t.label)).toEqual(['Feb ’26', 'Mar', 'Apr']);
    expect(ticks[0].frac).toBeGreaterThan(0);
    expect(ticks[2].frac).toBeLessThan(1);
    expect(ticks.map((t) => t.frac)).toEqual([...ticks.map((t) => t.frac)].sort((a, b) => a - b));
    expect(dateTicks(commits, p, 2).length).toBeLessThanOrEqual(2);
  });
  it('uses days for a short history and years for a very long one', () => {
    const short = at('2026-03-01T10:00:00Z', '2026-03-05T10:00:00Z');
    expect(dateTicks(short, axisPositions(short, 'time'), 10).map((t) => t.label)).toEqual(['Mar 2', 'Mar 3', 'Mar 4', 'Mar 5']);
    const long = at('2010-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
    expect(dateTicks(long, axisPositions(long, 'time'), 30).map((t) => t.label).slice(0, 2)).toEqual(['2011', '2012']);
  });
  it('formats dates in UTC', () => {
    expect(formatDate('2026-03-24T13:27:05+07:00')).toBe('24 Mar 2026');
    expect(formatDate('nonsense')).toBe('nonsense');
  });
});

describe('playback', () => {
  it('advances by BASE_RATE × speed commits per second and carries the fraction', () => {
    let s = { index: 0, carry: 0 };
    s = tick(s, 100, 1, 99); // 0.4 commits
    expect(s).toMatchObject({ index: 0, done: false });
    s = tick(s, 100, 1, 99); // 0.8
    s = tick(s, 100, 1, 99); // 1.2 → one whole commit
    expect(s.index).toBe(1);
    expect(s.carry).toBeCloseTo(0.2, 5);
    expect(tick({ index: 0, carry: 0 }, 250, 4, 99).index).toBe(BASE_RATE * 4 * 0.25);
    expect(tick({ index: 0, carry: 0 }, 200, 16, 999).index).toBe(Math.floor(0.2 * BASE_RATE * 16));
  });
  it('is deterministic whatever the frame rate: the same wall time lands on the same commit', () => {
    const run = (dt: number) => {
      let s = { index: 0, carry: 0 };
      for (let t = 0; t < 2000; t += dt) s = tick(s, dt, 4, 999);
      return s.index;
    };
    expect(run(50)).toBe(run(125));
    expect(run(50)).toBe(32);
  });
  it('stops at the newest commit and never passes it', () => {
    const r = tick({ index: 8, carry: 0 }, 1000, 16, 10);
    expect(r).toMatchObject({ index: 10, done: true, carry: 0 });
    expect(tick({ index: 10, carry: 0.5 }, 100, 1, 10)).toMatchObject({ index: 10, done: true });
  });
  it('clamps a long frame (a background tab) instead of fast-forwarding history', () => {
    expect(tick({ index: 0, carry: 0 }, 60_000, 1, 999).index).toBe(Math.floor((MAX_FRAME_MS / 1000) * BASE_RATE));
    expect(tick({ index: 0, carry: 0 }, -5, 1, 999).index).toBe(0);
  });
  it('offers 1×, 4× and 16×', () => {
    expect([...SPEEDS]).toEqual([1, 4, 16]);
  });
  it('replays from the beginning when play is pressed at the newest commit', () => {
    expect(playStart(10, 10)).toBe(0);
    expect(playStart(4, 10)).toBe(4);
  });
  it('clamps indices to the commits', () => {
    expect(clampIndex(-3, 10)).toBe(0);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(3.9, 10)).toBe(3);
    expect(clampIndex(5, 0)).toBe(0);
  });
});
