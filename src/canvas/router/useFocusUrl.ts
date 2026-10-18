/**
 * Keeps the URL in step with Focus mode, so browser back / forward walk in and out of it and a focus is
 * a shareable link:
 *
 *   #/p/<project>/map/focus/<id>?depth=2&dir=both&types=import,call     (see contracts/canvas/router.ts)
 *
 * Entering focus PUSHES an entry (back returns to the drill-path link the map was on); changing depth,
 * direction, types or the focused node REPLACES it (a slider drag is not history); leaving PUSHES the
 * drill-path link again. `history.pushState` does not fire `hashchange`, so writing the URL never
 * re-applies the route; back / forward do, and `useHashRoute` turns the route into store state.
 */
import { useEffect } from 'react';
import type { CanvasRouteFocus, FocusSpec } from '../../contracts/canvas/index.js';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { pathIdentifierOf } from '../../analysis/hierarchy/index.js';
import { useCanvasStore } from '../store/canvas-store';
import { resolveContainer } from '../utils/map-view';
import { useProjectContext } from '../components/explorer/project-context';
import { buildExplorerHash } from './explorer-route';

const FOCUS_LINK = /\/map\/focus(\/|$)/;

export const routeFocusOfSpec = (f: FocusSpec): CanvasRouteFocus => ({ id: f.id, depth: f.depth, dir: f.direction, ...(f.types?.length ? { types: f.types } : {}), ...(f.lateral ? { lateral: true } : {}) });

export const focusSpecOfRoute = (f: CanvasRouteFocus): FocusSpec => ({ id: f.id, depth: f.depth ?? 2, direction: f.dir ?? 'both', ...(f.types?.length ? { types: f.types } : {}), ...(f.lateral ? { lateral: true } : {}) });

export function useFocusUrl(hierarchy: Hierarchy, ready: boolean): void {
  const { projectId } = useProjectContext();
  const focus = useCanvasStore((s) => s.focus);
  const drillPath = useCanvasStore((s) => s.drillPath);

  useEffect(() => {
    if (!projectId || !ready) return;
    const current = window.location.hash;
    if (!current.startsWith(`#/p/${encodeURIComponent(projectId)}/map`)) return; // not showing this project's map
    const onFocusLink = FOCUS_LINK.test(current);
    if (focus) {
      const hash = buildExplorerHash({ tab: 'project', projectId, view: 'map', focus: routeFocusOfSpec(focus) });
      if (current === hash) return;
      if (onFocusLink) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    } else if (onFocusLink) {
      const container = resolveContainer(hierarchy, drillPath);
      const hash = buildExplorerHash({ tab: 'project', projectId, view: 'map', target: { kind: 'path', identifier: pathIdentifierOf(hierarchy, container) } });
      window.history.pushState(null, '', hash);
    }
    // The drill path is read when leaving only; its changes do not matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ready, focus]);
}
