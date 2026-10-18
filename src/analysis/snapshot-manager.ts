/**
 * SnapshotManager: stores and retrieves graph state snapshots keyed by git SHA.
 *
 * Each snapshot is written as `<sha>.graph.json` in the snapshots directory,
 * and a lightweight `index.json` is maintained for fast listing.
 */

import { readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphStore } from '../contracts/graph.js';
import type { SnapshotIndex, SnapshotData } from '../contracts/analysis/snapshots.js';

/** Snapshot keys are file names: allow SHA-like tokens only (no path traversal). */
export function isValidSnapshotKey(sha: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sha) && !sha.includes('..');
}

export class SnapshotManager {
  /** Parsed snapshots by `<sha>:<mtimeMs>` (snapshots are immutable per key). */
  private readonly loaded = new Map<string, SnapshotData>();
  private static readonly LOADED_MAX = 2;

  constructor(private readonly snapshotsDir: string) {}

  /** Whether a snapshot file exists for exactly this key. */
  hasSnapshot(sha: string): boolean {
    return isValidSnapshotKey(sha) && existsSync(join(this.snapshotsDir, `${sha}.graph.json`));
  }

  /**
   * Capture the current state of the graph and persist it under the given SHA.
   * Also updates the index.json catalogue.
   */
  async takeSnapshot(graph: GraphStore, sha: string): Promise<void> {
    if (!isValidSnapshotKey(sha)) throw new Error(`Invalid snapshot key: '${sha}'`);
    await mkdir(this.snapshotsDir, { recursive: true });
    const [entities, relations] = await Promise.all([
      graph.getAllNodes(),
      graph.getAllEdges(),
    ]);

    const data: SnapshotData = {
      sha,
      timestamp: new Date().toISOString(),
      entities,
      relations,
    };

    await writeFile(
      join(this.snapshotsDir, `${sha}.graph.json`),
      JSON.stringify(data),
    );

    // Update index
    const index = await this.listSnapshots();
    index[sha] = {
      timestamp: data.timestamp,
      entity_count: entities.length,
      relation_count: relations.length,
    };

    await writeFile(
      join(this.snapshotsDir, 'index.json'),
      JSON.stringify(index, null, 2),
    );
  }

  /**
   * Load a snapshot by its git SHA. Returns null when no snapshot exists for
   * the given SHA.
   */
  async loadSnapshot(sha: string): Promise<SnapshotData | null> {
    if (!isValidSnapshotKey(sha)) return null;
    const filePath = join(this.snapshotsDir, `${sha}.graph.json`);
    if (!existsSync(filePath)) return null;

    const key = `${sha}:${(await stat(filePath)).mtimeMs}`;
    const hit = this.loaded.get(key);
    if (hit) return hit;
    const data = JSON.parse(await readFile(filePath, 'utf-8')) as SnapshotData;
    this.loaded.set(key, data);
    if (this.loaded.size > SnapshotManager.LOADED_MAX) {
      this.loaded.delete(this.loaded.keys().next().value!);
    }
    return data;
  }

  /**
   * Return the index of all stored snapshots. Returns an empty object when no
   * index file exists yet.
   */
  async listSnapshots(): Promise<SnapshotIndex> {
    const indexPath = join(this.snapshotsDir, 'index.json');
    if (!existsSync(indexPath)) return {};

    const content = await readFile(indexPath, 'utf-8');
    return JSON.parse(content) as SnapshotIndex;
  }

  /**
   * Remove old snapshots, retaining only the `keepCount` most-recent ones.
   * Returns the number of snapshots deleted.
   */
  async pruneSnapshots(keepCount: number): Promise<number> {
    const index = await this.listSnapshots();
    const entries = Object.entries(index).sort(
      (a, b) =>
        new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime(),
    );

    if (entries.length <= keepCount) return 0;

    const toDelete = entries.slice(keepCount);

    for (const [sha] of toDelete) {
      const filePath = join(this.snapshotsDir, `${sha}.graph.json`);
      if (existsSync(filePath)) await unlink(filePath);
      delete index[sha];
    }

    await writeFile(
      join(this.snapshotsDir, 'index.json'),
      JSON.stringify(index, null, 2),
    );

    return toDelete.length;
  }
}
