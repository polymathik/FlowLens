/**
 * React hook that fetches graph data from the API and transforms it into
 * React Flow nodes + edges. Returns loading/error states for the UI.
 *
 * Also fetches annotations and attaches them to entity node data.
 */
import { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
  fetchEntities,
  fetchRelations,
  fetchAnnotations,
  type Entity,
  type Relation,
} from '../api/graph-client';
import { transformEntitiesToNodes } from '../utils/node-transformer';
import { transformRelationsToEdges } from '../utils/edge-transformer';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  entities: Entity[];
  relations: Relation[];
  loading: boolean;
  error: string | null;
}

export function useGraphData(): GraphData {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [rawEntities, relations, annotations] = await Promise.all([
          fetchEntities(),
          fetchRelations(),
          fetchAnnotations(),
        ]);

        if (cancelled) return;

        const rfNodes = transformEntitiesToNodes(rawEntities, annotations);
        const nodeIds = new Set(rfNodes.map((n) => n.id));
        const rfEdges = transformRelationsToEdges(relations, nodeIds, rawEntities);

        setEntities(rawEntities);
        setRelations(relations);
        setNodes(rfNodes);
        setEdges(rfEdges);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load graph');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Subscribe to the watch-mode SSE stream. When the server pushes a
    // graph-updated event, re-fetch everything. EventSource is resilient
    // to reconnects; if the endpoint doesn't exist (no-watch mode), the
    // browser silently retries and we don't error the UI.
    const events = new EventSource('/flowlens-api/events');
    events.addEventListener('graph-updated', () => {
      if (!cancelled) load();
    });
    events.onerror = () => {
      // Let the browser auto-reconnect; don't surface to UI.
    };

    return () => {
      cancelled = true;
      events.close();
    };
  }, []);

  return { nodes, edges, entities, relations, loading, error };
}
