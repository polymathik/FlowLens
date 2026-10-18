/**
 * Compile-time contract conformance (checked by `npm run lint` / `tsc`;
 * erased at runtime — type-only imports).
 *
 * Fails the build if a handler's input type drifts from
 * `contracts/mcp/tools.ts`, or if the Zod schemas drift from the
 * hand-written analysis types they mirror. Runtime output conformance is
 * tested in test/integration/mcp-correctness/e2e.test.ts.
 */

import type { z } from 'zod';
import type * as T from '../contracts/mcp/tools.js';
import type { AnalysisToolSchemas } from '../contracts/mcp/tools.js';
import type { DetectedCycle } from '../contracts/analysis/cycles.js';
import type { HotspotEntry } from '../contracts/analysis/hotspots.js';
import type { ArchitectureViolation } from '../contracts/analysis/architecture.js';
import type { InterfaceDiffEntry } from '../contracts/analysis/diff.js';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import type { ArchitectureConfigSchema } from '../contracts/analysis/architecture-config-schema.js';
import type { MCPToolResponse } from '../contracts/mcp/server.js';
import type { toolResponseSchema } from '../contracts/mcp/schemas/common.js';
import type { handleGetContext } from './tools/get-context.js';
import type { handleGetDependents } from './tools/get-dependents.js';
import type { handleGetModuleInterface } from './tools/get-module-interface.js';
import type { handleAnnotate } from './tools/annotate.js';
import type { handleTraverse } from './tools/traverse.js';
import type { handleDetectCycles } from './tools/detect-cycles.js';
import type { handleGetMetrics } from './tools/get-metrics.js';
import type { handleDiffInterface } from './tools/diff-interface.js';
import type { handleCheckArchitecture } from './tools/check-architecture.js';
import type { handleGetSummary } from './tools/get-summary.js';
import type { handleGetHotspots } from './tools/get-hotspots.js';
import type { handleGetLayerMap } from './tools/get-layer-map.js';

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type In<F extends (...a: never[]) => unknown> = Parameters<F>[0];
type S = typeof AnalysisToolSchemas;

export type ContractConformance = [
  Equals<In<typeof handleGetContext>, T.GetContextInput>,
  Equals<In<typeof handleGetDependents>, T.GetDependentsInput>,
  Equals<In<typeof handleGetModuleInterface>, T.GetModuleInterfaceInput>,
  Equals<In<typeof handleAnnotate>, T.AnnotateInput>,
  Equals<In<typeof handleTraverse>, T.TraverseInput>,
  Equals<In<typeof handleDetectCycles>, T.DetectCyclesInput>,
  Equals<In<typeof handleGetMetrics>, T.GetMetricsInput>,
  Equals<In<typeof handleDiffInterface>, T.DiffInterfaceInput>,
  Equals<In<typeof handleCheckArchitecture>, T.CheckArchitectureInput>,
  Equals<In<typeof handleGetSummary>, T.GetSummaryInput>,
  Equals<In<typeof handleGetHotspots>, T.GetHotspotsInput>,
  Equals<In<typeof handleGetLayerMap>, T.GetLayerMapInput>,
  Equals<z.infer<S['DetectedCycleSchema']>, DetectedCycle>,
  Equals<z.infer<S['HotspotEntrySchema']>, HotspotEntry>,
  Extends<ArchitectureViolation, z.infer<S['ArchitectureViolationSchema']>>,
  Extends<InterfaceDiffEntry, z.infer<S['InterfaceDiffEntrySchema']>>,
  Extends<z.infer<typeof ArchitectureConfigSchema>, ArchitectureConfig>,
  Extends<MCPToolResponse<unknown>, z.infer<ReturnType<typeof toolResponseSchema<z.ZodUnknown>>>>,
];

/** Every element must be `true`; a drift turns one into `false` and fails here. */
export const CONTRACT_CONFORMANCE: ContractConformance = [
  true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true,
];
