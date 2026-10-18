/**
 * Phase 12 end to end: a dependency loop made only of `import type` lines and
 * type annotations is not a runtime cycle. Index a tiny TS project →
 * detect_cycles (MCP), `flowlens check` runner and the health report must all
 * agree: runtime loops only by default, type loops on request / as info.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { AnnotationStore } from '../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../src/analysis/snapshot-manager.js';
import { createFlowLensServer } from '../../src/mcp/server.js';
import { detectCycles } from '../../src/analysis/cycle-detector.js';
import { runCheck } from '../../src/analysis/check-runner.js';
import { buildHealthReport, loadHealthInput } from '../../src/health/index.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';

const CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

const FILES: Record<string, string> = {
  // server → tools at runtime; tools → server only for a type (the FlowLens mcp/ shape).
  'src/server.ts': [
    "import { registerTool } from './tools';",
    'export interface Deps { root: string }',
    'export function start(d: Deps): void { registerTool(d); }',
  ].join('\n'),
  'src/tools.ts': [
    "import type { Deps } from './server';",
    'export function registerTool(d: Deps): string { return d.root; }',
  ].join('\n'),
  // A real runtime loop.
  'src/a.ts': "import { b } from './b';\nexport function a(): number { return b() + 1; }\n",
  'src/b.ts': "import { a } from './a';\nexport function b(): number { return a() - 1; }\n",
};

describe('type-only dependency loops (Phase 12)', () => {
  let root: string;
  let store: LevelGraphStore;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'flowlens-typeonly-'));
    for (const [file, text] of Object.entries(FILES)) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    mkdirSync(join(root, '.flowlens'));
    store = new LevelGraphStore();
    await store.open(join(root, '.flowlens', 'graph'));
    await runIndex({ rootDir: root, graphStore: store, config: CONFIG, fileIndexPath: join(root, '.flowlens', 'file_index.json'), incremental: false });
  }, 60_000);

  afterAll(async () => {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('detector: runtime cycles only by default, type loops marked when included', async () => {
    const runtime = await detectCycles(store, { granularity: 'file' });
    expect(runtime.map((c) => [...c.entities].sort())).toEqual([['src/a.ts', 'src/b.ts']]);
    expect(runtime[0].type_only).toBeUndefined();

    const all = await detectCycles(store, { granularity: 'file', include_type_only: true });
    const typeLoop = all.find((c) => c.entities.includes('src/server.ts'))!;
    expect(typeLoop.type_only).toBe(true);
    const back = typeLoop.edges!.find((e) => e.from === 'src/tools.ts')!;
    expect(back.type_only).toBe(true);
    expect(typeLoop.edges!.find((e) => e.from === 'src/server.ts')!.type_only).toBeUndefined();
    expect(all.find((c) => c.entities.includes('src/a.ts'))!.type_only).toBeUndefined();
  });

  it('MCP detect_cycles honours include_type_only', async () => {
    const flowlensDir = join(root, '.flowlens');
    const annotationStore = new AnnotationStore(join(flowlensDir, 'annotations.json'));
    await annotationStore.load();
    const server = createFlowLensServer({
      graph: store, annotationStore, snapshotManager: new SnapshotManager(join(flowlensDir, 'snapshots')),
      flowlensDir, rootDir: root, fileIndexPath: join(flowlensDir, 'file_index.json'),
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(ct);
    const call = async (args: Record<string, unknown>) => {
      const r = await client.callTool({ name: 'detect_cycles', arguments: args });
      return JSON.parse((r.content as Array<{ text: string }>)[0].text).data;
    };
    expect((await call({ granularity: 'file' })).summary.total_cycles).toBe(1);
    const inc = await call({ granularity: 'file', include_type_only: true });
    expect(inc.summary.total_cycles).toBe(2);
    expect(inc.cycles.filter((c: { type_only?: boolean }) => c.type_only)).toHaveLength(1);
    await client.close();
    await server.close();
  });

  it('check runner: --include-type-only adds the type loop', async () => {
    const opts = { flowlensDir: join(root, '.flowlens'), runCycles: true, runArchitecture: false, severity: 'low' as const };
    const plain = await runCheck(store, opts);
    expect(plain.report.summary.cycles_found).toBe(1);
    const inc = await runCheck(store, { ...opts, includeTypeOnly: true });
    expect(inc.report.include_type_only).toBe(true);
    expect(inc.report.cycles.filter((c) => c.type_only)).toHaveLength(1);
  });

  it('health: runtime loop is a tangle, type loop is an info note with no penalty', async () => {
    await store.close();
    try {
      const report = await buildHealthReport(await loadHealthInput(root), { now: '2026-10-18T00:00:00Z' });
      const tangles = report.findings.filter((f) => f.kind === 'cycle');
      expect(tangles.map((f) => f.focus.files)).toEqual([['src/a.ts', 'src/b.ts']]);
      const notes = report.findings.filter((f) => f.kind === 'type_cycle');
      expect(notes).toHaveLength(1);
      expect(notes[0].severity).toBe('info');
      expect(notes[0].penalty).toBe(0);
      expect(notes[0].focus.files).toEqual(['src/server.ts', 'src/tools.ts']);
      expect(report.next_steps.every((s) => s.finding_id !== notes[0].id)).toBe(true);
    } finally {
      await store.open(join(root, '.flowlens', 'graph'));
    }
  });
});
