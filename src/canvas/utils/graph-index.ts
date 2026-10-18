/**
 * GraphIndex — maps any graph reference (entity id, file path, or container
 * node id) to its chain of canvas nodes, deepest first:
 *
 *   entity id  → [entityId, file:…, module:…?, system:…]
 *   file path  → [file:…, module:…?, system:…]
 *
 * Used to aggregate relations, cycles, violations and diffs onto whichever
 * node level is currently visible.
 */
import type { Entity } from '../../contracts/entities.js';
import { ancestryForFile, containerKind, getModulePath, systemId, topDir } from './hierarchy';

export interface GraphIndex {
  entityById: Map<string, Entity>;
  /** Deepest-first node chain for a reference, or [] when unknown. */
  chainFor(ref: string): string[];
  /** Deepest node of the chain that is currently visible, or null. */
  resolveVisible(ref: string, visibleIds: ReadonlySet<string>): string | null;
}

function fileChain(filePath: string): string[] {
  const a = ancestryForFile(filePath);
  return a.moduleId ? [a.fileId, a.moduleId, a.systemId] : [a.fileId, a.systemId];
}

/** Chain for a directory: its module (first two segments) and system. */
function dirChain(dir: string): string[] {
  if (!dir) return [];
  const mod = getModulePath(`${dir}/x`);
  const sys = systemId(topDir(dir));
  return mod ? [`module:${mod}`, sys] : [sys];
}

export function buildGraphIndex(entities: Entity[]): GraphIndex {
  const entityById = new Map<string, Entity>();
  const knownFiles = new Set<string>();
  for (const e of entities) {
    entityById.set(e.id, e);
    if (e.file) knownFiles.add(e.file);
  }

  const cache = new Map<string, string[]>();

  function compute(ref: string): string[] {
    const entity = entityById.get(ref);
    if (entity) {
      if (entity.kind === 'module') return dirChain(entity.file);
      const chain = entity.file ? fileChain(entity.file) : [];
      // File entities are represented by their file node itself.
      return entity.kind === 'file' ? chain : [ref, ...chain];
    }
    const kind = containerKind(ref);
    if (kind === 'file') return fileChain(ref.slice('file:'.length));
    if (kind === 'module') {
      const path = ref.slice('module:'.length);
      return [ref, systemId(topDir(path))];
    }
    if (kind === 'system') return [ref];
    if (knownFiles.has(ref)) return fileChain(ref);
    return [];
  }

  return {
    entityById,
    chainFor(ref) {
      let chain = cache.get(ref);
      if (!chain) {
        chain = compute(ref);
        cache.set(ref, chain);
      }
      return chain;
    },
    resolveVisible(ref, visibleIds) {
      for (const id of this.chainFor(ref)) {
        if (visibleIds.has(id)) return id;
      }
      return null;
    },
  };
}
