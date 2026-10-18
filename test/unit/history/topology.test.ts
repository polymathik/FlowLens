import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryError, type HistoryTopology, type TopologyProgress } from '../../../src/contracts/history.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { runIndex } from '../../../src/indexer/indexer.js';
import { topologyDiff } from '../../../src/analysis/history/index.js';
import { readTopologyCache, topologyPath } from '../../../src/history/cache.js';
import { buildHistory } from '../../../src/history/commits.js';
import { createFileFilter, loadFileFilter } from '../../../src/history/file-filter.js';
import { buildTopology, type BuildTopologyInput } from '../../../src/history/topology.js';
import { wanted } from '../../../src/history/tree-export.js';
import { FALLBACK_CONFIG } from '../../../src/projects/config.js';
import { makeRepo, type Repo } from './git-fixture.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((f) => f())); });

/** a → b; later c → a, c → b; later a stops importing b and d → c is added. */
async function growingRepo(): Promise<Repo> {
  const r = await makeRepo();
  cleanups.push(() => r.cleanup());
  await r.write('src/b.ts', 'export function bee(): number { return 1; }\n');
  await r.write('src/a.ts', "import { bee } from './b';\nexport function ay(): number { return bee() + 1; }\n");
  await r.write('package.json', '{"name":"fixture"}\n');
  r.commit('a imports b');
  await r.write('src/c.ts', "import { ay } from './a';\nimport { bee } from './b';\nexport const c = ay() + bee();\n");
  r.commit('c imports a and b');
  await r.write('src/a.ts', 'export function ay(): number { return 2; }\n');
  await r.write('src/d.ts', "import { c } from './c';\nexport const d = c;\n");
  r.commit('a stops importing b; d imports c');
  await r.write('src/d.ts', "import { c } from './c';\nimport { ay } from './a';\nexport const d = c + ay();\n");
  r.commit('d imports a too');
  return r;
}

async function inputFor(r: Repo, extra: Partial<BuildTopologyInput> = {}): Promise<BuildTopologyInput> {
  const filter = await loadFileFilter(r.dir, FALLBACK_CONFIG);
  const flowlensDir = join(r.dir, '.flowlens');
  const h = await buildHistory({ rootDir: r.dir, flowlensDir, filter });
  return { rootDir: r.dir, flowlensDir, filter, head: h.head, commits: h.commits, ...extra };
}

const edgesOf = (t: HistoryTopology, i: number): string[] =>
  t.samples[i].edges.map(([a, b]) => `${t.files[a]}>${t.files[b]}`).sort();

