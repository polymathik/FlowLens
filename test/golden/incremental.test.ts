/**
 * Incremental correctness (Phase 8.6): deletions, additions and directory
 * removal must leave the graph exactly as a fresh full index would.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexFixture, danglingEdges, edgeStrings, findEdge, type IndexedFixture } from './harness.js';

let fx: IndexedFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('incremental indexing', () => {
  it('deleting a file leaves no dangling edges and records the broken reference', async () => {
    fx = await indexFixture('ts-esm');
    rmSync(join(fx.root, 'src/models/user.ts'));
    const result = await fx.reindex();
    expect(result.filesDeleted).toBe(1);
    expect(result.filesReresolved).toBeGreaterThan(0);
    expect(danglingEdges(fx)).toEqual([]);
    expect(findEdge(fx, 'import', 'src/services/service.ts', 'src/models/user.ts')).toBeUndefined();
    const broken = fx.unresolved.map((r) => `${r.type} ${r.target_name}`).sort();
    expect(broken).toEqual(['create User', 'import ../models/user.js']);
  });

  it('adding a file links importers that did not change', async () => {
    fx = await indexFixture('ts-esm');
    const main = join(fx.root, 'src/main.ts');
    writeFileSync(main, `import { later } from './later.js';\n${readFileSync(main, 'utf-8')}\nexport function useLater() { return later(); }\n`);
    await fx.reindex();
    expect(fx.unresolved.map((r) => r.target_name)).toContain('./later.js');

    writeFileSync(join(fx.root, 'src/later.ts'), 'export function later(): number { return 1; }\n');
    const result = await fx.reindex();
    expect(result.filesIndexed).toBeGreaterThanOrEqual(2); // later.ts + re-resolved main.ts
    expect(findEdge(fx, 'import', 'src/main.ts', 'src/later.ts')).toBeDefined();
    expect(findEdge(fx, 'call', 'src/main.ts/useLater', 'src/later.ts/later')).toBeDefined();
    expect(fx.unresolved).toEqual([]);
  });

  it('removing a directory removes its module node', async () => {
    fx = await indexFixture('ts-esm');
    expect(fx.nodes.some((n) => n.kind === 'module' && n.qualified_name === 'src/models')).toBe(true);
    rmSync(join(fx.root, 'src/models'), { recursive: true });
    await fx.reindex();
    expect(fx.nodes.some((n) => n.kind === 'module' && n.qualified_name === 'src/models')).toBe(false);
    expect(danglingEdges(fx)).toEqual([]);
  });

  it('changing an exporter re-resolves importers through a barrel', async () => {
    fx = await indexFixture('ts-esm');
    // rename helper → doubler; service.ts (unchanged) imports it via the barrel alias
    const util = join(fx.root, 'src/lib/util.ts');
    writeFileSync(util, readFileSync(util, 'utf-8').replace(/helper/g, 'doubler'));
    writeFileSync(join(fx.root, 'src/lib/index.ts'), readFileSync(join(fx.root, 'src/lib/index.ts'), 'utf-8').replace('helper as', 'doubler as'));
    await fx.reindex();
    expect(danglingEdges(fx)).toEqual([]);
    expect(findEdge(fx, 'call', 'src/services/service.ts/Service.run', 'src/lib/util.ts/doubler')).toBeDefined();
    // util.helper(2) through the namespace import now names nothing
    expect(fx.unresolved.map((r) => `${r.type} ${r.target_name}`)).toEqual(['call util.helper']);
  });

  it('an incremental run with no changes keeps the graph identical', async () => {
    fx = await indexFixture('py-pkg');
    const before = edgeStrings(fx, ['import', 'call', 'extend', 'create', 'override', 'decorate']);
    const result = await fx.reindex();
    expect(result.filesIndexed).toBe(0);
    expect(edgeStrings(fx, ['import', 'call', 'extend', 'create', 'override', 'decorate'])).toEqual(before);
  });
});
