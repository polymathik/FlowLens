/**
 * Fetches entities, relations, annotations and workspace facts from the
 * project's graph API and builds the code hierarchy (shared definition,
 * `src/analysis/hierarchy`) plus the lookups the Map needs. Re-fetches when
 * the project's revision changes (the explorer shell bumps it on every
 * `graph-changed` SSE event); the previous graph stays on screen meanwhile.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Entity, Relation } from '../api/graph-client';
import type { Hierarchy, WorkspaceInfo } from '../../contracts/hierarchy.js';
import { buildHierarchy, MANIFEST_FILES, selectPackages } from '../../analysis/hierarchy/index.js';
import { useProjectContext } from '../components/explorer/project-context';
import { buildGraphIndex, type GraphIndex } from '../utils/graph-index';

export interface GraphData {
  entities: Entity[];
  relations: Relation[];
  annotations: unknown[];
  hierarchy: Hierarchy;
  index: GraphIndex;
  relationById: Map<string, Relation>;
  loading: boolean;
  error: string | null;
  /** Increments on every successful (re)load. */
  version: number;
}

/** Manifests inferred from the file list when `/workspace` is unavailable. */
export function manifestsFromEntities(entities: Entity[]): WorkspaceInfo['manifests'] {
  const out: WorkspaceInfo['manifests'] = [];
  for (const e of entities) {
    if (e.kind !== 'file') continue;
    const base = e.file.slice(e.file.lastIndexOf('/') + 1);
    if (!MANIFEST_FILES.includes(base)) continue;
    const dir = e.file.includes('/') ? e.file.slice(0, e.file.lastIndexOf('/')) : '';
    out.push({ dir, name: dir.split('/').pop() ?? '', manifest: base });
  }
  return out;
}

export function useGraphData(): GraphData {
  const { client, revision, projectName } = useProjectContext();
  const [state, setState] = useState<{
    entities: Entity[];
    relations: Relation[];
    annotations: unknown[];
    workspace: WorkspaceInfo | null;
    version: number;
  }>({ entities: [], relations: [], annotations: [], workspace: null, version: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [entities, relations, annotations, workspace] = await Promise.all([
          client.fetchEntities(),
          client.fetchRelations(),
          client.fetchAnnotations().catch(() => [] as unknown[]),
          client.fetchWorkspace().catch(() => null),
        ]);
        if (cancelled) return;
        setState((s) => ({ entities, relations, annotations, workspace, version: s.version + 1 }));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load graph');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [client, revision]);

  const hierarchy = useMemo(() => {
    const manifests = state.workspace?.manifests ?? manifestsFromEntities(state.entities);
    const packages = selectPackages(manifests, state.workspace?.workspace_globs ?? []);
    return buildHierarchy({ projectName, entities: state.entities, packages });
  }, [state.entities, state.workspace, projectName]);
  const index = useMemo(() => buildGraphIndex(state.entities, hierarchy), [state.entities, hierarchy]);
  const relationById = useMemo(() => new Map(state.relations.map((r) => [r.id, r])), [state.relations]);

  return {
    entities: state.entities,
    relations: state.relations,
    annotations: state.annotations,
    hierarchy,
    index,
    relationById,
    loading,
    error,
    version: state.version,
  };
}

