/**
 * Layers view data: the saved architecture layers (for the zoning) and, while the map is grouped by
 * layers, the rule breaks to draw between the layer frames. Both follow the graph revision and the
 * rules editor (saving bumps `rulesRevision`).
 */
import { useEffect, useMemo, useState } from 'react';
import type { ArchitectureViolation } from '../../contracts/analysis/architecture.js';
import type { MapView } from '../../contracts/canvas/index.js';
import { useGraphClient, useProjectContext } from '../components/explorer/project-context';
import { useCanvasStore, useCanvasStoreApi } from '../store/canvas-store';
import { computeLayerBreaks, type LayerBreaks } from '../utils/layer-breaks';
import type { GraphData } from './useGraphData';

/** Keep `store.architectureLayers` in step with `.flowlens/architecture.json` (an unreadable file means no layers). */
export function useArchitectureLayersLoader(): void {
  const client = useGraphClient();
  const { revision } = useProjectContext();
  const rulesRevision = useCanvasStore((s) => s.rulesRevision);
  const store = useCanvasStoreApi();
  useEffect(() => {
    let cancelled = false;
    client.fetchArchitecture().then(
      (cfg) => !cancelled && store.getState().setArchitectureLayers(cfg.layers ?? []),
      () => !cancelled && store.getState().setArchitectureLayers([]),
    );
    return () => {
      cancelled = true;
    };
  }, [client, revision, rulesRevision, store]);
}

export function useLayerBreaks(graph: Pick<GraphData, 'hierarchy' | 'relations' | 'version'>, view: MapView): LayerBreaks {
  const client = useGraphClient();
  const rulesRevision = useCanvasStore((s) => s.rulesRevision);
  const active = view.zoning?.mode === 'layers' && view.zoning.zoneSet.zones.length > 0;
  const [violations, setViolations] = useState<ArchitectureViolation[]>([]);
  useEffect(() => {
    if (!active) {
      setViolations((v) => (v.length === 0 ? v : []));
      return;
    }
    let cancelled = false;
    client.fetchViolations().then(
      (v) => !cancelled && setViolations(v),
      () => !cancelled && setViolations([]),
    );
    return () => {
      cancelled = true;
    };
  }, [active, client, graph.version, rulesRevision]);
  return useMemo(() => (active ? computeLayerBreaks(violations, graph.relations, graph.hierarchy, view.cut) : computeLayerBreaks([], [], graph.hierarchy, undefined)), [active, violations, graph.relations, graph.hierarchy, view.cut]);
}
