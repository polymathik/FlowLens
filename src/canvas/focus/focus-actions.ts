/**
 * Entering, changing and leaving Focus mode from the UI (toolbar button, detail panel, context menu, the
 * `F` key, a double-click on a neighbour). The pure part turns a selected node id into a `FocusSpec`.
 */
import { useMemo } from 'react';
import type { FocusSpec } from '../../contracts/canvas/index.js';
import { FOCUS_DEFAULT_DEPTH, FOCUS_MORE_PREFIX, FOCUS_SELF_ZONE_ID } from '../../contracts/canvas/index.js';
import { PROJECT_NODE_ID, type Hierarchy } from '../../contracts/hierarchy.js';
import { pathIdentifierOf } from '../../analysis/hierarchy/index.js';
import { useCanvasStore, useCanvasStoreApi } from '../store/canvas-store';

/** The id Focus mode takes for a map node (card, zone or hierarchy id), or null when it cannot be focused. */
export function focusIdOf(h: Hierarchy, nodeId: string | null | undefined): string | null {
  if (!nodeId || nodeId === FOCUS_SELF_ZONE_ID || nodeId.startsWith(FOCUS_MORE_PREFIX)) return null;
  if (nodeId.startsWith('zone:')) return nodeId;
  if (nodeId === PROJECT_NODE_ID || !h.nodes.has(nodeId)) return null;
  return pathIdentifierOf(h, nodeId);
}

/** A spec for `nodeId`, keeping the depth / direction / types of the current focus when there is one. */
export function focusSpecFor(h: Hierarchy, nodeId: string | null | undefined, current?: FocusSpec | null): FocusSpec | null {
  const id = focusIdOf(h, nodeId);
  return id ? { id, depth: current?.depth ?? FOCUS_DEFAULT_DEPTH, direction: current?.direction ?? 'both', ...(current?.types ? { types: current.types } : {}), ...(current?.lateral ? { lateral: true } : {}) } : null;
}

export interface FocusActions {
  active: boolean;
  /** Focus on `nodeId` (default: the selected node). Returns false when it cannot be focused. */
  enter: (nodeId?: string | null) => boolean;
  exit: () => void;
  canFocus: (nodeId?: string | null) => boolean;
}

export function useFocusActions(hierarchy: Hierarchy): FocusActions {
  const store = useCanvasStoreApi();
  const active = useCanvasStore((s) => s.focus !== null);
  return useMemo<FocusActions>(
    () => ({
      active,
      enter: (nodeId) => {
        const s = store.getState();
        const spec = focusSpecFor(hierarchy, nodeId ?? s.selectedNodeId, s.focus);
        if (spec) s.setFocus(spec);
        return !!spec;
      },
      exit: () => store.getState().setFocus(null),
      canFocus: (nodeId) => !!focusIdOf(hierarchy, nodeId ?? store.getState().selectedNodeId),
    }),
    [store, hierarchy, active],
  );
}
