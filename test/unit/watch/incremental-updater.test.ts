import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyWatchEvents } from '../../../src/watch/incremental-updater.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { WatchEvent } from '../../../src/contracts/watch.js';

async function ev(type: WatchEvent['type'], path: string): Promise<WatchEvent> {
  return { type, path, timestamp: Date.now() };
}

describe('applyWatchEvents', () => {
  let tmp: string;
  let graph: LevelGraphStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-watch-'));
    graph = new LevelGraphStore();
    await graph.open(join(tmp, 'graph'));
  });

  afterEach(async () => {
    await graph.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('re-parses an added file and stores entities', async () => {
    await writeFile(join(tmp, 'a.ts'), 'export class Foo {}');

    const events = [await ev('add', 'a.ts')];
    const result = await applyWatchEvents(events, { rootDir: tmp, graph });

    expect(result.filesReparsed).toBe(1);
    expect(result.entitiesUpdated).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    const entities = await graph.getNodesByFile('a.ts');
    expect(entities.some((e) => e.name === 'Foo')).toBe(true);
  });

  it('handles unlink events by deleting graph data', async () => {
    await writeFile(join(tmp, 'a.ts'), 'export class Foo {}');
    await applyWatchEvents([await ev('add', 'a.ts')], { rootDir: tmp, graph });

    const before = await graph.getNodesByFile('a.ts');
    expect(before.length).toBeGreaterThan(0);

    // A real watcher reports unlink after the file is gone; the indexer checks the disk.
    await rm(join(tmp, 'a.ts'));
    const result = await applyWatchEvents([await ev('unlink', 'a.ts')], {
      rootDir: tmp,
      graph,
    });

    expect(result.filesDeleted).toBe(1);
    const after = await graph.getNodesByFile('a.ts');
    expect(after).toHaveLength(0);
  });

  it('dedupes by path — latest event wins', async () => {
    await writeFile(join(tmp, 'a.ts'), 'export class Foo {}');
    // change + change → one re-parse, not two
    const events = [
      await ev('change', 'a.ts'),
      await ev('change', 'a.ts'),
    ];
    const result = await applyWatchEvents(events, { rootDir: tmp, graph });
    expect(result.filesReparsed).toBe(1);
  });

  it('add then unlink in same batch of a never-indexed file is a no-op', async () => {
    // Updates go through the incremental indexer, which looks at the disk:
    // x.ts never existed in the graph, so nothing is parsed or deleted.
    const events = [
      await ev('add', 'x.ts'),
      await ev('unlink', 'x.ts'),
    ];
    const result = await applyWatchEvents(events, { rootDir: tmp, graph });
    expect(result.filesReparsed).toBe(0);
    expect(result.filesDeleted).toBe(0);
  });

  it('add then unlink in same batch of an indexed file deletes it', async () => {
    await writeFile(join(tmp, 'x.ts'), 'export const x = 1;');
    await applyWatchEvents([await ev('add', 'x.ts')], { rootDir: tmp, graph });
    await rm(join(tmp, 'x.ts'));
    const result = await applyWatchEvents([await ev('change', 'x.ts'), await ev('unlink', 'x.ts')], { rootDir: tmp, graph });
    expect(result).toMatchObject({ filesReparsed: 0, filesDeleted: 1 });
    expect(await graph.getNodesByFile('x.ts')).toHaveLength(0);
  });

  it('ignores unsupported file extensions', async () => {
    const events = [
      await ev('change', 'README.md'),
      await ev('change', 'image.png'),
    ];
    const result = await applyWatchEvents(events, { rootDir: tmp, graph });
    expect(result.filesReparsed).toBe(0);
    expect(result.filesDeleted).toBe(0);
  });

  it('reports durationMs', async () => {
    const result = await applyWatchEvents([], { rootDir: tmp, graph });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('updates entities when a file changes', async () => {
    const path = join(tmp, 'a.ts');
    await writeFile(path, 'export class Foo {}');
    await applyWatchEvents([await ev('add', 'a.ts')], { rootDir: tmp, graph });

    await writeFile(path, 'export class Bar {}');
    await applyWatchEvents([await ev('change', 'a.ts')], { rootDir: tmp, graph });

    const entities = await graph.getNodesByFile('a.ts');
    expect(entities.some((e) => e.name === 'Bar')).toBe(true);
    expect(entities.some((e) => e.name === 'Foo')).toBe(false);
  });

  it('re-parsed files keep churn metrics (git) after a watch batch', async () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: tmp, stdio: 'ignore' });
    await writeFile(join(tmp, 'a.ts'), 'export function f(x: number) { if (x) { return 1; } return 0; }\n');
    await writeFile(join(tmp, 'b.ts'), 'export function g(x: number) { if (x) { return 2; } return 0; }\n');
    git('init', '-q');
    git('add', 'a.ts', 'b.ts');
    git('commit', '-qm', 'one');
    await applyWatchEvents([await ev('add', 'a.ts'), await ev('add', 'b.ts')], { rootDir: tmp, graph });
    await writeFile(join(tmp, 'a.ts'), 'export function f(x: number) { if (x) { return 3; } return 0; }\n');
    await applyWatchEvents([await ev('change', 'a.ts')], { rootDir: tmp, graph });
    for (const file of ['a.ts', 'b.ts']) {
      const fn = (await graph.getNodesByFile(file)).find((e) => e.kind === 'function')!;
      expect(fn.metrics?.churn_rate).toBeGreaterThan(0);
      expect(fn.metrics?.hotspot_score).toBeGreaterThan(0);
    }
  });

  describe('cross-file resolution (Phase 8 two-pass)', () => {
    const edgesByName = async (): Promise<string[]> => {
      const qn = new Map((await graph.getAllNodes()).map((n) => [n.id, n.qualified_name]));
      return (await graph.getAllEdges()).map((e) => `${qn.get(e.from) ?? `?${e.from}`} -${e.type}-> ${qn.get(e.to) ?? `?${e.to}`}`);
    };

    beforeEach(async () => {
      await mkdir(join(tmp, 'src'));
      await writeFile(join(tmp, 'src/main.ts'), "import { helper } from './helper.js';\nexport function main() { return helper(); }\n");
      await applyWatchEvents([await ev('add', 'src/main.ts')], { rootDir: tmp, graph });
    });

    it('adding a file links an unchanged importer to it', async () => {
      expect(await edgesByName()).not.toContain('src/main.ts -import-> src/helper.ts');
      await writeFile(join(tmp, 'src/helper.ts'), 'export function helper(): number { return 1; }\n');
      const r = await applyWatchEvents([await ev('add', 'src/helper.ts')], { rootDir: tmp, graph });
      expect(r).toMatchObject({ filesReparsed: 1, filesReresolved: 1, errors: [] });
      expect(await edgesByName()).toEqual(expect.arrayContaining([
        'src/main.ts -import-> src/helper.ts',
        'src/main.ts/main -call-> src/helper.ts/helper',
      ]));
    });

    it('deleting a file leaves no dangling edges', async () => {
      await writeFile(join(tmp, 'src/helper.ts'), 'export function helper(): number { return 1; }\n');
      await applyWatchEvents([await ev('add', 'src/helper.ts')], { rootDir: tmp, graph });
      await rm(join(tmp, 'src/helper.ts'));
      const r = await applyWatchEvents([await ev('unlink', 'src/helper.ts')], { rootDir: tmp, graph });
      expect(r).toMatchObject({ filesDeleted: 1, filesReresolved: 1 });
      const ids = new Set((await graph.getAllNodes()).map((n) => n.id));
      const edges = await graph.getAllEdges();
      expect(edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))).toEqual([]);
      expect(await edgesByName()).not.toContain('src/main.ts/main -call-> src/helper.ts/helper');
      const unresolved = (await graph.getUnresolvedRelations()).filter((u) => u.location.file === 'src/main.ts');
      expect(unresolved.length).toBeGreaterThan(0);
      expect(unresolved.every((u) => u.to === '')).toBe(true);
    });

    it('renaming an export re-resolves callers in unchanged files', async () => {
      await writeFile(join(tmp, 'src/helper.ts'), 'export function helper(): number { return 1; }\n');
      await applyWatchEvents([await ev('add', 'src/helper.ts')], { rootDir: tmp, graph });
      await writeFile(join(tmp, 'src/helper.ts'), 'export function helper(): number { return 2; }\nexport function extra(): number { return helper(); }\n');
      await applyWatchEvents([await ev('change', 'src/helper.ts')], { rootDir: tmp, graph });
      expect(await edgesByName()).toEqual(expect.arrayContaining([
        'src/main.ts/main -call-> src/helper.ts/helper',
        'src/helper.ts/extra -call-> src/helper.ts/helper',
      ]));
    });
  });
});
