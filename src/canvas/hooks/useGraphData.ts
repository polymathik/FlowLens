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
} from '../api/graph-client';
import { transformEntitiesToNodes } from '../utils/node-transformer';
import { transformRelationsToEdges } from '../utils/edge-transformer';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  entities: Entity[];
  loading: boolean;
  error: string | null;
}

export function useGraphData(): GraphData {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
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
        const rfEdges = transformRelationsToEdges(relations, nodeIds);

        setEntities(rawEntities);
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
    return () => { cancelled = true; };
  }, []);

  return { nodes, edges, entities, loading, error };
}
