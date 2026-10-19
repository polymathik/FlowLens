/**
 * Locate FlowLens' own package files at runtime.
 *
 * Everything is resolved from `import.meta.url` of the running module —
 * never from `process.cwd()` — so the canvas works from a global install,
 * `npx flowlens`, a tarball install inside another project, or a source
 * checkout run through `tsx`.
 */
import type { CanvasLocations } from '../../contracts/canvas-host.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFlowLensPackageName } from '../../contracts/package-identity.js';

/**
 * Walk up from `startFile` until a `package.json` whose name is the FlowLens package's
 * is found. Returns that directory, or null when not found (should not
 * happen for a correctly installed package).
 */
export function findPackageRoot(startFile: string = fileURLToPath(import.meta.url)): string | null {
  let dir = dirname(startFile);
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
        if (isFlowLensPackageName(pkg.name)) return dir;
      } catch {
        /* unreadable package.json — keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type { CanvasLocations } from '../../contracts/canvas-host.js';

export function locateCanvas(packageRoot: string | null = findPackageRoot()): CanvasLocations {
  if (!packageRoot) {
    throw new Error('Could not locate the FlowLens package root (package.json named "flowlens").');
  }
  const builtDir = join(packageRoot, 'dist', 'canvas', 'app');
  const sourceDir = join(packageRoot, 'src', 'canvas');
  return {
    packageRoot,
    builtDir,
    builtAvailable: existsSync(join(builtDir, 'index.html')),
    sourceDir,
    sourceAvailable: existsSync(join(sourceDir, 'index.html')),
  };
}
