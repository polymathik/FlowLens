/**
 * Zones contract (Map v2, M2+). A zone is a labelled, coloured container of
 * files — the code equivalent of a Halcyon zone — computed automatically
 * from the code (packages, folders, later communities and architecture
 * layers) and adjustable by the user through `.flowlens/zones.json`.
 *
 * Producers (src/analysis/zones/**) are pure: they take the hierarchy (and,
 * for graph-based modes, a weighted file graph) and return a `ZoneSet`.
 * Consumers (the canvas) render zones as React Flow compound nodes and
 * never decide membership themselves. User overrides always win.
 */
import type { HierarchyStats } from './hierarchy.js';

export type ZoningMode = 'packages' | 'folders' | 'communities' | 'layers';
export const ZONING_MODES: readonly ZoningMode[] = ['packages', 'folders', 'communities', 'layers'];

/** Six soft hues tuned for light and dark; the canvas maps a slot to CSS variables. */
export const ZONE_COLOR_SLOTS = 6;

export type ZoneSource = 'package' | 'folder' | 'community' | 'layer' | 'config' | 'custom';

export interface Zone {
  /** `zone:<mode>:<key>` — stable across re-index while the key is stable. */
  id: string;
  /** Stable key: package name, folder path, community slug, or layer name. */
  key: string;
  /** Display name (an override name wins over the generated one). */
  label: string;
  source: ZoneSource;
  /** Enclosing zone (nested zones), or null for a top-level zone. */
  parentId: string | null;
  /** Hierarchy file-node ids directly in this zone, not in a child zone. */
  fileIds: string[];
  /** Child zone ids, in display order. */
  childIds: string[];
  /** 0..ZONE_COLOR_SLOTS-1; deterministic from `key` unless overridden. */
  colorIndex: number;
  /** Collapsed zones render as a label bar with a bundled summary. */
  collapsed: boolean;
  /** Recursive stats over every file in the zone and its children. */
  stats: HierarchyStats;
  /** True when a user override changed name, colour, collapse or membership. */
  customized?: boolean;
}

export interface ZoneSet {
  mode: ZoningMode;
  zones: Zone[];
  /** Top-level zone ids in display order. */
  rootIds: string[];
  /** File node id → the innermost zone containing it (files in no zone are absent). */
  zoneOfFile: Record<string, string>;
}

/** Input to every zoning producer. */
export interface ZoningInput {
  mode: ZoningMode;
  /** Hierarchy file/folder/package nodes (see contracts/hierarchy.ts). */
  hierarchy: import('./hierarchy.js').Hierarchy;
  /** Restrict zoning to the files below this hierarchy node (default: the project). */
  scopeId?: string;
  overrides?: ZoneOverrides;
}

/** `.flowlens/zones.json` — user adjustments, keyed by stable zone key. */
export interface ZoneOverrides {
  version: 1;
  /** Per zone key (see `Zone.key`), per mode, e.g. `folders:packages/server/src`. */
  zones: Record<string, ZoneOverride>;
  /** Pin a file path to a zone key (`<mode>:<key>`); beats automatic membership. */
  pins: Record<string, string>;
}

export interface ZoneOverride {
  name?: string;
  /** 0..ZONE_COLOR_SLOTS-1 */
  color?: number;
  collapsed?: boolean;
  /** Merge this zone into another zone key. */
  mergeInto?: string;
}

export const EMPTY_ZONE_OVERRIDES: ZoneOverrides = { version: 1, zones: {}, pins: {} };

/** Overrides store (file-backed, atomic writes, served by the explorer API). */
export interface ZoneOverridesStore {
  read(flowlensDir: string): Promise<ZoneOverrides>;
  write(flowlensDir: string, overrides: ZoneOverrides): Promise<void>;
}
