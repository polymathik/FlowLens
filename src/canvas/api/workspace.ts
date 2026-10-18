/**
 * Workspace facts for package detection (`GET /workspace`, Map v2): the
 * workspace globs of the project root (pnpm-workspace.yaml, package.json
 * `workspaces`) and every manifest among the indexed files with its name.
 * Pure selection of packages happens in the canvas
 * (`selectPackages`, `src/analysis/hierarchy/packages.ts`).
 *
 * Reads a handful of small manifest files from the project root at request
 * time; nothing leaves the machine.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphStore } from '../../contracts/graph.js';
import type { PackageInfo, WorkspaceInfo } from '../../contracts/hierarchy.js';
import { MANIFEST_FILES, parseWorkspaceGlobs } from '../../analysis/hierarchy/packages.js';

const MAX_MANIFESTS = 400;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/** Manifest name: package.json `name`, `name = "…"` in TOML, the `module` line of go.mod. */
export function manifestName(manifest: string, text: string): string {
  try {
    if (manifest === 'package.json') {
      const name = (JSON.parse(text) as { name?: unknown }).name;
      return typeof name === 'string' ? name : '';
    }
  } catch {
    return '';
  }
  const toml = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  if (toml) return toml[1];
  const goMod = text.match(/^module\s+(\S+)/m);
  return goMod ? goMod[1] : '';
}

export function workspaceGlobsOf(pnpmYaml: string | null, rootPackageJson: string | null): string[] {
  const globs = pnpmYaml ? parseWorkspaceGlobs(pnpmYaml) : [];
  if (globs.length > 0 || !rootPackageJson) return globs;
  try {
    const ws = (JSON.parse(rootPackageJson) as { workspaces?: unknown }).workspaces;
    const list = Array.isArray(ws) ? ws : ws && typeof ws === 'object' ? (ws as { packages?: unknown }).packages : undefined;
    return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export async function computeWorkspace(graph: GraphStore, rootDir: string): Promise<WorkspaceInfo> {
  const files = (await graph.getNodesByKind('file')).map((e) => e.file);
  const manifestFiles = files.filter((f) => MANIFEST_FILES.includes(f.slice(f.lastIndexOf('/') + 1))).sort().slice(0, MAX_MANIFESTS);
  const manifests: PackageInfo[] = [];
  for (const f of manifestFiles) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const text = await readText(join(rootDir, f));
    manifests.push({ dir, name: text ? manifestName(base, text) : '', manifest: base });
  }
  const rootPkg = await readText(join(rootDir, 'package.json'));
  const rootName = manifests.find((m) => m.dir === '' && m.manifest === 'package.json')?.name;
  return {
    project_name: rootName || undefined,
    workspace_globs: workspaceGlobsOf(await readText(join(rootDir, 'pnpm-workspace.yaml')), rootPkg),
    manifests,
  };
}
