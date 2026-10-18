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

/** Four discrete zoom tiers mapped from React Flow viewport zoom. */
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

/** Target handed to `navigateTo` by search, deep links and the Health screen. */
export interface NavigationTarget {
  /** Drill path that makes the node visible (e.g. ["system:src", "module:src/api"]). */
  drillPath: string[];
  /** Node to select and centre. */
  nodeId: string;
  /** Optional overlay to switch on as part of the jump. */
  overlay?: OverlayType | null;
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

  // Drill-down
  /**
   * Breadcrumb trail of container node ids, always a prefix-consistent
   * hierarchy: system → module? → file (e.g. ["system:src", "module:src/parser"]).
   */
  drillPath: string[];

  // Actions
  setZoomLevel: (level: ZoomLevel) => void;
  selectNode: (id: string | null) => void;
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
