/**
 * Semantic zoom hook — maps the React Flow viewport zoom level to a
 * discrete ZoomLevel ('system' | 'module' | 'file' | 'entity') and
 * keeps the Zustand store in sync as the user zooms in/out.
 */
import { useOnViewportChange } from '@xyflow/react';
import { useCanvasStore, type ZoomLevel } from '../store/canvas-store';
import { useCallback } from 'react';

function getZoomLevel(zoom: number): ZoomLevel {
  if (zoom < 0.3) return 'system';
  if (zoom < 0.7) return 'module';
  if (zoom < 1.5) return 'file';
  return 'entity';
}

export function useSemanticZoom() {
  const setZoomLevel = useCanvasStore((s) => s.setZoomLevel);

  useOnViewportChange({
    onChange: useCallback(
      (viewport: { zoom: number }) => {
        setZoomLevel(getZoomLevel(viewport.zoom));
      },
      [setZoomLevel],
    ),
  });
}
