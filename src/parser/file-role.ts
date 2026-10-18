/**
 * File role classification (Map M0, D7) — a pure function of the
 * project-relative path. It never reads the file and never removes anything
 * from the graph; it only labels files so views can group or mute them.
 *
 * Precedence: generated > test > config > docs > data > source.
 */
import type { FileRole } from '../contracts/entities.js';

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'composer.lock', 'gemfile.lock', 'go.sum', 'uv.lock',
  'pdm.lock', 'packages.lock.json', 'flake.lock', 'mix.lock', 'pubspec.lock', 'podfile.lock',
]);

const GENERATED_DIRS = new Set([
  'node_modules', 'dist', 'coverage', '.svelte-kit', '.next', '.nuxt', '.output',
  '__generated__', '.turbo', '.cache', '__pycache__',
]);
/** Ambiguous names (a source folder may be called `build`): generated only near the package root. */
const SHALLOW_GENERATED_DIRS = new Set(['build', 'out', 'target', 'generated']);
const GENERATED_FILE = /(\.min\.(js|css|mjs)|\.generated\.\w+|\.gen\.\w+|\.g\.dart|\.pb\.go|_pb2(_grpc)?\.pyi?|\.tsbuildinfo|\.map|\.snap)$/;

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', '__mocks__', 'e2e', 'fixtures', '__fixtures__', 'testdata']);
const TEST_FILE = /(\.(test|spec|e2e|stories)\.\w+|_test\.(go|py|rb|exs?)|_spec\.rb|^test_.*\.py|^conftest\.py|Tests?\.(java|kt|cs|swift|scala)|Spec\.(scala|kt))$/;

const CONFIG_NAMES = new Set([
  'package.json', 'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json', 'deno.json', 'deno.jsonc',
  'composer.json', 'renovate.json', 'vercel.json', 'netlify.toml', 'firebase.json', 'angular.json', 'project.json',
  'manifest.json', 'cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'dockerfile', 'makefile',
  '.babelrc', '.eslintrc', '.prettierrc', '.editorconfig', '.nvmrc', '.npmrc', '.gitignore', '.flowlensignore',
  'setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini', 'mypy.ini', 'conftest.cfg', 'gemfile', 'rakefile',
]);
const CONFIG_PATTERNS: RegExp[] = [
  /^(ts|js)config(\..+)?\.json$/,
  /^\.?(eslint|prettier|stylelint|babel|commitlint|lintstaged|releaserc|mocharc)(\..+)?$/,
  /^[\w.-]+\.config\.(c|m)?(js|ts|json|yaml|yml|cjs|mjs)$/,
  /^\.env(\..+)?$/,
  /^docker-compose(\..+)?\.ya?ml$/,
  /^\.[\w.-]*rc(\.(json|ya?ml|js|cjs|mjs))?$/,
  /\.(toml|ini|cfg|properties)$/,
  /^build\.gradle(\.kts)?$|^settings\.gradle(\.kts)?$/,
];
const CONFIG_DIRS = new Set(['.github', '.vscode', '.idea', '.husky', '.circleci', '.gitlab', '.devcontainer', '.changeset', '.claude']);

const DOC_DIRS = new Set(['docs', 'doc', '_docs', 'documentation']);
const DOC_FILE = /^(readme|changelog|contributing|license|notice|security|authors|code_of_conduct|history)(\..+)?$|\.(md|mdx|rst|adoc|txt)$/i;

const DATA_EXT = /\.(json|jsonc|ya?ml)$/;

export function classifyFile(relPath: string): FileRole {
  const path = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  const lower = base.toLowerCase();
  const dirs = parts.slice(0, -1);

  if (LOCKFILES.has(lower) || /\.lock$/.test(lower) || GENERATED_FILE.test(lower)) return 'generated';
  if (dirs.some((d) => GENERATED_DIRS.has(d)) || dirs.slice(0, 3).some((d) => SHALLOW_GENERATED_DIRS.has(d))) {
    return 'generated';
  }
  if (TEST_FILE.test(base) || dirs.some((d) => TEST_DIRS.has(d))) return 'test';
  if (CONFIG_NAMES.has(lower) || CONFIG_PATTERNS.some((re) => re.test(lower))) return 'config';
  if (dirs.some((d) => CONFIG_DIRS.has(d))) return 'config';
  if (dirs.some((d) => DOC_DIRS.has(d)) || DOC_FILE.test(base)) return 'docs';
  if (DATA_EXT.test(lower)) {
    // YAML/JSON at the project root or in a dot-directory is tool configuration.
    if (dirs.length === 0 || dirs[0].startsWith('.')) return 'config';
    return /\.ya?ml$/.test(lower) && dirs.length <= 1 ? 'config' : 'data';
  }
  return 'source';
}
