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
  /**
   * Hierarchy node this zone mirrors (package / folder / config-group id), when it has one.
   * Lets the canvas navigate into the zone's container; absent for custom and graph-based zones.
   */
  nodeId?: string;
  /** Producer's tooltip text (a layer's access rules, a community's cohesion…); shown on the zone chip. */
  detail?: string;
}

export interface ZoneSet {
  mode: ZoningMode;
  zones: Zone[];
  /** Top-level zone ids in display order. */
  rootIds: string[];
  /** File node id → the innermost zone containing it (files in no zone are absent). */
  zoneOfFile: Record<string, string>;
  /**
   * Set when the requested mode has no registered strategy (yet) and the
   * `folders` strategy ran instead: `mode` is then `'folders'` and this is the mode asked for.
   */
  fallbackFrom?: ZoningMode;
}

/** Tunables of the built-in strategies (all optional). */
export interface ZoningOptions {
  /** Nesting levels below the scope (default `ZONE_DEFAULT_MAX_DEPTH`); deeper folders merge into their ancestor zone. */
  maxDepth?: number;
  /** Zones with more files than this start collapsed (default `ZONE_DEFAULT_COLLAPSE_ABOVE`). */
  collapseAbove?: number;
}

export const ZONE_DEFAULT_MAX_DEPTH = 3;
export const ZONE_DEFAULT_COLLAPSE_ABOVE = 60;
/** Key of the muted zone that holds config files and lockfiles (`zone:<mode>:<config>`). */
export const ZONE_CONFIG_KEY = '<config>';
/** Key of the muted zone that holds files matching no architecture layer (`zone:layers:<unassigned>`). */
export const ZONE_UNASSIGNED_KEY = '<unassigned>';

/** Input to every zoning producer. */
export interface ZoningInput {
  mode: ZoningMode;
  /** Hierarchy file/folder/package nodes (see contracts/hierarchy.ts). */
  hierarchy: import('./hierarchy.js').Hierarchy;
  /** Restrict zoning to the files below this hierarchy node (default: the project). */
  scopeId?: string;
  overrides?: ZoneOverrides;
  options?: ZoningOptions;
  /** Weighted file-to-file dependency graph (for `communities`); built by `buildFileGraph`. */
  fileGraph?: ZoningFileGraph;
  /** Architecture layers (for `layers`), from `.flowlens/architecture.json`. */
  layers?: import('./architecture.js').ArchitectureLayer[];
  /** The previous community assignment (file path → community key) for stable re-zoning. */
  previousAssignment?: Record<string, string>;
}

/** Undirected weighted edge between two hierarchy file-node ids (weights already combined). */
export interface ZoningFileEdge {
  a: string;
  b: string;
  weight: number;
}

export interface ZoningFileGraph {
  edges: ZoningFileEdge[];
}

/**
 * A zoning producer. Built-ins (`packages`, `folders`) are registered by
 * `src/analysis/zones`; later modes add theirs with `registerZoning(mode, fn)`.
 * Strategies are pure and must return the same `ZoneSet` for the same input.
 */
export type ZoningStrategy = (input: ZoningInput) => ZoneSet;

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

/**
 * Override addressing: zone keys in `zones`, `pins` values and `mergeInto`
 * are `<mode>:<key>` (`packages:@halcyon/core`, `folders:packages/server/src`).
 * Entries for another mode than the one being computed are ignored.
 */
export const zoneOverrideKey = (mode: ZoningMode, key: string): string => `${mode}:${key}`;

/** Overrides store (file-backed, atomic writes, served by the explorer API). */
export interface ZoneOverridesStore {
  read(flowlensDir: string): Promise<ZoneOverrides>;
  write(flowlensDir: string, overrides: ZoneOverrides): Promise<void>;
}

/* ---------------- REST (per project, same auth as the other canvas routes) ---------------- */

/** File inside a project's `.flowlens/` directory. */
export const ZONES_FILE = 'zones.json';
/** `GET|PUT /api/projects/:id/canvas/zones` — body and response are `ZoneOverrides`. */
export const ZONES_ROUTE = '/api/projects/:id/canvas/zones';
/** PUT bodies above this size are refused with 413. */
export const ZONE_OVERRIDES_MAX_BYTES = 256 * 1024;

export interface ZoneOverridesIssue {
  /** Dotted path into the body, e.g. `zones.folders:src.color`. */
  path: string;
  message: string;
}

/** 400 body of an invalid PUT (same `issues` shape the canvas http helper already understands). */
export interface ZoneOverridesError {
  ok: false;
  error: { code: 'bad_request'; message: string };
  issues: ZoneOverridesIssue[];
}
