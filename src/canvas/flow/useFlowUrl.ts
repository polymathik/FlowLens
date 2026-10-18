/**
 * Keeps the URL in step with Flow mode, so browser back / forward walk in and out of it and a flow is a
 * shareable link (`#/p/<project>/map/flow/<entityId>?depth=4[&span=a-b][&dir=in]…`, see contracts/canvas/router.ts).
 * Same rules as Focus (`router/useFocusUrl.ts`):
 *  - entering PUSHES an entry (back returns to the map link it came from);
 *  - changing depth, direction, follow, max nodes or tests REPLACES it (a slider drag is not history);
 *  - tracing a different root from inside a flow PUSHES (back returns to the previous flow);
 *  - leaving PUSHES the drill-path link again.
 * `history.pushState` does not fire `hashchange`, so writing the URL never re-applies the route; back /
 * forward do, and `useHashRoute` turns the route into store state.
 */
import { useEffect, useRef } from 'react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { pathIdentifierOf } from '../../analysis/hierarchy/index.js';
import { useCanvasStore } from '../store/canvas-store';
import { resolveContainer } from '../utils/map-view';
import { useProjectContext } from '../components/explorer/project-context';
import { buildExplorerHash, parseExplorerHash } from '../router/explorer-route';
import { routeFlowOfSpec } from './flow-route';

const FLOW_LINK = /\/map\/flow(\/|$)/;
const rootKey = (s: { id: string; span?: { from: number; to: number } } | null | undefined): string => (s ? `${s.id}#${s.span?.from ?? ''}` : '');

const flowOfHash = (hash: string) => {
  const r = parseExplorerHash(hash);
  return r.tab === 'project' ? r.flow : undefined;
};

export function useFlowUrl(hierarchy: Hierarchy, ready: boolean): void {
  const { projectId } = useProjectContext();
  const flow = useCanvasStore((s) => s.flow);
  const drillPath = useCanvasStore((s) => s.drillPath);
  const lastRoot = useRef('');
  const key = flow ? JSON.stringify(routeFlowOfSpec(flow)) : '';

  useEffect(() => {
    if (!projectId || !ready) return;
    const current = window.location.hash;
    if (!current.startsWith(`#/p/${encodeURIComponent(projectId)}/map`)) return; // not showing this project's map
    const onFlowLink = FLOW_LINK.test(current);
    if (flow) {
      const hash = buildExplorerHash({ tab: 'project', projectId, view: 'map', flow: routeFlowOfSpec(flow) });
      const root = rootKey(flow);
      const previous = lastRoot.current;
      lastRoot.current = root;
      if (current === hash) return;
      // Same root as before, or a link that already names this root (a deep link, back / forward): only its form or settings
      // changed, so replace. A different root (traced from inside a flow, or entered from the map) is a new history entry.
      const urlNamesRoot = onFlowLink && rootKey(flowOfHash(current)) === root;
      if (onFlowLink && (previous === root || urlNamesRoot)) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    } else if (onFlowLink) {
      lastRoot.current = '';
      const container = resolveContainer(hierarchy, drillPath);
      window.history.pushState(null, '', buildExplorerHash({ tab: 'project', projectId, view: 'map', target: { kind: 'path', identifier: pathIdentifierOf(hierarchy, container) } }));
    } else lastRoot.current = '';
    // The drill path is read when leaving only; its changes do not matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ready, key]);
}
