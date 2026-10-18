/**
 * Module resolution + symbol table edge cases (Phase 8).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonc } from '../../../src/parser/resolution/jsonc.js';
import { resolveModuleSpecifier, clearModuleResolverCaches } from '../../../src/parser/resolution/ts-module-resolver.js';
import { indexFixture, findEdge, type IndexedFixture } from '../../golden/harness.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fl-res-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

let fx: IndexedFixture | null = null;
afterEach(async () => { await fx?.cleanup(); fx = null; clearModuleResolverCaches(); });

describe('jsonc', () => {
  it('parses comments and trailing commas, keeps // inside strings', () => {
    expect(parseJsonc('{ // c\n "a": "http://x", /* b */ "c": [1, 2,], }')).toEqual({ a: 'http://x', c: [1, 2] });
    expect(parseJsonc('{ broken')).toBeNull();
  });
});

describe('resolveModuleSpecifier', () => {
  it('maps .js/.mjs/.cjs/.jsx specifiers to TS sources and probes index files', () => {
    const root = project({ 'a.ts': '', 'b.mts': '', 'c.cts': '', 'd.tsx': '', 'dir/index.ts': '', 'e.js': '' });
    const r = (s: string) => resolveModuleSpecifier(s, 'x.ts', root).file;
    expect(r('./a.js')).toBe('a.ts');
    expect(r('./b.mjs')).toBe('b.mts');
    expect(r('./c.cjs')).toBe('c.cts');
    expect(r('./d.jsx')).toBe('d.tsx');
    expect(r('./dir')).toBe('dir/index.ts');
    expect(r('./e.js')).toBe('e.js');
    expect(resolveModuleSpecifier('./missing.js', 'x.ts', root)).toEqual({ file: null, external: false });
    expect(resolveModuleSpecifier('node:fs', 'x.ts', root)).toEqual({ file: null, external: true });
    expect(resolveModuleSpecifier('react', 'x.ts', root)).toEqual({ file: null, external: true });
  });

  it('applies tsconfig paths from an extended config and the nearest tsconfig', () => {
    const root = project({
      'tsconfig.json': '{ "extends": "./base.json" }',
      'base.json': '{ "compilerOptions": { "baseUrl": "src", // c\n "paths": { "~/*": ["lib/*"], "exact": ["lib/e.ts"], } } }',
      'src/lib/x.ts': '', 'src/lib/e.ts': '', 'src/top.ts': '',
      'pkg/tsconfig.json': '{ "compilerOptions": { "paths": { "@p/*": ["./inner/*"] } } }',
      'pkg/inner/y.ts': '',
    });
    expect(resolveModuleSpecifier('~/x', 'src/a.ts', root).file).toBe('src/lib/x.ts');
    expect(resolveModuleSpecifier('exact', 'src/a.ts', root).file).toBe('src/lib/e.ts');
    expect(resolveModuleSpecifier('top', 'src/a.ts', root).file).toBe('src/top.ts'); // baseUrl
    expect(resolveModuleSpecifier('@p/y', 'pkg/m.ts', root).file).toBe('pkg/inner/y.ts');
  });
});

describe('symbol table through barrels', () => {
  it('reports an ambiguous name exported by two `export *` sources', async () => {
    fx = await indexFixture(project({
      'a.ts': 'export function dup() {}\n',
      'b.ts': 'export function dup() {}\n',
      'index.ts': "export * from './a.js';\nexport * from './b.js';\n",
      'use.ts': "import { dup } from './index.js';\nexport function go() { dup(); }\n",
    }));
    const amb = fx.unresolved.find((r) => r.target_name === 'dup' && r.type === 'call');
    expect(amb?.resolution).toBe('ambiguous');
    expect(amb?.meta?.candidates).toHaveLength(2);
  });

  it('an explicit export wins over `export *`, and import-then-export is followed', async () => {
    fx = await indexFixture(project({
      'a.ts': 'export function dup() {}\n',
      'b.ts': 'export function dup() {}\n',
      'c.ts': "import { dup as theDup } from './b.js';\nexport { theDup as chosen };\n",
      'index.ts': "export * from './a.js';\nexport { dup } from './b.js';\nexport * from './c.js';\n",
      'use.ts': "import { dup, chosen } from './index.js';\nexport function go() { dup(); chosen(); }\n",
    }));
    expect(fx.unresolved).toEqual([]);
    const calls = fx.edges.filter((e) => e.type === 'call').map((e) => fx!.byId.get(e.to)?.qualified_name);
    expect(calls).toEqual(['b.ts/dup']);
    expect(findEdge(fx, 'call', 'use.ts/go', 'b.ts/dup')?.weight).toBe(2);
  });
});
