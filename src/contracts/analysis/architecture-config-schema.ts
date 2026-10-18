/**
 * Runtime schema for `.flowlens/architecture.json`, mirroring the
 * `ArchitectureConfig` type in `contracts/architecture.ts` (type-tested).
 * Used by the single `loadArchConfig` helper to reject invalid files.
 */

import { z } from 'zod';

export const ArchitectureLayerSchema = z.looseObject({
  name: z.string().min(1),
  include: z.looseObject({
    patterns: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
  }),
  may_only_access: z.array(z.string()).optional(),
  must_not_access: z.array(z.string()).optional(),
});

export const ArchitectureConfigSchema = z.looseObject({
  version: z.literal(2),
  inferred_by: z.enum(['heuristic', 'ai:anthropic', 'ai:ollama', 'manual']),
  inferred_at: z.string(),
  layers: z.array(ArchitectureLayerSchema),
});

/** Result of loading architecture.json. */
export type ArchConfigLoadResult =
  | { status: 'ok'; config: import('../architecture.js').ArchitectureConfig; path: string }
  | { status: 'missing'; path: string }
  | { status: 'invalid'; path: string; message: string };
