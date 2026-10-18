/**
 * `flowlens snapshot`
 *
 * Store a graph snapshot for the current HEAD (used by diff_interface and
 * get_module_interface diff_since), list stored snapshots, or prune them.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import { ensureSnapshotForHead } from '../../analysis/snapshot-service.js';
import { SNAPSHOT_KEEP_COUNT } from '../../contracts/analysis/snapshots.js';
import { printError, printSuccess, printWarning } from '../output.js';

export const snapshotCommand = new Command('snapshot')
  .description('Store a graph snapshot for the current git HEAD (for interface diffs)')
  .option('--force', 'Re-take the snapshot even if one exists for HEAD')
  .option('--list', 'List stored snapshots')
  .option('--keep <n>', `Snapshots to keep when pruning (default ${SNAPSHOT_KEEP_COUNT})`)
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');
    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(2);
    }
    const keep = opts.keep === undefined ? SNAPSHOT_KEEP_COUNT : Number(opts.keep);
    if (!Number.isInteger(keep) || keep < 1) {
      printError(`Invalid --keep '${opts.keep}'`);
      process.exit(2);
    }

    if (opts.list) {
      const index = await new SnapshotManager(join(flowlensDir, 'snapshots')).listSnapshots();
      const rows = Object.entries(index).sort((a, b) => b[1].timestamp.localeCompare(a[1].timestamp));
      if (rows.length === 0) printWarning('No snapshots stored');
      for (const [sha, info] of rows) {
        console.log(`${sha.slice(0, 12)}  ${info.timestamp}  ${info.entity_count} entities, ${info.relation_count} relations`);
      }
      return;
    }

    try {
      const graphStore = new LevelGraphStore();
      await graphStore.open(join(flowlensDir, 'graph'));
      const result = await ensureSnapshotForHead({ graph: graphStore, rootDir, flowlensDir, keep, force: Boolean(opts.force) });
      await graphStore.close();

      if (result.status === 'skipped') {
        printError(`Snapshot skipped: ${result.reason}`);
        process.exit(2);
      }
      if (result.status === 'exists') printSuccess(`Snapshot for ${result.sha.slice(0, 12)} already exists (use --force to retake)`);
      else printSuccess(`Snapshot taken at ${result.sha.slice(0, 12)}${result.pruned ? ` (pruned ${result.pruned} old)` : ''}`);
    } catch (err) {
      printError(`Snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  });
