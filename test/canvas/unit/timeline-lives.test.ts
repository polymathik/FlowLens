import { describe, expect, it } from 'vitest';
import { snapshotAt } from '../../../src/analysis/history/index.js';
import { ANIMATE_MAX_STEP, buildLives, endedPaths, fileStateAt, GHOST_WINDOW, liveAt, statesAt } from '../../../src/canvas/timeline/lives';
import { compareFiles } from '../../../src/canvas/timeline/compare';
import { historyOf, STORY } from '../helpers/history-fixture';

const history = historyOf(STORY);
const lives = buildLives(history);

describe('timeline lives (today\'s names across renames, deletes and re-adds)', () => {
  it('books a renamed file to the card of its final path, alive from its first commit', () => {
    expect(lives.has('packages/server/src/older.ts')).toBe(false);
    const a = lives.get('packages/server/src/a.ts')!;
    expect(a.born).toEqual([0]);
    expect(a.died).toEqual([Infinity]);
    expect(a.changes).toEqual([3, 7]); // the rename and the later edit
  });

  it('keeps one card with two intervals for a deleted and re-added path', () => {
    const t = lives.get('docs/tool.ts')!;
    expect(t.born).toEqual([5, 7]);
    expect(t.died).toEqual([6, Infinity]);
  });

  it('agrees with snapshotAt on how many files exist after every commit, and on which (no renames in play)', () => {
    for (let i = 0; i < history.commits.length; i++) {
      const snap = snapshotAt(history, i).files;
      const live = liveAt(lives, i);
      expect(live.size, `commit ${i}`).toBe(snap.size);
      if (i < 3) expect([...live].sort()).toEqual([...snap.keys()].filter((p) => p !== 'packages/server/src/older.ts').concat(i >= 0 ? ['packages/server/src/a.ts'] : []).sort());
    }
  });

  it('lists the cards whose last life ended (the ghost-only ones plus nothing alive)', () => {
    expect(endedPaths(lives).sort()).toEqual(['gone/x.ts', 'packages/server/legacy/old.ts']);
  });

  it('is absent before birth, live while alive, a ghost for GHOST_WINDOW commits after a delete, then gone', () => {
    const old = lives.get('packages/server/legacy/old.ts')!; // born 2, died 4
    expect(fileStateAt(old, 1, 1).phase).toBe('absent');
    expect(fileStateAt(old, 3, 3).phase).toBe('live');
    const ghost = fileStateAt(old, 4, 3);
    expect(ghost.phase).toBe('ghost');
    expect(ghost.deletedAt).toBe(4);
    expect(fileStateAt(old, 4 + GHOST_WINDOW - 1, 4).phase).toBe('ghost');
    expect(fileStateAt(old, 4 + GHOST_WINDOW, 4).phase).toBe('absent');
  });

  it('flags entering files and modified files on forward steps only', () => {
    const ids = lives.get('packages/core/src/ids.ts')!; // born 0, modified at 1
    expect(fileStateAt(ids, 0, -1).entered).toBe(true);
    const mod = fileStateAt(ids, 1, 0);
    expect(mod).toMatchObject({ phase: 'live', entered: false, pulsed: true });
    expect(fileStateAt(ids, 1, 1)).toMatchObject({ entered: false, pulsed: false }); // no previous step
    expect(fileStateAt(ids, 0, 1)).toMatchObject({ entered: false, pulsed: false }); // backwards
    expect(fileStateAt(ids, 1, 1 - ANIMATE_MAX_STEP - 1)).toMatchObject({ entered: false, pulsed: false }); // a big jump just shows the state
  });

  it('a re-added file enters again and a rename pulses the card', () => {
    const t = lives.get('docs/tool.ts')!;
    expect(fileStateAt(t, 7, 6).entered).toBe(true);
    expect(fileStateAt(lives.get('packages/server/src/a.ts')!, 3, 2).pulsed).toBe(true);
  });

  it('recency heat is 1 right after a change and fades to 0', () => {
    const a = lives.get('packages/server/src/a.ts')!;
    expect(fileStateAt(a, 3, 3).heat).toBe(1);
    expect(fileStateAt(a, 6, 6).heat).toBeLessThan(1);
    expect(fileStateAt(a, 6, 6).heat).toBeGreaterThan(0.8);
    const long = historyOf([[['A', 'x.ts']], ...Array.from({ length: 40 }, () => [] as never[])]);
    expect(fileStateAt(buildLives(long).get('x.ts')!, 40, 40).heat).toBe(0);
  });

  it('files that existed before a truncated window are alive from the start without heat', () => {
    const h = historyOf([[['M', 'old.ts']], [['A', 'new.ts']]], { truncated: true, baseline: ['old.ts', 'older.ts'] });
    const l = buildLives(h);
    expect(l.get('older.ts')!.born).toEqual([-1]);
    expect(fileStateAt(l.get('older.ts')!, 0, 0)).toMatchObject({ phase: 'live', heat: 0 });
    expect(liveAt(l, 0).size).toBe(snapshotAt(h, 0).files.size);
  });

  it('statesAt covers every card', () => {
    expect(statesAt(lives, 4, 3).size).toBe(lives.size);
  });
});

describe('compare two commits', () => {
  it('lists files added, removed and changed from A to B', () => {
    const c = compareFiles(lives, 1, 7);
    expect([...c.added].sort()).toEqual(['apps/web/src/app.ts', 'docs/tool.ts']);
    expect([...c.removed].sort()).toEqual(['gone/x.ts']);
    expect([...c.changed].sort()).toEqual(['packages/server/src/a.ts']);
  });
  it('is directional: going back swaps added and removed', () => {
    const fwd = compareFiles(lives, 1, 7);
    const back = compareFiles(lives, 7, 1);
    expect([...back.removed].sort()).toEqual([...fwd.added].sort());
    expect([...back.added].sort()).toEqual([...fwd.removed].sort());
  });
  it('a file deleted and re-added between A and B counts as changed', () => {
    expect(compareFiles(lives, 5, 7).changed.has('docs/tool.ts')).toBe(true);
  });
  it('is empty for the same commit', () => {
    const c = compareFiles(lives, 3, 3);
    expect(c.added.size + c.removed.size + c.changed.size).toBe(0);
  });
});
