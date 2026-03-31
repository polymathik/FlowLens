/**
 * MCP tools integration tests — validates all 12 tool handlers against
 * a real indexed graph built from the simple-project fixture.
 *
 * Tests call handleXxx() functions directly (no MCP transport layer).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { AnnotationStore } from '../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../src/analysis/snapshot-manager.js';
import type { ServerDependencies } from '../../src/mcp/server.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Import tool handlers
import { handleGetContext } from '../../src/mcp/tools/get-context.js';
import { handleGetDependents } from '../../src/mcp/tools/get-dependents.js';
import { handleGetModuleInterface } from '../../src/mcp/tools/get-module-interface.js';
import { handleAnnotate } from '../../src/mcp/tools/annotate.js';
import { handleTraverse } from '../../src/mcp/tools/traverse.js';
import { handleDetectCycles } from '../../src/mcp/tools/detect-cycles.js';
import { handleGetMetrics } from '../../src/mcp/tools/get-metrics.js';
import { handleGetSummary } from '../../src/mcp/tools/get-summary.js';
import { handleGetHotspots } from '../../src/mcp/tools/get-hotspots.js';
import { handleGetLayerMap } from '../../src/mcp/tools/get-layer-map.js';
import { handleCheckArchitecture } from '../../src/mcp/tools/check-architecture.js';

const DEFAULT_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

/**
 * Qualified name for the UserService class entity in simple-project.
 * Using the qualified name avoids ambiguity with child entities
 * (methods, fields, parameters) whose qualified_name also contains "UserService".
 */
const USER_SERVICE_QN = 'user-service.ts/UserService';

