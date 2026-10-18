/**
 * Zustand store for canvas state — implements the `CanvasState` contract
 * (`src/contracts/canvas/state.ts`) exactly.
 */
import { create } from 'zustand';
import type {
  CanvasState,
  ZoomLevel as ContractZoomLevel,
  OverlayType as ContractOverlayType,
} from '../../contracts/canvas/index.js';
import { DEFAULT_VISIBLE_RELATION_TYPES } from '../utils/relation-colors';

export type ZoomLevel = ContractZoomLevel;
/** Store variant: `null` means no overlay is active. */
export type OverlayType = ContractOverlayType | null;

let focusSeq = 0;

export const useCanvasStore = create<CanvasState>((set) => ({
  currentZoomLevel: 'system',
  selectedNodeId: null,
  focusRequest: null,
  visibleRelationTypes: new Set<string>(DEFAULT_VISIBLE_RELATION_TYPES),
  activeOverlay: null,
  searchQuery: '',
  searchOpen: false,
  diffSha: '',
  previewViolations: null,
  drillPath: [],

  setZoomLevel: (level) =>
    set((s) => (s.currentZoomLevel === level ? s : { currentZoomLevel: level })),
  selectNode: (id) => set({ selectedNodeId: id }),
  toggleRelationType: (type) =>
    set((state) => {
      const next = new Set(state.visibleRelationTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { visibleRelationTypes: next };
    }),
  setOverlay: (overlay) => set({ activeOverlay: overlay }),
  setSearch: (query) => set({ searchQuery: query }),
  setSearchOpen: (open) => set(open ? { searchOpen: true } : { searchOpen: false, searchQuery: '' }),
  setDiffSha: (sha) => set({ diffSha: sha }),
  setPreviewViolations: (violations) => set({ previewViolations: violations }),
  setDrillPath: (path) => set({ drillPath: [...path] }),
  drillUp: () => set((s) => ({ drillPath: s.drillPath.slice(0, -1) })),
  drillToLevel: (index) => set((s) => ({ drillPath: s.drillPath.slice(0, Math.max(0, index + 1)) })),
  navigateTo: (target) =>
    set((s) => ({
      drillPath: [...target.drillPath],
      selectedNodeId: target.nodeId,
      focusRequest: { nodeId: target.nodeId, seq: ++focusSeq },
      activeOverlay: target.overlay === undefined ? s.activeOverlay : target.overlay,
    })),
  clearFocusRequest: () => set({ focusRequest: null }),
}));
