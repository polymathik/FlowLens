/**
 * Node `#subpath` imports (package.json `imports`) — resolver level (Parser truth 2, item 1).
 * Each case runs with and without build output; resolution is path-based.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveModuleSpecifier, clearModuleResolverCaches } from '../../../src/parser/resolution/ts-module-resolver.js';
import { resolvePackageImport } from '../../../src/parser/resolution/package-imports.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fl-si-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
afterEach(() => clearModuleResolverCaches());

const j = (o: object) => JSON.stringify(o);
const web = (imports: unknown, extra: Record<string, string> = {}) => ({
  'package.json': j({ name: 'root', workspaces: ['apps/*'] }),
  'apps/web/package.json': j({ name: 'web', imports }),
  'apps/web/src/lib/api.ts': 'export const api = {};',
  'apps/web/src/lib/index.ts': 'export {};',
  'apps/web/src/lib/canvas/geometry.ts': 'export const g = 1;',
  'apps/web/src/lib/components/Icon.svelte': '<script></script>',
  'apps/web/src/routes/+page.svelte': '',
  'apps/web/src/main.ts': '',
  ...extra,
});
const from = 'apps/web/src/routes/+page.svelte';
const r = (root: string, spec: string, f = from) => resolveModuleSpecifier(spec, f, root);

describe('package.json imports (#subpath)', () => {
  it('resolves exact and wildcard keys, .js → .ts and extensionless', () => {
    const root = project(web({ '#lib': './src/lib/index.js', '#lib/*': './src/lib/*' }));
    expect(r(root, '#lib')).toEqual({ file: 'apps/web/src/lib/index.ts', external: false });
    expect(r(root, '#lib/api.js').file).toBe('apps/web/src/lib/api.ts');
    expect(r(root, '#lib/api').file).toBe('apps/web/src/lib/api.ts');
    expect(r(root, '#lib/canvas/geometry.js').file).toBe('apps/web/src/lib/canvas/geometry.ts');
    expect(r(root, '#lib/components/Icon.svelte').file).toBe('apps/web/src/lib/components/Icon.svelte');
  });

  it('uses the nearest package.json as scope (from any file below it)', () => {
    const root = project(web({ '#lib/*': './src/lib/*' }));
    expect(r(root, '#lib/api.js', 'apps/web/src/main.ts').file).toBe('apps/web/src/lib/api.ts');
  });

  it('prefers the longest matching pattern prefix', () => {
    const root = project(web(
      { '#lib/*': './src/nope/*', '#lib/canvas/*': './src/lib/canvas/*' },
      { 'apps/web/src/nope/canvas/geometry.ts': '' },
    ));
    expect(r(root, '#lib/canvas/geometry.js').file).toBe('apps/web/src/lib/canvas/geometry.ts');
  });

  it('ranks conditions: source › development › svelte › types › import › default', () => {
    const root = project(web({ '#lib/*': { default: './src/nope/*', types: './src/lib/*', development: './src/lib/canvas/*' } }));
    // `development` points at src/lib/canvas/<x>: geometry.ts lives there
    expect(r(root, '#lib/geometry.js').file).toBe('apps/web/src/lib/canvas/geometry.ts');
    const root2 = project(web({ '#lib/*': { import: './src/nope/*.js', svelte: './src/lib/*', default: './src/nope/*' } }));
    expect(r(root2, '#lib/api.js').file).toBe('apps/web/src/lib/api.ts');
  });

  it('falls back through array targets', () => {
    const root = project(web({ '#lib/*': ['./src/missing/*', './src/lib/*'] }));
    expect(r(root, '#lib/api.js').file).toBe('apps/web/src/lib/api.ts');
  });

  describe.each([['without dist/', {}], ['with dist/', { 'apps/web/dist/api.js': '', 'apps/web/dist/api.d.ts': '' }]])('targets in build output %s', (_l, built) => {
    it('maps dist/ targets back to source (tsconfig outDir/rootDir)', () => {
      const root = project(web({ '#lib/*': './dist/*', '#api': { types: './dist/api.d.ts', default: './dist/api.js' } }, {
        'apps/web/tsconfig.json': j({ compilerOptions: { rootDir: 'src/lib', outDir: 'dist' } }),
        ...built,
      }));
      expect(r(root, '#api').file).toBe('apps/web/src/lib/api.ts');
      expect(r(root, '#lib/api.js').file).toBe('apps/web/src/lib/api.ts');
      expect(r(root, '#lib/canvas/geometry.js').file).toBe('apps/web/src/lib/canvas/geometry.ts');
    });
  });

  it('is unresolved (not external) when the target file is missing or the key is not declared', () => {
    const root = project(web({ '#lib': './src/lib/index.js', '#lib/*': './src/lib/*' }));
    expect(r(root, '#lib/ghost.js')).toEqual({ file: null, external: false });
    expect(r(root, '#nothing/else')).toEqual({ file: null, external: false });
    const blocked = project(web({ '#lib/*': null }));
    expect(r(blocked, '#lib/api.js')).toEqual({ file: null, external: false });
  });

  it('a target that names another package is external', () => {
    const root = project(web({ '#dep': 'lodash', '#dep/*': 'lodash/*' }));
    expect(r(root, '#dep')).toEqual({ file: null, external: true });
    expect(r(root, '#dep/get')).toEqual({ file: null, external: true });
  });

  it('is ignored (external, as before) when the scope declares no `imports` (Nuxt #app, virtual ids)', () => {
    const root = project(web(undefined));
    expect(r(root, '#app')).toEqual({ file: null, external: true });
    expect(resolvePackageImport('#app', join(root, from), root)).toBeNull();
  });

  it('does not touch tsconfig paths, $lib or $app/$env specifiers', () => {
    const root = project(web({ '#lib/*': './src/lib/*' }, {
      'apps/web/tsconfig.json': j({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/lib/*'], '#hash/*': ['src/lib/canvas/*'] } } }),
    }));
    expect(r(root, '@/api').file).toBe('apps/web/src/lib/api.ts');
    expect(r(root, '$lib/api').file).toBe('apps/web/src/lib/api.ts');
    expect(r(root, '$app/navigation')).toEqual({ file: null, external: true });
    expect(r(root, '$env/static/public')).toEqual({ file: null, external: true });
    // a tsconfig `paths` alias beginning with `#` still wins
    expect(r(root, '#hash/geometry').file).toBe('apps/web/src/lib/canvas/geometry.ts');
  });
});
