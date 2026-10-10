/**
 * Canvas contracts for the context layer (Phase 7): REST routes, the
 * Zustand store slice, and view-model shapes for overlays, hulls, and the
 * context drawer.
 *
 * See _docs/specs/PHASE-7-context-layer.md §7.
 */
import type {
  ContextId,
  ContextItemType,
  ContextPatch,
  EffectiveStatus,
  IndexedContextItem,
  NewContextItem,
  RankedContextItem,
} from '../context.js';
import type { ContextBrief, ContextIndexStats, ContextQuery } from '../context-services.js';

// ── REST API (served by canvas/api/graph-server.ts under /flowlens-api) ────

export const CONTEXT_ROUTES = {
  list: 'GET /flowlens-api/context',
  get: 'GET /flowlens-api/context/:id',
  create: 'POST /flowlens-api/context',
  update: 'PATCH /flowlens-api/context/:id',
  supersede: 'POST /flowlens-api/context/:id/supersede',
  review: 'POST /flowlens-api/context/:id/review',
  history: 'GET /flowlens-api/context/:id/history',
  brief: 'GET /flowlens-api/context-brief',
  features: 'GET /flowlens-api/context-features',
  stats: 'GET /flowlens-api/context-stats',
} as const;

/** GET /context — query params map 1:1 to ContextQuery (arrays comma-joined). */
export type ContextListRequest = ContextQuery;
export interface ContextListResponse {
  results: RankedContextItem[];
  total_matched: number;
}

/** Canvas writes are human writes: provenance is filled server-side (source 'human', origin 'canvas'). */
export type ContextCreateRequest = Omit<NewContextItem, 'provenance'>;
export interface ContextUpdateRequest {
  rev: number;
  patch: ContextPatch;
}
export interface ContextSupersedeRequest {
  rev: number;
  replacement: ContextCreateRequest;
  reason: string;
}
export interface ContextReviewRequest {
  rev: number;
  action: 'accept' | 'reject';
  /** Optional edits applied with the accept. */
  patch?: ContextPatch;
}
export interface ContextHistoryEntry {
  commit: string;
  author: string;
  date: string;
  summary: string;
}
export type ContextBriefResponse = ContextBrief;
export type ContextStatsResponse = ContextIndexStats;

/** Error body for 4xx responses; 409 carries `current` for merge. */
export interface ContextApiError {
  code: string;
  message: string;
  current?: IndexedContextItem;
}

// ── View models ────────────────────────────────────────────────────────────

/** Per-node badge data for the context overlay. */
export interface NodeContextBadge {
  entity_id: string;
  counts: Partial<Record<ContextItemType, number>>;
  stale: number;
  proposed: number;
  /** Aggregated from children at system/module zoom. */
  aggregated: boolean;
}

/** A feature drawn as a translucent hull behind its member nodes. */
export interface FeatureHull {
  feature_id: ContextId;
  title: string;
  status: 'planned' | 'in_progress' | 'done' | 'paused';
  member_node_ids: string[];
  /** Stable palette index so a feature keeps its color across sessions. */
  color_index: number;
}

/** An orphaned anchor rendered as a ghost node near its last known file. */
export interface GhostAnchorNode {
  item_id: ContextId;
  qualified_name: string;
  last_file: string;
  suggestions: string[];
}

// ── Store slice (merged into CanvasState) ──────────────────────────────────

export type ContextDrawerTab = 'inbox' | 'explore' | 'features' | 'timeline';

export interface ContextFilters {
  types: Set<ContextItemType>;
  statuses: Set<EffectiveStatus>;
  feature: ContextId | null;
  agent: string | null;
  text: string;
}

export interface ContextCanvasState {
  contextDrawerOpen: boolean;
  contextDrawerTab: ContextDrawerTab;
  contextFilters: ContextFilters;
  /** Item whose anchors are highlighted (hover or select). */
  highlightedContextId: ContextId | null;
  /** Item open in the editor modal; 'new' for create. */
  editingContextId: ContextId | 'new' | null;
  visibleFeatureHulls: Set<ContextId>;
  showContextEdges: boolean;
  commandPaletteOpen: boolean;

  setContextDrawer: (open: boolean, tab?: ContextDrawerTab) => void;
  setContextFilters: (patch: Partial<ContextFilters>) => void;
  highlightContext: (id: ContextId | null) => void;
  editContext: (id: ContextId | 'new' | null) => void;
  toggleFeatureHull: (id: ContextId) => void;
  setShowContextEdges: (show: boolean) => void;
  setCommandPalette: (open: boolean) => void;
}

/** Payload for drag-and-drop of a context card onto a node. */
export interface ContextDragPayload {
  kind: 'flowlens/context-item';
  item_id: ContextId;
  rev: number;
}
