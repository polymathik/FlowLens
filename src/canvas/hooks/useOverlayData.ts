/**
 * Loads the extra data an overlay needs (cycles, violations, diff) when it
 * is switched on. A live rule-editor preview (store.previewViolations)
 * takes precedence over the saved rules' violations.
 */
import { useEffect, useState } from 'react';
import { fetchCycles, fetchDiff, fetchViolations } from '../api/graph-client';
import { useCanvasStore } from '../store/canvas-store';
import type { OverlayExtraData } from '../overlays/types';

export function useOverlayData(graphVersion: number): OverlayExtraData {
  const activeOverlay = useCanvasStore((s) => s.activeOverlay);
  const diffSha = useCanvasStore((s) => s.diffSha);
  const preview = useCanvasStore((s) => s.previewViolations);
  const [data, setData] = useState<OverlayExtraData>({});

  useEffect(() => {
    let cancelled = false;
    const done = (d: OverlayExtraData) => {
      if (!cancelled) setData(d);
    };
    const ignore = () => done({});

    if (activeOverlay === 'cycles') {
      fetchCycles().then((cycles) => done({ cycles }), ignore);
    } else if (activeOverlay === 'architecture-violations') {
      if (preview) done({ violations: preview });
      else fetchViolations().then((violations) => done({ violations }), ignore);
    } else if (activeOverlay === 'interface-diff' && diffSha) {
      fetchDiff(diffSha).then((diff) => done({ diffChanges: diff.changes ?? [] }), ignore);
    } else {
      done({});
    }
    return () => {
      cancelled = true;
    };
  }, [activeOverlay, diffSha, preview, graphVersion]);

  return data;
}
