/**
 * `flowlens index`
 *
 * Re-indexes the codebase incrementally.  Requires that `flowlens init` has
 * already been run (i.e. `.flowlens/` must exist).
 *
 * Incremental mode compares file hashes against the stored file index and
 * only re-parses files that have changed or been added, removing stale
 * entities and relations for deleted files.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { runIndex } from '../../indexer/indexer.js';
import { printHeader, printSuccess, printError, printSummary } from '../output.js';
import type { FlowLensConfig } from '../../contracts/config.js';

export const indexCommand = new Command('index')
  .description('Re-index the codebase (incremental)')
  .action(async () => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(1);
    }

    try {
      printHeader('FlowLens Index');

      // Load persisted config
      const configPath = join(flowlensDir, 'config.json');
      const config: FlowLensConfig = JSON.parse(
        await readFile(configPath, 'utf-8'),
      ) as FlowLensConfig;

      // Open graph store
      const graphStore = new LevelGraphStore();
      await graphStore.open(join(flowlensDir, 'graph'));

      const result = await runIndex({
        rootDir,
        graphStore,
        config,
        fileIndexPath: join(flowlensDir, 'file_index.json'),
        incremental: true,
      });

      await graphStore.close();

      printSummary(result);
      printSuccess('Index complete');
    } catch (err) {
      printError(`Index failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
