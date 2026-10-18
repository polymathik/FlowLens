/**
 * Semantic zoom hook — maps the viewport zoom to a discrete detail tier
 * (`zoomLevelFor`, thresholds from the state contract) and keeps the store
 * in sync. Viewport changes fire on every animation frame while zooming,
 * so updates are rAF-throttled and the store ignores unchanged tiers.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useOnViewportChange, type Viewport } from '@xyflow/react';
import { useCanvasStore } from '../store/canvas-store';
import { zoomLevelFor } from '../utils/zoom';

export function useSemanticZoom() {
  const setZoomLevel = useCanvasStore((s) => s.setZoomLevel);
  const frame = useRef<number | null>(null);
  const latest = useRef(1);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onChange = useCallback(
    (viewport: Viewport) => {
      latest.current = viewport.zoom;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setZoomLevel(zoomLevelFor(latest.current));
      });
    },
    [setZoomLevel],
  );

  useOnViewportChange({ onChange, onEnd: onChange });
}
