import { describe, it, expect } from 'vitest';
import { posix } from 'node:path';
import {
  buildHierarchy,
  chainOf,
  inferFileRole,
  parseWorkspaceGlobs,
  pathIdentifierOf,
  pathTo,
  resolvePathIdentifier,
  resolveRef,
  selectPackages,
} from '../../../src/analysis/hierarchy/index.js';
import { dirnameOf, moduleOfFile } from '../../../src/analysis/module-path.js';
import type { HierarchyEntity } from '../../../src/contracts/hierarchy.js';

const file = (path: string, extra: Partial<HierarchyEntity> = {}): HierarchyEntity => ({
  id: `f:${path}`, kind: 'file', name: path.split('/').pop()!, qualified_name: path, file: path, language: 'typescript', ...extra,
});
const sym = (path: string, scope: string, kind: HierarchyEntity['kind'] = 'function', line = 1): HierarchyEntity => ({
  id: `s:${path}/${scope}`, kind, name: scope.split('.').pop()!, qualified_name: `${path}/${scope}`, file: path, location: { line_start: line, line_end: line + 1 },
});

describe('module-path shared definition', () => {
  it('dirnameOf matches posix.dirname on normalised repo-relative paths', () => {
    for (const p of ['a.ts', 'src/a.ts', 'src/x/y/z.ts', 'src\\win\\f.ts', 'src/dir/']) {
      expect(dirnameOf(p)).toBe(posix.dirname(p.replace(/\\/g, '/')));
    }
    expect(moduleOfFile('index.ts')).toBe('.');
  });

  it('the folder holding a file has path === moduleOfFile(file) (Health == Map)', () => {
    const paths = ['src/a/b/c.ts', 'src/a/d.ts', 'src/e/f/g/h.ts', 'README.md', 'src/e/z.ts'];
    const h = buildHierarchy({ projectName: 'P', entities: paths.map((p) => file(p)) });
    for (const p of paths) {
      const fileNode = h.nodes.get(h.byFile.get(p)!)!;
      const parent = h.nodes.get(fileNode.parentId!)!;
      const expected = moduleOfFile(p) === '.' ? '' : moduleOfFile(p);
      expect(parent.path).toBe(expected);
    }
  });
});