describe('buildTopology', () => {
  it('produces the file-level dependency edges of every sampled commit, as index pairs into one string table', async () => {
    const r = await growingRepo();
    const t = await buildTopology(await inputFor(r));
    expect(t.samples.map((s) => s.sha)).toEqual((await inputFor(r)).commits.map((c) => c.sha));
    expect(edgesOf(t, 0)).toEqual(['src/a.ts>src/b.ts']);
    expect(edgesOf(t, 1)).toEqual(['src/a.ts>src/b.ts', 'src/c.ts>src/a.ts', 'src/c.ts>src/b.ts']);
    expect(edgesOf(t, 2)).toEqual(['src/c.ts>src/a.ts', 'src/c.ts>src/b.ts', 'src/d.ts>src/c.ts']);
    expect(edgesOf(t, 3)).toContain('src/d.ts>src/a.ts');
    expect(t.samples[0].files.map((i) => t.files[i]).sort()).toEqual(['package.json', 'src/a.ts', 'src/b.ts']);
    expect(new Set(t.files).size).toBe(t.files.length); // string table is deduplicated
    expect(t.samples.flatMap((s) => s.edges).every(([a, b, w]) => a !== b && w >= 1)).toBe(true);
    expect(t).toMatchObject({ version: 1, every: 1, capped: false, skipped: [] });
    expect(await readTopologyCache(join(r.dir, '.flowlens'))).toEqual(t);

    const diff = topologyDiff(t, 1, 2);
    expect(diff.files).toEqual({ added: ['src/d.ts'], removed: [] });
    expect(diff.edges.added.map((e) => `${e.from}>${e.to}`)).toEqual(['src/d.ts>src/c.ts']);
    expect(diff.edges.removed.map((e) => `${e.from}>${e.to}`)).toEqual(['src/a.ts>src/b.ts']);
  });

  it('agrees with the real indexer: the HEAD sample has exactly the file-to-file edges of a full index of that tree', async () => {
    const r = await growingRepo();
    await r.write('src/Shape.ts', 'export class Shape { area(): number { return 0; } }\n');
    await r.write('src/Circle.ts', "import { Shape } from './Shape';\nexport class Circle extends Shape { area(): number { return 3; } }\n");
    await r.write('src/use.ts', "import { Circle } from './Circle';\nimport { ay } from './a';\nexport const total = new Circle().area() + ay();\n");
    r.commit('classes');
    const t = await buildTopology(await inputFor(r));
    const flowlensDir = await mkdtemp(join(tmpdir(), 'flowlens-xcheck-'));
    cleanups.push(() => rm(flowlensDir, { recursive: true, force: true }));
    const store = new LevelGraphStore();
    await store.open(join(flowlensDir, 'graph'));
    let pairs: Set<string>;
    try {
      await runIndex({ rootDir: r.dir, graphStore: store, config: FALLBACK_CONFIG, fileIndexPath: join(flowlensDir, 'file_index.json'), flowlensDir, incremental: false });
      const fileOf = new Map((await store.getAllNodes()).map((n) => [n.id, n.file]));
      pairs = new Set();
      for (const e of await store.getAllEdges()) {
        if (!['import', 'call', 'extend', 'implement'].includes(e.type)) continue;
        const a = fileOf.get(e.from);
        const b = fileOf.get(e.to);
        if (a && b && a !== b) pairs.add(`${a}>${b}`);
      }
    } finally {
      await store.close();
    }
    expect(pairs.size).toBeGreaterThan(5);
    expect(new Set(edgesOf(t, t.samples.length - 1))).toEqual(pairs);
  });

  it('never touches the working tree and removes its temp directories', async () => {
    const r = await growingRepo();
    await r.write('src/uncommitted.ts', "export const wip = 'not committed';\n");
    await r.write('src/a.ts', '// local edit\n');
    const tmpRoot = await mkdtemp(join(tmpdir(), 'flowlens-topo-tmp-'));
    cleanups.push(() => rm(tmpRoot, { recursive: true, force: true }));
    const input = await inputFor(r, { tmpRoot });
    const before = r.git('status', '--porcelain'); // after the history cache exists
    const t = await buildTopology(input);
    expect(r.git('status', '--porcelain')).toBe(before);
    expect(await readFile(join(r.dir, 'src/a.ts'), 'utf8')).toBe('// local edit\n');
    expect(await readdir(tmpRoot)).toEqual([]);
    expect(t.files).not.toContain('src/uncommitted.ts'); // history only, not the working tree
    expect(r.git('worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('reuses stored samples and parses only what is new', async () => {
    const r = await growingRepo();
    const first: string[] = [];
    await buildTopology(await inputFor(r, { onSample: (s) => first.push(s.reused ? 'reused' : 'new') }));
    expect(first).toEqual(['new', 'new', 'new', 'new']);
    await r.write('src/e.ts', "import { d } from './d';\nexport const e = d;\n");
    r.commit('e imports d');
    const second: Array<[string, string]> = [];
    const t = await buildTopology(await inputFor(r, { onSample: (s) => second.push([s.sha.slice(0, 7), s.reused ? 'reused' : 'new']) }));
    expect(second.map(([, k]) => k)).toEqual(['reused', 'reused', 'reused', 'reused', 'new']);
    expect(t.samples).toHaveLength(5);
    expect(edgesOf(t, 4)).toContain('src/e.ts>src/d.ts');
    expect(edgesOf(t, 0)).toEqual(['src/a.ts>src/b.ts']); // re-encoded into the new string table correctly
  });

  it('keeps reusing samples when the history window slides (the oldest commit drops out)', async () => {
    const r = await growingRepo();
    for (let i = 0; i < 12; i++) { await r.write(`src/y${i}.ts`, `export const y${i} = ${i};\n`); r.commit(`y${i}`); }
    const input = await inputFor(r);
    expect(input.commits).toHaveLength(16);
    await buildTopology({ ...input, max: 5 }); // every 4: indices 0, 4, 8, 12, 15
    const kinds: string[] = [];
    const slid = { ...input, commits: input.commits.slice(1), max: 5, onSample: (s: { reused: boolean }) => kinds.push(s.reused ? 'reused' : 'new') };
    const t = await buildTopology(slid);
    expect(kinds.filter((k) => k === 'reused').length).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((k) => k === 'new').length).toBeLessThanOrEqual(2); // the new first slot at most (HEAD was stored)
    expect(t.samples[t.samples.length - 1].sha).toBe(r.sha());
    expect(new Set(t.samples.map((s) => s.sha)).size).toBe(t.samples.length);
  });

  it('chooses evenly spaced samples (first + HEAD) and reports progress', async () => {
    const r = await growingRepo();
    for (let i = 0; i < 6; i++) { await r.write(`src/x${i}.ts`, `export const x${i} = ${i};\n`); r.commit(`x${i}`); }
    const progress: TopologyProgress[] = [];
    const input = await inputFor(r, { every: 3, onProgress: (p) => progress.push(p) });
    const t = await buildTopology(input);
    expect(t.samples.map((s) => s.sha)).toEqual([0, 3, 6, 9].map((i) => input.commits[i].sha));
    expect(t.every).toBe(3);
    expect(progress[0]).toMatchObject({ done: 0, total: 4 });
    expect(progress[progress.length - 1]).toMatchObject({ done: 4, total: 4, skipped: 0, current: null });
    expect(progress.map((p) => p.done)).toEqual([...progress.map((p) => p.done)].sort((a, b) => a - b));
  });

  it('skips a sample that cannot be read and says why, then carries on', async () => {
    const r = await growingRepo();
    const input = await inputFor(r);
    const bad = '0123456789abcdef0123456789abcdef01234567';
    const commits = [input.commits[0], { ...input.commits[1], sha: bad }, input.commits[2]];
    const t = await buildTopology({ ...input, commits });
    expect(t.samples.map((s) => s.sha)).toEqual([input.commits[0].sha, input.commits[2].sha]);
    expect(t.skipped).toHaveLength(1);
    expect(t.skipped[0].sha).toBe(bad);
    expect(t.skipped[0].reason).toMatch(/\S/);
  });

  it('stops after two timeouts in a row (a timed-out parse cannot be killed) and marks the result capped', async () => {
    const r = await growingRepo();
    const t = await buildTopology(await inputFor(r, { sampleTimeoutMs: -1 }));
    expect(t.samples).toEqual([]);
    expect(t.skipped).toHaveLength(2);
    expect(t.skipped[0].reason).toMatch(/Timed out/);
    expect(t.capped).toBe(true);
  });

  it('can be cancelled: rejects with aborted and leaves no topology.json', async () => {
    const r = await growingRepo();
    const ac = new AbortController();
    const input = await inputFor(r, { signal: ac.signal, onProgress: (p) => { if (p.done === 1) ac.abort(); } });
    await expect(buildTopology(input)).rejects.toMatchObject({ code: 'aborted' });
    await expect(readFile(topologyPath(input.flowlensDir))).rejects.toThrow();
    await expect(buildTopology({ ...input, signal: AbortSignal.abort() })).rejects.toBeInstanceOf(HistoryError);
  });

  it('thins the middle samples when topology.json would exceed its size cap', async () => {
    const r = await growingRepo();
    const t = await buildTopology(await inputFor(r, { maxStoreBytes: 400 }));
    expect(t.capped).toBe(true);
    expect(t.samples.length).toBeLessThan(4);
    expect(t.samples[0].sha).toBe((await inputFor(r)).commits[0].sha);
    expect(t.samples[t.samples.length - 1].sha).toBe(r.sha());
  });

  it('exports only indexable files plus the resolver inputs, honouring ignore rules', () => {
    const f = createFileFilter(['dist/', 'node_modules/'], ['.ts']);
    expect(wanted(f, 'src/a.ts')).toBe(true);
    expect(wanted(f, 'packages/x/tsconfig.base.json')).toBe(true);
    expect(wanted(f, 'package.json')).toBe(true);
    expect(wanted(f, 'go.mod')).toBe(true);
    expect(wanted(f, 'dist/a.ts')).toBe(false);
    expect(wanted(f, 'node_modules/x/package.json')).toBe(false);
    expect(wanted(f, 'assets/logo.png')).toBe(false);
    expect(wanted(f, '.github/package.json')).toBe(false);
  });
});
