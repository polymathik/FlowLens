/**
 * Registered projects from the daemon (`GET /api/projects`), refreshed on
 * window focus and on demand. Shared by the tab bar, picker and Home.
 */
import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ProjectDetail } from '../../../contracts/service.js';
import { fetchProjects } from '../../api/explorer-client';

interface ProjectsState {
  projects: ProjectDetail[] | null;
  error: string | null;
  loadedAt: number;
  set: (p: Partial<ProjectsState>) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: null,
  error: null,
  loadedAt: 0,
  set: (p) => set(p),
}));

export async function refreshProjects(): Promise<void> {
  try {
    const projects = await fetchProjects();
    useProjectsStore.getState().set({ projects, error: null, loadedAt: Date.now() });
  } catch (err) {
    useProjectsStore.getState().set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function useProjects() {
  const projects = useProjectsStore((s) => s.projects);
  const error = useProjectsStore((s) => s.error);
  useEffect(() => {
    if (useProjectsStore.getState().loadedAt === 0) void refreshProjects();
    const onFocus = () => void refreshProjects();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const byId = useCallback((id: string) => projects?.find((p) => p.id === id) ?? null, [projects]);
  return { projects, error, byId, refresh: refreshProjects };
}

/** Loads something keyed by `deps`; keeps the previous value while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (err: unknown) => !cancelled && setState((s) => ({ data: s.data, error: err instanceof Error ? err.message : String(err), loading: false })),
    );
    return () => {
      cancelled = true;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