describe('buildHierarchy', () => {
  it('collapses single-child folder chains but not folders with files or siblings', () => {
    const h = buildHierarchy({
      projectName: 'P',
      entities: [file('src/adapters/codex/codex.ts'), file('src/adapters/codex/parse.ts'), file('src/core/a.ts'), file('src/core/deep/only/b.ts')],
    });
    // src has two children (adapters/…, core) -> kept; adapters has one child (codex) and no files -> merged.
    expect(h.nodes.get('folder:src')!.childIds).toEqual(['folder:src/adapters/codex', 'folder:src/core']);
    expect(h.nodes.get('folder:src/adapters/codex')!.name).toBe('adapters/codex');
    expect(h.nodes.get('folder:src/adapters/codex')!.collapsedDirs).toEqual(['src/adapters', 'src/adapters/codex']);
    expect(h.byDir.get('src/adapters')).toBe('folder:src/adapters/codex');
    // core has files, so deep/only is NOT merged into core, but deep/only is a chain on its own.
    expect(h.nodes.get('folder:src/core')!.childIds).toEqual(['folder:src/core/deep/only', 'file:src/core/a.ts']);
    expect(h.nodes.get('folder:src/core/deep/only')!.name).toBe('deep/only');
  });

  it('builds packages for a monorepo and keeps the package name as the level', () => {
    const entities = [
      file('apps/web/package.json'), file('apps/web/src/main.ts'),
      file('packages/core/package.json'), file('packages/core/src/index.ts'),
      file('packages/server/package.json'), file('packages/server/src/adapters/codex/codex-adapter.ts'),
      file('package.json'), file('pnpm-lock.yaml'),
    ];
    const packages = selectPackages(
      [
        { dir: '', name: 'halcyon' }, { dir: 'apps/web', name: '@halcyon/web' }, { dir: 'packages/core', name: '@halcyon/core' },
        { dir: 'packages/server', name: '@halcyon/server' },
      ],
      parseWorkspaceGlobs('packages:\n  - "apps/*"\n  - packages/*\n'),
    );
    const h = buildHierarchy({ projectName: 'Halcyon', entities, packages });
    expect(h.nodes.get('project')!.childIds).toEqual(['folder:apps', 'folder:packages', 'config:.']);
    expect(h.nodes.get('folder:packages')!.childIds).toEqual(['package:packages/core', 'package:packages/server']);
    expect(h.nodes.get('package:packages/server')!.name).toBe('@halcyon/server');
    // apps has one child (a package): packages are never merged into a folder chain.
    expect(h.nodes.get('folder:apps')!.childIds).toEqual(['package:apps/web']);
    const codex = h.byFile.get('packages/server/src/adapters/codex/codex-adapter.ts')!;
    expect(pathTo(h, codex)).toEqual([
      'folder:packages', 'package:packages/server', 'folder:packages/server/src/adapters/codex', codex,
    ]);
    expect(chainOf(h, codex)[0]).toBe(codex);
    // Lockfile + package.json live in the Config group at the root.
    const cfg = h.nodes.get('config:.')!;
    expect(cfg.childIds).toEqual(['file:package.json', 'file:pnpm-lock.yaml']);
    expect(h.nodes.get('file:pnpm-lock.yaml')!.role).toBe('lockfile');
  });

  it('keeps symbol-less files (barrels, d.ts, css) as nodes', () => {
    const h = buildHierarchy({
      projectName: 'P',
      entities: [file('src/index.ts'), file('src/app.d.ts'), file('src/styles.css'), file('src/a.ts'), sym('src/a.ts', 'run')],
    });
    const names = h.nodes.get('folder:src')!.childIds.map((id) => h.nodes.get(id)!.name);
    expect(names).toEqual(['a.ts', 'app.d.ts', 'index.ts', 'styles.css']);
    expect(h.nodes.get('file:src/index.ts')!.childIds).toEqual([]);
    expect(h.nodes.get('file:src/app.d.ts')!.role).toBe('declaration');
  });

  it('derives files from symbols when no file entity exists', () => {
    const h = buildHierarchy({ projectName: 'P', entities: [sym('lib/x.ts', 'f')] });
    expect(h.byFile.has('lib/x.ts')).toBe(true);
  });

  it('nests members under their class and counts everything exactly', () => {
    const e = [
      file('src/a.ts', { metrics: { line_count: 40 } }),
      sym('src/a.ts', 'Cls', 'class', 1), sym('src/a.ts', 'Cls.run', 'method', 3), sym('src/a.ts', 'Cls.stop', 'method', 6),
      sym('src/a.ts', 'helper', 'function', 10),
      { ...sym('src/a.ts', 'helper.p', 'parameter', 10) },
    ];
    const h = buildHierarchy({ projectName: 'P', entities: e });
    const cls = h.nodes.get('s:src/a.ts/Cls')!;
    expect(cls.childIds).toEqual(['s:src/a.ts/Cls.run', 's:src/a.ts/Cls.stop']);
    expect(h.nodes.get('file:src/a.ts')!.childIds).toEqual(['s:src/a.ts/Cls', 's:src/a.ts/helper']);
    expect(h.nodes.get('file:src/a.ts')!.stats.symbols).toBe(4); // parameter skipped
    expect(h.nodes.get('project')!.stats).toMatchObject({ files: 1, symbols: 4, lines: 40 });
    expect(h.nodes.get('folder:src')!.topFiles).toEqual(['file:src/a.ts']);
  });

  it('is deterministic regardless of input order', () => {
    const e = [file('b/z.ts'), file('a/y.ts'), file('a/x.ts'), sym('a/x.ts', 'f'), sym('a/x.ts', 'g', 'function', 5)];
    const a = buildHierarchy({ projectName: 'P', entities: e });
    const b = buildHierarchy({ projectName: 'P', entities: [...e].reverse() });
    expect([...a.nodes.keys()]).toEqual([...b.nodes.keys()]);
    expect([...a.nodes.values()].map((n) => n.childIds)).toEqual([...b.nodes.values()].map((n) => n.childIds));
  });

  it('resolves refs: node id, entity id, file path, directory, qualified name, path identifiers', () => {
    const h = buildHierarchy({ projectName: 'P', entities: [file('src/a/b.ts'), sym('src/a/b.ts', 'Foo.bar')] });
    expect(resolveRef(h, 'file:src/a/b.ts')).toBe('file:src/a/b.ts');
    expect(resolveRef(h, 'f:src/a/b.ts')).toBe('file:src/a/b.ts');
    expect(resolveRef(h, 'src/a')).toBe('folder:src/a');
    expect(resolveRef(h, 'src/a/b.ts/Foo.bar')).toBe('s:src/a/b.ts/Foo.bar');
    expect(resolveRef(h, 'nope/x')).toBeNull();
    expect(resolvePathIdentifier(h, '.')).toBe('project');
    for (const id of h.nodes.keys()) expect(resolvePathIdentifier(h, pathIdentifierOf(h, id))).toBe(id);
  });
});

describe('workspace packages', () => {
  it('parses pnpm-workspace.yaml packages lists (block, inline, comments, negation)', () => {
    expect(parseWorkspaceGlobs('packages:\n  - "apps/*" # ui\n  - \'packages/**\'\n  - "!**/test/**"\nother: 1\n')).toEqual(['apps/*', 'packages/**', '!**/test/**']);
    expect(parseWorkspaceGlobs("packages: ['a/*', b]")).toEqual(['a/*', 'b']);
  });

  it('selects by globs; falls back to outermost non-root manifests without globs', () => {
    const m = [
      { dir: '', name: 'root' }, { dir: 'packages/a', name: 'a' }, { dir: 'packages/a/nested', name: 'n' },
      { dir: 'tools/x', name: 'x' }, { dir: 'test/fixtures/app', name: 'fx' },
    ];
    expect(selectPackages(m, ['packages/*']).map((p) => p.dir)).toEqual(['packages/a']);
    expect(selectPackages(m).map((p) => p.dir)).toEqual(['packages/a', 'tools/x']);
    expect(selectPackages(m, ['packages/**', '!packages/a/nested']).map((p) => p.dir)).toEqual(['packages/a']);
    expect(selectPackages([{ dir: 'svc', name: '', manifest: 'pyproject.toml' }], ['packages/*']).map((p) => p.name)).toEqual(['svc']);
  });
});

describe('inferFileRole', () => {
  it.each([
    ['pnpm-lock.yaml', 'lockfile'], ['package-lock.json', 'lockfile'], ['Cargo.lock', 'lockfile'],
    ['package.json', 'config'], ['tsconfig.base.json', 'config'], ['vite.config.ts', 'config'], ['.eslintrc.cjs', 'config'], ['.gitignore', 'config'],
    ['src/a.test.ts', 'test'], ['src/__tests__/x.ts', 'test'], ['types/app.d.ts', 'declaration'],
    ['src/theme.css', 'asset'], ['README.md', 'docs'], ['src/index.ts', 'source'], ['lib/x.svelte', 'source'],
  ])('%s -> %s', (path, role) => expect(inferFileRole(path)).toBe(role));
});
