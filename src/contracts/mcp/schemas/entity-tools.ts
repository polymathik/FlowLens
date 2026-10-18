/**
 * Input shapes and output data schemas for the entity-centric MCP tools:
 * get_context, get_dependents, get_module_interface, annotate, traverse.
 *
 * Input shapes are raw Zod shapes (what `McpServer.registerTool` expects);
 * output schemas describe the `data` field of the response envelope.
 */

import { z } from 'zod';
import {
  AnnotationSchema, EntityViewSchema, RelationSchema,
  RelationTypeSchema, SourcePointSchema, detailField, maxResultsField,
} from './common.js';
import { InterfaceDiffEntrySchema } from './analysis-tools.js';

export const LIMITS = {
  context: { default: 25, cap: 250, depthDefault: 2, depthCap: 5 },
  dependents: { default: 50, cap: 250 },
  moduleInterface: { default: 50, cap: 250 },
  traverse: { default: 50, cap: 500, depthDefault: 3, depthCap: 10 },
} as const;

const entityField = () =>
  z.string().min(1).describe('Entity: id, qualified name, file path, or (unique) name');

/* ---------------- get_context ---------------- */

export const GetContextInputShape = {
  entity: entityField(),
  depth: z.number().int().min(1).optional()
    .describe(`Relation traversal depth (default ${LIMITS.context.depthDefault}, max ${LIMITS.context.depthCap})`),
  relation_types: z.array(RelationTypeSchema).optional().describe('Only follow these relation types'),
  include_metrics: z.boolean().optional().describe('Include the entity metrics (default true)'),
  max_results: maxResultsField(LIMITS.context.default, LIMITS.context.cap),
  detail: detailField(),
};

export const ContextRelationSchema = z.strictObject({
  direction: z.enum(['inbound', 'outbound']),
  relation_type: RelationTypeSchema,
  depth: z.number().int().positive(),
  entity: EntityViewSchema,
  location: SourcePointSchema,
  /** full detail only */
  relation: RelationSchema.optional(),
});

export const GetContextOutputSchema = z.strictObject({
  /** The resolved entity; its `metrics` are complete when include_metrics (default). */
  entity: EntityViewSchema,
  relations: z.array(ContextRelationSchema),
  /** Counts over all matching relations (not just the returned page). */
  relation_counts: z.strictObject({
    inbound: z.number().int(),
    outbound: z.number().int(),
    by_type: z.record(z.string(), z.number().int()),
  }),
  annotations: z.array(AnnotationSchema),
});

/* ---------------- get_dependents ---------------- */

export const GetDependentsInputShape = {
  entity: entityField(),
  include_transitive: z.boolean().optional().describe('Include transitive dependents (default false)'),
  relation_types: z.array(RelationTypeSchema).optional()
    .describe("Relation types to follow (default: all except 'contain')"),
  max_results: maxResultsField(LIMITS.dependents.default, LIMITS.dependents.cap),
  detail: detailField(),
};

export const DependentEntrySchema = z.strictObject({
  entity: EntityViewSchema,
  relation_type: RelationTypeSchema,
  depth: z.number().int().positive(),
  is_direct: z.boolean(),
  location: SourcePointSchema,
  relation: RelationSchema.optional(),
});

export const GetDependentsOutputSchema = z.strictObject({
  entity: EntityViewSchema,
  dependents: z.array(DependentEntrySchema),
  direct_count: z.number().int(),
  transitive_count: z.number().int(),
  /** Share of all entities that (transitively, if requested) depend on this one, 0..1. */
  risk_score: z.number().min(0).max(1),
});

/* ---------------- get_module_interface ---------------- */

export const GetModuleInterfaceInputShape = {
  module: z.string().min(1).describe('Module/file: file path, directory module path, id, or qualified name'),
  include_private: z.boolean().optional().describe('Include non-public entities (default false)'),
  diff_since: z.string().optional().describe('Snapshot ref to diff against: full/short SHA, HEAD~1, branch'),
  max_results: maxResultsField(LIMITS.moduleInterface.default, LIMITS.moduleInterface.cap),
  detail: detailField(),
};

export const ExportEntrySchema = z.strictObject({
  entity: EntityViewSchema,
  type_signature: z.string().optional(),
  /** Distinct entities referencing this export (excluding containment). */
  dependent_count: z.number().int(),
  diff: z.array(InterfaceDiffEntrySchema).optional(),
});

export const GetModuleInterfaceOutputSchema = z.strictObject({
  module: EntityViewSchema,
  exports: z.array(ExportEntrySchema),
  diff_since_sha: z.string().optional(),
});

/* ---------------- annotate ---------------- */

export const AnnotateInputShape = {
  entity: entityField(),
  text: z.string().min(1).describe('Annotation text'),
  category: z.enum(['convention', 'decision', 'warning', 'todo']).describe('Annotation category'),
  author: z.string().optional().describe("Author name (default 'unknown')"),
};

export const AnnotateOutputSchema = z.strictObject({
  annotation_id: z.string(),
  entity_id: z.string(),
  created_at: z.string(),
});

/* ---------------- traverse ---------------- */

export const TraverseInputShape = {
  start: entityField(),
  direction: z.enum(['inbound', 'outbound', 'both']).describe('Traversal direction'),
  relation_types: z.array(RelationTypeSchema).optional().describe('Only follow these relation types'),
  max_depth: z.number().int().min(1).optional()
    .describe(`Max depth (default ${LIMITS.traverse.depthDefault}, max ${LIMITS.traverse.depthCap})`),
  max_nodes: z.number().int().min(1).optional()
    .describe(`Max nodes (default ${LIMITS.traverse.default}, max ${LIMITS.traverse.cap}); total_count reports all reachable`),
  stop_at_boundary: z.boolean().optional()
    .describe('Do not expand past architecture layer boundary crossings (needs architecture.json)'),
  detail: detailField(),
};

export const TraverseNodeSchema = z.strictObject({
  entity: EntityViewSchema,
  depth: z.number().int().positive(),
  layer: z.string().nullable().optional(),
  /** True when this node is across a layer boundary and was not expanded. */
  boundary: z.literal(true).optional(),
});

export const TraverseEdgeSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  type: RelationTypeSchema,
  direction: z.enum(['inbound', 'outbound']),
  relation: RelationSchema.optional(),
});

export const BoundaryStopSchema = z.strictObject({
  entity: z.string(),
  from_layer: z.string().nullable(),
  to_layer: z.string().nullable(),
});

export const TraverseOutputSchema = z.strictObject({
  start: EntityViewSchema,
  start_layer: z.string().nullable().optional(),
  nodes: z.array(TraverseNodeSchema),
  /** Edges between the start and returned nodes only. */
  edges: z.array(TraverseEdgeSchema),
  stopped_at_boundaries: z.array(BoundaryStopSchema),
});
