/**
 * Watch mode keeps Phase 8 graph truth end to end: a real chokidar watcher
 * (`startWatching` with a direct LevelGraphStore) on a copy of the canvas
 * sample-app fixture.
 *
 *   - Re-adding lib/util/strings.ts links its unchanged importers
 *     (core/model.ts, lib/util/numbers.ts): import + call edges appear.
 *   - Deleting src/ui/widgets.ts leaves no dangling edge; view.ts keeps an
 *     explicit unresolved record instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { runIndex } from '../../src/indexer/indexer.js';
import { startWatching, type StopWatching, type WatchUpdate } from '../../src/service/watch-session.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';

const SAMPLE_APP = resolve(import.meta.dirname, '../canvas/fixtures/sample-app');
const CONFIG: FlowLensConfig = {
  exclude: ['architecture.json'],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('watch mode keeps cross-file edges (real watcher)', () => {
  let base: string;
  let root: string;
  let graph: LevelGraphStore;
  let stop: StopWatching;
  const updates: WatchUpdate[] = [];
  let stringsSrc: string;

  const edges = async (): Promise<string[]> => {
    const qn = new Map((await graph.getAllNodes()).map((n) => [n.id, n.qualified_name]));
    return (await graph.getAllEdges()).map((e) => `${qn.get(e.from) ?? `?${e.from}`} -${e.type}-> ${qn.get(e.to) ?? `?${e.to}`}`);
  };
  const waitFor = async (pred: () => Promise<boolean>, ms = 15_000): Promise<void> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await pred()) return;
      await sleep(100);
    }
    throw new Error(`condition not met in ${ms} ms; updates: ${JSON.stringify(updates)}`);
  };

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'flowlens-watch-truth-'));
    root = join(base, 'sample-app');
    await cp(SAMPLE_APP, root, { recursive: true });
    stringsSrc = await readFile(join(root, 'lib/util/strings.ts'), 'utf8');
    await rm(join(root, 'lib/util/strings.ts'));
    const flowlensDir = join(root, '.flowlens');
    await mkdir(flowlensDir);
    await writeFile(join(flowlensDir, 'config.json'), JSON.stringify(CONFIG));
    graph = new LevelGraphStore();
    await graph.open(join(flowlensDir, 'graph'));
    await runIndex({ rootDir: root, graphStore: graph, config: CONFIG, fileIndexPath: join(flowlensDir, 'file_index.json'), incremental: false });
    stop = await startWatching(graph, root, { debounceMs: 100, onUpdate: (u) => updates.push(u) });
  }, 60_000);

  afterAll(async () => {
    await stop?.();
    await graph?.close();
    await rm(base, { recursive: true, force: true });
  });

  it('starts without the edges into the missing file', async () => {
    const e = await edges();
    expect(e).not.toContain('src/core/model.ts -import-> lib/util/strings.ts');
    expect(e).toContain('src/ui/view.ts/renderUser -call-> src/ui/widgets.ts/badge');
  });

  it('adding a file links unchanged importers to it', async () => {
    await writeFile(join(root, 'lib/util/strings.ts'), stringsSrc);
    await waitFor(async () => (await edges()).includes('src/core/model.ts/User.id -call-> lib/util/strings.ts/slugify'));
    expect(await edges()).toEqual(expect.arrayContaining([
      'src/core/model.ts -import-> lib/util/strings.ts',
      'lib/util/numbers.ts -import-> lib/util/strings.ts',
      'lib/util/numbers.ts/pad -call-> lib/util/strings.ts/slugify',
    ]));
    const u = updates.at(-1)!;
    expect(u).toMatchObject({ filesReparsed: 1, filesDeleted: 0, errors: [] });
  }, 30_000);

  it('deleting a file leaves no dangling edges', async () => {
    const before = updates.length;
    await rm(join(root, 'src/ui/widgets.ts'));
    await waitFor(async () => updates.length > before && (await graph.getNodesByFile('src/ui/widgets.ts')).length === 0);
    const ids = new Set((await graph.getAllNodes()).map((n) => n.id));
    const all = await graph.getAllEdges();
    expect(all.filter((r) => !ids.has(r.from) || !ids.has(r.to))).toEqual([]);
    expect((await edges()).some((e) => e.includes('widgets.ts'))).toBe(false);
    const unresolved = (await graph.getUnresolvedRelations()).filter((r) => r.location.file === 'src/ui/view.ts');
    expect(unresolved.length).toBeGreaterThan(0);
    expect(updates.at(-1)).toMatchObject({ filesDeleted: 1 });
  }, 30_000);
});
