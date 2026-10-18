/**
 * Shared Zod schemas for the MCP tool contracts.
 *
 * These schemas are the runtime half of the contract: `src/contracts/mcp/tools.ts`
 * derives every tool Input/Output TypeScript type from them, handlers import
 * those types, and the conformance tests parse real tool output with them.
 *
 * Objects owned by other contracts (Entity, Relation) are `looseObject` so new
 * optional fields added by other lanes don't break MCP conformance; MCP-owned
 * shapes are `strictObject` so undeclared fields are caught as contract drift.
 */

import { z } from 'zod';

export const ENTITY_KINDS = [
  'file', 'module', 'namespace', 'class', 'interface',
  'function', 'method', 'variable', 'field', 'parameter',
  'type', 'enum', 'enum_member', 'decorator',
] as const;

export const RELATION_TYPES = [
  'import', 'call', 'extend', 'implement',
  'override', 'mixin', 'use', 'contain', 'create',
  'parameter', 'return', 'throw', 'decorate',
] as const;

export const EntityKindSchema = z.enum(ENTITY_KINDS);
export const RelationTypeSchema = z.enum(RELATION_TYPES);

/** Progressive disclosure level. `summary` (default) returns compact entity refs. */
export const DetailSchema = z.enum(['summary', 'full']);
export type Detail = z.infer<typeof DetailSchema>;

export const LocationSchema = z.looseObject({
  line_start: z.number(),
  line_end: z.number(),
  column_start: z.number(),
  column_end: z.number(),
});

/** All metrics optional: summary refs carry only a few key metrics. */
export const MetricsSchema = z.looseObject({
  line_count: z.number().optional(),
  cognitive_complexity: z.number().optional(),
  quality_score: z.number().optional(),
  cyclomatic_complexity: z.number().optional(),
  halstead_volume: z.number().optional(),
  halstead_difficulty: z.number().optional(),
  halstead_bugs: z.number().optional(),
  afferent_coupling: z.number().optional(),
  efferent_coupling: z.number().optional(),
  instability: z.number().optional(),
  churn_rate: z.number().optional(),
  hotspot_score: z.number().optional(),
});

/**
 * An entity as returned by a tool. In `summary` detail only the ref fields
 * (id..line + key metrics) are present; `full` adds the remaining Entity fields.
 */
export const EntityViewSchema = z.looseObject({
  id: z.string(),
  kind: EntityKindSchema,
  name: z.string(),
  qualified_name: z.string(),
  file: z.string(),
  line: z.number(),
  metrics: MetricsSchema.optional(),
  location: LocationSchema.optional(),
  visibility: z.string().optional(),
  language: z.string().optional(),
  annotations: z.record(z.string(), z.string()).optional(),
});
export type EntityView = z.infer<typeof EntityViewSchema>;

export const RelationSchema = z.looseObject({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: RelationTypeSchema,
  location: z.looseObject({ file: z.string(), line: z.number(), column: z.number() }),
  weight: z.number(),
  confidence: z.number(),
});

export const SourcePointSchema = z.strictObject({ file: z.string(), line: z.number() });

export const AnnotationSchema = z.strictObject({
  id: z.string(),
  entity_id: z.string(),
  text: z.string(),
  category: z.enum(['convention', 'decision', 'warning', 'todo']),
  author: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Envelope shared by every tool response.
 *
 * Semantics for list tools (contract revision 2, Phase 10):
 * - `total_count`  — number of items matching the query after filters, before the limit
 * - `returned_count` — number of items in the response's primary list
 * - `truncated`    — `returned_count < total_count`
 * - `total_is_estimate` — present (true) only when `total_count` is a lower bound
 * - `limit`        — the effective limit after clamping to the cap
 * Non-list tools omit the counts and always report `truncated: false`.
 */
export function toolResponseSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({
    data,
    last_indexed: z.string(),
    truncated: z.boolean(),
    total_count: z.number().int().nonnegative().optional(),
    returned_count: z.number().int().nonnegative().optional(),
    total_is_estimate: z.literal(true).optional(),
    limit: z.number().int().positive().optional(),
    detail: DetailSchema.optional(),
    canvas_url: z.string().optional(),
  });
}

export const ToolErrorCodeSchema = z.enum([
  'not_found', 'ambiguous', 'invalid_argument', 'no_snapshot', 'no_architecture', 'internal',
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export const EntityCandidateSchema = z.strictObject({
  id: z.string(),
  kind: EntityKindSchema,
  qualified_name: z.string(),
  file: z.string(),
  line: z.number(),
});
export type EntityCandidate = z.infer<typeof EntityCandidateSchema>;

/** Body of an `isError: true` tool result. */
export const ToolErrorSchema = z.strictObject({
  error: z.string(),
  code: ToolErrorCodeSchema,
  suggestions: z.array(z.string()),
  candidates: z.array(EntityCandidateSchema).optional(),
  last_indexed: z.string(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

/** Common optional input fields. */
export const maxResultsField = (def: number, cap: number) =>
  z.number().int().min(1).optional()
    .describe(`Max items to return (default ${def}, capped at ${cap}). total_count always reports the full match count.`);

export const detailField = () =>
  DetailSchema.optional()
    .describe("'summary' (default): compact entity refs; 'full': complete entity/relation objects");
