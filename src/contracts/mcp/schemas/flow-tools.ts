/**
 * MCP contracts of the flow tools (Map v2, M6a): `trace_flow` and
 * `list_entry_points`. The input shapes and the data schemas are defined once
 * in `src/contracts/flow.ts` (shared with the REST routes and the CLI); this
 * file only re-exports them under the MCP naming used by `TOOL_CONTRACTS`.
 */
import { z } from 'zod';
import {
  EntryPointsInputShape, EntryPointsResultSchema, FlowTraceInputShape, TraceFlowOutputSchema,
} from '../../flow.js';

export const TraceFlowInputShape = FlowTraceInputShape;
export const TraceFlowDataSchema = TraceFlowOutputSchema;
export const ListEntryPointsInputShape = EntryPointsInputShape;
export const ListEntryPointsDataSchema = EntryPointsResultSchema;

export type TraceFlowInput = z.input<z.ZodObject<typeof TraceFlowInputShape>>;
export type ListEntryPointsInput = z.input<z.ZodObject<typeof ListEntryPointsInputShape>>;
