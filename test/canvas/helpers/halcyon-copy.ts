/**
 * Optional real-world project for the E2E: a copy of a Halcyon snapshot
 * (pnpm + SvelteKit monorepo) indexed in the temp FLOWLENS_HOME. The source
 * is `$FLOWLENS_E2E_HALCYON`, else `/tmp/mm/halcyon`; without it the Halcyon
 * scenarios skip. The snapshot is only read, never modified.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { runIndex } from '../../../src/indexer/indexer.js';
import type { FlowLensConfig } from '../../../src/contracts/config.js';

export const HALCYON_SOURCE = process.env.FLOWLENS_E2E_HALCYON ?? '/tmp/mm/halcyon';

export async function createHalcyonCopy(parent: string): Promise<{ rootDir: string } | null> {
  if (!existsSync(HALCYON_SOURCE)) return null;
  const rootDir = join(parent, 'halcyon');
  await mkdir(parent, { recursive: true });
  await cp(HALCYON_SOURCE, rootDir, {
    recursive: true,
    filter: (src) => !/\/(\.flowlens|\.git|node_modules)(\/|$)/.test(src),
  });
  const flowlensDir = join(rootDir, '.flowlens');
  await mkdir(flowlensDir, { recursive: true });
  let config: FlowLensConfig;
  try {
    config = JSON.parse(await readFile(join(HALCYON_SOURCE, '.flowlens', 'config.json'), 'utf-8')) as FlowLensConfig;
  } catch {
    config = { exclude: ['node_modules/**', 'dist/**', 'build/**', '.flowlens/**', '.git/**'], languages: { typescript: true, javascript: true }, ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' } };
  }
  await writeFile(join(flowlensDir, 'config.json'), JSON.stringify(config, null, 2));
  const store = new LevelGraphStore();
  await store.open(join(flowlensDir, 'graph'));
  try {
    await runIndex({ rootDir, graphStore: store, config, fileIndexPath: join(flowlensDir, 'file_index.json'), incremental: false });
  } finally {
    await store.close();
  }
  return { rootDir };
}
