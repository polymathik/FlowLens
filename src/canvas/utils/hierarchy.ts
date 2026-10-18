/**
 * Path → canvas hierarchy helpers shared by the node/edge transformers,
 * drill navigation, search and deep links (single source of truth for how
 * a file path maps onto system → module → file node ids).
 *
 *   'src/parser/extractors/foo.ts' → system:src, module:src/parser, file:src/parser/extractors/foo.ts
 *   'src/index.ts'                 → system:src, (no module),       file:src/index.ts
 *   'package.json'                 → system:package.json, (no module), file:package.json
 */

/** Top-level directory of a path, or the bare file name for root files. */
export function topDir(filePath: string): string {
  return filePath.split('/')[0] || 'root';
}

/** Last path segment. */
export function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Module path (first two directory segments) for a file, or null when the
 * file sits directly in its top-level directory (or at the root).
 */
export function getModulePath(filePath: string): string | null {
  const parts = filePath.split('/');
  if (parts.length < 3) return null;
  return parts.slice(0, 2).join('/');
}

export const systemId = (dir: string): string => `system:${dir}`;
export const moduleId = (modulePath: string): string => `module:${modulePath}`;
export const fileId = (filePath: string): string => `file:${filePath}`;

/** Container ids for a file: system, module (optional) and the file itself. */
export interface FileAncestry {
  systemId: string;
  moduleId?: string;
  fileId: string;
}

export function ancestryForFile(filePath: string): FileAncestry {
  const mod = getModulePath(filePath);
  return {
    systemId: systemId(topDir(filePath)),
    moduleId: mod ? moduleId(mod) : undefined,
    fileId: fileId(filePath),
  };
}

/** Drill path that makes the *file node* for `filePath` visible. */
export function drillPathToShowFile(filePath: string): string[] {
  const a = ancestryForFile(filePath);
  return a.moduleId ? [a.systemId, a.moduleId] : [a.systemId];
}

/** Drill path that makes the *symbols inside* `filePath` visible. */
export function drillPathIntoFile(filePath: string): string[] {
  return [...drillPathToShowFile(filePath), fileId(filePath)];
}

/** Drill path that makes the module node itself visible (its system). */
export function drillPathToShowModule(modulePath: string): string[] {
  return [systemId(topDir(modulePath))];
}

/** Kind of container a node id denotes, from its prefix. */
export function containerKind(id: string): 'system' | 'module' | 'file' | null {
  if (id.startsWith('system:')) return 'system';
  if (id.startsWith('module:')) return 'module';
  if (id.startsWith('file:')) return 'file';
  return null;
}

/** Human label for a container id (prefix stripped). */
export function containerLabel(id: string): string {
  return id.replace(/^(system|module|file):/, '');
}
