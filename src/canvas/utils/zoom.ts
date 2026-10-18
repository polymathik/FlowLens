/**
 * Semantic zoom mapping — continuous viewport zoom → discrete detail tier,
 * driven by `ZOOM_THRESHOLDS` from the canvas state contract.
 */
import {
  ZOOM_THRESHOLDS,
  type ZoomLevel,
} from '../../contracts/canvas/index.js';

export function zoomLevelFor(zoom: number): ZoomLevel {
  if (zoom < ZOOM_THRESHOLDS.system) return 'system';
  if (zoom < ZOOM_THRESHOLDS.module) return 'module';
  if (zoom < ZOOM_THRESHOLDS.file) return 'file';
  return 'entity';
}

/** Plain-language label for the detail tier shown in the toolbar. */
export const DETAIL_LABELS: Record<ZoomLevel, string> = {
  system: 'overview',
  module: 'low detail',
  file: 'normal detail',
  entity: 'full detail',
};
