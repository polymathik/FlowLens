/**
 * Keeps the URL hash and the tab bar in sync. The hash is the source of
 * truth: `#/home`, `#/p/<id>/health|map/...`. A legacy `#/entity/...` link
 * (no project) is rewritten to the active project tab, or to the only
 * registered project, or falls back to Home.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExplorerRoute } from '../../../contracts/canvas/index.js';
import type { ProjectDetail } from '../../../contracts/service.js';
import { buildExplorerHash, parseExplorerHash } from '../../router/explorer-route';
import { useExplorerStore } from '../../store/explorer-store';

export function resolveProjectlessRoute(
  route: ExplorerRoute,
  activeTab: string,
  projects: ProjectDetail[] | null,
): ExplorerRoute | null {
  if (route.tab !== 'project' || route.projectId) return route;
  const id = activeTab !== 'home' ? activeTab : projects && projects.length === 1 ? projects[0].id : null;
  if (id) return { ...route, projectId: id };
  return projects ? { tab: 'home' } : null; // null = wait for the project list
}

export function useExplorerRoute(projects: ProjectDetail[] | null): { route: ExplorerRoute; stamp: number } {
  const [state, setState] = useState<{ route: ExplorerRoute; stamp: number }>(() => ({ route: { tab: 'home' }, stamp: 0 }));

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const apply = useCallback(() => {
    const s = useExplorerStore.getState();
    const parsed = parseExplorerHash(window.location.hash);
    const route = resolveProjectlessRoute(parsed, s.activeTab, projectsRef.current);
    if (!route) return;
    if (route !== parsed) window.history.replaceState(null, '', buildExplorerHash(route));
    if (route.tab === 'project' && route.projectId) {
      s.openTab(route.projectId);
      s.setActive(route.projectId);
      s.setView(route.projectId, route.view);
    } else {
      s.setActive('home');
    }
    setState((prev) => ({ route, stamp: prev.stamp + 1 }));
  }, []);

  useEffect(() => {
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [apply]);

  // A project-less link waits for the project list; resolve it once that arrives.
  useEffect(() => {
    const parsed = parseExplorerHash(window.location.hash);
    if (projects && parsed.tab === 'project' && !parsed.projectId) apply();
  }, [projects, apply]);

  return state;
}
