/**
 * Lays out the open container's view and commits it, then either centres a
 * pending focus request (search / deep link / portal) or fits the view.
 *
 * Determinism (audit D8):
 *  - The old view stays on screen until the new layout is ready; nodes and
 *    edges are committed together with their final positions, so React Flow
 *    never renders a half-laid-out set.
 *  - Nodes carry explicit width/height, so fit-to-view does not depend on
 *    React Flow having measured them.
 *  - Fit runs two animation frames after the commit (React Flow has adopted
 *    the new nodes by then) and is keyed on a layout counter that is bumped
 *    in the same batch as the commit — never on a separate promise tick.
 */
import { useEffect, useRef, useState } from 'react';
import { useReactFlow, type Edge, type Node } from '@xyflow/react';
import { FIT_VIEW_MAX_ZOOM } from '../../contracts/canvas/index.js';
import { boxesFor, computeLayout, sortForLayout } from '../layout/compute-layout';
import { gridLayout } from '../layout/grid-layout';
import { useCanvasStore } from '../store/canvas-store';
import type { MapModel } from './useMapModel';

interface Params {
  model: Pick<MapModel, 'nodes' | 'edges' | 'key'>;
  visibleIds: ReadonlySet<string>;
  commit: (nodes: Node[], edges: Edge[]) => void;
}

export const FIT_PADDING = 0.2;

export function useCanvasLayout({ model, visibleIds, commit }: Params) {
  const rf = useReactFlow();
  const focusRequest = useCanvasStore((s) => s.focusRequest);
  const clearFocusRequest = useCanvasStore((s) => s.clearFocusRequest);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const pending = useRef(false);
  const runId = useRef(0);
  const fittedVersion = useRef(-1);

  // 1. Layout whenever the view's identity changes, then commit nodes + edges + version together.
  useEffect(() => {
    const run = ++runId.current;
    pending.current = true;
    const apply = (positions: Awaited<ReturnType<typeof computeLayout>>) => {
      if (run !== runId.current) return;
      commit(
        model.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
        model.edges,
      );
      pending.current = false;
      setLayoutVersion((v) => v + 1);
    };
    computeLayout(model.nodes, model.edges).then(apply, (err) => {
      console.error('[flowlens] layout failed, using a grid', err);
      apply(gridLayout(boxesFor(sortForLayout(model.nodes))));
    });
    // Intentionally keyed on the view identity only.
  }, [model.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Focus or fit once the committed positions are in React Flow.
  useEffect(() => {
    if (pending.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (focusRequest) {
          const internal = rf.getInternalNode(focusRequest.nodeId);
          if (internal && visibleIds.has(focusRequest.nodeId)) {
            const { x, y } = internal.internals.positionAbsolute;
            const w = internal.measured.width ?? Number(internal.width ?? 160);
            const h = internal.measured.height ?? Number(internal.height ?? 44);
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
          rf.fitView({ padding: FIT_PADDING, maxZoom: FIT_VIEW_MAX_ZOOM, duration: 200 });
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [layoutVersion, focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  return { layoutVersion, layoutPending: pending };
}
