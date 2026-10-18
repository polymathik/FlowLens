/**
 * Phase 12: with a daemon revision token the digest fingerprint ignores
 * LevelDB file churn (compaction) and moves only with the revision.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureStamp, graphFingerprint, readFreshDigest, writeDigest } from '../../../src/agent/digest-cache.js';
import { computeGraphDigest } from '../../../src/agent/digest.js';
import { InMemoryGraph } from '../../../src/agent/memory-graph.js';
import { serviceRevision } from '../../../src/agent/service-revision.js';
import { entity } from './helpers.js';

describe('digest fingerprint with a service revision', () => {
  let fl: string;
  beforeEach(async () => {
    fl = join(await mkdtemp(join(tmpdir(), 'flowlens-rev-')), '.flowlens');
    await mkdir(join(fl, 'graph'), { recursive: true });
    await writeFile(join(fl, 'graph', '000001.log'), 'a');
  });
  afterEach(async () => { await rm(join(fl, '..'), { recursive: true, force: true }); });

  it('is stable across LevelDB file changes and moves with the revision', async () => {
    const r1 = 'svc:1:t:o:1';
    const a = graphFingerprint(fl, r1);
    await writeFile(join(fl, 'graph', '000001.log'), 'abc'); // compaction / write
    expect(graphFingerprint(fl, r1)).toBe(a);
    expect(graphFingerprint(fl, 'svc:1:t:o:2')).not.toBe(a);
    expect(graphFingerprint(fl)).not.toBe(a); // stat fallback is a different space
  });

  it('a digest stamped with a revision is a hit for the same revision', async () => {
    const graph = new InMemoryGraph([entity('a', 'file', 'a.ts', 'src/a.ts')], []);
    await writeDigest(fl, await computeGraphDigest(graph, fl), captureStamp(fl, 'svc:9:t:o:3'));
    await writeFile(join(fl, 'graph', '000001.log'), 'zz');
    expect(await readFreshDigest(fl, [], 'svc:9:t:o:3')).not.toBeNull();
  });

  it('serviceRevision is null without a daemon', async () => {
    expect(await serviceRevision(fl, { daemon: false })).toBeNull();
  });
});