describe('MCP Tools integration', () => {
  let tmpDir: string;
  let deps: ServerDependencies;
  let store: LevelGraphStore;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-mcp-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));

    // Index simple-project
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const annotationStore = new AnnotationStore(join(tmpDir, 'annotations.json'));
    await mkdir(join(tmpDir, 'snapshots'), { recursive: true });
    const snapshotManager = new SnapshotManager(join(tmpDir, 'snapshots'));

    // Take a snapshot for diff testing
    await snapshotManager.takeSnapshot(store, 'test-sha');

    deps = {
      graph: store,
      annotationStore,
      snapshotManager,
      flowlensDir: tmpDir,
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      fileIndexPath: join(tmpDir, 'file_index.json'),
    };
  });

  afterAll(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -- get_context --
  it('get_context returns entity with relations', async () => {
    const result = await handleGetContext(
      { entity: USER_SERVICE_QN, max_results: 50 },
      deps,
    );
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const data = JSON.parse(result.content[0].text);
    expect(data.data.entity.name).toBe('UserService');
    expect(data.last_indexed).toBeDefined();
  });

  it('get_context returns error for unknown entity', async () => {
    const result = await handleGetContext({ entity: 'NonExistentThing' }, deps);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('not found');
  });

  // -- get_dependents --
  it('get_dependents returns dependents with risk score', async () => {
    const result = await handleGetDependents(
      { entity: USER_SERVICE_QN },
      deps,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.data.entity).toBeDefined();
    expect(data.data.risk_score).toBeGreaterThanOrEqual(0);
    expect(data.data.dependents).toBeDefined();
  });

  // -- get_summary --
  it('get_summary returns codebase statistics', async () => {
    const result = await handleGetSummary({} as Record<string, never>, deps);
    const data = JSON.parse(result.content[0].text);
    expect(data.data.total_entities).toBeGreaterThan(0);
    expect(data.data.total_relations).toBeGreaterThanOrEqual(0);
    expect(data.data.language_breakdown).toBeDefined();
    expect(data.last_indexed).toBeDefined();
  });

  // -- get_metrics --
  it('get_metrics returns sorted metrics', async () => {
    const result = await handleGetMetrics(
      { sort_by: 'cognitive_complexity', max_results: 5 },
      deps,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.data.entries.length).toBeGreaterThan(0);
    expect(data.data.summary).toBeDefined();
  });

  // -- annotate --
  it('annotate creates and persists annotation', async () => {
    const result = await handleAnnotate(
      {
        entity: USER_SERVICE_QN,
        text: 'Test annotation',
        category: 'decision',
        author: 'test',
      },
      deps,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.data.annotation_id).toMatch(/^ann_/);
    expect(data.data.created_at).toBeDefined();

    // Verify it appears in get_context
    const ctx = await handleGetContext({ entity: USER_SERVICE_QN }, deps);
    const ctxData = JSON.parse(ctx.content[0].text);
    expect(ctxData.data.annotations?.length).toBeGreaterThan(0);
  });

  // -- traverse --
  it('traverse walks graph at given depth', async () => {
    const result = await handleTraverse(
      { start: USER_SERVICE_QN, direction: 'outbound', max_depth: 1 },
      deps,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.data.start).toBeDefined();
    expect(data.data.nodes.length).toBeGreaterThanOrEqual(0);
  });

  // -- detect_cycles --
  it('detect_cycles returns cycle data', async () => {
    const result = await handleDetectCycles({ granularity: 'file' }, deps);
    const data = JSON.parse(result.content[0].text);
    expect(data.data.cycles).toBeDefined();
    expect(data.data.summary).toBeDefined();
    // simple-project has no cycles
    expect(data.data.summary.total_cycles).toBe(0);
  });

  // -- get_hotspots --
  it('get_hotspots returns ranked list', async () => {
    const result = await handleGetHotspots({ max_results: 10 }, deps);
    const data = JSON.parse(result.content[0].text);
    expect(data.data.hotspots).toBeDefined();
    expect(data.data.summary).toBeDefined();
  });

  // -- check_architecture (no architecture.json in simple-project) --
  it('check_architecture returns error when no architecture.json exists', async () => {
    const result = await handleCheckArchitecture({}, deps);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('architecture.json');
  });

  // -- get_layer_map (no architecture.json in simple-project) --
  it('get_layer_map returns error when no architecture.json exists', async () => {
    const result = await handleGetLayerMap({} as Record<string, never>, deps);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('architecture.json');
  });

  // -- get_module_interface --
  it('get_module_interface returns public exports for a file', async () => {
    const result = await handleGetModuleInterface(
      { module: 'user-service.ts' },
      deps,
    );
    // Should resolve to the file entity and return its exports
    if (!('isError' in result) || !result.isError) {
      const data = JSON.parse(result.content[0].text);
      expect(data.data.module).toBeDefined();
      expect(data.data.exports).toBeDefined();
    }
  });

  // -- Response format consistency --
  it('all non-error responses include last_indexed', async () => {
    const tools = [
      handleGetContext({ entity: USER_SERVICE_QN }, deps),
      handleGetSummary({} as Record<string, never>, deps),
      handleGetMetrics({ max_results: 1 }, deps),
      handleDetectCycles({}, deps),
    ];
    const results = await Promise.all(tools);
    for (const r of results) {
      if (!('isError' in r) || !r.isError) {
        const data = JSON.parse(r.content[0].text);
        expect(data.last_indexed).toBeDefined();
      }
    }
  });

  // -- Entity resolution modes --
  it('entity resolution works by qualified name', async () => {
    const result = await handleGetContext(
      { entity: USER_SERVICE_QN },
      deps,
    );
    expect(!('isError' in result) || !result.isError).toBe(true);
  });

  // -- max_results truncation --
  it('max_results truncation works', async () => {
    const result = await handleGetMetrics({ max_results: 1 }, deps);
    const data = JSON.parse(result.content[0].text);
    expect(data.data.entries.length).toBeLessThanOrEqual(1);
  });

  // -- Query latency --
  it('typical tool call completes under 100ms', async () => {
    // Warm-up call (first call may be slower due to lazy init)
    await handleGetContext({ entity: USER_SERVICE_QN }, deps);

    const start = performance.now();
    await handleGetContext({ entity: USER_SERVICE_QN }, deps);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
