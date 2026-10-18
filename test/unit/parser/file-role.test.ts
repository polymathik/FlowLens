import { describe, it, expect } from 'vitest';
import { classifyFile } from '../../../src/parser/file-role.js';

const cases: Array<[string, string]> = [
  ['package.json', 'config'],
  ['packages/core/package.json', 'config'],
  ['tsconfig.base.json', 'config'],
  ['packages/server/tsconfig.build.json', 'config'],
  ['pnpm-workspace.yaml', 'config'],
  ['.env', 'config'],
  ['.env.local', 'config'],
  ['vite.config.ts', 'config'],
  ['apps/web/svelte.config.js', 'config'],
  ['.github/workflows/ci.yml', 'config'],
  ['Cargo.toml', 'config'],
  ['pyproject.toml', 'config'],
  ['pnpm-lock.yaml', 'generated'],
  ['package-lock.json', 'generated'],
  ['yarn.lock', 'generated'],
  ['Cargo.lock', 'generated'],
  ['go.sum', 'generated'],
  ['packages/core/dist/index.js', 'generated'],
  ['public/app.min.js', 'generated'],
  ['src/api.generated.ts', 'generated'],
  ['apps/web/build/200.html', 'generated'],
  ['src/deep/a/b/build/x.ts', 'source'],
  ['src/a.test.ts', 'test'],
  ['src/a.spec.tsx', 'test'],
  ['test/unit/x.ts', 'test'],
  ['pkg/__tests__/x.js', 'test'],
  ['internal/foo_test.go', 'test'],
  ['tests/test_thing.py', 'test'],
  ['test/fixtures/built-monorepo/package.json', 'test'],
  ['README.md', 'docs'],
  ['docs/guide.md', 'docs'],
  ['src/locales/en.json', 'data'],
  ['src/data/items.yaml', 'data'],
  ['src/index.ts', 'source'],
  ['apps/web/src/app.d.ts', 'source'],
  ['apps/web/src/lib/Zone.svelte', 'source'],
  ['src/styles/app.css', 'source'],
  ['src/main.py', 'source'],
];

describe('classifyFile', () => {
  it.each(cases)('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('normalises Windows separators and ./ prefixes', () => {
    expect(classifyFile('.\\packages\\core\\package.json')).toBe('config');
    expect(classifyFile('./src/index.ts')).toBe('source');
  });

  it('lockfiles win over config naming', () => {
    expect(classifyFile('apps/web/package-lock.json')).toBe('generated');
  });
});
