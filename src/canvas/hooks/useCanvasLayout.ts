/**
 * Runs the layout whenever the visible node set changes, then either
 * centres a pending focus request (search / deep link) or fits the view.
 *
 * Ordering: navigateTo() updates drill path + focus in one store update, so
 * the layout starts (pending) before the focus effect runs; the focus is
 * applied once positions land (layoutVersion bumps). When the target is
 * already on screen no layout runs and the focus applies immediately.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useReactFlow, type Edge, type Node } from '@xyflow/react';
import { FIT_VIEW_MAX_ZOOM } from '../../contracts/canvas/index.js';
import { computeLayout, layoutModeFor } from '../layout/compute-layout';
import { useCanvasStore } from '../store/canvas-store';

interface Params {
  layoutNodes: Node[];
  layoutEdges: Edge[];
  layoutKey: string;
  visibleIds: ReadonlySet<string>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
}

export const FIT_PADDING = 0.2;

export function useCanvasLayout({ layoutNodes, layoutEdges, layoutKey, visibleIds, setNodes }: Params) {
  const rf = useReactFlow();
  const drillPath = useCanvasStore((s) => s.drillPath);
  const focusRequest = useCanvasStore((s) => s.focusRequest);
  const clearFocusRequest = useCanvasStore((s) => s.clearFocusRequest);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const pending = useRef(false);
  const runId = useRef(0);
  const fittedVersion = useRef(-1);

  // 1. Layout on visible-set change.
  useEffect(() => {
    if (layoutNodes.length === 0) return;
    const run = ++runId.current;
    pending.current = true;
    computeLayout(layoutNodes, layoutEdges, layoutModeFor(drillPath))
      .then((positions) => {
        if (run !== runId.current) return;
        setNodes((all) =>
          all.map((n) => {
            const p = positions.get(n.id);
            return p ? { ...n, position: p } : n;
          }),
        );
      })
      .catch((err) => console.error('[flowlens] layout failed', err))
      .finally(() => {
        if (run !== runId.current) return;
        pending.current = false;
        setLayoutVersion((v) => v + 1);
      });
    // Intentionally keyed on the set identity only.
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Focus or fit once positions are applied.
  useEffect(() => {
    if (pending.current) return;
    const frame = requestAnimationFrame(() => {
      if (focusRequest) {
        const internal = rf.getInternalNode(focusRequest.nodeId);
        if (internal && visibleIds.has(focusRequest.nodeId)) {
          const { x, y } = internal.internals.positionAbsolute;
          const w = internal.measured.width ?? Number(internal.style?.width ?? 160);
          const h = internal.measured.height ?? Number(internal.style?.height ?? 44);
          const zoom = Math.min(Math.max(rf.getZoom(), 1), FIT_VIEW_MAX_ZOOM);
          rf.setCenter(x + w / 2, y + h / 2, { zoom, duration: 400 });
          fittedVersion.current = layoutVersion;
          clearFocusRequest();
          return;
        }
        clearFocusRequest();
      }
      if (fittedVersion.current !== layoutVersion) {
        fittedVersion.current = layoutVersion;
        rf.fitView({ padding: FIT_PADDING, maxZoom: FIT_VIEW_MAX_ZOOM, duration: 250 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutVersion, focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  return { layoutVersion, layoutPending: pending };
}
