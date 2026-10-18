/**
 * Input shapes and output data schemas for the analysis MCP tools:
 * detect_cycles, get_metrics, diff_interface, check_architecture,
 * get_summary, get_hotspots, get_layer_map.
 */

import { z } from 'zod';
import {
  EntityKindSchema, MetricsSchema, RelationTypeSchema, detailField, maxResultsField,
} from './common.js';

export const ANALYSIS_LIMITS = {
  cycles: { default: 50, cap: 250 },
  metrics: { default: 25, cap: 250 },
  diff: { default: 50, cap: 250 },
  architecture: { default: 50, cap: 250 },
  hotspots: { default: 20, cap: 250 },
} as const;

/* ---------------- shared analysis shapes ---------------- */

export const CycleSeveritySchema = z.enum(['low', 'medium', 'high']);
export const CycleGranularitySchema = z.enum(['file', 'module', 'function', 'all']);

export const DetectedCycleSchema = z.strictObject({
  id: z.string(),
  entities: z.array(z.string()),
  granularity: CycleGranularitySchema,
  severity: CycleSeveritySchema,
  relation_types: z.array(RelationTypeSchema),
  length: z.number().int(),
  path: z.array(z.string()).optional(),
  path_labels: z.array(z.string()).optional(),
  edges: z.array(z.strictObject({
    from: z.string(), to: z.string(), relation_types: z.array(RelationTypeSchema),
  })).optional(),
  severity_reasons: z.array(z.string()).optional(),
  layers: z.array(z.string()).optional(),
});

export const InterfaceDiffEntrySchema = z.strictObject({
  entity_id: z.string(),
  entity_name: z.string(),
  change_type: z.enum([
    'added', 'removed', 'modified', 'visibility',
    'parameter_added', 'parameter_removed', 'type_changed', 'return_changed',
  ]),
  severity: z.enum(['breaking', 'non-breaking']),
  affected_dependents: z.number(),
  details: z.string(),
  /** full detail only */
  before: z.looseObject({}).optional(),
  after: z.looseObject({}).optional(),
});

export const ArchitectureViolationSchema = z.strictObject({
  id: z.string(),
  rule: z.string(),
  layer_from: z.string(),
  layer_to: z.string(),
  entity_from: z.string(),
  entity_to: z.string(),
  relation_type: RelationTypeSchema,
  location: z.strictObject({ file: z.string(), line: z.number(), column: z.number() }),
  auto_fix_suggestion: z.string().optional(),
  rule_text: z.string().optional(),
  entity_from_name: z.string().optional(),
  entity_to_name: z.string().optional(),
});

export const HotspotEntrySchema = z.strictObject({
  entity_id: z.string(),
  entity_name: z.string(),
  entity_kind: EntityKindSchema,
  file: z.string(),
  hotspot_score: z.number(),
  churn_rate: z.number(),
  cognitive_complexity: z.number(),
  dependent_count: z.number().int(),
  qualified_name: z.string().optional(),
  change_count: z.number().int().optional(),
  last_changed: z.string().optional(),
});

/* ---------------- detect_cycles ---------------- */

export const DetectCyclesInputShape = {
  granularity: CycleGranularitySchema.optional()
    .describe("file | module (directory) | function (call graph) | all (= file+module+function). Default all"),
  scope: z.string().optional().describe('Only cycles with a member under this path prefix'),
  relation_types: z.array(RelationTypeSchema).optional().describe('Relation types forming edges (file/module)'),
  severity_threshold: CycleSeveritySchema.optional().describe('Minimum severity'),
  max_results: maxResultsField(ANALYSIS_LIMITS.cycles.default, ANALYSIS_LIMITS.cycles.cap),
};

export const DetectCyclesOutputSchema = z.strictObject({
  cycles: z.array(DetectedCycleSchema),
  summary: z.strictObject({
    total_cycles: z.number().int(),
    by_severity: z.strictObject({ high: z.number().int(), medium: z.number().int(), low: z.number().int() }),
    by_granularity: z.record(z.string(), z.number().int()),
  }),
});

/* ---------------- get_metrics ---------------- */

export const METRIC_SORT_FIELDS = [
  'cognitive_complexity', 'cyclomatic_complexity', 'quality_score',
  'halstead_volume', 'halstead_difficulty', 'halstead_bugs', 'line_count',
  'instability', 'afferent_coupling', 'efferent_coupling', 'churn_rate', 'hotspot_score',
] as const;
export type MetricSortField = typeof METRIC_SORT_FIELDS[number];

export const GetMetricsInputShape = {
  entity: z.string().optional().describe('Entity identifier (omit for a ranked list)'),
  kind: EntityKindSchema.optional().describe('Filter by entity kind'),
  sort_by: z.enum(METRIC_SORT_FIELDS).optional()
    .describe('Metric to rank by, descending (quality_score: ascending = worst first). Default cognitive_complexity'),
  max_results: maxResultsField(ANALYSIS_LIMITS.metrics.default, ANALYSIS_LIMITS.metrics.cap),
  detail: detailField(),
};

