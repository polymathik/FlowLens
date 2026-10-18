import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { HistoryCommit, HistorySummary, HistoryTopology } from '../../../src/contracts/history.js';
import { growthByZone, snapshotAt, recencyHeat, commitIndex, topologyDiff, BEFORE_WINDOW } from '../../../src/analysis/history/index.js';
import { buildHistory } from '../../../src/history/commits.js';
import { loadFileFilter } from '../../../src/history/file-filter.js';
import { FALLBACK_CONFIG } from '../../../src/projects/config.js';
import { makeRepo, type Repo } from './git-fixture.js';

const sha = (n: number): string => String(n).repeat(40).slice(0, 40);
const commit = (n: number, files: HistoryCommit['files']): HistoryCommit => ({ sha: sha(n), parents: n > 0 ? [sha(n - 1)] : [], date: `2026-01-0${n + 1}T00:00:00Z`, author: 'a', subject: `c${n}`, files });
const A = (path: string, added: number) => ({ path, status: 'A' as const, added, deleted: 0 });
const M = (path: string, added: number, deleted: number) => ({ path, status: 'M' as const, added, deleted });
const D = (path: string, deleted: number) => ({ path, status: 'D' as const, added: 0, deleted });
const R = (from: string, path: string, added = 0, deleted = 0) => ({ path, status: 'R' as const, from, added, deleted });
const hist = (commits: HistoryCommit[], extra: Partial<HistorySummary> = {}): Pick<HistorySummary, 'commits' | 'baseline' | 'truncated'> =>
  ({ commits, truncated: false, ...extra });

describe('snapshotAt', () => {
  const h = hist([
    commit(0, [A('src/a.ts', 10), A('src/b.ts', 5)]),
    commit(1, [M('src/a.ts', 4, 2), R('src/b.ts', 'lib/b.ts', 1, 0)]),
    commit(2, [D('src/a.ts', 12), A('src/c.ts', 3)]),
    commit(3, [A('src/a.ts', 1)]), // re-added after deletion: a new lineage
  ]);

  it('tracks live files with first-seen / last-changed / loc / touch count', () => {
    const s = snapshotAt(h, 1);
    expect([...s.files.keys()].sort()).toEqual(['lib/b.ts', 'src/a.ts']);
    expect(s.files.get('src/a.ts')).toEqual({ first_seen: 0, last_changed: 1, loc: 12, commits: 2 });
    expect(s.files.get('lib/b.ts')).toEqual({ first_seen: 0, last_changed: 1, loc: 6, commits: 2 }); // rename keeps first_seen
    expect(s.sha).toBe(sha(1));
    expect(s.ghosts.size).toBe(0);
  });

  it('deleted files become ghosts until re-added, then start a new lineage', () => {
    const s2 = snapshotAt(h, 2);
    expect([...s2.files.keys()].sort()).toEqual(['lib/b.ts', 'src/c.ts']);
    expect([...s2.ghosts]).toEqual([['src/a.ts', 2]]);
    const s3 = snapshotAt(h, 3);
    expect(s3.ghosts.size).toBe(0);
    expect(s3.files.get('src/a.ts')).toEqual({ first_seen: 3, last_changed: 3, loc: 1, commits: 1 });
  });

  it('clamps the index; -1 is the state before the first commit (the baseline)', () => {
    expect(snapshotAt(h, 99).index).toBe(3);
    const before = snapshotAt(hist(h.commits, { baseline: ['old.ts'], truncated: true }), -5);
    expect(before.index).toBe(-1);
    expect(before.sha).toBeNull();
    expect(before.files.get('old.ts')).toEqual({ first_seen: BEFORE_WINDOW, last_changed: BEFORE_WINDOW, loc: 0, commits: 0 });
  });

  it('is lenient with a truncated window: modifying an unknown file creates it as pre-existing', () => {
    const w = hist([commit(0, [M('x.ts', 3, 1), D('never-seen.ts', 4), R('gone.ts', 'moved.ts', 2, 0)])], { truncated: true });
    const s = snapshotAt(w, 0);
    expect(s.files.get('x.ts')).toMatchObject({ first_seen: BEFORE_WINDOW, last_changed: 0, loc: 2 });
    expect(s.files.get('moved.ts')?.first_seen).toBe(BEFORE_WINDOW);
    expect(s.ghosts.size).toBe(0);
  });

  it('recencyHeat fades with distance and is 0 for pre-window files', () => {
    expect(recencyHeat({ last_changed: 10 }, 10)).toBe(1);
    expect(recencyHeat({ last_changed: 10 }, 35, 50)).toBeCloseTo(0.5);
    expect(recencyHeat({ last_changed: 10 }, 500)).toBe(0);
    expect(recencyHeat({ last_changed: BEFORE_WINDOW }, 0)).toBe(0);
    expect(commitIndex(h, sha(2))).toBe(2);
    expect(commitIndex(h, sha(2).slice(0, 8))).toBe(2);
    expect(commitIndex(h, 'nope1234')).toBe(-1);
  });
});

