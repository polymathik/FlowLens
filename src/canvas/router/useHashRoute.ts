/**
 * Applies the URL hash route on load and on every `hashchange`:
 * navigate (drill + select + focus) to the target and switch on the
 * requested overlay. Waits until graph data is loaded.
 */
import { useEffect, useRef } from 'react';
import type { Entity } from '../../contracts/entities.js';
import { useCanvasStore } from '../store/canvas-store';
import { parseCanvasHash } from './hash-route';
import { LINK_OVERLAY_TO_STORE, resolveRouteTarget } from '../utils/navigation';

export function useHashRoute(entities: Entity[], nodeIds: ReadonlySet<string>, ready: boolean) {
  const navigateTo = useCanvasStore((s) => s.navigateTo);
  const setOverlay = useCanvasStore((s) => s.setOverlay);
  const lookupRef = useRef({ entities, nodeIds });
  lookupRef.current = { entities, nodeIds };

  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const route = parseCanvasHash(window.location.hash);
      const overlay = route.overlay ? LINK_OVERLAY_TO_STORE[route.overlay] : undefined;
      const target = route.target ? resolveRouteTarget(route.target, lookupRef.current) : null;
      if (target) navigateTo({ ...target, overlay });
      else if (overlay) setOverlay(overlay);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [ready, navigateTo, setOverlay]);
}