export const MetricsEntrySchema = z.strictObject({
  entity_id: z.string(),
  entity_name: z.string(),
  qualified_name: z.string(),
  entity_kind: EntityKindSchema,
  file: z.string(),
  line: z.number(),
  metrics: MetricsSchema,
});

export const GetMetricsOutputSchema = z.strictObject({
  sort_by: z.enum(METRIC_SORT_FIELDS),
  entries: z.array(MetricsEntrySchema),
  summary: z.strictObject({
    avg_quality: z.number().nullable(),
    highest_complexity_entity: z.string().nullable(),
    bug_density: z.number(),
    most_unstable: z.array(z.strictObject({ name: z.string(), instability: z.number() })),
  }),
});

/* ---------------- diff_interface ---------------- */

export const DiffInterfaceInputShape = {
  since: z.string().min(1).describe('Snapshot ref: full/short SHA, HEAD~1, tag or branch'),
  scope: z.string().optional().describe('Restrict diff to a file path prefix'),
  breaking_only: z.boolean().optional().describe('Only breaking changes (default true)'),
  max_results: maxResultsField(ANALYSIS_LIMITS.diff.default, ANALYSIS_LIMITS.diff.cap),
  detail: detailField(),
};

export const DiffInterfaceOutputSchema = z.strictObject({
  requested_ref: z.string(),
  from_sha: z.string(),
  to_sha: z.string(),
  changes: z.array(InterfaceDiffEntrySchema),
  summary: z.strictObject({
    total_changes: z.number().int(),
    breaking_changes: z.number().int(),
    non_breaking_changes: z.number().int(),
    most_impacted_entity: z.string().optional(),
  }),
});

/* ---------------- check_architecture ---------------- */

export const CheckArchitectureInputShape = {
  scope: z.string().optional().describe('Only violations whose source location is under this path prefix'),
  max_results: maxResultsField(ANALYSIS_LIMITS.architecture.default, ANALYSIS_LIMITS.architecture.cap),
};

export const LayerStatSchema = z.strictObject({
  name: z.string(),
  entity_count: z.number().int(),
  violation_count: z.number().int(),
});

export const CheckArchitectureOutputSchema = z.strictObject({
  violations: z.array(ArchitectureViolationSchema),
  layers: z.array(LayerStatSchema),
  summary: z.strictObject({
    total_violations: z.number().int(),
    layers_with_violations: z.array(z.string()),
  }),
});

/* ---------------- get_summary ---------------- */

export const GetSummaryInputShape = {};

export const GetSummaryOutputSchema = z.strictObject({
  entities: z.record(z.string(), z.number().int()),
  relations: z.record(z.string(), z.number().int()),
  languages: z.record(z.string(), z.strictObject({ files: z.number().int(), entities: z.number().int() })),
  /** Top 10 directory modules by entity count. */
  top_modules: z.array(z.strictObject({ path: z.string(), entity_count: z.number().int() })),
  average_quality_score: z.number(),
  layers: z.array(z.strictObject({ name: z.string(), entity_count: z.number().int() })),
  /** File-level dependency cycles. */
  cycle_count: z.number().int(),
  last_indexed: z.string(),
});

/* ---------------- get_hotspots ---------------- */

export const GetHotspotsInputShape = {
  kind: EntityKindSchema.optional().describe('Filter by entity kind'),
  min_score: z.number().min(0).optional().describe('Minimum hotspot score'),
  include_zero: z.boolean().optional().describe('Include entities with score 0 (no recent churn). Default false'),
  max_results: maxResultsField(ANALYSIS_LIMITS.hotspots.default, ANALYSIS_LIMITS.hotspots.cap),
};

export const GetHotspotsOutputSchema = z.strictObject({
  hotspots: z.array(HotspotEntrySchema),
  summary: z.strictObject({
    total_hotspots: z.number().int(),
    avg_hotspot_score: z.number(),
    highest_hotspot: z.string().nullable(),
    churn_period_days: z.number().int(),
  }),
});

/* ---------------- get_layer_map ---------------- */

export const GetLayerMapInputShape = {};

export const GetLayerMapOutputSchema = z.strictObject({
  version: z.number(),
  inferred_by: z.string(),
  layers: z.array(z.strictObject({
    name: z.string(),
    include: z.looseObject({}),
    entity_count: z.number().int(),
    violation_count: z.number().int(),
    may_only_access: z.array(z.string()),
    must_not_access: z.array(z.string()),
  })),
  unassigned_count: z.number().int(),
  summary: z.strictObject({
    total_layers: z.number().int(),
    total_entities_assigned: z.number().int(),
    total_violations: z.number().int(),
  }),
});
