/**
 * Keeps the URL in step with the open container, so browser back / forward
 * walk the drill history and every view is a shareable link:
 *
 *   #/p/<project>/map/path/packages/server/src      (see contracts/canvas/router.ts)
 *
 * `history.pushState` does not fire `hashchange`, so writing the URL never
 * re-applies the route; back / forward do fire it and the route is applied
 * by `useHashRoute` like any deep link.
 *
 * - First sync after the map mounts, and a deep link that was just applied
 *   (entity / file / module form), REPLACE the entry with the canonical path
 *   form (keeps the overlay), so history never holds a state that cannot be
 *   restored.
 * - Later container changes PUSH a new entry.
 */
import { useEffect, useRef } from 'react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { pathIdentifierOf } from '../../analysis/hierarchy/index.js';
import { useCanvasStore } from '../store/canvas-store';
import { LINK_OVERLAY_TO_STORE } from '../utils/navigation';
import { resolveContainer } from '../utils/map-view';
import { useProjectContext } from '../components/explorer/project-context';
import { buildExplorerHash } from './explorer-route';

export function useDrillUrl(hierarchy: Hierarchy, ready: boolean): void {
  const { projectId } = useProjectContext();
  const drillPath = useCanvasStore((s) => s.drillPath);
  const overlay = useCanvasStore((s) => s.activeOverlay);
  const first = useRef(true);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const container = ready ? resolveContainer(hierarchy, drillPath) : null;

  useEffect(() => {
    if (!projectId || !container) return;
    const current = window.location.hash;
    if (!current.startsWith(`#/p/${encodeURIComponent(projectId)}/map`)) return; // not showing this project's map
    const linkOverlay = Object.entries(LINK_OVERLAY_TO_STORE).find(([, v]) => v === overlayRef.current)?.[0];
    const hash = buildExplorerHash({
      tab: 'project',
      projectId,
      view: 'map',
      target: { kind: 'path', identifier: pathIdentifierOf(hierarchy, container) },
      overlay: linkOverlay as never,
    });
    if (current === hash) {
      first.current = false;
      return;
    }
    const isPathLink = /\/map\/path(\/|$)/.test(current);
    const replace = first.current || !isPathLink;
    first.current = false;
    if (replace) window.history.replaceState(null, '', hash);
    else window.history.pushState(null, '', hash);
  }, [projectId, container, hierarchy]);
}