describe('growthByZone', () => {
  // today: src/a.ts deleted, lib/b.ts (renamed from src/b.ts) and src/c.ts and src/a.ts (re-added) live
  const h = hist([
    commit(0, [A('src/a.ts', 10), A('src/b.ts', 5)]),
    commit(1, [M('src/a.ts', 4, 2), R('src/b.ts', 'lib/b.ts', 1, 0)]),
    commit(2, [D('src/a.ts', 12), A('src/c.ts', 3), A('tmp/gone.ts', 8)]),
    commit(3, [A('src/a.ts', 1), D('tmp/gone.ts', 8)]),
  ]);
  const zoneOf = (p: string): string | null => (p.startsWith('lib/') ? 'lib' : p.startsWith('src/') ? 'src' : null);

  it('books a file to the zone of its final path (renames keep their zone) and counts ghosts', () => {
    const g = growthByZone(h, zoneOf);
    const z = Object.fromEntries(g.zones.map((s) => [String(s.zone), s]));
    expect(g.length).toBe(4);
    // b.ts was renamed src/ -> lib/ at commit 1: it belongs to "lib" for its whole life
    expect(z.lib.files).toEqual([1, 1, 1, 1]);
    expect(z.lib.loc).toEqual([5, 6, 6, 6]);
    // src: a.ts (0..1 live, deleted at 2, new lineage at 3), c.ts at 2
    expect(z.src.files).toEqual([1, 1, 1, 2]); // a(0) | a(1) | c (a gone) | a' + c
    expect(z.src.ghosts).toEqual([0, 0, 1, 1]);
    expect(z.src.loc).toEqual([10, 12, 3, 4]);
    // tmp/gone.ts: no zone today -> the null series; added at 2, deleted at 3 (a ghost)
    expect(z.null.files).toEqual([0, 0, 1, 0]);
    expect(z.null.ghosts).toEqual([0, 0, 0, 1]);
    // totals are sums
    expect(g.total.files).toEqual([2, 2, 3, 3]);
    expect(g.total.loc).toEqual([15, 18, 17, 10]);
    expect(g.total.ghosts).toEqual([0, 0, 1, 2]);
  });

  it('a deleted file is placed by a prefix-style zoneOfPath through its last path', () => {
    const byFolder = (p: string): string | null => p.split('/')[0] ?? null;
    const g = growthByZone(h, byFolder);
    expect(g.zones.map((s) => s.zone).sort()).toEqual(['lib', 'src', 'tmp']);
    expect(g.zones.find((s) => s.zone === 'tmp')?.ghosts).toEqual([0, 0, 0, 1]);
  });

  it('starts from the baseline of a truncated window', () => {
    const w = hist([commit(0, [M('src/old.ts', 3, 1), A('src/new.ts', 4)]), commit(1, [D('src/old.ts', 9)])], { truncated: true, baseline: ['src/old.ts', 'lib/keep.ts'] });
    const g = growthByZone(w, (p) => p.split('/')[0]);
    const z = Object.fromEntries(g.zones.map((s) => [String(s.zone), s]));
    expect(z.src.files).toEqual([2, 1]);
    expect(z.src.ghosts).toEqual([0, 1]);
    expect(z.lib.files).toEqual([1, 1]);
    expect(g.total.files).toEqual([3, 2]);
  });

  it('handles an empty history', () => {
    expect(growthByZone(hist([]), () => 'x')).toMatchObject({ length: 0, zones: [], total: { files: [] } });
  });
});

