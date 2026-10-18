/**
 * Data the overlays need beyond node metrics. Shapes are the minimal
 * subsets of the analysis contracts the canvas reads, so partial or older
 * server payloads still render.
 */
import type { DetectedCycle } from '../../contracts/analysis/cycles.js';
import type { ArchitectureViolation } from '../../contracts/analysis/architecture.js';
import type { InterfaceDiffEntry } from '../../contracts/analysis/diff.js';

export interface OverlayExtraData {
  cycles?: Array<Pick<DetectedCycle, 'entities'>>;
  violations?: Array<Partial<Pick<ArchitectureViolation, 'entity_from' | 'entity_to'>>>;
  diffChanges?: Array<Pick<InterfaceDiffEntry, 'entity_id' | 'change_type'>>;
}
