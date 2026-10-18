/**
 * Resolves the base command installed hooks use to invoke FlowLens.
 *
 * Default: `node "<absolute path to this package's dist/cli/index.js>"`, which
 * works without a global install (the package is not on npm yet). The package
 * root is found from `import.meta.url`, so this resolves correctly whether the
 * code runs from `dist/` (normal) or from `src/` under a test runner.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findPackageRoot(fromUrl: string = import.meta.url): string | null {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: string }).name;
        if (name === 'flowlens') return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Absolute path of the CLI entry point (`dist/cli/index.js`), or null if unknown. */
export function resolveCliEntry(fromUrl: string = import.meta.url): string | null {
  const root = findPackageRoot(fromUrl);
  return root ? join(root, 'dist', 'cli', 'index.js') : null;
}

export function defaultHookBaseCommand(fromUrl: string = import.meta.url): string {
  const entry = resolveCliEntry(fromUrl);
  if (!entry) return 'flowlens';
  return `node ${shellQuote(entry.replaceAll('\\', '/'))}`;
}

/** Double-quote for POSIX sh / Git Bash (escapes `\\`, `"`, `$` and backtick). */
export function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
