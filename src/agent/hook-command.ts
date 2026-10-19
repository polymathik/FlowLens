/**
 * Resolves the base command installed hooks use to invoke FlowLens.
 *
 * Default: `node "<absolute path to this package's dist/cli/index.js>"`, which
 * works without a global install. The package
 * root is found from `import.meta.url`, so this resolves correctly whether the
 * code runs from `dist/` (normal) or from `src/` under a test runner.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_BIN_NAME, LEGACY_PACKAGE_NAME, PACKAGE_NAME, isFlowLensPackageName } from '../contracts/package-identity.js';

export function findPackageRoot(fromUrl: string = import.meta.url): string | null {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: string }).name;
        if (isFlowLensPackageName(name)) return dir;
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

/** Portable base command for shared settings: the project's own FlowLens install. */
export const PORTABLE_HOOK_COMMAND = 'npx --no-install flowlens';

/**
 * `npx --no-install flowlens` when FlowLens is a dependency of the project
 * at `projectDir` (declared in package.json and installed in
 * node_modules/.bin), so a committed `.claude/settings.json` works on every
 * teammate's machine; null otherwise.
 */
export function portableHookBaseCommand(projectDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const declared = Boolean(deps[PACKAGE_NAME] ?? deps[LEGACY_PACKAGE_NAME]);
    const installed = [CLI_BIN_NAME, `${CLI_BIN_NAME}.cmd`].some((b) => existsSync(join(projectDir, 'node_modules', '.bin', b)));
    return declared && installed ? PORTABLE_HOOK_COMMAND : null;
  } catch {
    return null;
  }
}

/** True when a hook command embeds an absolute filesystem path (machine-specific). */
export function embedsAbsolutePath(command: string): boolean {
  return /(^|[\s"'])(\/[^\s"']|[A-Za-z]:[\\/])/.test(command);
}
