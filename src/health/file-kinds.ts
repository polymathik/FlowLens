/**
 * Which files count for size / god-file findings (Phase 12).
 *
 * Only hand-written code is judged by length. Lockfiles, minified or bundled
 * output, files under build-output folders, and data/markup languages
 * (JSON, YAML, CSS, HTML, …) are skipped: their length says nothing about
 * how hard the code is to change.
 */

/** Languages whose files are data or markup, not code. */
const DATA_LANGUAGES = new Set([
  'json', 'jsonc', 'yaml', 'toml', 'xml', 'css', 'scss', 'less', 'html', 'markdown', 'csv', 'text',
]);

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'gemfile.lock', 'composer.lock', 'go.sum',
  'pubspec.lock', 'podfile.lock', 'packages.lock.json', 'uv.lock', 'flake.lock',
]);

/** Folder names whose contents are build output or vendored code. */
const OUTPUT_DIRS = new Set([
  'dist', 'build', 'out', 'coverage', 'vendor', 'node_modules', '.next', '.nuxt', '.svelte-kit',
  'generated', '__generated__',
]);

const GENERATED_NAME = /(\.min\.(js|mjs|cjs|css)|\.bundle\.(js|mjs)|\.generated\.[a-z]+|\.g\.dart|_pb2\.py|\.pb\.go)$/i;

/** True when `file` (project-relative, `/`-separated) should get size findings. */
export function isSizeJudged(file: string, language: string | undefined): boolean {
  if (language && DATA_LANGUAGES.has(language.toLowerCase())) return false;
  const parts = file.split('/');
  const name = parts[parts.length - 1].toLowerCase();
  if (LOCKFILES.has(name) || GENERATED_NAME.test(name)) return false;
  return !parts.slice(0, -1).some((dir) => OUTPUT_DIRS.has(dir.toLowerCase()));
}
