/** Hierarchy node id constructors / parsers (see `contracts/hierarchy.ts`). */
import { PROJECT_NODE_ID, type HierarchyKind } from '../../contracts/hierarchy.js';

export { PROJECT_NODE_ID };

export const packageId = (dir: string): string => `package:${dir}`;
export const folderId = (dir: string): string => `folder:${dir}`;
export const configId = (dir: string): string => `config:${dir || '.'}`;
export const fileNodeId = (path: string): string => `file:${path}`;

const PREFIXES: ReadonlyArray<[string, HierarchyKind]> = [
  ['package:', 'package'],
  ['folder:', 'folder'],
  ['config:', 'config'],
  ['file:', 'file'],
];

/** Kind a node id denotes by prefix; 'symbol' for anything else (entity ids). */
export function kindOfNodeId(id: string): HierarchyKind {
  if (id === PROJECT_NODE_ID) return 'project';
  for (const [prefix, kind] of PREFIXES) if (id.startsWith(prefix)) return kind;
  return 'symbol';
}

/** Path part of a package/folder/config/file id, or null. */
export function pathOfNodeId(id: string): string | null {
  for (const [prefix] of PREFIXES) if (id.startsWith(prefix)) return id.slice(prefix.length);
  return null;
}
