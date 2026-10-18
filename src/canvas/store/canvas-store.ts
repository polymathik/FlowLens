/**
 * Canvas state store — implements the `CanvasState` contract
 * (`src/contracts/canvas/state.ts`).
 *
 * Multi-project explorer: every project tab gets its own store instance
 * (`createCanvasStore`, kept by `project-stores.ts`) provided through
 * `CanvasStoreContext`, so drill path, filters, overlays, selection and
 * search never bleed between tabs. `useCanvasStore(selector)` reads the
 * store of the nearest provider; outside any provider it uses a default
 * store (and exposes that store's `getState`/`setState` for tests).
 */
import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import {
  DEFAULT_EDITOR_SCHEME,
  EDITOR_SCHEMES,
  type CanvasState,
  type EditorScheme,
  type ZoomLevel as ContractZoomLevel,
  type OverlayType as ContractOverlayType,
} from '../../contracts/canvas/index.js';
import { DEFAULT_VISIBLE_RELATION_TYPES } from '../utils/relation-defaults';

export type ZoomLevel = ContractZoomLevel;
/** Store variant: `null` means no overlay is active. */
export type OverlayType = ContractOverlayType | null;
export type CanvasStore = StoreApi<CanvasState>;

let focusSeq = 0;

const EDITOR_KEY = 'flowlens.editorScheme';

/** Remembered "Open in editor" scheme (per browser; best effort — storage can be blocked). */
function readEditorScheme(): EditorScheme {
  try {
    const v = window.localStorage.getItem(EDITOR_KEY);
    return EDITOR_SCHEMES.includes(v as EditorScheme) ? (v as EditorScheme) : DEFAULT_EDITOR_SCHEME;
  } catch {
    return DEFAULT_EDITOR_SCHEME;
  }
}

export function createCanvasStore(): CanvasStore {
  return createStore<CanvasState>()((set) => ({
    currentZoomLevel: 'system',
    selectedNodeId: null,
    selectedEdgeId: null,
    focusRequest: null,
    showLockfiles: false,
    editorScheme: readEditorScheme(),
    visibleRelationTypes: new Set<string>(DEFAULT_VISIBLE_RELATION_TYPES),
    activeOverlay: null,
    searchQuery: '',
    searchOpen: false,
    diffSha: '',
    previewViolations: null,
    highlightedIds: [],
    drillPath: [],

    setZoomLevel: (level) => set((s) => (s.currentZoomLevel === level ? s : { currentZoomLevel: level })),
    selectNode: (id) => set(id === null ? { selectedNodeId: null, selectedEdgeId: null, highlightedIds: [] } : { selectedNodeId: id, selectedEdgeId: null }),
    selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
    setShowLockfiles: (show) => set({ showLockfiles: show }),
    setEditorScheme: (scheme) => {
      try {
        window.localStorage.setItem(EDITOR_KEY, scheme);
      } catch {
        /* storage blocked: the choice lasts for this session only */
      }
      set({ editorScheme: scheme });
    },
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
        selectedEdgeId: null,
        focusRequest: target.nodeId ? { nodeId: target.nodeId, seq: ++focusSeq } : null,
        activeOverlay: target.overlay === undefined ? s.activeOverlay : target.overlay,
        highlightedIds: target.highlight ? [...target.highlight] : [],
      })),
    clearFocusRequest: () => set({ focusRequest: null }),
    setHighlighted: (ids) => set({ highlightedIds: [...ids] }),
  }));
}

const defaultStore = createCanvasStore();

export const CanvasStoreContext = createContext<CanvasStore>(defaultStore);

/** The store of the current project tab (imperative access). */
export function useCanvasStoreApi(): CanvasStore {
  return useContext(CanvasStoreContext);
}

function useCanvasStoreHook<T>(selector: (s: CanvasState) => T): T {
  return useStore(useContext(CanvasStoreContext), selector);
}

export const useCanvasStore = Object.assign(useCanvasStoreHook, {
  getState: defaultStore.getState,
  setState: defaultStore.setState,
  subscribe: defaultStore.subscribe,
});
