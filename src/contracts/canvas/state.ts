/**
 * Canvas state contract — the shape of the Zustand store backing the canvas.
 * Keeps volatile UI state (zoom, selection, filters, drill-down) out of
 * React Flow's internal state so rapid interactions don't trigger global
 * re-renders.
 *
 * Phase 10 (Lane C3) aligned this contract with the real store
 * (`src/canvas/store/canvas-store.ts` is typed as `create<CanvasState>`):
 * drill navigation is path-based (`setDrillPath` / `navigateTo`) instead of
 * push-only, the unused `expandedNodes` set was dropped, and focus/search
 * state was added. Wave 2 will key a slice of this state per project tab.
 */
import type { RelationType } from '../relations.js';
import type { ArchitectureViolation } from '../analysis/architecture.js';
import type { ZoneOverrides, ZoningMode } from '../zones.js';

/** Four discrete zoom tiers mapped from React Flow viewport zoom (names are historical; they are detail tiers). */
export type ZoomLevel = 'system' | 'module' | 'file' | 'entity';

/** Identifiers for the six analytical overlays. */
export type OverlayType =
  | 'complexity-heatmap'
  | 'churn-heatmap'
  | 'hotspot'
  | 'cycles'
  | 'architecture-violations'
  | 'interface-diff';

/**
 * A one-shot request to centre the viewport on a node once it is visible
 * and laid out. `seq` increments on every request so repeated jumps to the
 * same node still fire.
 */
export interface FocusRequest {
  nodeId: string;
  seq: number;
}

/** `scheme://file/<abs>:<line>` link scheme of the "Open in editor" action. */
export type EditorScheme = 'vscode' | 'cursor' | 'vscode-insiders' | 'windsurf';
export const EDITOR_SCHEMES: readonly EditorScheme[] = ['vscode', 'cursor', 'vscode-insiders', 'windsurf'];
export const DEFAULT_EDITOR_SCHEME: EditorScheme = 'vscode';

/** Target handed to `navigateTo` by search, deep links, portals and the Health screen. */
export interface NavigationTarget {
  /**
   * Hierarchy path of containers that makes the view show `nodeId` (or the
   * container itself when `nodeId` is null), root excluded, e.g.
   * ["folder:packages", "package:packages/server", "folder:packages/server/src"].
   */
  drillPath: string[];
  /** Node to select and centre; null = just open the container. */
  nodeId: string | null;
  /** Optional overlay to switch on as part of the jump. */
  overlay?: OverlayType | null;
  /** Optional ids to highlight alongside the selection (Health "Show on map"). */
  highlight?: string[];
}

/**
 * The Zustand store shape. All fields that represent store state go above
 * the action methods; all action methods live at the bottom.
 */
export interface CanvasState {
  // Zoom & navigation
  currentZoomLevel: ZoomLevel;

  // Selection
  selectedNodeId: string | null;
  /** Selected edge (the detail panel lists its relations with reference lines). */
  selectedEdgeId: string | null;
  /** Pending viewport focus (consumed by the canvas once layout settles). */
  focusRequest: FocusRequest | null;

  // Filters
  visibleRelationTypes: Set<RelationType | string>;
  activeOverlay: OverlayType | null;
  searchQuery: string;
  /** Whether the search palette is open. */
  searchOpen: boolean;
  /** SHA used by the interface-diff overlay. */
  diffSha: string;
  /**
   * Violations computed from an unsaved architecture draft (live preview in
   * the rule editor). When non-null the violations overlay shows these
   * instead of the saved rules' violations.
   */
  previewViolations: ArchitectureViolation[] | null;
  /**
   * Node ids to emphasise (e.g. every file of a Health finding after
   * "Show on map"). Empty = none. Cleared by `selectNode(null)`.
   */
  highlightedIds: string[];

  // View options
  /** Lockfiles are hidden by default (they are never code). */
  showLockfiles: boolean;
  /** URL scheme of the "Open in editor" links. */
  editorScheme: EditorScheme;

  // Zones (Map v2 M2)
  /** How files are grouped into zones. `communities` / `layers` are roadmap items (disabled in the UI). */
  groupBy: ZoningMode;
  /**
   * Explicit expand (true) / collapse (false) choices, keyed
   * `<containerId>|<itemId>`; absent keys follow the defaults. Remembered per
   * project in sessionStorage (best effort).
   */
  zoneExpansion: Record<string, boolean>;
  /** User adjustments from `GET /canvas/zones` (rename, colour, collapse, pins). */
  zoneOverrides: ZoneOverrides;
  /**
   * Last community assignment (file path → community key), kept so communities survive edits and
   * reloads (persisted in `.flowlens/zone-state.json`). `null` until loaded.
   */
  communityAssignment: Record<string, string> | null;
  /** Node under the pointer (its edges stay strong, the rest dim). */
  hoveredNodeId: string | null;
  /** One-line message about zones (override save failed, zones collapsed for performance…). */
  zoneNotice: string | null;

  // Drill-down
  /**
   * The real path from the project root to the open container, as hierarchy
   * node ids (any depth; the view shows ONLY that container's children), e.g.
   * ["folder:packages", "package:packages/server", "folder:packages/server/src"].
   */
  drillPath: string[];

  // Actions
  setZoomLevel: (level: ZoomLevel) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setShowLockfiles: (show: boolean) => void;
  setEditorScheme: (scheme: EditorScheme) => void;
  toggleRelationType: (type: RelationType | string) => void;
  setOverlay: (overlay: OverlayType | null) => void;
  setSearch: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  setDiffSha: (sha: string) => void;
  setPreviewViolations: (violations: ArchitectureViolation[] | null) => void;
  /** Replace the drill path (used for drill-down and sibling navigation). */
  setDrillPath: (path: string[]) => void;
  /** Pop one level. */
  drillUp: () => void;
  /** Truncate the path to `index + 1` entries; -1 returns to the root. */
  drillToLevel: (index: number) => void;
  /** Drill, select and request focus in one update. */
  navigateTo: (target: NavigationTarget) => void;
  clearFocusRequest: () => void;
  setHighlighted: (ids: string[]) => void;
  setGroupBy: (mode: ZoningMode) => void;
  /** Set one or several expand / collapse choices at once. */
  setZoneExpansion: (entries: Record<string, boolean>) => void;
  /** Forget every explicit choice for the container (back to the defaults). */
  resetZoneExpansion: (containerId: string) => void;
  setZoneOverrides: (overrides: ZoneOverrides) => void;
  setCommunityAssignment: (assignment: Record<string, string>) => void;
  setHoveredNode: (id: string | null) => void;
  setZoneNotice: (notice: string | null) => void;
}

/**
 * Maps a continuous React Flow viewport zoom to a discrete ZoomLevel:
 * zoom < system → 'system', < module → 'module', < file → 'file', else 'entity'.
 */
export const ZOOM_THRESHOLDS = {
  system: 0.3,
  module: 0.7,
  file: 1.5,
} as const;

/**
 * Upper bound for automatic fit-to-view. Kept below `ZOOM_THRESHOLDS.file`
 * so a fitted view never jumps to the most detailed tier on its own.
 */
export const FIT_VIEW_MAX_ZOOM = 1.25;
