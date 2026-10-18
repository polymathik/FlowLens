/**
 * Everything a project tab's canvas needs from its surroundings: which
 * project, its graph client, the live graph revision (SSE) and the map
 * route currently in the URL. One provider per project tab.
 */
import React, { createContext, useContext, useMemo } from 'react';
import type { ExplorerRoute } from '../../../contracts/canvas/index.js';
import { createGraphClient, LEGACY_API_BASE, projectApiBase, type GraphClient } from '../../api/graph-client';
import { CanvasStoreContext } from '../../store/canvas-store';
import { getProjectStore } from '../../store/project-stores';

export interface ProjectContextValue {
  projectId: string | null;
  client: GraphClient;
  revision: number;
  route: ExplorerRoute | null;
  /** Increments on every hash navigation (a route is applied once per stamp). */
  routeStamp: number;
}

const fallback: ProjectContextValue = {
  projectId: null,
  client: createGraphClient(LEGACY_API_BASE),
  revision: 0,
  route: null,
  routeStamp: 0,
};

const ProjectContext = createContext<ProjectContextValue>(fallback);

export function useProjectContext(): ProjectContextValue {
  return useContext(ProjectContext);
}

export function useGraphClient(): GraphClient {
  return useContext(ProjectContext).client;
}

export function ProjectProvider({
  projectId,
  revision,
  route,
  routeStamp,
  children,
}: {
  projectId: string;
  revision: number;
  route: ExplorerRoute | null;
  routeStamp: number;
  children: React.ReactNode;
}) {
  const client = useMemo(() => createGraphClient(projectApiBase(projectId)), [projectId]);
  const value = useMemo(() => ({ projectId, client, revision, route, routeStamp }), [projectId, client, revision, route, routeStamp]);
  return (
    <ProjectContext.Provider value={value}>
      <CanvasStoreContext.Provider value={getProjectStore(projectId)}>{children}</CanvasStoreContext.Provider>
    </ProjectContext.Provider>
  );
}
