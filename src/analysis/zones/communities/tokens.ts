/** Words from file and symbol names, for naming communities (camel / snake / kebab split, stop-words out). */

const STOP: ReadonlySet<string> = new Set([
  'index', 'main', 'util', 'utils', 'helper', 'helpers', 'common', 'base', 'type', 'types', 'test', 'tests', 'spec', 'specs',
  'mock', 'mocks', 'impl', 'default', 'get', 'set', 'new', 'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'src',
  'lib', 'file', 'files', 'module', 'modules', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'svelte', 'vue', 'py', 'java', 'init',
  'all', 'any', 'one', 'not', 'has', 'are', 'was', 'use', 'run', 'fn', 'obj', 'val', 'tmp', 'misc',
]);

/** `parseSessionFile` / `parse_session-file.ts` → `parse`, `session`, `file` (stop-words, short words and digits removed). */
export function splitIdentifier(text: string): string[] {
  const words = text
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase());
  return words.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w));
}

/**
 * Token weights of one file: file-name words 2, folder-name words 1.2, words of its top-level symbols
 * 0.5 per symbol (at most 1) — names say what a file is, symbols are noisier.
 */
export function fileTokens(path: string, symbolNames: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const parts = path.split('/');
  for (const dir of parts.slice(0, -1)) for (const t of splitIdentifier(dir)) out.set(t, 1.2);
  for (const t of splitIdentifier(parts[parts.length - 1])) out.set(t, 2);
  const sym = new Map<string, number>();
  for (const name of symbolNames.slice(0, 40)) for (const t of splitIdentifier(name)) sym.set(t, Math.min(1, (sym.get(t) ?? 0) + 0.5));
  for (const [t, w] of sym) out.set(t, Math.max(out.get(t) ?? 0, w));
  return out;
}
