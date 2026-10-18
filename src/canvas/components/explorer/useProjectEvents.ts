/**
 * One SSE stream per open project tab (`/api/projects/:id/events`). Every
 * `graph-changed` bumps that project's revision in the explorer store, so
 * only that tab's map, Health screen and Home card reload.
 */
import { useEffect } from 'react';
import { openProjectEvents } from '../../api/explorer-client';
import { useExplorerStore } from '../../store/explorer-store';

export function useProjectEvents(projectIds: string[], enabled: boolean): void {
  const bump = useExplorerStore((s) => s.bumpRevision);
  const key = projectIds.join('|');
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const sources = projectIds.map((id) => {
      const es = openProjectEvents(id);
      es.addEventListener('graph-changed', () => bump(id));
      return es;
    });
    return () => sources.forEach((s) => s.close());
  }, [key, enabled, bump]); // eslint-disable-line react-hooks/exhaustive-deps
}
