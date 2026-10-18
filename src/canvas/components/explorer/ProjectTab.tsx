/**
 * A project tab: header (name, path, Health | Map switch, freshness) and
 * the active sub-view. The map is mounted only while visible; its state
 * survives in the project's own canvas store. A missing project explains
 * what happened and offers to remove it from the list.
 */
import React, { Suspense, lazy, useState } from 'react';
import type { ExplorerRoute, ProjectView } from '../../../contracts/canvas/index.js';
import type { ProjectDetail } from '../../../contracts/service.js';
import { removeProject } from '../../api/explorer-client';
import { buildExplorerHash, tabHash } from '../../router/explorer-route';
import { navigate } from '../../router/navigate';
import { useExplorerStore } from '../../store/explorer-store';
import { formatRelativeTime } from '../../utils/format';
import { HealthView } from './HealthView';
import { ProjectProvider } from './project-context';
import { refreshProjects } from './useProjects';

const Canvas = lazy(() => import('../Canvas'));

interface Props {
  projectId: string;
  project: ProjectDetail | null;
  route: ExplorerRoute;
  routeStamp: number;
}

export function ProjectTab({ projectId, project, route, routeStamp }: Props) {
  const view = useExplorerStore((s) => s.views[projectId] ?? 'health');
  const revision = useExplorerStore((s) => s.revisions[projectId] ?? 0);
  const views: Array<{ id: ProjectView; label: string }> = [
    { id: 'health', label: 'Health' },
    { id: 'map', label: 'Map' },
  ];

  if (!project) return <div className="fl-center">Loading project…</div>;
  if (project.status === 'missing') return <MissingProject project={project} />;

  return (
    <div className="fl-main" id="fl-tabpanel" role="tabpanel" aria-labelledby={`tab-${projectId}`} data-testid={`project-${projectId}`}>
      <div className="fl-projhead">
        <h2>{project.name}</h2>
        <span className="fl-path" title={project.root}>
          {project.root}
        </span>
        <div className="fl-views" role="tablist" aria-label="View">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className="fl-view"
              data-testid={`view-${v.id}`}
              onClick={() => navigate(buildExplorerHash({ tab: 'project', projectId, view: v.id }))}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="fl-projhead-end">Indexed {formatRelativeTime(project.last_indexed)}</span>
      </div>
      <div className="fl-main">
        {view === 'health' ? (
          <HealthView projectId={projectId} />
        ) : (
          <ProjectProvider projectId={projectId} projectName={project.name} projectRoot={project.root} revision={revision} route={route} routeStamp={routeStamp}>
            <Suspense fallback={<div className="fl-center">Loading map…</div>}>
              <Canvas />
            </Suspense>
          </ProjectProvider>
        )}
      </div>
    </div>
  );
}

function MissingProject({ project }: { project: ProjectDetail }) {
  const closeTab = useExplorerStore((s) => s.closeTab);
  const [error, setError] = useState<string | null>(null);
  const inUse = project.graph?.leases ?? 0;
  const remove = async () => {
    try {
      await removeProject(project.id, inUse > 0);
      const next = closeTab(project.id);
      await refreshProjects();
      navigate(tabHash(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="fl-center" id="fl-tabpanel" role="tabpanel" data-testid="missing-project">
      <div className="fl-notice">
        <h2>{project.name} can't be found</h2>
        <p>
          FlowLens expected this project at <code>{project.root}</code>, but the folder (or its <code>.flowlens</code> data) is gone. It may have
          been moved, renamed or deleted.
        </p>
        <p>
          If you moved it, run <code>flowlens init</code> in the new location and it will be linked again. Otherwise, remove it from the list.
        </p>
        <div className="fl-actions">
          <button type="button" className="fl-primary-btn" onClick={remove} data-testid="remove-project">
            {inUse > 0 ? 'Remove anyway' : 'Remove from list'}
          </button>
          <button type="button" className="fl-quiet-btn" onClick={() => navigate(tabHash(closeTab(project.id)))}>
            Close tab
          </button>
        </div>
        {inUse > 0 && <p data-testid="project-in-use">In use by {inUse} client{inUse === 1 ? '' : 's'}.</p>}
        {error && <p role="alert">Could not remove it: {error}</p>}
      </div>
    </div>
  );
}
