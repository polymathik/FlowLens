/**
 * Phase 12 review H1: concurrent incremental index runs on one project must
 * not lose each other's edits. Each run reads symbols.json + file_index.json,
 * writes the graph and writes both back, so runs have to be serialized:
 * through the daemon they run in the project's write queue (`reindex`
 * route); directly they hold `.flowlens/index.lock`.
 *
 * Before the fix, agent re-indexes ran `runIndex` client-side over RPC, so
 * N concurrent hooks interleaved and the last snapshot writer won (the
 * reviewer saw 19/20 edits survive).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reindexAgentChangedFiles } from '../../src/agent/reindex.js';
import { runIndex } from '../../src/indexer/indexer.js';
import { loadProjectConfig } from '../../src/projects/config.js';
import type { RemoteGraphStore } from '../../src/service/remote-graph-store.js';
import { startHarness, type Harness } from '../helpers/daemon-harness.js';
import { removeDir, tempDir } from '../helpers/service-env.js';

const N = 12;

async function makeProject(): Promise<string> {
  const root = await tempDir('flowlens-race-');
  await mkdir(join(root, 'src'));
  await mkdir(join(root, '.flowlens'));
  await writeFile(join(root, '.flowlens', 'config.json'), JSON.stringify({ exclude: [], languages: {}, ai: { enabled: false } }));
  for (let i = 0; i < N; i++) await writeFile(join(root, `src/m${i}.ts`), `export function f${i}() { return ${i}; }\n`);
  const imports = Array.from({ length: N }, (_, i) => `import { g${i} } from './m${i}';`).join('\n');
  const calls = Array.from({ length: N }, (_, i) => `g${i}();`).join(' ');
  await writeFile(join(root, 'src/main.ts'), `${imports}\nexport function main() { ${calls} }\n`);
  return root;
}

async function graphSignature(store: RemoteGraphStore, root: string) {
  const nodes = await store.getAllNodes();
  const gIds = new Set(nodes.filter((n) => /^g\d+$/.test(n.name)).map((n) => n.id));
  const edges = await store.getAllEdges();
  const snapshot = JSON.parse(await readFile(join(root, '.flowlens', 'symbols.json'), 'utf8')) as {
    files: Record<string, { symbols: { exports: Array<{ name: string }> } }>;
  };
  const exported = Object.values(snapshot.files).flatMap((r) => r.symbols.exports.map((e) => e.name)).filter((n) => /^g\d+$/.test(n));
  return { gNodes: gIds.size, edgesToG: edges.filter((e) => gIds.has(e.to)).length, snapshotExports: new Set(exported).size };
}

describe('concurrent incremental re-index (H1)', () => {
  let h: Harness;
  let root: string;

  beforeEach(async () => {
    h = await startHarness();
    root = await makeProject();
  });

  afterEach(async () => {
    await h.stop();
    await removeDir(root);
  });

  it(`${N} concurrent agent re-indexes through separate daemon clients keep every edit`, async () => {
    const seed = await h.remote(root, 'seed');
    await runIndex({
      rootDir: root, graphStore: seed, config: loadProjectConfig(root),
      fileIndexPath: join(root, '.flowlens', 'file_index.json'), incremental: false,
    });
    expect((await graphSignature(seed, root)).gNodes).toBe(0);

    for (let i = 0; i < N; i++) await writeFile(join(root, `src/m${i}.ts`), `export function g${i}() { return ${i}; }\n`);
    const stores = await Promise.all(Array.from({ length: N }, (_, i) => h.remote(root, `hook-${i}`)));
    await Promise.all(stores.map((s, i) => reindexAgentChangedFiles(root, s, [`src/m${i}.ts`])));

    expect(await graphSignature(seed, root)).toEqual({ gNodes: N, edgesToG: expect.any(Number), snapshotExports: N });
    const sig = await graphSignature(seed, root);
    expect(sig.edgesToG).toBeGreaterThanOrEqual(N); // main's imports/calls resolve to every g_i
  }, 60_000);

  it('the reindex route runs a full rebuild and reports the run', async () => {
    const store = await h.remote(root, 'cli');
    const full = await store.reindex({ full: true });
    expect(full.filesIndexed).toBe(N + 1);
    const again = await store.reindex({});
    expect(again.filesIndexed).toBe(0);
    expect(again.filesSkipped).toBe(N + 1);
  }, 30_000);
});
