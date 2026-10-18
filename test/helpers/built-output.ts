/**
 * Simulate `pnpm -r build` on a copied fixture: for each `tsc` package write
 * the compiled `.js` + `.d.ts` next to where its tsconfig `outDir` points,
 * mirroring the source tree under `rootDir`. The content is a stub — only the
 * paths matter to the resolver.
 */
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export interface BuiltPackage { dir: string; rootDir: string; outDir: string }

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

export function buildOutput(root: string, packages: BuiltPackage[]): string[] {
  const written: string[] = [];
  for (const pkg of packages) {
    const src = join(root, pkg.dir, pkg.rootDir);
    for (const file of walk(src)) {
      if (!file.endsWith('.ts')) continue;
      const stem = join(root, pkg.dir, pkg.outDir, relative(src, file)).replace(/\.ts$/, '');
      mkdirSync(dirname(stem), { recursive: true });
      writeFileSync(`${stem}.js`, 'export {};\n');
      writeFileSync(`${stem}.d.ts`, 'export {};\n');
      written.push(`${stem}.js`, `${stem}.d.ts`);
    }
  }
  return written;
}

/** The compiled packages of `test/fixtures/built-monorepo`. */
export const BUILT_MONOREPO_PACKAGES: BuiltPackage[] = [
  { dir: 'packages/core', rootDir: 'src', outDir: 'dist' },
  { dir: 'packages/server', rootDir: 'src', outDir: 'dist' },
  { dir: 'packages/shared', rootDir: 'source', outDir: 'compiled' },
];
