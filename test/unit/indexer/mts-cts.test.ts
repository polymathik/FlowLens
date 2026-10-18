/**
 * `.mts` / `.cts` are TypeScript: discovered, parsed, and their ESM-style
 * `.mjs` / `.cjs` specifiers resolve to the TS sources. The agent's changed
 * file filter uses the same extension set as the indexer.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIndex } from '../../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { getSupportedExtensions } from '../../../src/utils/paths.js';
import { supportedExtensions } from '../../../src/agent/file-filter.js';
import type { FlowLensConfig } from '../../../src/contracts/config.js';

const CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('.mts / .cts support', () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('follows config.languages.typescript and is shared with the agent filter', () => {
    expect(getSupportedExtensions({ typescript: true })).toEqual(expect.arrayContaining(['.ts', '.mts', '.cts']));
    const off = getSupportedExtensions({ typescript: false });
    expect(off).not.toContain('.mts');
    expect(off).not.toContain('.cts');
    expect([...supportedExtensions({ typescript: false })].sort()).toEqual([...off].sort());
  });

  it('indexes .mts/.cts files and resolves .mjs/.cjs specifiers to them', async () => {
    dir = await mkdtemp(join(tmpdir(), 'flowlens-mts-'));
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src/main.mts'), "import { util } from './util.mjs';\nimport { legacy } from './legacy.cjs';\nexport function main() { return util() + legacy(); }\n");
    await writeFile(join(dir, 'src/util.mts'), 'export function util(): number { return 1; }\n');
    await writeFile(join(dir, 'src/legacy.cts'), 'export function legacy(): number { return 2; }\n');
    const store = new LevelGraphStore();
    await store.open(join(dir, '.flowlens/graph'));
    try {
      await runIndex({ rootDir: dir, graphStore: store, config: CONFIG, fileIndexPath: join(dir, '.flowlens/file_index.json'), incremental: false });
      const nodes = await store.getAllNodes();
      const qn = new Map(nodes.map((n) => [n.id, n.qualified_name]));
      const edges = (await store.getAllEdges()).map((e) => `${qn.get(e.from)} -${e.type}-> ${qn.get(e.to)}`);
      expect(edges).toEqual(expect.arrayContaining([
        'src/main.mts -import-> src/util.mts',
        'src/main.mts -import-> src/legacy.cts',
        'src/main.mts/main -call-> src/util.mts/util',
        'src/main.mts/main -call-> src/legacy.cts/legacy',
      ]));
      expect(nodes.find((n) => n.kind === 'file' && n.file === 'src/legacy.cts')?.language).toBe('typescript');
    } finally {
      await store.close();
    }
  });
});
