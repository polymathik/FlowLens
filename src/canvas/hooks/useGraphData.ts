/**
 * React hook that fetches graph data from the API and transforms it into
 * React Flow nodes + edges. Returns loading/error states for the UI.
 */
import { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { fetchEntities, fetchRelations } from '../api/graph-client';
import { transformEntitiesToNodes } from '../utils/node-transformer';
import { transformRelationsToEdges } from '../utils/edge-transformer';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  loading: boolean;
  error: string | null;
}

export function useGraphData(): GraphData {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [entities, relations] = await Promise.all([
          fetchEntities(),
          fetchRelations(),
        ]);

        if (cancelled) return;

        const rfNodes = transformEntitiesToNodes(entities);
        const nodeIds = new Set(rfNodes.map((n) => n.id));
        const rfEdges = transformRelationsToEdges(relations, nodeIds);

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

  return { nodes, edges, loading, error };
}
