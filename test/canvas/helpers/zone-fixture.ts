/** A Halcyon-shaped monorepo (packages, nested folders, config) for the zone tests. */
import { buildHierarchy } from '../../../src/analysis/hierarchy/index.js';
import type { HierarchyEntity } from '../../../src/contracts/hierarchy.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';

export const fileEntity = (path: string): HierarchyEntity => ({ id: `f:${path}`, kind: 'file', name: path.split('/').pop()!, qualified_name: path, file: path });
export const fnEntity = (path: string, name: string, kind: HierarchyEntity['kind'] = 'function'): HierarchyEntity => ({
  id: `s:${path}/${name}`, kind, name, qualified_name: `${path}/${name}`, file: path, location: { line_start: 1, line_end: 2 },
});

let n = 0;
export const rel = (from: string, to: string, type: RelationType = 'import'): Relation => ({
  id: `r${++n}`, from, to, type, location: { file: 'x', line: 1, column: 0 }, weight: 1, confidence: 1,
});
export const F = (path: string) => `f:${path}`;
export const S = (path: string, name: string) => `s:${path}/${name}`;

export const FILES = [
  'apps/web/src/app.ts', 'apps/web/src/ui/button.ts', 'apps/web/src/ui/card.ts',
  'packages/core/src/adapter.ts', 'packages/core/src/ids.ts', 'packages/core/src/index.ts',
  'packages/server/src/a.ts', 'packages/server/src/b.ts', 'packages/server/src/cli.ts',
  'packages/server/src/adapters/codex/codex.ts', 'packages/server/src/adapters/codex/parse.ts',
  'packages/server/src/adapters/claude/claude.ts', 'packages/server/src/adapters/cursor.ts',
  'packages/server/test/a.test.ts', 'docs/tool.ts', 'package.json', 'pnpm-lock.yaml',
];
export const PACKAGES = [
  { dir: 'packages/core', name: '@h/core' }, { dir: 'packages/server', name: '@h/server' }, { dir: 'apps/web', name: '@h/web' },
];

export function zoneFixture(extraFiles: string[] = []) {
  const entities: HierarchyEntity[] = [];
  for (const f of [...FILES, ...extraFiles]) {
    entities.push(fileEntity(f));
    if (/\.ts$/.test(f)) entities.push(fnEntity(f, 'main'), fnEntity(f, 'helper'));
  }
  const hierarchy = buildHierarchy({ projectName: 'Halcyon', entities, packages: PACKAGES });
  const relations: Relation[] = [
    rel(F('apps/web/src/app.ts'), F('apps/web/src/ui/button.ts')),
    rel(S('apps/web/src/app.ts', 'main'), S('apps/web/src/ui/card.ts', 'main'), 'call'),
    rel(F('apps/web/src/app.ts'), F('packages/core/src/index.ts')),
    rel(F('packages/server/src/a.ts'), F('packages/core/src/adapter.ts')),
    rel(F('packages/server/src/b.ts'), F('packages/core/src/adapter.ts')),
    rel(S('packages/server/src/adapters/codex/codex.ts', 'main'), S('packages/core/src/adapter.ts', 'helper'), 'call'),
    rel(F('packages/server/src/adapters/claude/claude.ts'), F('packages/core/src/ids.ts')),
    rel(F('packages/server/src/adapters/codex/codex.ts'), F('packages/server/src/adapters/codex/parse.ts')),
    rel(F('packages/server/src/adapters/codex/codex.ts'), F('packages/server/src/adapters/cursor.ts')),
    rel(F('packages/server/src/cli.ts'), F('packages/server/src/adapters/codex/codex.ts')),
    rel(S('packages/server/src/cli.ts', 'main'), S('packages/server/src/adapters/claude/claude.ts', 'main'), 'call'),
    rel(F('packages/server/test/a.test.ts'), F('packages/server/src/a.ts')),
    rel(S('packages/server/src/a.ts', 'main'), S('packages/server/src/a.ts', 'helper'), 'call'),
    rel(F('docs/tool.ts'), F('packages/core/src/ids.ts')),
    rel(S('packages/core/src/adapter.ts', 'main'), S('packages/core/src/adapter.ts', 'main'), 'contain'),
  ];
  return { entities, hierarchy, relations };
}
