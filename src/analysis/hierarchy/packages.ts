/**
 * Workspace package detection (pure).
 *
 * The server reads raw facts (workspace globs, every manifest with its
 * name — `GET /workspace`); `selectPackages` decides which manifests are
 * packages:
 *
 *  - With workspace globs (pnpm-workspace.yaml / package.json `workspaces`):
 *    a `package.json` directory is a package when a positive glob matches
 *    it and no negated glob does.
 *  - Without globs, and for non-package.json manifests (pyproject.toml,
 *    Cargo.toml, go.mod): the OUTERMOST non-root manifest directories,
 *    skipping vendored / fixture locations. Limitation: a nested package
 *    inside another package is not separated in that mode.
 *
 * The project root is never a package.
 */
import type { PackageInfo } from '../../contracts/hierarchy.js';

const SKIP_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', 'vendor', 'fixtures', '__fixtures__', 'testdata', 'examples', 'example']);

const clean = (dir: string): string => dir.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
export const isRootDir = (dir: string): boolean => clean(dir) === '' || clean(dir) === '.';

/** Glob → RegExp over directory paths: `*` one segment, `**` any depth, `?` one char. */
export function globToRegExp(glob: string): RegExp {
  const g = clean(glob);
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function matchesWorkspaceGlobs(dir: string, globs: string[]): boolean {
  const d = clean(dir);
  let matched = false;
  for (const raw of globs) {
    const negated = raw.startsWith('!');
    if (globToRegExp(negated ? raw.slice(1) : raw).test(d)) matched = !negated;
  }
  return matched;
}

/** `packages:` entries of a pnpm-workspace.yaml (list items only; no YAML dependency). */
export function parseWorkspaceGlobs(yamlText: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      const inline = line.match(/\[(.*)\]/);
      if (inline) {
        for (const part of inline[1].split(',')) globs.push(part.trim().replace(/^['"]|['"]$/g, ''));
        inPackages = false;
      }
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s*-\s*(.+?)\s*(?:#.*)?$/);
    if (item) globs.push(item[1].replace(/^['"]|['"]$/g, ''));
    else if (/^\S/.test(line)) inPackages = false;
  }
  return globs.filter(Boolean);
}

const manifestBase = (m: PackageInfo): string => (m.manifest ?? 'package.json').toLowerCase();

function outermost(candidates: PackageInfo[]): PackageInfo[] {
  const dirs = candidates.map((c) => clean(c.dir)).sort();
  return candidates.filter((c) => {
    const d = clean(c.dir);
    return !dirs.some((o) => o !== d && d.startsWith(`${o}/`));
  });
}

/** Packages among raw manifests (see module doc). Result sorted by directory. */
export function selectPackages(manifests: PackageInfo[], globs: string[] = []): PackageInfo[] {
  const nonRoot = manifests
    .map((m) => ({ ...m, dir: clean(m.dir) }))
    .filter((m) => !isRootDir(m.dir) && !m.dir.split('/').some((s) => SKIP_SEGMENTS.has(s)));
  const fromGlobs = globs.length > 0 ? nonRoot.filter((m) => manifestBase(m) === 'package.json' && matchesWorkspaceGlobs(m.dir, globs)) : [];
  const rest = nonRoot.filter((m) => (globs.length > 0 ? manifestBase(m) !== 'package.json' : true));
  const unnested = outermost(rest.filter((m) => !fromGlobs.some((p) => p.dir === m.dir || m.dir.startsWith(`${p.dir}/`))));
  const seen = new Set<string>();
  return [...fromGlobs, ...unnested]
    .filter((p) => (seen.has(p.dir) ? false : (seen.add(p.dir), true)))
    .map((p) => ({ dir: p.dir, name: p.name || p.dir.split('/').pop() || p.dir, manifest: p.manifest }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/** Manifest file names the server looks for when collecting `WorkspaceInfo.manifests`. */
export const MANIFEST_FILES: readonly string[] = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
