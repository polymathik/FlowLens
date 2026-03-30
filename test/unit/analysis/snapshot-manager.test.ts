import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { SnapshotManager } from '../../../src/analysis/snapshot-manager.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';

/* ---------- helpers ---------- */

function makeEntity(id: string, name: string, file: string): Entity {
  return {
    id,
    kind: 'function',
    name,
    qualified_name: `${file}/${name}`,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    metrics: { line_count: 10 },
  };
}

function makeRelation(id: string, from: string, to: string): Relation {
  return {
    id,
    from,
    to,
    type: 'import',
    location: { file: 'src/test.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1.0,
  };
}

/* ---------- test suite ---------- */

describe('SnapshotManager', () => {
  let store: LevelGraphStore;
  let tmpDir: string;
  let snapshotsDir: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-snapshot-test-'));
    const dbPath = join(tmpDir, 'graph');
    snapshotsDir = join(tmpDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });

    store = new LevelGraphStore();
    await store.open(dbPath);

    manager = new SnapshotManager(snapshotsDir);
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('takes a snapshot and stores as JSON', async () => {
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'),
    ]);
    await store.putEdges([makeRelation('r1', 'e1', 'e2')]);

    await manager.takeSnapshot(store, 'abc123');

    const snapshotFile = join(snapshotsDir, 'abc123.graph.json');
    expect(existsSync(snapshotFile)).toBe(true);

    const indexFile = join(snapshotsDir, 'index.json');
    expect(existsSync(indexFile)).toBe(true);
  });

  it('loads a snapshot by SHA', async () => {
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'),
    ]);
    await store.putEdges([makeRelation('r1', 'e1', 'e2')]);

    await manager.takeSnapshot(store, 'deadbeef');

    const loaded = await manager.loadSnapshot('deadbeef');
    expect(loaded).not.toBeNull();
    expect(loaded!.sha).toBe('deadbeef');
    expect(loaded!.entities).toHaveLength(2);
    expect(loaded!.relations).toHaveLength(1);
    expect(loaded!.timestamp).toBeTruthy();
  });

  it('returns null for nonexistent snapshot', async () => {
    const result = await manager.loadSnapshot('nonexistent-sha');
    expect(result).toBeNull();
  });

  it('lists all snapshots', async () => {
    await store.putNodes([makeEntity('e1', 'funcA', 'src/a.ts')]);

    await manager.takeSnapshot(store, 'sha-001');
    await manager.takeSnapshot(store, 'sha-002');
    await manager.takeSnapshot(store, 'sha-003');

    const index = await manager.listSnapshots();
    expect(Object.keys(index)).toHaveLength(3);
    expect(index['sha-001']).toBeDefined();
    expect(index['sha-002']).toBeDefined();
    expect(index['sha-003']).toBeDefined();
  });

  it('prunes old snapshots keeping N most recent', async () => {
    await store.putNodes([makeEntity('e1', 'funcA', 'src/a.ts')]);

    // Take snapshots with slight delays to ensure different timestamps
    await manager.takeSnapshot(store, 'old-sha-1');
    // Force different timestamp by slightly modifying the snapshot manually
    await new Promise((r) => setTimeout(r, 10));
    await manager.takeSnapshot(store, 'old-sha-2');
    await new Promise((r) => setTimeout(r, 10));
    await manager.takeSnapshot(store, 'recent-sha');

    const pruned = await manager.pruneSnapshots(1);
    expect(pruned).toBe(2);

    const index = await manager.listSnapshots();
    expect(Object.keys(index)).toHaveLength(1);
    expect(index['recent-sha']).toBeDefined();

    // Old snapshot files should be deleted
    expect(existsSync(join(snapshotsDir, 'old-sha-1.graph.json'))).toBe(false);
    expect(existsSync(join(snapshotsDir, 'old-sha-2.graph.json'))).toBe(false);
    expect(existsSync(join(snapshotsDir, 'recent-sha.graph.json'))).toBe(true);
  });

  it('updates index.json correctly', async () => {
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'),
    ]);
    await store.putEdges([
      makeRelation('r1', 'e1', 'e2'),
      makeRelation('r2', 'e2', 'e1'),
    ]);

    await manager.takeSnapshot(store, 'sha-xyz');

    const index = await manager.listSnapshots();
    expect(index['sha-xyz']).toBeDefined();
    expect(index['sha-xyz'].entity_count).toBe(2);
    expect(index['sha-xyz'].relation_count).toBe(2);
    expect(index['sha-xyz'].timestamp).toBeTruthy();
  });

  it('returns empty index when no snapshots exist', async () => {
    const index = await manager.listSnapshots();
    expect(index).toEqual({});
  });

  it('pruneSnapshots returns 0 when count is within keepCount', async () => {
    await store.putNodes([makeEntity('e1', 'funcA', 'src/a.ts')]);
    await manager.takeSnapshot(store, 'sha-a');
    await manager.takeSnapshot(store, 'sha-b');

    const pruned = await manager.pruneSnapshots(5);
    expect(pruned).toBe(0);

    const index = await manager.listSnapshots();
    expect(Object.keys(index)).toHaveLength(2);
  });
});
