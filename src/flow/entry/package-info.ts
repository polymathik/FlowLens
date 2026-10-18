/** Nearest `package.json` of a file (read through the source provider, cached per directory). */
import { dirOf, type DetectContext } from './types.js';

export interface PackageJsonInfo {
  dir: string;
  file: string;
  json: Record<string, unknown>;
  deps: Set<string>;
}

const cache = new WeakMap<DetectContext, Map<string, PackageJsonInfo | null>>();

function readAt(ctx: DetectContext, dir: string): PackageJsonInfo | null {
  const file = dir ? `${dir}/package.json` : 'package.json';
  const src = ctx.source(file);
  if (!src) return null;
  try {
    const json = JSON.parse(src.text) as Record<string, unknown>;
    const deps = new Set<string>();
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const group = json[k];
      if (group && typeof group === 'object') for (const name of Object.keys(group)) deps.add(name);
    }
    return { dir, file, json, deps };
  } catch {
    return null;
  }
}

export function nearestPackage(ctx: DetectContext, file: string): PackageJsonInfo | null {
  let byDir = cache.get(ctx);
  if (!byDir) cache.set(ctx, (byDir = new Map()));
  let dir = dirOf(file);
  for (;;) {
    if (!byDir.has(dir)) byDir.set(dir, readAt(ctx, dir));
    const hit = byDir.get(dir);
    if (hit) return hit;
    if (!dir) return null;
    dir = dirOf(dir);
  }
}

/** True when the nearest package depends on any of `names` (or a prefix ending in '/'). */
export function dependsOn(ctx: DetectContext, file: string, names: string[]): boolean | null {
  const pkg = nearestPackage(ctx, file);
  if (!pkg) return null;
  return [...pkg.deps].some((d) => names.some((n) => (n.endsWith('/') ? d.startsWith(n) : d === n)));
}

/** All package.json files of the graph, outermost first. */
export function allPackageJsons(ctx: DetectContext): PackageJsonInfo[] {
  const out: PackageJsonInfo[] = [];
  for (const f of ctx.graph.fileEntity.keys()) {
    if (f !== 'package.json' && !f.endsWith('/package.json')) continue;
    if (f.split('/').includes('node_modules')) continue;
    const info = nearestPackage(ctx, f);
    if (info && info.file === f) out.push(info);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
