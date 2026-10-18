/**
 * Zones view contract (Map v2, lane R2): the CUT of the zone tree that the
 * Map shows for the open container, plus the layout constants every part of
 * the zone renderer shares. Pure data built by `src/canvas/utils/zone-cut.ts`.
 *
 * The visible set is a cut of the tree: each zone is either EXPANDED (a frame
 * with its children inside) or COLLAPSED (one card standing for every file
 * below it). Files that belong to no zone are loose cards at the top level.
 *
 *   project ─ zone A (expanded) ─ file a1, file a2, zone A1 (collapsed card)
 *           ├ zone B (collapsed card)
 *           └ loose file x
 *
 * Item ids are React Flow node ids: the hierarchy id for package / folder /
 * config zones (`folder:packages/server/src`) and files (`file:<path>`), the
 * zone id (`zone:<mode>:<key>`) for zones without a hierarchy node.
 */
import type { ZoneSource } from '../zones.js';

export interface CutItem {
  id: string;
  kind: 'zone' | 'file';
  /** Zone behind the item (zones only). */
  zoneId?: string;
  /** Hierarchy node the item stands for, when it has one. */
  hierarchyId?: string;
  label: string;
  source?: ZoneSource;
  colorIndex: number;
  /** Item id of the enclosing EXPANDED zone; null at the top level. */
  parentId: string | null;
  /** 0 = top level. */
  depth: number;
  /** Zones only: frame (true) or card (false). */
  expanded: boolean;
  /** Child item ids: zones first, then files, each name-sorted. Empty when collapsed. */
  childIds: string[];
  /** File cards below, recursive. */
  fileCount: number;
  /** Why a collapsed zone is collapsed: the user, an override, the default rule, or the node budget. */
  collapsedBy?: 'user' | 'override' | 'default' | 'depth' | 'budget';
  customized?: boolean;
}

export interface MapCut {
  /** Items parents-before-children (React Flow order), top level first. */
  items: CutItem[];
  /** Top-level item ids in display order. */
  topIds: string[];
  /** File hierarchy id → the item that represents it on screen (its card, or its outermost collapsed zone). */
  atomOfFile: Record<string, string>;
  /** Zones collapsed by the node budget (shown as a notice). */
  budgetCollapsed: number;
  /** Zone item ids forced open by a reveal (search hit, deep link); the canvas remembers them as user choices. */
  revealed: string[];
  /** File cards in the cut (before collapsing), for layout density decisions. */
  totalFiles: number;
}

/** Sizes and thresholds shared by cut, layout and node components. */
export const ZONE_LAYOUT = {
  /** Expand every top-level zone when the open container has at most this many file cards. */
  expandAllUpTo: 120,
  /** Above that, zones with more files than this start collapsed. */
  collapseAbove: 25,
  /** Zones nested deeper than this are always cards. */
  maxDepth: 3,
  /** Mounted nodes (frames + cards + portals) before the largest zones auto-collapse. */
  nodeBudget: 300,
  /** Hard ceiling even for zones the user expanded. */
  hardNodeBudget: 1200,
  /** Cards get room for symbol rows when the cut has at most this many file cards. */
  richUpTo: 48,
  maxSymbolRows: 8,
  framePad: 14,
  frameHeader: 36,
  gap: 14,
  card: { width: 200, height: 46 },
  richCard: { width: 224, height: 52, row: 15 },
  zoneCard: { width: 244, height: 112 },
  /** Zoom below which only zone summaries are drawn (no cards, no card edges). */
  summaryZoom: 0.3,
} as const;
