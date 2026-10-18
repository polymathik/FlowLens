/**
 * MCP tool contracts — the single source of truth for every tool's input and
 * output (contract revision 2, Phase 10). Types are derived from the Zod
 * schemas in `./schemas/`, so the runtime checks and the compile-time types
 * can't drift. Handlers in `src/mcp/tools/` import their Input/Output types
 * and input shapes from here; `TOOL_CONTRACTS` lets tests validate real
 * output against the envelope + data schema of every tool.
 *
 * Revision 2 changes vs. the Phase 4 draft are listed in
 * `_docs/specs/PHASE-10-MCP-CORRECTNESS.md` ("Contract revisions").
 */

import { z } from 'zod';
import { toolResponseSchema } from './schemas/common.js';
import * as E from './schemas/entity-tools.js';
import * as A from './schemas/analysis-tools.js';

export type { Detail, EntityView, ToolError, ToolErrorCode, EntityCandidate } from './schemas/common.js';
export type { MetricSortField } from './schemas/analysis-tools.js';
export { LIMITS } from './schemas/entity-tools.js';
export { ANALYSIS_LIMITS, METRIC_SORT_FIELDS } from './schemas/analysis-tools.js';

type InputOf<S extends z.ZodRawShape> = z.input<z.ZodObject<S>>;

export type GetContextInput = InputOf<typeof E.GetContextInputShape>;
export type GetContextOutput = z.infer<typeof E.GetContextOutputSchema>;
export type ContextRelation = z.infer<typeof E.ContextRelationSchema>;

export type GetDependentsInput = InputOf<typeof E.GetDependentsInputShape>;
export type GetDependentsOutput = z.infer<typeof E.GetDependentsOutputSchema>;
export type DependentEntry = z.infer<typeof E.DependentEntrySchema>;

export type GetModuleInterfaceInput = InputOf<typeof E.GetModuleInterfaceInputShape>;
export type GetModuleInterfaceOutput = z.infer<typeof E.GetModuleInterfaceOutputSchema>;
export type ExportEntry = z.infer<typeof E.ExportEntrySchema>;

export type AnnotateInput = InputOf<typeof E.AnnotateInputShape>;
export type AnnotateOutput = z.infer<typeof E.AnnotateOutputSchema>;

export type TraverseInput = InputOf<typeof E.TraverseInputShape>;
export type TraverseOutput = z.infer<typeof E.TraverseOutputSchema>;
export type TraverseNode = z.infer<typeof E.TraverseNodeSchema>;
export type TraverseEdge = z.infer<typeof E.TraverseEdgeSchema>;
export type BoundaryStop = z.infer<typeof E.BoundaryStopSchema>;

export type DetectCyclesInput = InputOf<typeof A.DetectCyclesInputShape>;
export type DetectCyclesOutput = z.infer<typeof A.DetectCyclesOutputSchema>;

export type GetMetricsInput = InputOf<typeof A.GetMetricsInputShape>;
export type GetMetricsOutput = z.infer<typeof A.GetMetricsOutputSchema>;
export type MetricsEntry = z.infer<typeof A.MetricsEntrySchema>;

export type DiffInterfaceInput = InputOf<typeof A.DiffInterfaceInputShape>;
export type DiffInterfaceOutput = z.infer<typeof A.DiffInterfaceOutputSchema>;

export type CheckArchitectureInput = InputOf<typeof A.CheckArchitectureInputShape>;
export type CheckArchitectureOutput = z.infer<typeof A.CheckArchitectureOutputSchema>;
export type LayerStat = z.infer<typeof A.LayerStatSchema>;

export type GetSummaryInput = InputOf<typeof A.GetSummaryInputShape>;
export type GetSummaryOutput = z.infer<typeof A.GetSummaryOutputSchema>;

export type GetHotspotsInput = InputOf<typeof A.GetHotspotsInputShape>;
export type GetHotspotsOutput = z.infer<typeof A.GetHotspotsOutputSchema>;

export type GetLayerMapInput = InputOf<typeof A.GetLayerMapInputShape>;
export type GetLayerMapOutput = z.infer<typeof A.GetLayerMapOutputSchema>;

/** Per-tool contract: input shape, data schema, and whether it is a paginated list tool. */
export interface ToolContract {
  input: z.ZodRawShape;
  output: z.ZodType;
  /** Name of the list field in `data` that max_results limits (list tools only). */
  list?: string;
}

export const TOOL_CONTRACTS = {
  get_context: { input: E.GetContextInputShape, output: E.GetContextOutputSchema, list: 'relations' },
  get_dependents: { input: E.GetDependentsInputShape, output: E.GetDependentsOutputSchema, list: 'dependents' },
  get_module_interface: { input: E.GetModuleInterfaceInputShape, output: E.GetModuleInterfaceOutputSchema, list: 'exports' },
  annotate: { input: E.AnnotateInputShape, output: E.AnnotateOutputSchema },
  traverse: { input: E.TraverseInputShape, output: E.TraverseOutputSchema, list: 'nodes' },
  detect_cycles: { input: A.DetectCyclesInputShape, output: A.DetectCyclesOutputSchema, list: 'cycles' },
  get_metrics: { input: A.GetMetricsInputShape, output: A.GetMetricsOutputSchema, list: 'entries' },
  diff_interface: { input: A.DiffInterfaceInputShape, output: A.DiffInterfaceOutputSchema, list: 'changes' },
  check_architecture: { input: A.CheckArchitectureInputShape, output: A.CheckArchitectureOutputSchema, list: 'violations' },
  get_summary: { input: A.GetSummaryInputShape, output: A.GetSummaryOutputSchema },
  get_hotspots: { input: A.GetHotspotsInputShape, output: A.GetHotspotsOutputSchema, list: 'hotspots' },
  get_layer_map: { input: A.GetLayerMapInputShape, output: A.GetLayerMapOutputSchema },
} as const satisfies Record<string, ToolContract>;

export type ToolName = keyof typeof TOOL_CONTRACTS;
export const TOOL_NAMES = Object.keys(TOOL_CONTRACTS) as ToolName[];

/** Full envelope schema for a tool: `{ data, last_indexed, truncated, ... }`. */
export function toolEnvelopeSchema(name: ToolName) {
  return toolResponseSchema(TOOL_CONTRACTS[name].output);
}

export * as EntityToolSchemas from './schemas/entity-tools.js';
export * as AnalysisToolSchemas from './schemas/analysis-tools.js';
