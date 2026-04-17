import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('add then unlink in same batch ends with delete', async () => {
    const events = [
      await ev('add', 'x.ts'),
      await ev('unlink', 'x.ts'),
    ];
    const result = await applyWatchEvents(events, { rootDir: tmp, graph });
    expect(result.filesReparsed).toBe(0);
    expect(result.filesDeleted).toBe(1);
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
});
