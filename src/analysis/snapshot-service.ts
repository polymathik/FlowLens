/**
 * Automatic snapshot lifecycle: after an index run, store a snapshot for the
 * current HEAD (if none exists yet) and prune to the newest N. Idempotent —
 * calling it repeatedly at the same HEAD is a cheap no-op — so the indexer
 * and CLI commands can call it unconditionally.
 */

import { join } from 'node:path';
import type { GraphStore } from '../contracts/graph.js';
import { SNAPSHOT_KEEP_COUNT, type EnsureSnapshotResult } from '../contracts/analysis/snapshots.js';
import { SnapshotManager } from './snapshot-manager.js';
import { headSha } from './git.js';

export interface EnsureSnapshotOptions {
  graph: GraphStore;
  /** Project root (git working tree). */
  rootDir: string;
  /** `.flowlens` directory; snapshots live in `<flowlensDir>/snapshots`. */
  flowlensDir: string;
  /** Snapshots to keep after pruning (default 20). */
  keep?: number;
  /** Re-take the snapshot even if one exists for HEAD. */
  force?: boolean;
}

export async function ensureSnapshotForHead(opts: EnsureSnapshotOptions): Promise<EnsureSnapshotResult> {
  const sha = headSha(opts.rootDir);
  if (!sha) return { status: 'skipped', reason: 'not a git repository (or no commits yet)' };

  const manager = new SnapshotManager(join(opts.flowlensDir, 'snapshots'));
  if (!opts.force && manager.hasSnapshot(sha)) return { status: 'exists', sha };

  await manager.takeSnapshot(opts.graph, sha);
  const pruned = await manager.pruneSnapshots(opts.keep ?? SNAPSHOT_KEEP_COUNT);
  return { status: 'created', sha, pruned };
}
