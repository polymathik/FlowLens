/**
 * Fetches entities, relations and annotations from the graph API and
 * builds the full (all-levels) node list plus a GraphIndex. Re-fetches when
 * watch mode pushes a `graph-updated` event.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import {
  fetchAnnotations,
  fetchEntities,
  fetchRelations,
  openEventStream,
  type Entity,
  type Relation,
} from '../api/graph-client';
import { transformEntitiesToNodes } from '../utils/node-transformer';
import { buildGraphIndex, type GraphIndex } from '../utils/graph-index';

export interface GraphData {
  nodes: Node[];
  entities: Entity[];
  relations: Relation[];
  index: GraphIndex;
  loading: boolean;
  error: string | null;
  /** Increments on every successful (re)load. */
  version: number;
}

export function useGraphData(): GraphData {
  const [state, setState] = useState<{
    entities: Entity[];
    relations: Relation[];
    annotations: unknown[];
    version: number;
  }>({ entities: [], relations: [], annotations: [], version: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [entities, relations, annotations] = await Promise.all([
          fetchEntities(),
          fetchRelations(),
          fetchAnnotations().catch(() => [] as unknown[]),
        ]);
        if (cancelled) return;
        setState((s) => ({ entities, relations, annotations, version: s.version + 1 }));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load graph');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    // Watch mode pushes graph-updated; without watch the browser just retries quietly.
    const events = openEventStream();
    events.addEventListener('graph-updated', () => {
      if (!cancelled) load();
    });
    events.onerror = () => {};
    return () => {
      cancelled = true;
      events.close();
    };
  }, []);

  const nodes = useMemo(
    () => transformEntitiesToNodes(state.entities, state.annotations),
    [state.entities, state.annotations],
  );
  const index = useMemo(() => buildGraphIndex(state.entities), [state.entities]);

  return {
    nodes,
    entities: state.entities,
    relations: state.relations,
    index,
    loading,
    error,
    version: state.version,
  };
}
