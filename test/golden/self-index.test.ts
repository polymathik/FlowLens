/**
 * Self-index golden test: FlowLens indexing its own `src/` must resolve
 * ≥ 98% of internal imports, have zero dangling edges / id collisions, and
 * link core modules (e.g. the indexer) to what they import.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexFixture, danglingEdges, type IndexedFixture } from './harness.js';

const REPO = join(import.meta.dirname, '../..');
let fx: IndexedFixture;
afterAll(async () => { await fx?.cleanup(); });

describe('self-index', () => {
  it('indexes FlowLens src/ with trustworthy cross-file edges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fl-self-'));
    cpSync(join(REPO, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(REPO, 'tsconfig.json'), join(dir, 'tsconfig.json'));
    cpSync(join(REPO, 'package.json'), join(dir, 'package.json'));
    const t = Date.now();
    fx = await indexFixture(dir);
    const ms = Date.now() - t;
    const q = fx.result.quality;
    console.log(`self-index: ${fx.result.filesIndexed} files in ${ms} ms, ${q.entity_count} entities, ${q.edge_count} edges, imports ${q.relative_imports_resolved}/${q.relative_imports}, unresolved ${q.unresolved_count}`);

    expect(q.import_resolution_rate).toBeGreaterThanOrEqual(0.98);
    expect(danglingEdges(fx)).toEqual([]);
    expect(q.id_collisions).toBe(0);
    expect(fx.result.entitiesCreated).toBe(fx.nodes.length);
    expect(q.unresolved_count / Math.max(1, q.edge_count)).toBeLessThan(0.01);

    const byQn = new Map(fx.nodes.map((n) => [n.qualified_name, n]));
    const indexer = byQn.get('src/indexer/indexer.ts')!;
    const imports = fx.edges.filter((e) => e.from === indexer.id && e.type === 'import')
      .map((e) => fx.byId.get(e.to)?.qualified_name);
    expect(imports).toEqual(expect.arrayContaining(['src/indexer/pass2.ts', 'src/quality/graph-quality.ts']));
    const runIndex = byQn.get('src/indexer/indexer.ts/runIndex')!;
    const calls = fx.edges.filter((e) => e.from === runIndex.id && e.type === 'call')
      .map((e) => fx.byId.get(e.to)?.qualified_name);
    expect(calls).toContain('src/indexer/pass2.ts/runPass2');
  }, 180_000);
});
