/**
 * Robust baseline capture (wave 2): with the daemon's watcher running, the
 * live graph may already contain the edit being guarded. The baseline must
 * come from a source read before the edit — or leave the edited files' issues
 * out — so a new cycle is never baselined away.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureBaseline, ensureGuardBaseline } from '../../../src/agent/baseline-capture.js';
import { computeGraphDigest } from '../../../src/agent/digest.js';
import { SnapshotManager } from '../../../src/analysis/snapshot-manager.js';
import { InMemoryGraph } from '../../../src/agent/memory-graph.js';
import { loadBaseline } from '../../../src/agent/baseline.js';
import { entity, makeGraph, relation } from './helpers.js';

/** user-service <-> user-repo cycle (pre-existing) + x <-> y cycle (the "edit"). */
function graphWithEdit(): InMemoryGraph {
  const g = makeGraph();
  void g.putNodes([entity('file:x', 'file', 'x.ts', 'src/x.ts'), entity('file:y', 'file', 'y.ts', 'src/y.ts')]);
  void g.putEdges([relation('rx', 'file:x', 'file:y', 'src/x.ts'), relation('ry', 'file:y', 'file:x', 'src/y.ts')]);
  return g;
}

describe('captureBaseline', () => {
  let root: string;
  let fl: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowlens-capture-'));
    fl = join(root, '.flowlens');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(fl, { recursive: true });
    await writeFile(join(root, 'src/y.ts'), 'edited just now');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('prefers the HEAD snapshot taken before the edit', async () => {
    await new SnapshotManager(join(fl, 'snapshots')).takeSnapshot(makeGraph(), 'a'.repeat(40));
    const future = new Date(Date.now() + 60_000);
    await utimes(join(root, 'src/y.ts'), future, future); // edit after the snapshot
    const b = await captureBaseline({ rootDir: root, flowlensDir: fl, head: 'a'.repeat(40), digest: null, graph: graphWithEdit(), changedFiles: ['src/y.ts'] });
    expect(b.source).toBe('snapshot');
    expect(b.cycles).toEqual([['src/data/user-repo.ts', 'src/services/user-service.ts']]);
  });

  it('uses a digest read before the edit', async () => {
    const digest = await computeGraphDigest(makeGraph(), fl);
    digest.read_at = Date.now() - 60_000;
    const b = await captureBaseline({ rootDir: root, flowlensDir: fl, head: null, digest, graph: graphWithEdit(), changedFiles: ['src/y.ts'] });
    expect(b.source).toBe('guard');
    expect(b.cycles).toHaveLength(1);
  });

  it('falls back to the live graph minus issues touching the edited files (never baselines the edit)', async () => {
    const digest = await computeGraphDigest(graphWithEdit(), fl);
    digest.read_at = Date.now() + 60_000; // computed after the edit: may contain it
    const b = await captureBaseline({ rootDir: root, flowlensDir: fl, head: null, digest, graph: graphWithEdit(), changedFiles: ['src/y.ts'] });
    expect(b.cycles).toEqual([['src/data/user-repo.ts', 'src/services/user-service.ts']]);
  });

  it('ensureGuardBaseline keeps an existing baseline and saves a captured one', async () => {
    const input = { rootDir: root, flowlensDir: fl, head: 'h1', digest: null, graph: makeGraph(), changedFiles: ['src/y.ts'] };
    expect(await ensureGuardBaseline(input, false)).toBeNull();
    const first = await ensureGuardBaseline(input, true);
    expect((await loadBaseline(fl, 'h1'))?.created_at).toBe(first?.created_at);
    const again = await ensureGuardBaseline({ ...input, graph: graphWithEdit() }, true);
    expect(again?.cycles).toEqual(first?.cycles);
  });
});
