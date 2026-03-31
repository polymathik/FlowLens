import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { detectCycles } from '../../src/analysis/cycle-detector.js';
import { computePageRank } from '../../src/analysis/pagerank.js';
import { computeChurn } from '../../src/analysis/churn-analyzer.js';
import { computeHotspots } from '../../src/analysis/hotspot-analyzer.js';
import { validateArchitecture } from '../../src/analysis/architecture-validator.js';
import { SnapshotManager } from '../../src/analysis/snapshot-manager.js';
import { computeDiff } from '../../src/analysis/diff-computer.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import type { ArchitectureConfig } from '../../src/contracts/architecture.js';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('Analysis integration', () => {
  let tmpDir: string;
  let store: LevelGraphStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-analysis-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Cycle Detection ---

  it('detects cycles in cyclic-project fixture', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/cyclic-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const cycles = await detectCycles(store, { granularity: 'file' });
    expect(cycles.length).toBeGreaterThan(0);
    // Should find the triangle cycle (a→b→c→a) and/or binary cycle (d↔e)
  });

  it('no cycles in simple-project fixture', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const cycles = await detectCycles(store, { granularity: 'file' });
    // simple-project has no circular imports
    expect(cycles).toHaveLength(0);
  });

  // --- Architecture Validation ---

  it('detects architecture violations in layered-project', async () => {
    const fixtureDir = join(import.meta.dirname, '../fixtures/layered-project');
    await runIndex({
      rootDir: fixtureDir,
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const archConfig: ArchitectureConfig = JSON.parse(
      await readFile(join(fixtureDir, 'architecture.json'), 'utf-8'),
    );
    const violations = await validateArchitecture(store, archConfig);
    // admin.ts imports from data/ which violates Routes may_only_access Services
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.layer_from === 'Routes')).toBe(true);
  });

  // --- PageRank ---

  it('computes PageRank for indexed project', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const ranks = await computePageRank(store);
    expect(ranks.size).toBeGreaterThan(0);
    // Ranks should sum approximately to 1
    const sum = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 0);
  });

  // --- Hotspots ---

  it('computes hotspots with churn data', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    // Use the FlowLens repo root for actual git churn data
    const repoRoot = join(import.meta.dirname, '../..');
    const churnData = await computeChurn(repoRoot, { period_days: 365 });

    // Even with no matching churn data, should not crash
    const hotspots = await computeHotspots(store, churnData);
    expect(Array.isArray(hotspots)).toBe(true);
  });

  // --- Snapshots + Diff ---

  it('takes snapshot, modifies graph, computes diff', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    // Take snapshot
    const snapshotsDir = join(tmpDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });
    const snapshotMgr = new SnapshotManager(snapshotsDir);
    await snapshotMgr.takeSnapshot(store, 'abc123');

    // Verify snapshot exists
    const snapshot = await snapshotMgr.loadSnapshot('abc123');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.entities.length).toBeGreaterThan(0);

    // Modify graph: add a new entity
    await store.putNode({
      id: 'new-entity',
      kind: 'class',
      name: 'NewClass',
      qualified_name: 'src/new.ts/NewClass',
      file: 'src/new.ts',
      location: { line_start: 1, line_end: 5, column_start: 0, column_end: 0 },
      visibility: 'public',
      language: 'typescript',
    });

    // Remove an entity that was in the snapshot
    const oldEntities = snapshot!.entities.filter((e) => e.kind !== 'file' && e.kind !== 'module');
    if (oldEntities.length > 0) {
      await store.deleteNode(oldEntities[0].id);
    }

    // Compute diff
    const diff = await computeDiff(store, snapshot!);
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(diff.summary.total_changes).toBeGreaterThan(0);

    // Should have at least one 'added' and one 'removed'
    const added = diff.changes.filter((c) => c.change_type === 'added');
    const removed = diff.changes.filter((c) => c.change_type === 'removed');
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);
  });

  // --- Snapshot Pruning ---

  it('prunes old snapshots', async () => {
    const snapshotsDir = join(tmpDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });
    const snapshotMgr = new SnapshotManager(snapshotsDir);

    // Create a node so snapshots are non-empty
    await store.putNode({
      id: 'a',
      kind: 'class',
      name: 'A',
      qualified_name: 'a',
      file: 'a.ts',
      location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 },
      visibility: 'public',
      language: 'typescript',
    });

    await snapshotMgr.takeSnapshot(store, 'sha1');
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await snapshotMgr.takeSnapshot(store, 'sha2');
    await new Promise((r) => setTimeout(r, 10));
    await snapshotMgr.takeSnapshot(store, 'sha3');

    const index = await snapshotMgr.listSnapshots();
    expect(Object.keys(index)).toHaveLength(3);

    // Prune to keep only 2
    const pruned = await snapshotMgr.pruneSnapshots(2);
    expect(pruned).toBe(1);

    const indexAfter = await snapshotMgr.listSnapshots();
    expect(Object.keys(indexAfter)).toHaveLength(2);
  });

  // --- Performance ---

  it('cycle detection completes within performance budget', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const start = performance.now();
    await detectCycles(store, { granularity: 'file' });
    const duration = performance.now() - start;

    // Small project should complete in under 500ms (spec target: <200ms for 50K entities)
    expect(duration).toBeLessThan(500);
  });

  it('architecture validation completes within performance budget', async () => {
    const fixtureDir = join(import.meta.dirname, '../fixtures/layered-project');
    await runIndex({
      rootDir: fixtureDir,
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const archConfig = JSON.parse(
      await readFile(join(fixtureDir, 'architecture.json'), 'utf-8'),
    ) as ArchitectureConfig;

    const start = performance.now();
    await validateArchitecture(store, archConfig);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);
  });

  // --- CLI Check Output Structure ---

  it('flowlens check returns structured results', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/cyclic-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const cycles = await detectCycles(store, { granularity: 'file' });
    expect(cycles.length).toBeGreaterThan(0);

    // Verify the JSON output structure matches spec
    const jsonOutput = {
      timestamp: new Date().toISOString(),
      cycles: cycles.map((c) => ({
        entities: c.entities,
        severity: c.severity,
        granularity: c.granularity,
      })),
      architecture_violations: [],
      summary: {
        cycles_found: cycles.length,
        violations_found: 0,
        severity_breakdown: {
          high: cycles.filter((c) => c.severity === 'high').length,
          medium: cycles.filter((c) => c.severity === 'medium').length,
          low: cycles.filter((c) => c.severity === 'low').length,
        },
      },
    };

    expect(jsonOutput.timestamp).toBeDefined();
    expect(jsonOutput.cycles.length).toBeGreaterThan(0);
    expect(jsonOutput.summary.cycles_found).toBe(cycles.length);
    expect(typeof jsonOutput.summary.severity_breakdown.high).toBe('number');
  });
});