describe('snapshotAt equals git (oracle) on a real history with renames, deletes, re-adds', () => {
  let repo: Repo | undefined;
  afterAll(async () => repo?.cleanup());

  it('live files after every commit == filtered ls-tree of that commit; growth totals agree', async () => {
    repo = await makeRepo();
    const body = (n: number): string => Array.from({ length: 12 + n }, (_, i) => `export const x${i} = ${i};`).join('\n') + '\n';
    await repo.write('src/a.ts', body(0)); await repo.write('src/b.ts', body(1)); repo.commit('1');
    await repo.write('src/c.ts', body(2)); repo.commit('2');
    await repo.mv('src/b.ts', 'lib/b.ts'); repo.commit('3 rename');
    repo.git('rm', '-q', 'src/a.ts'); repo.commit('4 delete');
    await repo.write('src/a.ts', body(5)); repo.commit('5 re-add');
    await repo.mv('lib/b.ts', 'lib/deep/b2.ts'); await repo.write('lib/deep/b2.ts', body(1) + '// edit\n'); repo.commit('6 rename+edit');
    await repo.write('src/d.ts', body(3)); repo.git('rm', '-q', 'src/c.ts'); repo.commit('7 add+delete');
    const filter = await loadFileFilter(repo.dir, FALLBACK_CONFIG);
    const h = await buildHistory({ rootDir: repo.dir, flowlensDir: join(repo.dir, '.flowlens'), filter });
    expect(h.commits).toHaveLength(7);
    h.commits.forEach((c, i) => {
      const tree = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', c.sha], { cwd: repo!.dir, encoding: 'utf8' })
        .split('\0').filter((p) => filter.accepts(p)).sort();
      expect([...snapshotAt(h, i).files.keys()].sort()).toEqual(tree);
    });
    const g = growthByZone(h, (p) => p.split('/')[0]);
    expect(g.total.files).toEqual(h.commits.map((_, i) => snapshotAt(h, i).files.size));
    const finalLoc = [...snapshotAt(h, 6).files.values()].reduce((n, f) => n + f.loc, 0);
    expect(g.total.loc[6]).toBe(finalLoc);
    expect(g.total.ghosts[6]).toBe(1); // only a.ts was deleted; b -> b2 and c -> d (similar content) are renames
  });
});

describe('topologyDiff', () => {
  const topo: Pick<HistoryTopology, 'files' | 'samples'> = {
    files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    samples: [
      { sha: sha(1), date: 'x', files: [0, 1, 2], edges: [[0, 1, 2], [1, 2, 1], [0, 2, 1]] },
      { sha: sha(2), date: 'y', files: [0, 1, 3], edges: [[0, 1, 5], [1, 3, 1], [3, 0, 1]] },
    ],
  };

  it('reports added / removed / re-weighted files and edges by path', () => {
    const d = topologyDiff(topo, 0, 1);
    expect(d.files).toEqual({ added: ['d.ts'], removed: ['c.ts'] });
    expect(d.edges.added).toEqual([{ from: 'b.ts', to: 'd.ts', weight: 1 }, { from: 'd.ts', to: 'a.ts', weight: 1 }]);
    expect(d.edges.removed).toEqual([{ from: 'a.ts', to: 'c.ts', weight: 1 }, { from: 'b.ts', to: 'c.ts', weight: 1 }]);
    expect(d.edges.changed).toEqual([{ from: 'a.ts', to: 'b.ts', weight: 5, was: 2 }]);
  });

  it('accepts sample objects and shas, is symmetric, and rejects unknown samples', () => {
    const fwd = topologyDiff(topo, topo.samples[0], sha(2));
    const back = topologyDiff(topo, sha(2), 0);
    expect(back.files).toEqual({ added: fwd.files.removed, removed: fwd.files.added });
    expect(back.edges.added).toEqual(fwd.edges.removed);
    expect(topologyDiff(topo, 1, 1)).toEqual({ files: { added: [], removed: [] }, edges: { added: [], removed: [], changed: [] } });
    expect(() => topologyDiff(topo, 0, 9)).toThrow(RangeError);
  });
});
