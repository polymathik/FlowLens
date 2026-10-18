/**
 * Digest revision + revalidation: a LevelDB fingerprint change without any
 * source change (daemon compaction, the watcher re-applying a file the guard
 * already re-indexed) must keep the digest; a real source change must not.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureStamp, readFreshDigest, writeDigest } from '../../../src/agent/digest-cache.js';
import { accountFiles, directoriesOf, unchangedSince } from '../../../src/agent/digest-revalidate.js';
import { computeGraphDigest } from '../../../src/agent/digest.js';
import { InMemoryGraph } from '../../../src/agent/memory-graph.js';
import { entity } from './helpers.js';

describe('digest revalidation', () => {
  let root: string;
  let fl: string;
  const old = new Date(Date.now() - 120_000);

  async function setup() {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(fl, 'graph'), { recursive: true });
    await writeFile(join(fl, 'graph', '000001.log'), 'a');
    for (const f of ['src/a.ts', 'src/b.ts']) await writeFile(join(root, f), 'x');
    for (const p of ['src/a.ts', 'src/b.ts', 'src', '.']) await utimes(join(root, p), old, old);
    const graph = new InMemoryGraph([entity('a', 'file', 'a.ts', 'src/a.ts'), entity('b', 'file', 'b.ts', 'src/b.ts')], []);
    const stamp = captureStamp(fl);
    await writeDigest(fl, await computeGraphDigest(graph, fl), stamp);
  }
  const touchGraph = () => writeFile(join(fl, 'graph', '000001.log'), 'ab'); // a write / compaction

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowlens-revalidate-'));
    fl = join(root, '.flowlens');
    await setup();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('keeps (and re-stamps) the digest when the graph files moved but no source changed', async () => {
    await touchGraph();
    const digest = await readFreshDigest(fl);
    expect(digest).not.toBeNull();
    expect(digest!.fingerprint).toBe(captureStamp(fl)!.fingerprint);
  });

  it('drops it when an indexed file changed, was deleted, or a directory gained an entry', async () => {
    await touchGraph();
    await writeFile(join(root, 'src/a.ts'), 'changed');
    expect(await readFreshDigest(fl)).toBeNull();

    await rm(root, { recursive: true, force: true });
    await setup();
    await touchGraph();
    await writeFile(join(root, 'src/new.ts'), 'new');
    expect(await readFreshDigest(fl)).toBeNull();

    await rm(root, { recursive: true, force: true });
    await setup();
    await touchGraph();
    await rm(join(root, 'src/b.ts'));
    expect(await readFreshDigest(fl)).toBeNull();
  });

  it('drops it when a base file (full index / architecture) changed', async () => {
    await touchGraph();
    await writeFile(join(fl, 'manifest.json'), '{}');
    expect(await readFreshDigest(fl)).toBeNull();
  });

  it('accepts files the guard re-indexed into the digest at their current mtime', async () => {
    const stamp = captureStamp(fl)!;
    const graph = new InMemoryGraph([entity('a', 'file', 'a.ts', 'src/a.ts'), entity('b', 'file', 'b.ts', 'src/b.ts')], []);
    await writeFile(join(root, 'src/a.ts'), 'agent edit');
    const digest = await computeGraphDigest(graph, fl);
    digest.accounted = accountFiles(root, undefined, ['src/a.ts'], stamp.read_at);
    await writeDigest(fl, digest, stamp);
    await touchGraph(); // the daemon watcher re-applies src/a.ts
    expect(await readFreshDigest(fl)).not.toBeNull();
    await writeFile(join(root, 'src/a.ts'), 'second edit, not yet guarded');
    await utimes(join(root, 'src/a.ts'), new Date(), new Date(Date.now() + 5000));
    await touchGraph();
    expect(await readFreshDigest(fl)).toBeNull();
  });

  it('lets the guard reuse a digest that is stale only for the files it is about to patch', async () => {
    await writeFile(join(root, 'src/a.ts'), 'edited; the watcher already applied it');
    await touchGraph();
    expect(await readFreshDigest(fl)).toBeNull();
    const forGuard = await readFreshDigest(fl, ['src/a.ts']);
    expect(forGuard).not.toBeNull();
    expect(forGuard!.fingerprint).not.toBe(captureStamp(fl)!.fingerprint); // not re-stamped until patched
    await writeFile(join(root, 'src/b.ts'), 'another file changed too');
    expect(await readFreshDigest(fl, ['src/a.ts'])).toBeNull();
  });

  it('needs read_at and lists directories with ancestors', () => {
    expect(unchangedSince(root, { entities: [] } as never)).toBe(false);
    expect([...directoriesOf(['src/x/y.ts', 'lib/z.ts'])].sort()).toEqual(['', 'lib', 'src', 'src/x']);
  });
});
