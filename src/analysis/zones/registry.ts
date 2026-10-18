/**
 * Zoning strategy registry. `packages` and `folders` are built in; later
 * modes (communities, layers) call `registerZoning(mode, fn)` from their
 * own modules without touching this directory. A mode with no strategy
 * falls back to `folders` (reported through `ZoneSet.fallbackFrom`).
 */
import { PROJECT_NODE_ID } from '../../contracts/hierarchy.js';
import type { ZoneSet, ZoningInput, ZoningMode, ZoningStrategy } from '../../contracts/zones.js';
import { finalizeZones } from './finalize.js';
import { foldersDrafts } from './folders.js';
import { packagesDrafts } from './packages.js';
import { scopeNodeOf } from './scope.js';

type Drafts = typeof packagesDrafts;

/** Build a strategy from a draft producer: the shared pipeline does overrides, stats, colours, order. */
export function draftStrategy(mode: ZoningMode, produce: Drafts): ZoningStrategy {
  return (input) =>
    finalizeZones({
      mode,
      hierarchy: input.hierarchy,
      scopeNodeId: scopeNodeOf(input.hierarchy, input.scopeId)?.id ?? PROJECT_NODE_ID,
      drafts: produce({ ...input, mode }),
      overrides: input.overrides,
      options: input.options,
    });
}

const strategies = new Map<ZoningMode, ZoningStrategy>([
  ['packages', draftStrategy('packages', packagesDrafts)],
  ['folders', draftStrategy('folders', foldersDrafts)],
]);

/** Register (or replace) the strategy for `mode`. */
export function registerZoning(mode: ZoningMode, strategy: ZoningStrategy): void {
  strategies.set(mode, strategy);
}

export const hasZoning = (mode: ZoningMode): boolean => strategies.has(mode);

export function computeZones(input: ZoningInput): ZoneSet {
  const strategy = strategies.get(input.mode);
  if (strategy) return strategy(input);
  const fallback = strategies.get('folders')!;
  return { ...fallback({ ...input, mode: 'folders' }), fallbackFrom: input.mode };
}
