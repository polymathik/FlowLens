/**
 * Which architecture layer a file (or entity) belongs to — the ONE glob
 * matcher shared by the rule engine (`architecture-validator.ts`) and the
 * `layers` zoning strategy (`zones/layers.ts`). Pure: only `minimatch`
 * (browser-safe, bundled into the canvas), no Node built-ins, so the canvas
 * and the Node services decide layer membership identically.
 *
 * Precedence is "first layer wins": patterns and exact `files` first, then
 * `entities` rules (a layer listed earlier beats a later one).
 */
import { Minimatch } from 'minimatch';
import type { ArchitectureLayer } from '../contracts/architecture.js';

/** Compiled glob cache: compiling a Minimatch per entity dominated layer resolution time. */
const patternCache = new Map<string, Minimatch>();

export function compiledPattern(pattern: string): Minimatch {
  let mm = patternCache.get(pattern);
  if (!mm) {
    mm = new Minimatch(pattern);
    patternCache.set(pattern, mm);
  }
  return mm;
}

/** True when `file` (repo-relative, forward slashes) is included by the layer's patterns or exact file list. */
export function matchesLayerFile(file: string, layer: ArchitectureLayer): boolean {
  if (layer.include.patterns) {
    for (const pattern of layer.include.patterns) {
      if (compiledPattern(pattern).match(file)) return true;
    }
  }
  return layer.include.files?.includes(file) ?? false;
}

/** True when the layer lists the entity by name or qualified name. */
export function matchesLayerEntity(entity: { name: string; qualified_name?: string }, layer: ArchitectureLayer): boolean {
  return layer.include.entities?.some((n) => entity.name === n || entity.qualified_name === n) ?? false;
}

/** Index of the first layer that includes `file` by pattern or file list, or -1. */
export function firstFileLayerIndex(file: string, layers: readonly ArchitectureLayer[]): number {
  return layers.findIndex((l) => matchesLayerFile(file, l));
}
