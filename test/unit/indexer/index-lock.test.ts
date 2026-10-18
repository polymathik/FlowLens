/**
 * Phase 12 review H1: the per-project index lock and atomic bookkeeping
 * writes behind direct (`--no-daemon`) index runs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { indexLockPath, withIndexLock } from '../../../src/indexer/index-lock.js';
import { FileIndexManager } from '../../../src/indexer/file-index.js';
import { saveSymbolSnapshot, loadSymbolSnapshot } from '../../../src/indexer/symbol-snapshot.js';
import type { FileSymbolRecord } from '../../../src/contracts/symbols.js';

/** A pid that certainly is not running (a child that already exited). */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid!;
}

describe('index lock', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'flowlens-lock-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('serializes overlapping runs on one project', async () => {
    const log: string[] = [];
    const run = (name: string) => withIndexLock(dir, async () => {
      log.push(`${name}:start`);
      await sleep(40);
      log.push(`${name}:end`);
    });
    await Promise.all([run('a'), run('b'), run('c')]);
    for (let i = 0; i < log.length; i += 2) {
      expect(log[i].split(':')[0]).toBe(log[i + 1].split(':')[0]);
    }
    expect(existsSync(indexLockPath(dir))).toBe(false);
  });

  it('takes over a lock whose holder pid is dead', async () => {
    await writeFile(indexLockPath(dir), JSON.stringify({ pid: deadPid(), at: new Date().toISOString() }));
    const t = Date.now();
    expect(await withIndexLock(dir, async () => 'ran')).toBe('ran');
    expect(Date.now() - t).toBeLessThan(2_000);
  });

  it('waits for a live holder and reports it', async () => {
    await writeFile(indexLockPath(dir), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    let waitedFor: number | undefined;
    const pending = withIndexLock(dir, async () => 'second', (pid) => { waitedFor = pid; });
    await sleep(150);
    expect(waitedFor).toBe(process.pid);
    await rm(indexLockPath(dir));
    expect(await pending).toBe('second');
  });

  it('heart-beats while held, so a long run is not mistaken for stale', async () => {
    let mtimeDuring = 0;
    await withIndexLock(dir, async () => {
      const old = new Date(Date.now() - 60_000);
      await utimes(indexLockPath(dir), old, old);
      await sleep(2_300); // > INDEX_LOCK_HEARTBEAT_MS
      const { mtimeMs } = await import('node:fs').then((fs) => fs.statSync(indexLockPath(dir)));
      mtimeDuring = mtimeMs;
    });
    expect(Date.now() - mtimeDuring).toBeLessThan(5_000);
  });
});

describe('atomic index bookkeeping', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'flowlens-atomic-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('concurrent file_index.json saves leave one complete file and no temp files', async () => {
    const p = join(dir, 'file_index.json');
    const m = new FileIndexManager();
    await Promise.all(Array.from({ length: 20 }, (_, i) => m.save(p, {
      [`src/f${i}.ts`]: { hash: 'x'.repeat(5000 + i), last_indexed: 'now' },
    })));
    expect(Object.keys(JSON.parse(readFileSync(p, 'utf8')))).toHaveLength(1);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('concurrent symbols.json saves in one process never share a temp file', async () => {
    const p = join(dir, 'symbols.json');
    const rec = (i: number): Map<string, FileSymbolRecord> => new Map([[`f${i}.ts`, {
      symbols: { file: `f${i}.ts`, language: 'typescript', imports: [], exports: [], reexports: [], implicit_exports: true },
      entities: [], extends: [],
    }]]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => saveSymbolSnapshot(p, rec(i))));
    expect((await loadSymbolSnapshot(p)).size).toBe(1);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
