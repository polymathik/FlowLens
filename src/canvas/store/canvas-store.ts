/**
 * Zustand store for canvas state management.
 *
 * Manages zoom level, node selection, relation-type filters, overlay mode,
 * search query, and drill-down navigation state.
 */
import { create } from 'zustand';

export type ZoomLevel = 'system' | 'module' | 'file' | 'entity';
export type OverlayType =
  | 'complexity-heatmap'
  | 'churn-heatmap'
  | 'hotspot'
  | 'cycles'
  | 'architecture-violations'
  | 'interface-diff'
  | null;

interface CanvasState {
  // Zoom
  currentZoomLevel: ZoomLevel;
  setZoomLevel: (level: ZoomLevel) => void;

  // Selection
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;

  // Filters
  visibleRelationTypes: Set<string>;
  toggleRelationType: (type: string) => void;

  // Overlays
  activeOverlay: OverlayType;
  setOverlay: (overlay: OverlayType) => void;

  // Search
  searchQuery: string;
  setSearch: (query: string) => void;

  // Drill-down
  drillPath: string[];
  expandedNodes: Set<string>;
  drillInto: (nodeId: string) => void;
  drillUp: () => void;
  toggleExpand: (nodeId: string) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  currentZoomLevel: 'system',
  setZoomLevel: (level) => set({ currentZoomLevel: level }),

  selectedNodeId: null,
  selectNode: (id) => set({ selectedNodeId: id }),

  visibleRelationTypes: new Set(['import', 'call', 'extend', 'implement']),
  toggleRelationType: (type) =>
    set((state) => {
      const next = new Set(state.visibleRelationTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { visibleRelationTypes: next };
    }),

  activeOverlay: null,
  setOverlay: (overlay) => set({ activeOverlay: overlay }),

  searchQuery: '',
  setSearch: (query) => set({ searchQuery: query }),

  drillPath: [],
  expandedNodes: new Set(),
  drillInto: (nodeId) =>
    set((state) => ({
      drillPath: [...state.drillPath, nodeId],
      expandedNodes: new Set([...state.expandedNodes, nodeId]),
    })),
  drillUp: () =>
    set((state) => {
      const path = [...state.drillPath];
      const removed = path.pop();
      const expanded = new Set(state.expandedNodes);
      if (removed) expanded.delete(removed);
      return { drillPath: path, expandedNodes: expanded };
    }),
  toggleExpand: (nodeId) =>
    set((state) => {
      const expanded = new Set(state.expandedNodes);
      if (expanded.has(nodeId)) expanded.delete(nodeId);
      else expanded.add(nodeId);
      return { expandedNodes: expanded };
    }),
}));
