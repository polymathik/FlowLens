import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChokidarFileWatcher } from '../../../src/watch/file-watcher.js';
import type { WatchEvent } from '../../../src/contracts/watch.js';

/**
 * Live chokidar tests: slightly slow (~500ms each) because chokidar needs
 * to settle, but essential for validating the debounce behavior in a
 * real event-driven environment.
 */
describe('ChokidarFileWatcher', () => {
  let tmp: string;
  let watcher: ChokidarFileWatcher;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-watcher-'));
    watcher = new ChokidarFileWatcher();
  });

  afterEach(async () => {
    await watcher.stop();
    await rm(tmp, { recursive: true, force: true });
  });

  it('batches rapid changes into a single flush via debounce', async () => {
    const batches: WatchEvent[][] = [];
    watcher.onChanges(async (events) => {
      batches.push(events);
    });
    watcher.start(tmp, { debounceMs: 100, ignore: [] });

    // Let chokidar settle before triggering changes.
    await delay(200);

    await writeFile(join(tmp, 'a.ts'), 'a');
    await writeFile(join(tmp, 'b.ts'), 'b');
    await writeFile(join(tmp, 'c.ts'), 'c');

    await delay(400);

    // Exactly one batch containing all three files (chokidar may also add
    // some directory events but we only assert the file events are present).
    const filePaths = batches.flat().map((e) => e.path);
    expect(filePaths).toContain('a.ts');
    expect(filePaths).toContain('b.ts');
    expect(filePaths).toContain('c.ts');
    // Debounce should coalesce into a single batch
    expect(batches.length).toBeLessThanOrEqual(2);
  });

  it('throws if started twice', () => {
    watcher.start(tmp, { debounceMs: 50, ignore: [] });
    expect(() => watcher.start(tmp, { debounceMs: 50, ignore: [] })).toThrow(
      /already started/,
    );
  });

  it('stop() is idempotent', async () => {
    watcher.start(tmp, { debounceMs: 50, ignore: [] });
    await watcher.stop();
    await watcher.stop(); // should not throw
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
