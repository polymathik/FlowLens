/**
 * Robustness: deep nesting cannot overflow the stack, a failing extractor
 * never marks the file indexed (it is retried and keeps its old graph data),
 * syntax errors and failures are counted in the manifest.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { indexFixture, type IndexedFixture } from './harness.js';
import { extractorRegistry } from '../../src/parser/extractor-registry.js';
import type { LanguageExtractor } from '../../src/contracts/language-extractor.js';

let fx: IndexedFixture | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await fx?.cleanup();
  fx = null;
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fl-robust-'));
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  return dir;
}

describe('indexer robustness', () => {
  it('indexes 12k-deep nesting without a stack overflow', async () => {
    const deep = `export function deep() { return ${'['.repeat(12000)}${']'.repeat(12000)}; }\n`;
    fx = await indexFixture(project({ 'src/deep.ts': deep, 'src/ok.ts': 'export const ok = 1;\n' }));
    expect(fx.result.errors.filter((e) => /call stack/i.test(e.message))).toEqual([]);
    expect(fx.nodes.some((n) => n.qualified_name === 'src/deep.ts/deep')).toBe(true);
    expect(fx.result.manifest.completion).toBe('complete');
  });

  it('a failing extractor keeps old data, is not marked indexed, and is retried', async () => {
    fx = await indexFixture(project({ 'a.ts': 'export function a() {}\n', 'b.ts': 'export function b() {}\n' }));
    const real = extractorRegistry.get('typescript')!;
    const broken: LanguageExtractor = { ...real, extractEntities: () => { throw new Error('boom'); } };
    writeFileSync(join(fx.root, 'a.ts'), 'export function a2() {}\n');
    const spy = vi.spyOn(extractorRegistry, 'get').mockImplementation((lang) => (lang === 'typescript' ? broken : real));

    const failed = await fx.reindex();
    expect(failed.manifest.completion).toBe('partial');
    expect(failed.manifest.errors.parse_failures).toBe(1);
    expect(failed.manifest.errors.failed_files).toEqual(['a.ts']);
    // previous graph data for a.ts survives
    expect(fx.nodes.some((n) => n.qualified_name === 'a.ts/a')).toBe(true);
    const index = JSON.parse(readFileSync(join(fx.root, '.flowlens/file_index.json'), 'utf-8'));
    expect(index['a.ts'].status).toBe('failed');

    spy.mockRestore();
    const retried = await fx.reindex();
    expect(retried.filesIndexed).toBe(1);
    expect(retried.manifest.completion).toBe('complete');
    expect(fx.nodes.some((n) => n.qualified_name === 'a.ts/a2')).toBe(true);
    expect(fx.nodes.some((n) => n.qualified_name === 'a.ts/a')).toBe(false);
  });

  it('counts files with syntax errors and writes the manifest', async () => {
    fx = await indexFixture(project({ 'bad.ts': 'export function f( {\n', 'good.ts': 'export const g = 1;\n' }));
    expect(fx.result.quality.files_with_syntax_errors).toBe(1);
    const manifest = JSON.parse(readFileSync(join(fx.root, '.flowlens/manifest.json'), 'utf-8'));
    expect(manifest.project_id).toMatch(/^[0-9a-f]{12}$/);
    expect(manifest.completion).toBe('complete');
    expect(manifest.entity_count).toBe(fx.nodes.length);
    expect(manifest.quality.files_with_syntax_errors).toBe(1);
    const identity = JSON.parse(readFileSync(join(fx.root, '.flowlens/project.json'), 'utf-8'));
    expect(manifest.project_id).toBe(identity.id);
  });

  it('resolves imports when given a relative rootDir', async () => {
    const { runIndex } = await import('../../src/indexer/indexer.js');
    const { LevelGraphStore } = await import('../../src/graph/levelgraph-store.js');
    const dir = project({ 'a.ts': "import { b } from './b.js';\nexport const a = b;\n", 'b.ts': 'export const b = 1;\n' });
    const store = new LevelGraphStore();
    await store.open(join(dir, '.flowlens/graph'));
    const rel = relative(process.cwd(), dir);
    expect(rel.startsWith('/')).toBe(false);
    try {
      const result = await runIndex({
        rootDir: rel, graphStore: store,
        config: { exclude: ['.flowlens/**'], languages: {} },
        fileIndexPath: join(dir, '.flowlens/file_index.json'), incremental: false,
      });
      expect(result.quality.dangling_edges).toBe(0);
      expect((await store.getAllEdges()).filter((e) => e.type === 'import')).toHaveLength(1);
    } finally {
      await store.close();
    }
  });
});
