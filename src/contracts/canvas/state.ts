/**
 * Canvas state contract — the shape of the Zustand store backing the canvas.
 * Keeps volatile UI state (zoom, selection, filters, drill-down) out of
 * React Flow's internal state so rapid interactions don't trigger global
 * re-renders.
 */
import type { RelationType } from '../relations.js';

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
 * The Zustand store shape. All fields that represent store state go above
 * the action methods; all action methods live at the bottom.
 */
export interface CanvasState {
  // Zoom & navigation
  currentZoomLevel: ZoomLevel;

  // Selection
  selectedNodeId: string | null;

  // Filters
  visibleRelationTypes: Set<RelationType | string>;
  activeOverlay: OverlayType | null;
  searchQuery: string;
  /** SHA used by the interface-diff overlay. */
  diffSha: string;

  // Drill-down
  /** Breadcrumb trail of compound-node ids (e.g. "system:src" → "module:src/parser"). */
  drillPath: string[];
  /** Which compound nodes are currently expanded. */
  expandedNodes: Set<string>;

  // Actions
  setZoomLevel: (level: ZoomLevel) => void;
  selectNode: (id: string | null) => void;
  toggleRelationType: (type: RelationType | string) => void;
  setOverlay: (overlay: OverlayType | null) => void;
  setSearch: (query: string) => void;
  setDiffSha: (sha: string) => void;
  drillInto: (nodeId: string) => void;
  drillUp: () => void;
  toggleExpand: (nodeId: string) => void;
}

/** Maps a continuous React Flow viewport zoom to a discrete ZoomLevel. */
export const ZOOM_THRESHOLDS = {
  system: 0.3,
  module: 0.7,
  file: 1.5,
} as const;
