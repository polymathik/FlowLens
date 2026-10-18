/**
 * Source-first workspace resolution (Map M0, D1) — resolver level.
 * Build output is mapped back to the source tree by path alone, so every
 * case runs with and without the build output on disk.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveModuleSpecifier, clearModuleResolverCaches } from '../../../src/parser/resolution/ts-module-resolver.js';
import { getWorkspacePackages, packageEntryCandidates } from '../../../src/parser/resolution/workspaces.js';
import { builtToSourceCandidates, getBuildLayout, stripBuiltExtension } from '../../../src/parser/resolution/build-layout.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fl-sf-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
afterEach(() => clearModuleResolverCaches());

const pkg = (o: object) => JSON.stringify(o);
const base = (exports: unknown, extra: Record<string, string> = {}) => ({
  'package.json': pkg({ name: 'root', workspaces: ['packages/*'] }),
  'packages/core/package.json': pkg({ name: '@s/core', exports }),
  'packages/core/tsconfig.json': pkg({ compilerOptions: { rootDir: 'src', outDir: 'dist' } }),
  'packages/core/src/index.ts': 'export const a = 1;',
  'packages/core/src/deep/thing.ts': 'export const b = 2;',
  'packages/app/src/m.ts': '',
  ...extra,
});
const dist = { 'packages/core/dist/index.js': '', 'packages/core/dist/index.d.ts': '', 'packages/core/dist/deep/thing.js': '' };

describe.each([['without dist/', {}], ['with dist/', dist]])('workspace imports %s', (_label, built) => {
  const r = (root: string, spec: string) => resolveModuleSpecifier(spec, 'packages/app/src/m.ts', root);

  it('maps exports → dist/index.js (and types) back to src/index.ts', () => {
    const root = project(base({ '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, built));
    expect(r(root, '@s/core')).toEqual({ file: 'packages/core/src/index.ts', external: false });
  });

  it('maps a subpath pattern export and a string `main`/`types` entry', () => {
    const root = project(base({ './deep/*': './dist/deep/*.js' }, built));
    expect(r(root, '@s/core/deep/thing').file).toBe('packages/core/src/deep/thing.ts');
    const legacy = project({
      ...base(undefined, built),
      'packages/core/package.json': pkg({ name: '@s/core', main: './dist/index.js', types: './dist/index.d.ts' }),
    });
    expect(r(legacy, '@s/core').file).toBe('packages/core/src/index.ts');
  });

  it('honours `source` / `development` / scoped source conditions before `types`', () => {
    for (const cond of ['source', 'development', '@s/source']) {
      const root = project(base({ '.': { types: './dist/index.d.ts', [cond]: './src/index.ts', default: './dist/index.js' } }, built));
      expect(packageEntryCandidates(getWorkspacePackages(root).get('@s/core')!, '')[0]).toBe(join(root, 'packages/core/src/index.ts'));
      expect(r(root, '@s/core').file).toBe('packages/core/src/index.ts');
      clearModuleResolverCaches();
    }
  });

  it('uses tsconfig rootDir/outDir (non-conventional layout)', () => {
    const root = project({
      'package.json': pkg({ workspaces: ['packages/*'] }),
      'packages/lib/package.json': pkg({ name: '@s/lib', main: './compiled/index.js' }),
      'packages/lib/tsconfig.json': pkg({ compilerOptions: { rootDir: './source', outDir: './compiled' } }),
      'packages/lib/source/index.ts': '',
      'packages/app/src/m.ts': '',
      ...(built === dist ? { 'packages/lib/compiled/index.js': '' } : {}),
    });
    expect(r(root, '@s/lib').file).toBe('packages/lib/source/index.ts');
  });

  it('follows tsconfig extends and ${configDir} for outDir/rootDir', () => {
    const root = project({
      'package.json': pkg({ workspaces: ['packages/*'] }),
      'tsconfig.base.json': pkg({ compilerOptions: { rootDir: '${configDir}/source', outDir: '${configDir}/out-js' } }),
      'packages/lib/package.json': pkg({ name: '@s/lib', exports: './out-js/index.js' }),
      'packages/lib/tsconfig.json': pkg({ extends: '../../tsconfig.base.json' }),
      'packages/lib/source/index.ts': '',
      'packages/app/src/m.ts': '',
      ...(built === dist ? { 'packages/lib/out-js/index.js': '' } : {}),
    });
    expect(getBuildLayout(join(root, 'packages/lib')).outDirs).toContain(join(root, 'packages/lib/out-js'));
    expect(r(root, '@s/lib').file).toBe('packages/lib/source/index.ts');
  });

  it('tsconfig `paths` that point into dist/ resolve to the source file', () => {
    const root = project({
      'package.json': pkg({ name: 'solo' }),
      'tsconfig.json': pkg({ compilerOptions: { baseUrl: '.', paths: { '@lib': ['./lib/dist/index.d.ts'] } } }),
      'lib/package.json': pkg({ name: 'lib' }),
      'lib/src/index.ts': '',
      'app/m.ts': '',
      ...(built === dist ? { 'lib/dist/index.d.ts': '' } : {}),
    });
    expect(resolveModuleSpecifier('@lib', 'app/m.ts', root).file).toBe('lib/src/index.ts');
  });
});

describe('workspace edge cases', () => {
  it('falls back to the built file when there is no source for it (package without sources)', () => {
    const root = project({
      'package.json': pkg({ workspaces: ['packages/*'] }),
      'packages/vendored/package.json': pkg({ name: '@s/vendored', main: './lib/index.js' }),
      'packages/vendored/lib/index.js': 'module.exports = {};',
      'packages/app/src/m.ts': '',
    });
    expect(resolveModuleSpecifier('@s/vendored', 'packages/app/src/m.ts', root).file).toBe('packages/vendored/lib/index.js');
  });

  it('an import of a workspace package that names no file is unresolved, not external', () => {
    const root = project(base({ '.': './dist/index.js' }));
    expect(resolveModuleSpecifier('@s/core/nope', 'packages/app/src/m.ts', root)).toEqual({ file: null, external: false });
    expect(resolveModuleSpecifier('left-pad', 'packages/app/src/m.ts', root)).toEqual({ file: null, external: true });
  });

  it('a package whose real sources live in lib/ is not remapped', () => {
    const root = project({
      'package.json': pkg({ workspaces: ['packages/*'] }),
      'packages/p/package.json': pkg({ name: '@s/p', main: './lib/index.js' }),
      'packages/p/lib/index.ts': '',
      'packages/app/src/m.ts': '',
    });
    expect(resolveModuleSpecifier('@s/p', 'packages/app/src/m.ts', root).file).toBe('packages/p/lib/index.ts');
  });

  it('SvelteKit $lib alias and generated ./$types', () => {
    const root = project({
      'package.json': pkg({ name: 'kit' }),
      'src/lib/a.ts': '', 'src/lib/c.svelte': '', 'src/routes/p.ts': '',
    });
    expect(resolveModuleSpecifier('$lib/a', 'src/routes/p.ts', root)).toEqual({ file: 'src/lib/a.ts', external: false });
    expect(resolveModuleSpecifier('$lib/c.svelte', 'src/routes/p.ts', root).file).toBe('src/lib/c.svelte');
    expect(resolveModuleSpecifier('./$types', 'src/routes/p.ts', root)).toEqual({ file: null, external: true });
  });
});

describe('build-layout helpers', () => {
  it('strips compiled extensions but keeps assets and components', () => {
    expect(['index.d.ts', 'x.js', 'x.d.mts', 'y.cjs', 'Foo.svelte', 'a.css', 'z.json'].map(stripBuiltExtension))
      .toEqual(['index', 'x', 'x', 'y', 'Foo.svelte', 'a.css', 'z.json']);
  });

  it('maps only paths inside an output directory', () => {
    const root = project({ 'p/package.json': '{}', 'p/src/a.ts': '' });
    const layout = getBuildLayout(join(root, 'p'));
    expect(builtToSourceCandidates(layout, join(root, 'p/dist/a.js'))).toContain(join(root, 'p/src/a'));
    expect(builtToSourceCandidates(layout, join(root, 'p/src/a.ts'))).toEqual([]);
  });
});
