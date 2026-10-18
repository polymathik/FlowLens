/**
 * Applies the project's map route (from the explorer URL) once graph data
 * is loaded: navigate (drill + select + focus) to the target, switch on the
 * requested overlay and highlight what "Show on map" asked for.
 *
 * Each route is applied once per navigation (`route.stamp`), so switching
 * back to a tab keeps whatever the user did on the map since.
 */
import { useEffect, useRef } from 'react';
import type { Entity } from '../../contracts/entities.js';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { useCanvasStore } from '../store/canvas-store';
import { LINK_OVERLAY_TO_STORE, resolveRouteTarget } from '../utils/navigation';
import { useProjectContext } from '../components/explorer/project-context';
import { mapRouteKey } from './explorer-route';
import { focusSpecOfRoute } from './useFocusUrl';
import { markApplied, takePendingHighlight, wasApplied } from './map-intents';

export function useHashRoute(entities: Entity[], hierarchy: Hierarchy, ready: boolean) {
  const navigateTo = useCanvasStore((s) => s.navigateTo);
  const setOverlay = useCanvasStore((s) => s.setOverlay);
  const setFocus = useCanvasStore((s) => s.setFocus);
  const { projectId, route, routeStamp } = useProjectContext();
  const lookupRef = useRef({ entities, hierarchy });
  lookupRef.current = { entities, hierarchy };

  useEffect(() => {
    if (!ready || !route || route.tab !== 'project') return;
    const key = mapRouteKey(route);
    const pid = projectId ?? '';
    if (!key || wasApplied(pid, key, routeStamp)) return;
    markApplied(pid, key, routeStamp);
    const overlay = route.overlay ? LINK_OVERLAY_TO_STORE[route.overlay] : undefined;
    const target = route.target ? resolveRouteTarget(route.target, lookupRef.current) : null;
    const highlight = takePendingHighlight(pid, key);
    if (target) navigateTo({ ...target, overlay, highlight: highlight?.filter((id) => lookupRef.current.hierarchy.nodes.has(id)) });
    else if (overlay) setOverlay(overlay);
    // Focus mode is part of the route: a focus link enters it; any other map link leaves it (`navigateTo` does that).
    if (route.focus) setFocus(focusSpecOfRoute(route.focus));
  }, [ready, route, routeStamp, projectId, navigateTo, setOverlay, setFocus]);
}
